import type { MetadataSignal } from "@/lib/analysis/metadata-signals";
import { metadataSignalSchema } from "@/lib/analysis/metadata-signals";
import { computeTriage, type Triage } from "@/lib/analysis/triage";
import type {
  ReleaseFinding,
  StaticAnalysisReport,
} from "@/lib/types/static-analysis";
import { CliAnalysisError } from "./arguments";

export interface CliTarget {
  name: string;
  from: string | null;
  to: string;
  path: string | null;
  dev: boolean;
}
export type CliResult = CliTarget &
  (
    | {
        outcome: "completed";
        status: "INCONCLUSIVE";
        metadataSignals: MetadataSignal[];
        triage: Triage;
        findingsByCategory: Record<ReleaseFinding["category"], number>;
        coverage: StaticAnalysisReport["coverage"];
        limitations: string[];
      }
    | { outcome: "failed"; status: "INCONCLUSIVE"; error: string }
  );
export interface CliDocument {
  command: "check" | "lockfile" | null;
  status: "INCONCLUSIVE";
  results: CliResult[];
  skipped: { name: string | null; path: string; reason: string }[];
  summary: { completed: number; failed: number; skipped: number };
  triageSummary?: Record<Triage["tier"], number>;
  error?: { code: "usage-error" | "file-error"; message: string };
}

/** Presentation only: leave reports and analyzer inputs untouched. Escape
 * terminal controls and omit verdict vocabulary even in untrusted evidence.
 */
export function displayText(text: string): string {
  return text
    .replace(/\b(?:safe|unsafe|malicious|clean|verified)\b/gi, "[omitted]")
    .replace(
      /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu,
      (character) =>
        `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
    );
}

export function jsonOutput(value: unknown): string {
  // The summary has no score field. Also exclude score keys in arbitrary
  // metadata evidence, and apply the word filter to evidence keys as well.
  return (
    JSON.stringify(
      value,
      (key, item) =>
        key === "riskScore"
          ? undefined
          : typeof item === "string"
            ? displayText(item)
            : item,
      2,
    ).replace(/\b(?:safe|unsafe|malicious|clean|verified)\b/gi, "[omitted]") +
    "\n"
  );
}

export function summarizeReport(
  target: CliTarget,
  report: StaticAnalysisReport,
): CliResult {
  if (
    report.mode !== "static" ||
    report.status !== "INCONCLUSIVE" ||
    report.riskScore !== null ||
    report.input.packageName !== target.name ||
    report.input.candidateVersion !== target.to ||
    (target.from !== null && report.input.trustedVersion !== target.from)
  )
    throw new CliAnalysisError(
      "The analyzer returned an incompatible static report.",
    );
  const findingsByCategory: Record<ReleaseFinding["category"], number> = {
    network: 0,
    environment: 0,
    process: 0,
    filesystem: 0,
    "dynamic-code": 0,
    lifecycle: 0,
    metadata: 0,
  };
  for (const finding of report.findings) {
    if (Object.hasOwn(findingsByCategory, finding.category))
      findingsByCategory[finding.category]++;
  }
  return {
    ...target,
    outcome: "completed",
    status: report.status,
    triage: computeTriage(report),
    metadataSignals: (report.metadataSignals ?? []).map((signal) =>
      metadataSignalSchema.parse(signal),
    ),
    findingsByCategory,
    coverage: report.coverage,
    limitations: report.limitations,
  };
}

export function humanOutput(document: CliDocument): string {
  const lines = ["DependencyGuard - INCONCLUSIVE"];
  if (document.error)
    lines.push(`Error: ${displayText(document.error.message)}`);
  for (const result of document.results) {
    lines.push(
      "",
      `${displayText(result.name)} ${displayText(result.from ?? "(no trusted baseline)")} -> ${displayText(result.to)}`,
    );
    if (result.path !== null) lines.push(`  Path: ${displayText(result.path)}`);
    lines.push(`  ${result.outcome.toUpperCase()} - INCONCLUSIVE`);
    if (result.outcome === "failed") {
      lines.push(`  ${displayText(result.error)}`);
      continue;
    }
    lines.push(`  Triage: ${result.triage.tier}`);
    for (const reason of result.triage.reasons)
      lines.push(
        `    ${displayText(reason.id)} [${reason.source}]: ${displayText(reason.title)}`,
        `      ${displayText(reason.detail)}`,
        `      Evidence: ${displayText(reason.evidenceRef)}`,
      );
    lines.push(`  ${result.triage.disclaimer}`);
    lines.push(`  Metadata signals: ${result.metadataSignals.length}`);
    for (const signal of result.metadataSignals)
      lines.push(
        `    ${signal.id} [${signal.severity}]: ${displayText(signal.title)}`,
        `      ${displayText(signal.detail)}`,
        `      Evidence: ${jsonOutput(signal.evidence).trim().replace(/\n\s*/g, " ")}`,
      );
    lines.push("  Static findings by category (displayed records):");
    for (const [category, count] of Object.entries(result.findingsByCategory))
      lines.push(`    ${category}: ${count}`);
    const coverage = result.coverage;
    lines.push(
      `  Scan: ${coverage.trustedFilesScanned} trusted / ${coverage.candidateFilesScanned} candidate files; ${coverage.skippedFiles} skipped; truncated: ${coverage.truncated}`,
      "  Scan limitations:",
    );
    for (const limitation of [...result.limitations, ...coverage.notes])
      lines.push(`    - ${displayText(limitation)}`);
    if (!result.limitations.length && !coverage.notes.length)
      lines.push("    - No additional limitations supplied by the analyzer.");
  }
  if (document.skipped.length) {
    lines.push("", "Skipped entries:");
    for (const entry of document.skipped)
      lines.push(
        `  ${displayText(entry.path || "(root)")}: ${displayText(entry.reason)}`,
      );
  }
  lines.push(
    "",
    `Completed: ${document.summary.completed}; failed: ${document.summary.failed}; skipped: ${document.summary.skipped}.`,
  );
  if (document.triageSummary)
    lines.push(
      `Triage totals: needs-review: ${document.triageSummary["needs-review"]}; no-notable-changes: ${document.triageSummary["no-notable-changes"]}; incomplete: ${document.triageSummary.incomplete}.`,
    );
  return lines.join("\n") + "\n";
}
