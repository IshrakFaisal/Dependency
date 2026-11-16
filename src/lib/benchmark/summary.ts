import { TRIAGE_DISCLAIMER } from "@/lib/analysis/triage";
import { escapeCommentText } from "@/lib/github/escape";
import { tiers, type Measurement } from "./measure";
import { displayText } from "@/lib/cli/output";

function reasonId(value: string) {
  const text = displayText(value);
  // Normal internal IDs are readable in raw Markdown. Unexpected punctuation
  // uses the existing inert renderer so it cannot break a table or add links.
  return /^[A-Za-z0-9:_-]+$/.test(text)
    ? `\`${text}\``
    : escapeCommentText(text);
}

/** Presentation only. Raw report/evidence text is not rendered in this summary. */
export function renderBenchmarkSummary(measurement: Measurement): string {
  const { aggregates: a, entries } = measurement;
  const lines = [
    "# DependencyGuard benchmark",
    "",
    "Assessment: INCONCLUSIVE",
    "",
    `Pairs: ${a.total}; completed: ${a.completed}; analysis failures: ${a.analysisFailures}.`,
    `Labels: benign-update ${entries.filter(({ entry }) => entry.label === "benign-update").length}; synthetic-suspicious ${entries.filter(({ entry }) => entry.label === "synthetic-suspicious").length}.`,
    "",
    "Percentages use completed pairs as the denominator. Failures have no tier. With no completed pairs, percentages are 0.",
    "",
    "| Tier | Count | Percentage of completed pairs |",
    "| --- | ---: | ---: |",
  ];
  for (const tier of tiers)
    lines.push(
      `| ${tier} | ${a.tierCounts[tier]} | ${a.tierPercentages[tier].toFixed(2)}% |`,
    );
  lines.push(
    "",
    "## Top 5 reason IDs",
    "",
    "| Reason ID | Pairs |",
    "| --- | ---: |",
  );
  for (const reason of a.topReasons)
    lines.push(`| ${reasonId(reason.id)} | ${reason.count} |`);
  if (!a.topReasons.length) lines.push("| None recorded | 0 |");
  if (measurement.replayLimitations?.length) {
    lines.push(
      "",
      "## Replay limitations",
      "",
      `${measurement.replayLimitations.length} pairs require reacquisition for skipped-file classification. Their conservative legacy triage is retained.`,
      "",
      "| Pair | Detail |",
      "| --- | --- |",
    );
    for (const limitation of measurement.replayLimitations)
      lines.push(
        `| ${escapeCommentText(`${limitation.entry.name} ${limitation.entry.from} -> ${limitation.entry.to}`)} | ${escapeCommentText(limitation.detail)} |`,
      );
  }
  const failures = entries.filter((entry) => entry.outcome === "failed");
  if (failures.length) {
    lines.push(
      "",
      "## Analysis failures",
      "",
      "| Pair | Detail |",
      "| --- | --- |",
    );
    for (const failure of failures)
      lines.push(
        `| ${escapeCommentText(`${failure.entry.name} ${failure.entry.from} -> ${failure.entry.to}`)} | ${escapeCommentText(failure.error)} |`,
      );
  }
  lines.push(
    "",
    "The benign-update label means only no known incident for the selected pair in this seed corpus; it is a curation assumption. This small, selected corpus measures noise and known gaps. It provides no detection-rate estimate or incident ground truth.",
    "",
    TRIAGE_DISCLAIMER,
    "",
  );
  return lines.join("\n");
}
