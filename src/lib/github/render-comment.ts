import { z } from "zod";
import { version } from "../../../package.json";
import { TRIAGE_DISCLAIMER } from "@/lib/analysis/triage";
import { cliJsonSchema, maxPackagesSchema, targetSchema } from "./cli-json";
import { escapeCommentText } from "./escape";

export const COMMENT_MARKER = "<!-- dependencyguard-comment -->";
export const COMMENT_LIMIT = 60_000;
export const commentOptionsSchema = z.object({
  maxPackages: maxPackagesSchema,
  toolVersion: z.string().min(1).max(100).default(version),
  notAnalyzed: z.array(targetSchema).default([]),
  notice: z
    .enum([
      "missing-base-lockfile",
      "missing-head-lockfile",
      "missing-both-lockfiles",
      "no-dependency-changes",
    ])
    .optional(),
});
export type CommentOptions = z.input<typeof commentOptionsSchema>;
type Group = "review" | "failed" | "other" | "skipped";
type Row = { group: Group; text: string };
const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Pure rendering of the existing CLI JSON contract; no report is modified. */
export function renderTriageComment(
  cliJson: unknown,
  options: CommentOptions = {},
): string {
  const document = cliJsonSchema.parse(cliJson);
  const settings = commentOptionsSchema.parse(options);
  let shortened = false;
  const cell = (value: string, limit = 180) => {
    if (value.length > limit) {
      shortened = true;
      value = value.slice(0, limit) + "…";
    }
    return escapeCommentText(value);
  };
  const counts = { "needs-review": 0, "no-notable-changes": 0, incomplete: 0 };
  for (const item of document.results)
    if (item.outcome === "completed") counts[item.triage.tier]++;
  const heading = [
    COMMENT_MARKER,
    "## DependencyGuard triage",
    "",
    `INCONCLUSIVE · needs-review: ${counts["needs-review"]} · no-notable-changes: ${counts["no-notable-changes"]} · incomplete: ${counts.incomplete} · failed: ${document.summary.failed} · skipped: ${document.summary.skipped} · not analyzed: ${settings.notAnalyzed.length}`,
  ];
  const notices = {
    "missing-base-lockfile":
      "The base package-lock.json is missing. No package analysis was performed.",
    "missing-head-lockfile":
      "The head package-lock.json is missing. No package analysis was performed.",
    "missing-both-lockfiles":
      "The base and head package-lock.json files are missing. No package analysis was performed.",
    "no-dependency-changes":
      "No dependency changes in the supported registry package comparison. Skipped entries were not assessed.",
  };
  if (settings.notice) heading.push("", notices[settings.notice]);
  else if (!document.results.length)
    heading.push("", "No package analyses were selected.");
  if (document.error)
    heading.push(
      "",
      `Input/output error: ${cell(document.error.message, 500)}`,
    );

  const identity = (item: { name: string; path: string | null }) =>
    cell(item.name) + (item.path ? `<br>${cell(item.path)}` : "");
  const rows: Row[] = [];
  const results = [...document.results].sort(
    (a, b) =>
      compareText(a.name, b.name) || compareText(a.path ?? "", b.path ?? ""),
  );
  for (const item of results) {
    if (item.outcome === "failed") {
      rows.push({
        group: "failed",
        text: `| ${identity(item)} | ${cell(item.from ?? "No trusted baseline")} → ${cell(item.to)} | ${cell(item.error, 400)} |`,
      });
      continue;
    }
    if (item.triage.reasons.length > 3) shortened = true;
    const reasons =
      item.triage.reasons
        .slice(0, 3)
        .map(
          (reason) =>
            `${cell(reason.title, 120)}: ${cell(reason.detail, 240)} (evidence: ${cell(reason.evidenceRef, 160)})`,
        )
        .join("<br>") || "No listed rule triggered.";
    rows.push({
      group: item.triage.tier === "needs-review" ? "review" : "other",
      text: `| ${identity(item)} | ${cell(item.from ?? "No trusted baseline")} → ${cell(item.to)} | ${item.triage.tier} | ${reasons} |`,
    });
  }
  // Overflow identities are a compact list, not detailed analysis rows. This
  // keeps the unexamined packages visible even when all detailed rows are used.
  const overflow = [...settings.notAnalyzed]
    .sort(
      (a, b) =>
        compareText(a.name, b.name) || compareText(a.path ?? "", b.path ?? ""),
    )
    .map(
      (item) => `${cell(item.name)}${item.path ? ` (${cell(item.path)})` : ""}`,
    );
  const shownOverflow: string[] = [];
  let overflowBytes = 0;
  for (const item of overflow) {
    if (overflowBytes + item.length > 8000) break;
    shownOverflow.push(item);
    overflowBytes += item.length + 2;
  }
  const overflowSection = overflow.length
    ? [
        "",
        "### Not analyzed",
        "",
        "Analysis package limit reached. The following entries were not analyzed:",
        shownOverflow.join(", "),
        ...(shownOverflow.length < overflow.length
          ? [
              `${overflow.length - shownOverflow.length} more not shown in the not-analyzed list.`,
            ]
          : []),
      ]
    : [];
  for (const item of [...document.skipped].sort(
    (a, b) =>
      compareText(a.name ?? "", b.name ?? "") ||
      compareText(a.path, b.path) ||
      compareText(a.reason, b.reason),
  ))
    rows.push({
      group: "skipped",
      text: `| ${cell(item.name ?? "Package entry")} | ${cell(item.path || "(root)")} | ${cell(item.reason, 400)} |`,
    });
  const order: Group[] = ["review", "failed", "other", "skipped"];
  rows.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
  const footer = [
    "",
    TRIAGE_DISCLAIMER,
    "",
    `DependencyGuard version: ${escapeCommentText(settings.toolVersion)}`,
  ];
  function assemble(selected: Row[], omitted: number, lengthLimited: boolean) {
    const lines = [...heading];
    for (const group of order) {
      const selectedRows = selected.filter((row) => row.group === group);
      if (!selectedRows.length) continue;
      const title = {
        review: "Packages needing review",
        failed: "Analysis failures",
        other: "no-notable-changes and incomplete packages",
        skipped: "Skipped entries",
      }[group];
      if (group === "other")
        lines.push("", "<details>", `<summary>${title}</summary>`, "");
      else lines.push("", `### ${title}`, "");
      if (group === "review" || group === "other")
        lines.push(
          "| Package / path | Versions | Tier | Short reasons |",
          "| --- | --- | --- | --- |",
        );
      else if (group === "skipped")
        lines.push("| Package | Path | Reason |", "| --- | --- | --- |");
      else
        lines.push(
          "| Package / path | Versions | Reason |",
          "| --- | --- | --- |",
        );
      lines.push(...selectedRows.map((row) => row.text));
      if (group === "other") lines.push("", "</details>");
    }
    lines.push(...overflowSection);
    if (omitted)
      lines.push(
        "",
        `${omitted} more not shown (package, failure, or skipped rows).`,
      );
    if (shortened) lines.push("", "Some field text or reasons were shortened.");
    if (lengthLimited || shownOverflow.length < overflow.length)
      lines.push("", "Comment truncated to stay under 60,000 characters.");
    return [...lines, ...footer, ""].join("\n");
  }
  // Reserve room for every table header, closing details tag and notices. Never
  // truncate raw Markdown/HTML in the middle of a row, entity or fixed footer.
  let budget =
    COMMENT_LIMIT - 1 - assemble([], rows.length, true).length - 1600;
  const selected: Row[] = [];
  let lengthLimited = false;
  for (const row of rows) {
    if (selected.length >= settings.maxPackages) break;
    if (row.text.length + 1 > budget) {
      lengthLimited = true;
      break;
    }
    selected.push(row);
    budget -= row.text.length + 1;
  }
  return assemble(selected, rows.length - selected.length, lengthLimited);
}
