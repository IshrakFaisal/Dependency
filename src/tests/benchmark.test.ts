import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { benchmarkMain, type BenchmarkIO } from "../../scripts/benchmark";
import corpus from "../../benchmark/corpus.json";
import {
  corpusSchema,
  replayReportSchema,
  type CorpusEntry,
} from "@/lib/benchmark/schema";
import {
  aggregate,
  measureCorpus,
  replayBenchmark,
  type Measurement,
} from "@/lib/benchmark/measure";
import { renderBenchmarkSummary } from "@/lib/benchmark/summary";
import { TRIAGE_DISCLAIMER } from "@/lib/analysis/triage";
import { CliAnalysisError } from "@/lib/cli/arguments";
import type { CliAnalyzer } from "@/lib/cli";
import { triageReport, triageSignal } from "./helpers/triage-fixtures";
import {
  fixtureEntry,
  syntheticFixtures,
  syntheticReport,
} from "./helpers/benchmark-fixtures";

const realAnalyzer = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("Real analyzer prohibited in offline tests.");
  }),
);
vi.mock("@/lib/cli/analyzer", () => ({ staticAnalyzer: realAnalyzer }));
beforeEach(() => {
  realAnalyzer.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Network prohibited in benchmark tests.");
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const entries: CorpusEntry[] = [
  "example-d",
  "example-c",
  "example-b",
  "example-a",
].map((name) => ({
  name,
  from: "1.0.0",
  to: "1.0.1",
  label: "benign-update",
  notes: "Authored offline benchmark input.",
}));
function fakeAnalyzer() {
  return vi.fn<CliAnalyzer>(async (target) => {
    if (target.name === "example-d")
      throw new CliAnalysisError("Authored acquisition failure.");
    const report = triageReport(target);
    Object.assign(report, {
      triage: { tier: "historical-value", extra: "Retain exactly" },
    });
    Object.assign(report.coverage, { extraEvidence: { original: true } });
    if (target.name === "example-a")
      report.metadataSignals = [triageSignal("install-script-added")];
    if (target.name === "example-b") report.coverage.skippedFiles = 1;
    return report;
  });
}
function ioFor(inputs: Record<string, string> = {}) {
  const files = new Map(Object.entries(inputs));
  let stdout = "";
  let stderr = "";
  const io: BenchmarkIO = {
    read: vi.fn(async (path) => {
      if (!files.has(path)) throw new Error("Missing fixture file.");
      return files.get(path)!;
    }),
    mkdir: vi.fn(async () => undefined),
    writeNew: vi.fn(async (path, text) => {
      if (files.has(path)) throw new Error("Already exists.");
      files.set(path, text);
    }),
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
  };
  return {
    io,
    files,
    stdout: () => stdout,
    stderr: () => stderr,
    saved: () =>
      [...files.entries()].find(
        ([path]) => path.endsWith(".json") && !Object.hasOwn(inputs, path),
      )!,
  };
}
const now = () => new Date("2026-11-16T00:00:00.000Z");

describe("benchmark corpus validation", () => {
  it("validates 30 distinct real seed pairs with nonempty names and versions", () => {
    const parsed = corpusSchema.parse(corpus);
    expect(parsed).toHaveLength(60);
    expect(
      parsed.every(
        (entry) =>
          entry.label === "benign-update" &&
          entry.name &&
          entry.from &&
          entry.to,
      ),
    ).toBe(true);
  });
  it("rejects duplicate pairs even when labels differ", () => {
    expect(() =>
      corpusSchema.parse([
        entries[0],
        { ...entries[0], label: "synthetic-suspicious" },
      ]),
    ).toThrow();
  });
  it.each(
    [
      null,
      [],
      [{ ...entries[0], name: " " }],
      [{ ...entries[0], from: "" }],
      [{ ...entries[0], to: "latest" }],
      [{ ...entries[0], to: "1.0.0" }],
    ].map((input) => ({ input })),
  )("rejects malformed corpus $input", ({ input }) => {
    expect(() => corpusSchema.parse(input)).toThrow();
  });
});

describe("benchmark measurement", () => {
  it("computes exact counts, percentages, reason frequencies and failures", async () => {
    const measured = await measureCorpus(entries, fakeAnalyzer());
    expect(measured.aggregates).toEqual({
      total: 4,
      completed: 3,
      analysisFailures: 1,
      tierCounts: { "needs-review": 1, "no-notable-changes": 1, incomplete: 1 },
      tierPercentages: {
        "needs-review": 33.33,
        "no-notable-changes": 33.33,
        incomplete: 33.33,
      },
      reasonFrequency: [
        { id: "install-script-added", count: 1 },
        { id: "scan-skipped-files", count: 1 },
      ],
      topReasons: [
        { id: "install-script-added", count: 1 },
        { id: "scan-skipped-files", count: 1 },
      ],
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("awaits each package, continues after a failure and sorts deterministically", async () => {
    let active = 0;
    let peak = 0;
    const seen: string[] = [];
    const fake = fakeAnalyzer();
    const analyzer: CliAnalyzer = async (target, progress) => {
      peak = Math.max(peak, ++active);
      seen.push(target.name);
      try {
        await Promise.resolve();
        return await fake(target, progress);
      } finally {
        active--;
      }
    };
    const result = await measureCorpus(entries, analyzer);
    expect(peak).toBe(1);
    expect(seen).toEqual(["example-a", "example-b", "example-c", "example-d"]);
    expect(result).toEqual(
      await measureCorpus([...entries].reverse(), fakeAnalyzer()),
    );
  });
  it("ranks five reasons by frequency then ID and counts pairs, not duplicate occurrences", async () => {
    const input = [
      ...syntheticFixtures,
      { ...syntheticFixtures[1], name: "synthetic-network-repeat" },
    ];
    const measurement = await measureCorpus(
      input.map(fixtureEntry),
      async (target) =>
        syntheticReport(input.find((item) => item.name === target.name)!),
    );
    expect(measurement.aggregates.topReasons).toEqual([
      { id: "network-matches-increased", count: 2 },
      { id: "dependency-added", count: 1 },
      { id: "dynamic-code-matches-increased", count: 1 },
      { id: "environment-matches-increased", count: 1 },
      { id: "install-script-added", count: 1 },
    ]);
    const record = measurement.entries.find(
      (item) => item.outcome === "completed" && item.triage.reasons.length,
    )!;
    if (record.outcome === "completed")
      record.triage.reasons.push(record.triage.reasons[0]);
    expect(aggregate(measurement.entries)).toEqual(measurement.aggregates);
  });
  it("returns zero percentages when every analysis fails", async () => {
    const measured = await measureCorpus(entries, async () => {
      throw new Error("Failure");
    });
    expect(measured.aggregates.completed).toBe(0);
    expect(measured.aggregates.analysisFailures).toBe(4);
    expect(measured.aggregates.tierPercentages).toEqual({
      "needs-review": 0,
      "no-notable-changes": 0,
      incomplete: 0,
    });
    expect(measured.aggregates.reasonFrequency).toEqual([]);
  });
  it("validates all inputs before invoking any analyzer", async () => {
    const analyzer = fakeAnalyzer();
    await expect(
      measureCorpus([entries[0], entries[0]], analyzer),
    ).rejects.toThrow();
    expect(analyzer).not.toHaveBeenCalled();
  });
  it.each(["identity", "status", "score"])(
    "records an analysis failure for an incompatible %s",
    async (kind) => {
      const measured = await measureCorpus([entries[3]], async (target) => {
        const report = triageReport(target);
        if (kind === "identity") report.input.packageName = "example-other";
        if (kind === "status") Object.assign(report, { status: "HIGH RISK" });
        if (kind === "score") Object.assign(report, { riskScore: 82 });
        return report;
      });
      expect(measured.aggregates.analysisFailures).toBe(1);
      expect(measured.entries[0].outcome).toBe("failed");
    },
  );
  it("keeps original report data and does not mutate analyzer inputs or outputs", async () => {
    const target = {
      name: entries[3].name,
      from: entries[3].from,
      to: entries[3].to,
      path: null,
      dev: false,
    };
    const report = triageReport(target);
    Object.assign(report, {
      triage: { tier: "historical-value", extra: "Retain exactly" },
    });
    Object.assign(report.coverage, { extraEvidence: { original: true } });
    const copy = structuredClone(report);
    const measured = await measureCorpus([entries[3]], async () => report);
    expect(report).toEqual(copy);
    const result = measured.entries[0];
    if (result.outcome !== "completed") throw new Error("Expected completion.");
    expect(result.report).toEqual(replayReportSchema.parse(copy));
    expect(result.report).toEqual(copy);
    expect(result.report).not.toBe(report);
    const replayed = replayBenchmark({ schemaVersion: 1, ...measured });
    const replayedEntry = replayed.entries[0];
    if (replayedEntry.outcome !== "completed")
      throw new Error("Expected completion.");
    expect(replayedEntry.report).toEqual(copy);
    expect(replayedEntry.triage.tier).toBe("no-notable-changes");
    expect(result.report.riskScore).toBeNull();
    expect(result.report.status).toBe("INCONCLUSIVE");
  });
});

describe("operator command with injected analyzer and file IO", () => {
  it("runs scripts/benchmark.ts logic offline and writes full triage, reports and Markdown", async () => {
    const memory = ioFor({ "benchmark/corpus.json": JSON.stringify(entries) });
    const analyzer = fakeAnalyzer();
    expect(await benchmarkMain([], { analyzer, io: memory.io, now })).toBe(2);
    const [path, text] = memory.saved();
    expect(path).toMatch(/2026-11-16T00-00-00-000Z\.json$/);
    const document = JSON.parse(text) as Measurement;
    expect(document.aggregates.completed).toBe(3);
    expect(
      document.entries
        .filter((item) => item.outcome === "completed")
        .every(
          (item) => item.report && item.triage.disclaimer === TRIAGE_DISCLAIMER,
        ),
    ).toBe(true);
    expect(memory.files.get(path.replace(/\.json$/, ".md"))).toBe(
      memory.stdout(),
    );
    expect(memory.stderr()).toContain("Analyzing");
    expect(memory.stdout()).not.toContain("Analyzing");
    expect(realAnalyzer).not.toHaveBeenCalled();
  });
  it("replays a saved file with equal aggregates and deep-equal repeat output, without an analyzer", async () => {
    const first = ioFor({ "benchmark/corpus.json": JSON.stringify(entries) });
    await benchmarkMain([], { analyzer: fakeAnalyzer(), io: first.io, now });
    const saved = first.saved()[1];
    const outputs: unknown[] = [];
    for (let index = 0; index < 2; index++) {
      const memory = ioFor({ "saved.json": saved });
      expect(
        await benchmarkMain(["--replay", "saved.json"], { io: memory.io, now }),
      ).toBe(2);
      outputs.push(JSON.parse(memory.saved()[1]));
    }
    expect(outputs[0]).toEqual(outputs[1]);
    expect((outputs[0] as Measurement).aggregates).toEqual(
      (JSON.parse(saved) as Measurement).aggregates,
    );
    expect(realAnalyzer).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("recomputes from reports and ignores stale derived tiers and aggregates", async () => {
    const measured = await measureCorpus(entries, fakeAnalyzer());
    const saved = {
      schemaVersion: 1,
      ...measured,
      aggregates: { obsolete: true },
    };
    Object.assign(saved.entries[0], { triage: { tier: "obsolete" } });
    const replay = replayBenchmark(saved);
    expect(replay.aggregates.tierCounts["needs-review"]).toBe(1);
    expect(replayBenchmark(saved)).toEqual(replay);
    const first = saved.entries[0];
    if (first.outcome === "completed") first.report.metadataSignals = [];
    expect(replayBenchmark(saved).aggregates.tierCounts["needs-review"]).toBe(
      0,
    );
  });
  it("rejects malformed replay reports before classification", async () => {
    const measured = await measureCorpus(entries, fakeAnalyzer());
    const saved = { schemaVersion: 1, ...measured };
    Object.assign(saved.entries[0], { report: { status: "INCONCLUSIVE" } });
    const memory = ioFor({ "saved.json": JSON.stringify(saved) });
    expect(
      await benchmarkMain(["--replay", "saved.json"], { io: memory.io, now }),
    ).toBe(1);
    expect(memory.io.writeNew).not.toHaveBeenCalled();
    expect(realAnalyzer).not.toHaveBeenCalled();
  });
  it("exits zero when all analyses complete, regardless of review tiers", async () => {
    const memory = ioFor({ "small.json": JSON.stringify(entries.slice(1)) });
    expect(
      await benchmarkMain(["--corpus", "small.json"], {
        analyzer: fakeAnalyzer(),
        io: memory.io,
        now,
      }),
    ).toBe(0);
  });
  it.each(
    [
      ["--unknown"],
      ["--replay"],
      ["--replay", "a", "--corpus", "b"],
      ["extra"],
      ["--corpus", "a", "--corpus", "b"],
    ].map((args) => ({ args })),
  )("returns usage error for $args", async ({ args }) => {
    const memory = ioFor();
    const analyzer = fakeAnalyzer();
    expect(await benchmarkMain(args, { analyzer, io: memory.io, now })).toBe(1);
    expect(analyzer).not.toHaveBeenCalled();
  });
  it("reports missing input and output-file collisions without overwriting data", async () => {
    const memory = ioFor({
      "benchmark/corpus.json": JSON.stringify(entries.slice(1)),
    });
    expect(
      await benchmarkMain(["--corpus", "absent.json"], {
        analyzer: fakeAnalyzer(),
        io: memory.io,
        now,
      }),
    ).toBe(1);
    await benchmarkMain([], { analyzer: fakeAnalyzer(), io: memory.io, now });
    const saved = [...memory.files];
    expect(
      await benchmarkMain([], { analyzer: fakeAnalyzer(), io: memory.io, now }),
    ).toBe(1);
    expect([...memory.files]).toEqual(saved);
  });
  it("does not send synthetic corpus names to the default registry analyzer", async () => {
    const memory = ioFor({
      "benchmark/corpus.json": JSON.stringify(
        syntheticFixtures.map(fixtureEntry),
      ),
    });
    expect(await benchmarkMain([], { io: memory.io, now })).toBe(1);
    expect(realAnalyzer).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("help requires no file access or analyzer", async () => {
    const memory = ioFor();
    expect(await benchmarkMain(["--help"], { io: memory.io, now })).toBe(0);
    expect(memory.io.read).not.toHaveBeenCalled();
    expect(memory.stdout()).toContain("--replay");
    expect(realAnalyzer).not.toHaveBeenCalled();
  });
});

describe("generated summary wording", () => {
  it("excludes forbidden terms outside the fixed disclaimer, including untrusted failures and IDs", async () => {
    const measured = await measureCorpus(entries, fakeAnalyzer());
    const attack =
      "safe unsafe malicious clean verified @person | <img> [link](https://fixture.invalid)";
    measured.aggregates.topReasons = [{ id: attack, count: 1 }];
    const failed = measured.entries.find((item) => item.outcome === "failed")!;
    if (failed.outcome === "failed") failed.error = attack;
    const markdown = renderBenchmarkSummary(measured);
    expect(markdown.split(TRIAGE_DISCLAIMER)).toHaveLength(2);
    expect(markdown.replace(TRIAGE_DISCLAIMER, "")).not.toMatch(
      /\b(?:safe|unsafe|malicious|clean|verified)\b/i,
    );
    expect(markdown).not.toContain("riskScore");
    expect(markdown).not.toContain("<img>");
    expect(markdown).toContain("INCONCLUSIVE");
  });
});
