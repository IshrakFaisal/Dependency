import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { computeTriage, TRIAGE_DISCLAIMER } from "@/lib/analysis/triage";
import { compareSnapshots } from "@/lib/analysis/compare";
import { replayBenchmark, measureCorpus } from "@/lib/benchmark/measure";
import { renderBenchmarkSummary } from "@/lib/benchmark/summary";
import {
  expectReferencedTriage,
  triageReport,
  triageSignal,
} from "./helpers/triage-fixtures";
import type { SkipBreakdown } from "@/lib/analysis/coverage";
import type { PackageSnapshot } from "@/lib/types/static-analysis";

const zero: SkipBreakdown = {
  nonSource: 0,
  sourceUnavailable: 0,
  sourceOversized: 0,
  sourceBudget: 0,
};
describe("structured skip causes and triage", () => {
  it.each([
    {
      counts: zero,
      truncated: false,
      review: false,
      tier: "no-notable-changes",
      ids: [],
    },
    {
      counts: { ...zero, nonSource: 12 },
      truncated: false,
      review: false,
      tier: "no-notable-changes",
      ids: ["scan-skipped-nonsource"],
    },
    {
      counts: { ...zero, sourceUnavailable: 1 },
      truncated: false,
      review: false,
      tier: "incomplete",
      ids: ["scan-skipped-files"],
    },
    {
      counts: { ...zero, sourceOversized: 1 },
      truncated: true,
      review: false,
      tier: "incomplete",
      ids: ["scan-skipped-files", "scan-truncated"],
    },
    {
      counts: { ...zero, sourceBudget: 1 },
      truncated: true,
      review: false,
      tier: "incomplete",
      ids: ["scan-skipped-files", "scan-truncated"],
    },
    {
      counts: zero,
      truncated: true,
      review: false,
      tier: "incomplete",
      ids: ["scan-truncated"],
    },
    {
      counts: { ...zero, nonSource: 3 },
      truncated: false,
      review: true,
      tier: "needs-review",
      ids: ["maintainer-changed", "scan-skipped-nonsource"],
    },
    {
      counts: { ...zero, nonSource: 3, sourceUnavailable: 1 },
      truncated: false,
      review: false,
      tier: "incomplete",
      ids: ["scan-skipped-files", "scan-skipped-nonsource"],
    },
    {
      counts: { ...zero, nonSource: 2, sourceBudget: 1 },
      truncated: true,
      review: true,
      tier: "needs-review",
      ids: [
        "maintainer-changed",
        "scan-skipped-files",
        "scan-skipped-nonsource",
        "scan-truncated",
      ],
    },
  ])(
    "classifies $counts with truncated=$truncated review=$review",
    ({ counts, truncated, review, tier, ids }) => {
      const report = triageReport();
      report.coverage = {
        ...report.coverage,
        skippedFiles: Object.values(counts).reduce(
          (sum, value) => sum + value,
          0,
        ),
        skipBreakdown: counts,
        truncated,
      };
      if (review) report.metadataSignals = [triageSignal("maintainer-changed")];
      const copy = structuredClone(report);
      const triage = computeTriage(report);
      expect(triage.tier).toBe(tier);
      expect(triage.reasons.map(({ id }) => id)).toEqual(ids);
      expectReferencedTriage(triage, report);
      expect(triage).toEqual(computeTriage(report));
      expect(report).toEqual(copy);
      expect(JSON.stringify(triage).replace(TRIAGE_DISCLAIMER, "")).not.toMatch(
        /\b(?:safe|unsafe|malicious|clean|verified)\b/i,
      );
    },
  );
  it("retains conservative legacy handling without guessing from notes", () => {
    const report = triageReport();
    report.coverage.skippedFiles = 1;
    report.coverage.notes = ["Only docs were excluded."];
    expect(computeTriage(report).tier).toBe("incomplete");
    report.coverage.skipBreakdown = zero; // inconsistent counts cannot erase an exclusion
    expect(computeTriage(report).tier).toBe("incomplete");
  });
  it("records actual scanner kind/cause counts while retaining counts and findings", () => {
    const report = triageReport();
    const files: PackageSnapshot["files"] = [
      { path: "README.md", text: "docs", size: 4, sha256: "a" },
      { path: "addon.node", text: null, size: 100, sha256: "b" },
      { path: "unavailable.js", text: null, size: 100, sha256: "c" },
      {
        path: "oversized.ts",
        text: "// inert",
        size: 256 * 1024 + 1,
        sha256: "d",
      },
      { path: "index.js", text: "// inert", size: 8, sha256: "e" },
    ];
    const snapshot = (role: "trusted" | "candidate"): PackageSnapshot => ({
      ...report.releases[role],
      files,
      manifest: { ...report.releases[role].release },
    });
    const compared = compareSnapshots(
      report.id,
      report.input,
      snapshot("trusted"),
      snapshot("candidate"),
    );
    expect(compared.coverage).toMatchObject({
      skippedFiles: 8,
      trustedFilesScanned: 1,
      candidateFilesScanned: 1,
      skipBreakdown: {
        nonSource: 4,
        sourceUnavailable: 2,
        sourceOversized: 2,
        sourceBudget: 0,
      },
      truncated: true,
    });
    expect(compared.findings).toEqual([]);
    expect(compared.riskScore).toBeNull();
  });
});

describe("replay coverage availability", () => {
  const corpus = [
    {
      name: "example-replay",
      from: "1.0.0",
      to: "1.0.1",
      label: "benign-update",
      notes: "Authored input",
    },
  ];
  it("explicitly lists old reports requiring reacquisition and preserves raw data", async () => {
    const measured = await measureCorpus(corpus, async (target) => {
      const report = triageReport(target);
      report.coverage.skippedFiles = 2;
      return report;
    });
    const saved = { schemaVersion: 1, ...measured };
    const copy = structuredClone(saved);
    const result = replayBenchmark(saved);
    expect(result.replayLimitations).toEqual([
      { entry: corpus[0], detail: expect.stringContaining("skipBreakdown") },
    ]);
    expect(renderBenchmarkSummary(result)).toContain(
      "1 pairs require reacquisition",
    );
    expect(renderBenchmarkSummary(result)).toContain("example&#45;replay");
    expect(result.entries).toEqual(measured.entries);
    expect(saved).toEqual(copy);
    expect(replayBenchmark(saved)).toEqual(result);
  });
  it("recomputes new reports and preserves unknown-free legacy reports with zero exclusions", async () => {
    const measured = await measureCorpus(corpus, async (target) => {
      const report = triageReport(target);
      report.coverage.skippedFiles = 2;
      report.coverage.skipBreakdown = { ...zero, nonSource: 2 };
      return report;
    });
    const result = replayBenchmark({ schemaVersion: 1, ...measured });
    expect(result.replayLimitations).toBeUndefined();
    expect(result.aggregates.tierCounts["no-notable-changes"]).toBe(1);
    const markdown = renderBenchmarkSummary(result);
    expect(markdown).toContain("| `scan-skipped-nonsource` | 1 |");
    expect(markdown).not.toContain("&#45;");
    const legacy = await measureCorpus(corpus, async (target) =>
      triageReport(target),
    );
    expect(
      replayBenchmark({ schemaVersion: 1, ...legacy }).replayLimitations,
    ).toBeUndefined();
  });
});
