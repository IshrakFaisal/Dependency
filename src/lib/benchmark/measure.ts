import { computeTriage, type Triage } from "@/lib/analysis/triage";
import type { CliAnalyzer } from "@/lib/cli";
import { CliAnalysisError } from "@/lib/cli/arguments";
import { displayText } from "@/lib/cli/output";
import { usableSkipBreakdown } from "@/lib/analysis/coverage";
import {
  benchmarkEntrySchema,
  corpusSchema,
  replayFileSchema,
  replayReportSchema,
  type BenchmarkEntry,
  type CorpusEntry,
} from "./schema";

export const tiers = [
  "needs-review",
  "no-notable-changes",
  "incomplete",
] as const;
const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const ordered = <T extends { entry: CorpusEntry }>(entries: T[]): T[] =>
  [...entries].sort(
    (a, b) =>
      compareText(a.entry.name, b.entry.name) ||
      compareText(a.entry.from, b.entry.from) ||
      compareText(a.entry.to, b.entry.to),
  );

export function aggregate(entries: BenchmarkEntry[]) {
  const tierCounts: Record<Triage["tier"], number> = {
    "needs-review": 0,
    "no-notable-changes": 0,
    incomplete: 0,
  };
  const reasons = new Map<string, number>();
  let analysisFailures = 0;
  for (const entry of entries) {
    if (entry.outcome === "failed") {
      analysisFailures++;
      continue;
    }
    tierCounts[entry.triage.tier]++;
    // Frequency is the number of completed pairs emitting an ID, not repeated
    // occurrences of that ID within one pair. Percentages exclude failures.
    for (const id of new Set(entry.triage.reasons.map((reason) => reason.id)))
      reasons.set(id, (reasons.get(id) ?? 0) + 1);
  }
  const completed = entries.length - analysisFailures;
  const percentage = (count: number) =>
    completed ? Math.round((count / completed) * 10000) / 100 : 0;
  const tierPercentages = {
    "needs-review": percentage(tierCounts["needs-review"]),
    "no-notable-changes": percentage(tierCounts["no-notable-changes"]),
    incomplete: percentage(tierCounts.incomplete),
  };
  const reasonFrequency = [...reasons]
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count || compareText(a.id, b.id));
  return {
    total: entries.length,
    completed,
    analysisFailures,
    tierCounts,
    tierPercentages,
    reasonFrequency,
    topReasons: reasonFrequency.slice(0, 5),
  };
}
export type Aggregates = ReturnType<typeof aggregate>;
export interface Measurement {
  entries: BenchmarkEntry[];
  aggregates: Aggregates;
  replayLimitations?: { entry: CorpusEntry; detail: string }[];
}

function completed(entry: CorpusEntry, raw: unknown): BenchmarkEntry {
  const report = structuredClone(replayReportSchema.parse(raw));
  if (
    report.input.packageName !== entry.name ||
    report.input.trustedVersion !== entry.from ||
    report.input.candidateVersion !== entry.to ||
    report.releases.trusted.release.name !== entry.name ||
    report.releases.candidate.release.name !== entry.name ||
    report.releases.trusted.release.version !== entry.from ||
    report.releases.candidate.release.version !== entry.to
  )
    throw new Error("Report identity differs from the corpus pair.");
  return benchmarkEntrySchema.parse({
    entry,
    outcome: "completed",
    report,
    triage: computeTriage(report),
  });
}

/** The caller supplies the analyzer. Corpus validation finishes before any work.
 * No registry, runtime, investigation, storage or clock is imported here.
 */
export async function measureCorpus(
  corpus: unknown,
  analyzer: CliAnalyzer,
  progress: (text: string) => void = () => {},
): Promise<Measurement> {
  const inputs = ordered(
    corpusSchema.parse(corpus).map((entry) => ({ entry })),
  );
  const entries: BenchmarkEntry[] = [];
  for (const { entry } of inputs) {
    progress(
      displayText(`Analyzing ${entry.name} ${entry.from} -> ${entry.to}`),
    );
    try {
      const report = await analyzer(
        {
          name: entry.name,
          from: entry.from,
          to: entry.to,
          path: null,
          dev: false,
        },
        (message) => progress(displayText(message)),
      );
      entries.push(completed(entry, report));
    } catch (error) {
      entries.push({
        entry,
        outcome: "failed",
        error:
          error instanceof CliAnalysisError
            ? displayText(error.message)
            : "Package analysis failed or returned an incompatible report.",
      });
    }
  }
  return { entries, aggregates: aggregate(entries) };
}

/** Pure offline replay. Derived tiers and aggregates in the file are ignored.
 * Failed acquisitions remain failures; replay never retries or rescans source.
 */
export function replayBenchmark(saved: unknown): Measurement {
  const parsed = replayFileSchema.parse(saved);
  const entries = ordered(parsed.entries).map((result) =>
    result.outcome === "completed"
      ? completed(result.entry, result.report)
      : { ...result, error: displayText(result.error) },
  );
  const replayLimitations = ordered(parsed.entries).flatMap((result) =>
    result.outcome === "completed" &&
    result.report.coverage.skippedFiles > 0 &&
    !usableSkipBreakdown(result.report.coverage)
      ? [
          {
            entry: result.entry,
            detail:
              "Skipped-file kinds cannot be recomputed: this saved report lacks a consistent skipBreakdown. Conservative legacy triage retained; reacquire the pair for the new distinction.",
          },
        ]
      : [],
  );
  return {
    entries,
    aggregates: aggregate(entries),
    ...(replayLimitations.length ? { replayLimitations } : {}),
  };
}
