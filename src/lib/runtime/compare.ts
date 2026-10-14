import type { StaticAnalysisReport } from "@/lib/types/static-analysis";
import {
  runtimeBundleSchema,
  type RuntimeBundle,
  type RuntimeComparison,
  type ProbeEvent,
} from "@/lib/runtime/contracts";

export function validateRuntimeBinding(
  value: unknown,
  report: StaticAnalysisReport,
): RuntimeBundle {
  const bundle = runtimeBundleSchema.parse(value);
  if (
    bundle.analysisId !== report.id ||
    bundle.packageName !== report.input.packageName ||
    bundle.trusted.version !== report.input.trustedVersion ||
    bundle.candidate.version !== report.input.candidateVersion ||
    bundle.trusted.archiveSha256 !== report.releases.trusted.archiveSha256 ||
    bundle.candidate.archiveSha256 !== report.releases.candidate.archiveSha256
  )
    throw new Error(
      "Runtime evidence does not match the static report's releases and archive hashes.",
    );
  return bundle;
}

export function compareRuntime(bundle: RuntimeBundle): RuntimeComparison {
  const comparable =
    bundle.trusted.status === "completed" &&
    bundle.candidate.status === "completed" &&
    !bundle.trusted.truncated &&
    !bundle.candidate.truncated &&
    bundle.trusted.imageId === bundle.candidate.imageId &&
    bundle.trusted.profile === bundle.candidate.profile;
  const rows = new Map<
    string,
    { event: ProbeEvent; old: number; next: number; evidenceIds: string[] }
  >();
  for (const [role, run] of [
    ["trusted", bundle.trusted],
    ["candidate", bundle.candidate],
  ] as const) {
    run.events.forEach((event, index) => {
      const key = JSON.stringify([
        event.category,
        event.operation,
        event.target,
        event.outcome,
      ]);
      const row = rows.get(key) ?? { event, old: 0, next: 0, evidenceIds: [] };
      if (role === "trusted") row.old++;
      else row.next++;
      row.evidenceIds.push(
        `RUN-${role === "trusted" ? "T" : "C"}-${index + 1}`,
      );
      rows.set(key, row);
    });
  }
  const differences: RuntimeComparison["differences"] = comparable
    ? [...rows.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([, row], index) => ({
          id: `DIFF-${index + 1}`,
          ...row.event,
          trustedCount: row.old,
          candidateCount: row.next,
          change:
            row.next === row.old
              ? "unchanged"
              : row.next < row.old
                ? "decreased"
                : row.old === 0
                  ? "introduced"
                  : "increased",
          evidenceIds: row.evidenceIds,
        }))
    : [];
  const introduced = differences.filter(
    (row) => row.change === "introduced" || row.change === "increased",
  ).length;
  return {
    bundle,
    comparable,
    differences,
    summary: comparable
      ? `${introduced} introduced or increased instrumented API patterns during the import probes. These are unverified runtime signals, not proof of successful actions or malicious intent.`
      : "The two probes do not provide comparable complete observations. Differential conclusions are withheld; partial events remain available for inspection.",
    counts: (["network", "environment", "process", "filesystem"] as const).map(
      (category) => ({
        category,
        trusted: bundle.trusted.events.filter(
          (event) => event.category === category,
        ).length,
        candidate: bundle.candidate.events.filter(
          (event) => event.category === category,
        ).length,
      }),
    ),
    limitations: [
      "Experimental import-only probe: exports are not invoked, dependencies are not installed, and lifecycle scripts are not run. Missing dependencies or unsupported entry points can prevent import.",
      "Events come from in-process JavaScript hooks. Package code can bypass, alter, or forge them. They are UNVERIFIED RISK signals, not authenticated operating-system telemetry.",
      "Network and process hooks deny intercepted attempts. Docker also disables external networking. An attempt is not a successful network request or child-process execution. Filesystem events record calls, not confirmed writes.",
      "Only synthetic environment values are supplied. No host credentials, environment values, package stdout, stderr, file contents, or command arguments are included in the evidence.",
      "One import per release with a short observation window cannot establish absence of behavior, causality, repeatability, or safety. Native binaries, non-UTF-8 files, large packages, and transitive dependency behavior are outside this profile.",
      "Local evidence is schema-validated and tied to archive hashes, but it is not cryptographically attested. No numeric risk score or AI verdict is generated.",
    ],
  };
}
