import { z } from "zod";
import { TRIAGE_DISCLAIMER } from "@/lib/analysis/triage";
import { escapeCommentText } from "@/lib/github/escape";
import type {
  StaticAnalysisReport,
  StaticEvidence,
} from "@/lib/types/static-analysis";
import { benchmarkEntrySchema, replayFileSchema } from "./schema";

// Audit the saved measurement, including its validated saved tiers. Unlike
// replay, this mode does not recompute triage or replace the historical result.
const auditFileSchema = replayFileSchema.safeExtend({
  entries: z.array(benchmarkEntrySchema).min(1).max(1000),
});
const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Path spelling only, never content classification or a tier input. */
export function auditPathHints(path: string): string[] {
  const normalized = path.replaceAll("\\", "/").toLowerCase();
  const hints: string[] = [];
  if (
    /(^|\/)(?:tests?|__tests__|__fixtures__|fixtures)(\/|$)|\.(?:test|spec)\.[^/]+$/.test(
      normalized,
    )
  )
    hints.push("test");
  if (
    /(^|\/)(?:docs?|documentation)(\/|$)|(^|\/)(?:readme|changelog|license)(?:\.[^/]*)?$|\.(?:md|mdx|rst)$/.test(
      normalized,
    )
  )
    hints.push("docs");
  if (/(^|\/)(?:examples?|samples?|demos?)(\/|$)/.test(normalized))
    hints.push("example");
  if (
    /(^|\/)(?:dist|build|out|bundles?|compiled|\.next)(\/|$)|\.(?:min|bundle)\.[^/]+$/.test(
      normalized,
    )
  )
    hints.push("build-output");
  return hints;
}

function excerpt(value: string | null): string {
  if (value === null) return "not retained";
  const characters = Array.from(value);
  const shortened =
    characters.length > 200 ? characters.slice(0, 199).join("") + "…" : value;
  return escapeCommentText(shortened);
}

function evidenceLines(evidence: StaticEvidence): string[] {
  const hints = auditPathHints(evidence.file);
  return [
    `- Evidence ID: ${escapeCommentText(evidence.id)}; source: ${escapeCommentText(evidence.source)}`,
    `- File: ${escapeCommentText(evidence.file)}`,
    `- Path-kind hint (path heuristic only): ${hints.length ? hints.join(", ") : "no recognized location hint"}`,
    `- Old line: ${evidence.oldLine ?? "not retained"}; excerpt: ${excerpt(evidence.oldExcerpt)}`,
    `- New line: ${evidence.newLine ?? "not retained"}; excerpt: ${excerpt(evidence.newExcerpt)}`,
    "",
  ];
}

function staticReasonLines(
  report: Pick<StaticAnalysisReport, "findings" | "evidence" | "signalCounts">,
  reference: string,
): string[] {
  const lines: string[] = [];
  const aggregateMatch = /^#\/signalCounts\/(0|[1-9]\d*)$/.exec(reference);
  let findings = report.findings.filter((finding) => finding.id === reference);
  if (aggregateMatch) {
    const counts = report.signalCounts[Number(aggregateMatch[1])];
    lines.push("Source location: not attributable to a single finding", "");
    if (!counts)
      return [
        ...lines,
        "Category totals not retained at the referenced row.",
        "",
      ];
    lines.push(
      `Category: ${escapeCommentText(counts.category)}; old total: ${counts.oldCount}; new total: ${counts.newCount}.`,
      "",
    );
    findings = report.findings.filter(
      (finding) => finding.category === counts.category,
    );
    lines.push(
      "Linked evidence for this category is context; it does not attribute the aggregate increase to a particular location.",
      "",
    );
  } else if (findings.length) {
    lines.push(
      `Finding categories: ${[...new Set(findings.map((finding) => finding.category))].sort(compareText).map(escapeCommentText).join(", ")}.`,
      "",
    );
  } else {
    return [
      "Source location: no linked finding retained for this reference.",
      "",
    ];
  }
  const evidenceIds = new Set(
    findings.flatMap((finding) => finding.evidenceIds),
  );
  const evidence = report.evidence
    .filter((item) => evidenceIds.has(item.id))
    .sort(
      (a, b) =>
        compareText(a.file, b.file) ||
        compareText(a.id, b.id) ||
        (a.oldLine ?? -1) - (b.oldLine ?? -1) ||
        (a.newLine ?? -1) - (b.newLine ?? -1) ||
        compareText(a.oldExcerpt ?? "", b.oldExcerpt ?? "") ||
        compareText(a.newExcerpt ?? "", b.newExcerpt ?? ""),
    );
  if (!evidence.length)
    lines.push("No linked evidence entries retained for this reason.", "");
  for (const item of evidence) lines.push(...evidenceLines(item));
  const present = new Set(evidence.map((item) => item.id));
  const absent = [...evidenceIds]
    .filter((id) => !present.has(id))
    .sort(compareText);
  if (absent.length)
    lines.push(
      `Referenced evidence not retained: ${absent.map(escapeCommentText).join(", ")}.`,
      "",
    );
  return lines;
}

/** Pure offline presentation of full saved results. No analyzer or clock. */
export function renderBenchmarkAudit(saved: unknown): string {
  const parsed = auditFileSchema.parse(saved);
  for (const result of parsed.entries) {
    if (result.outcome !== "completed") continue;
    const { entry, report } = result;
    if (
      report.input.packageName !== entry.name ||
      report.input.trustedVersion !== entry.from ||
      report.input.candidateVersion !== entry.to ||
      report.releases.trusted.release.name !== entry.name ||
      report.releases.candidate.release.name !== entry.name ||
      report.releases.trusted.release.version !== entry.from ||
      report.releases.candidate.release.version !== entry.to
    )
      throw new Error("Audit report identity differs from the corpus pair.");
  }
  const selected = parsed.entries
    .filter(
      (result) =>
        result.outcome === "completed" &&
        result.triage.tier !== "no-notable-changes",
    )
    .sort(
      (a, b) =>
        compareText(a.entry.name, b.entry.name) ||
        compareText(a.entry.from, b.entry.from) ||
        compareText(a.entry.to, b.entry.to),
    );
  const failures = parsed.entries.filter(
    (result) => result.outcome === "failed",
  ).length;
  const lines = [
    "# DependencyGuard benchmark audit",
    "",
    "Assessment: INCONCLUSIVE",
    "",
    `Pairs selected for manual review: ${selected.length}. Omitted: ${parsed.entries.length - selected.length - failures} no-notable-changes; ${failures} analysis failures.`,
    "",
    "Tiers and reasons are from the saved measurement; no analysis or reclassification occurs. Evidence can be absent or limited in the saved report. Excerpts are limited to 200 characters before escaping. Path-kind hints use path spelling only and never affect tiers.",
    "",
    "Reviewer labels: true signal / noise / unclear. Leave the label blank until a human reviews the evidence. Labels describe these flags on this corpus only, not detection.",
    "",
    TRIAGE_DISCLAIMER,
    "",
  ];
  for (const [index, result] of selected.entries()) {
    if (result.outcome !== "completed") continue;
    lines.push(
      `## Pair ${index + 1}: ${escapeCommentText(`${result.entry.name} ${result.entry.from} -> ${result.entry.to}`)}`,
      "",
      `Tier: ${result.triage.tier}`,
      "",
    );
    const reasons = [...result.triage.reasons].sort(
      (a, b) =>
        compareText(a.source, b.source) ||
        compareText(a.id, b.id) ||
        compareText(a.evidenceRef, b.evidenceRef) ||
        compareText(a.title, b.title) ||
        compareText(a.detail, b.detail),
    );
    for (const reason of reasons) {
      lines.push(
        `### Reason: ${escapeCommentText(reason.id)}`,
        "",
        `Source: ${reason.source}; evidence reference: ${escapeCommentText(reason.evidenceRef)}`,
        "",
        escapeCommentText(reason.title),
        "",
        escapeCommentText(reason.detail),
        "",
      );
      if (reason.source === "static")
        lines.push(...staticReasonLines(result.report, reason.evidenceRef));
    }
    lines.push("Reviewer label: ____", "");
  }
  return lines.join("\n");
}
