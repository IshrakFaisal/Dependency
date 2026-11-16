import { z } from "zod";
import type { MetadataSignal } from "./metadata-signals";
import { usableSkipBreakdown } from "./coverage";
import type { StaticAnalysisReport } from "@/lib/types/static-analysis";

export const TRIAGE_DISCLAIMER =
  "This tier reflects only the checks listed, can miss obfuscated or indirect behavior, and is not a safety determination.";

export const triageSchema = z.strictObject({
  tier: z.enum(["needs-review", "no-notable-changes", "incomplete"]),
  reasons: z.array(
    z.strictObject({
      id: z.string().min(1),
      source: z.enum(["metadata", "static", "scan-limitation"]),
      title: z.string().min(1),
      detail: z.string().min(1),
      // IDs identify existing signals/findings. JSON Pointer fragments identify
      // existing report fields where those records have no dedicated ID.
      evidenceRef: z.string().min(1),
    }),
  ),
  disclaimer: z.literal(TRIAGE_DISCLAIMER),
});
export type Triage = z.infer<typeof triageSchema>;
export type TriageInput = Pick<
  StaticAnalysisReport,
  | "metadataSignals"
  | "signalCounts"
  | "findings"
  | "evidence"
  | "fileChanges"
  | "coverage"
>;
type Reason = Triage["reasons"][number];

const metadataReasons: Record<
  MetadataSignal["id"],
  Pick<Reason, "title" | "detail">
> = {
  "install-script-added": {
    title: "Install-related script declaration changed",
    detail:
      "The registry comparison records an added or changed install-related script. Its declaration does not establish execution.",
  },
  "maintainer-changed": {
    title: "Publisher or maintainer membership changed",
    detail:
      "The version metadata comparison records a publisher or maintainer membership change. Intent is not established.",
  },
  "provenance-dropped": {
    title: "Attestation metadata is absent in the candidate",
    detail:
      "The trusted version advertises attestation metadata and the candidate does not. This check does not validate attestations.",
  },
  "dependency-added": {
    title: "Direct dependency declaration added",
    detail:
      "The registry comparison records an additional direct dependency. Its behavior has not been analyzed by this check.",
  },
  "recent-release": {
    title: "Recent release (information only)",
    detail:
      "The existing metadata signal places the release within seven days of comparison. Recency alone does not request review.",
  },
};
const categoryLabels = {
  network: "network",
  environment: "environment-variable",
  process: "child-process",
  filesystem: "filesystem mutation",
  "dynamic-code": "dynamic code",
} as const;
type Category = keyof typeof categoryLabels;
function isCategory(category: string): category is Category {
  return Object.hasOwn(categoryLabels, category);
}
function compareText(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Pure classification of existing comparison records. No source is rescanned,
 * report fields are not mutated, and no runtime/AI supplements are consulted.
 */
export function computeTriage(input: TriageInput): Triage {
  const reasons = new Map<string, Reason>();
  const add = (reason: Reason) =>
    reasons.set(`${reason.source}:${reason.id}`, reason);
  let incomplete = false;
  let review = false;

  const breakdown = usableSkipBreakdown(input.coverage);
  const sourceSkipped = breakdown
    ? breakdown.sourceUnavailable +
      breakdown.sourceOversized +
      breakdown.sourceBudget
    : input.coverage.skippedFiles;
  if (sourceSkipped > 0) {
    incomplete = true;
    add({
      id: "scan-skipped-files",
      source: "scan-limitation",
      title: "Files excluded from source scanning",
      detail: breakdown
        ? `${sourceSkipped} source files were excluded because their text was unavailable, oversized, or beyond the scan budget.`
        : `${sourceSkipped} files were skipped. File-kind metadata unavailable in this report; reacquisition is needed to distinguish source exclusions.`,
      evidenceRef: breakdown
        ? "#/coverage/skipBreakdown"
        : "#/coverage/skippedFiles",
    });
  }
  if (breakdown && breakdown.nonSource > 0)
    add({
      id: "scan-skipped-nonsource",
      source: "scan-limitation",
      title: "Non-source files outside lexical scanning (information only)",
      detail: `${breakdown.nonSource} non-source files were excluded from source rules. This includes documents, manifests, lockfiles, media, fonts, WebAssembly and native content; manifest fields are compared separately.`,
      evidenceRef: "#/coverage/skipBreakdown/nonSource",
    });
  if (input.coverage.truncated) {
    incomplete = true;
    add({
      id: "scan-truncated",
      source: "scan-limitation",
      title: "Scan or report coverage was limited",
      detail:
        "The existing report marks source scanning or retained comparison records as limited. Coverage notes describe the applicable limits.",
      evidenceRef: "#/coverage/truncated",
    });
  }

  for (const signal of input.metadataSignals ?? []) {
    if (signal.id !== "recent-release" && signal.severity !== "review")
      continue;
    if (!Object.hasOwn(metadataReasons, signal.id)) continue;
    if (signal.id !== "recent-release") review = true;
    add({
      id: signal.id,
      source: "metadata",
      ...metadataReasons[signal.id],
      ...(signal.id === "recent-release" && signal.evidence.publishedAt === null
        ? {
            title: "Publication time unavailable (information only)",
            detail: "metadata unavailable",
          }
        : {}),
      evidenceRef: signal.id,
    });
  }

  const findings = [...input.findings]
    .filter(
      (finding) => finding.status === "STATIC SIGNAL" && finding.id.length > 0,
    )
    .sort((a, b) => compareText(a.id, b.id));
  for (const [index, counts] of input.signalCounts.entries()) {
    if (!isCategory(counts.category) || counts.newCount <= counts.oldCount)
      continue;
    review = true;
    // Category totals have no IDs. A same-category finding may concern a
    // different change (for example an environment name at equal file counts),
    // so cite the total's own record rather than choosing a representative ID.
    add({
      id: `${counts.category}-matches-increased`,
      source: "static",
      title: `Additional ${categoryLabels[counts.category]} matches`,
      detail: `Recorded category matches increased from ${counts.oldCount} to ${counts.newCount}. Counts describe textual references, not observed execution.`,
      evidenceRef: `#/signalCounts/${index}`,
    });
  }

  const addedFiles = new Set(
    input.fileChanges
      .filter((file) => file.change === "added")
      .map((file) => file.path),
  );
  const evidenceById = new Map(
    input.evidence.map((evidence) => [evidence.id, evidence]),
  );
  for (const finding of findings) {
    if (!isCategory(finding.category)) continue;
    const inAddedFile = finding.evidenceIds.some((id) => {
      const evidence = evidenceById.get(id);
      return (
        evidence?.source === "npm-archive" &&
        evidence.newLine !== null &&
        addedFiles.has(evidence.file)
      );
    });
    if (!inAddedFile) continue;
    review = true;
    add({
      id: `new-file:${finding.id}`,
      source: "static",
      title: `${categoryLabels[finding.category]} finding in an added file`,
      detail:
        "The existing finding links candidate source evidence to a newly added file. Matching text does not establish execution.",
      evidenceRef: finding.id,
    });
  }

  return triageSchema.parse({
    tier: review
      ? "needs-review"
      : incomplete
        ? "incomplete"
        : "no-notable-changes",
    reasons: [...reasons.values()].sort(
      (a, b) => compareText(a.source, b.source) || compareText(a.id, b.id),
    ),
    disclaimer: TRIAGE_DISCLAIMER,
  });
}
