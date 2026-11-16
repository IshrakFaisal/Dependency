import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCli, type CliAnalyzer } from "@/lib/cli";
import type { CliIO } from "@/lib/cli/io";
import type { CliDocument, CliTarget } from "@/lib/cli/output";
import type { StaticAnalysisReport } from "@/lib/types/static-analysis";
import { TRIAGE_DISCLAIMER } from "@/lib/analysis/triage";
import {
  expectReferencedTriage,
  prohibitedTriageWords,
  serializeWithoutDisclaimer,
  triageReport,
  triageSignal,
} from "./helpers/triage-fixtures";
import oldFixture from "./fixtures/lockfile-v2-old.json";
import newFixture from "./fixtures/lockfile-v3-new.json";

const check = ["check", "example-cli", "1.0.0", "1.1.0"];
const lockfile = ["lockfile", "old.json", "new.json"];
type BuildReport = (target: CliTarget) => StaticAnalysisReport | Error;
function reviewReport(target?: CliTarget) {
  const report = triageReport(target);
  report.metadataSignals = [triageSignal("dependency-added")];
  return report;
}
function limitedReport(target?: CliTarget) {
  const report = triageReport(target);
  report.coverage.skippedFiles = 1;
  return report;
}
function harness(build: BuildReport = triageReport) {
  const paths = [
    "node_modules/@scope/tool",
    "node_modules/downgrade",
    "node_modules/upgrade",
  ];
  const fixture = (value: typeof oldFixture | typeof newFixture) =>
    JSON.stringify({
      ...value,
      packages: Object.fromEntries(
        Object.entries(value.packages).filter(([key]) => paths.includes(key)),
      ),
    });
  const files = new Map([
    ["old.json", fixture(oldFixture)],
    ["new.json", fixture(newFixture)],
  ]);
  const reports = new Map<string, StaticAnalysisReport>();
  const originals = new Map<string, StaticAnalysisReport>();
  const stdout = vi.fn<(text: string) => void>();
  const stderr = vi.fn<(text: string) => void>();
  const io: CliIO = {
    stdout,
    stderr,
    readFile: vi.fn(async (file) => {
      if (!files.has(file)) throw new Error("Missing file");
      return files.get(file)!;
    }),
    writeFile: vi.fn(async () => undefined),
  };
  const analyzer = vi.fn<CliAnalyzer>(async (target, progress) => {
    progress("Fixture progress");
    const report = build(target);
    if (report instanceof Error) throw report;
    reports.set(target.name, report);
    originals.set(target.name, structuredClone(report));
    return report;
  });
  const text = () => stdout.mock.calls.flat().join("");
  const document = () => JSON.parse(text()) as CliDocument;
  async function execute(args: string[]) {
    const code = await runCli(args, analyzer, io);
    for (const [name, report] of reports) {
      expect(report).toEqual(originals.get(name));
      expect(report.riskScore).toBeNull();
      expect(report.status).toBe("INCONCLUSIVE");
    }
    if (args.includes("--json")) {
      expect(stdout).toHaveBeenCalledOnce();
      for (const result of document().results) {
        if (result.outcome === "completed")
          expectReferencedTriage(result.triage, reports.get(result.name)!);
      }
      expect(serializeWithoutDisclaimer(document())).not.toMatch(
        prohibitedTriageWords,
      );
    } else {
      // Only exact occurrences of the fixed sentence are removed from text.
      expect(text().split(TRIAGE_DISCLAIMER).join("")).not.toMatch(
        prohibitedTriageWords,
      );
    }
    return code;
  }
  return { execute, io, analyzer, stdout, stderr, text, document };
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Network is disabled in triage CLI tests.");
    }),
  );
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe("CLI triage thresholds", () => {
  it.each([
    { failOn: "review", build: reviewReport, code: 3, tier: "needs-review" },
    {
      failOn: "review",
      build: triageReport,
      code: 0,
      tier: "no-notable-changes",
    },
    { failOn: "review", build: limitedReport, code: 0, tier: "incomplete" },
    { failOn: "incomplete", build: limitedReport, code: 3, tier: "incomplete" },
    {
      failOn: "incomplete",
      build: reviewReport,
      code: 3,
      tier: "needs-review",
    },
    {
      failOn: "incomplete",
      build: triageReport,
      code: 0,
      tier: "no-notable-changes",
    },
  ])(
    "--fail-on $failOn returns $code for $tier",
    async ({ failOn, build, code, tier }) => {
      const h = harness(build);
      expect(await h.execute([...check, "--json", "--fail-on", failOn])).toBe(
        code,
      );
      expect(h.document().results[0]).toMatchObject({
        status: "INCONCLUSIVE",
        triage: { tier },
      });
    },
  );

  it.each([reviewReport, limitedReport])(
    "preserves the default exit 0 without --fail-on",
    async (build) => {
      const h = harness(build);
      expect(await h.execute([...check, "--json"])).toBe(0);
    },
  );

  it.each(["review", "incomplete"])(
    "keeps exit 2 above --fail-on %s and retains remaining results",
    async (failOn) => {
      const h = harness((target) =>
        target.name === "downgrade"
          ? new Error("Fixture failure")
          : reviewReport(target),
      );
      expect(
        await h.execute([...lockfile, "--json", "--fail-on", failOn]),
      ).toBe(2);
      expect(h.document().results.map((result) => result.outcome)).toEqual([
        "completed",
        "failed",
        "completed",
      ]);
      expect(h.document().triageSummary).toEqual({
        "needs-review": 2,
        "no-notable-changes": 0,
        incomplete: 0,
      });
      expect(h.analyzer).toHaveBeenCalledTimes(3);
    },
  );

  it("keeps output-file errors at exit 1 above a triggered triage threshold", async () => {
    const h = harness(reviewReport);
    vi.mocked(h.io.writeFile).mockRejectedValue(new Error("Output error"));
    expect(
      await h.execute([
        ...check,
        "--json",
        "--fail-on",
        "review",
        "--out",
        "report.json",
      ]),
    ).toBe(1);
    expect(h.document().error?.code).toBe("file-error");
    expect(h.document().results).toHaveLength(1);
  });

  it.each(
    [
      ["--fail-on"],
      ["--fail-on", "unknown"],
      ["--fail-on", ""],
      ["--fail-on", "review", "--fail-on", "incomplete"],
    ].map((flags) => ({ flags })),
  )("rejects invalid threshold arguments: $flags", async ({ flags }) => {
    const h = harness();
    expect(await h.execute([...check, "--json", ...flags])).toBe(1);
    expect(h.analyzer).not.toHaveBeenCalled();
    expect(h.document().error?.code).toBe("usage-error");
  });

  it("handles --fail-on=review using node:util argument parsing", async () => {
    const h = harness(reviewReport);
    expect(await h.execute([...check, "--json", "--fail-on=review"])).toBe(3);
  });

  it("does not escalate recency with --fail-on review", async () => {
    const h = harness((target) => {
      const report = triageReport(target);
      report.metadataSignals = [triageSignal("recent-release")];
      return report;
    });
    expect(await h.execute([...check, "--json", "--fail-on", "review"])).toBe(
      0,
    );
    expect(h.document().results[0]).toMatchObject({
      triage: {
        tier: "no-notable-changes",
        reasons: [expect.objectContaining({ id: "recent-release" })],
      },
    });
  });
});

describe("CLI triage output", () => {
  it("includes tier, reasons, references and the fixed disclaimer in human output", async () => {
    const h = harness(reviewReport);
    expect(await h.execute(check)).toBe(0);
    expect(h.text()).toContain("Triage: needs-review");
    expect(h.text()).toContain("dependency-added [metadata]");
    expect(h.text()).toContain("Evidence: dependency-added");
    expect(h.text()).toContain(TRIAGE_DISCLAIMER);
  });

  it("includes triage in a single JSON document and keeps progress on stderr", async () => {
    const h = harness(reviewReport);
    await h.execute([...check, "--json"]);
    expect(h.document().results[0]).toMatchObject({
      triage: { tier: "needs-review", disclaimer: TRIAGE_DISCLAIMER },
    });
    expect(h.text()).not.toContain("Fixture progress");
    expect(h.stderr.mock.calls.flat().join("")).toContain("Fixture progress");
  });

  it.each([false, true])(
    "counts completed lockfile packages per tier, JSON=%s",
    async (json) => {
      const h = harness((target) =>
        target.name === "@scope/tool"
          ? reviewReport(target)
          : target.name === "downgrade"
            ? limitedReport(target)
            : triageReport(target),
      );
      expect(await h.execute([...lockfile, ...(json ? ["--json"] : [])])).toBe(
        0,
      );
      if (json)
        expect(h.document().triageSummary).toEqual({
          "needs-review": 1,
          "no-notable-changes": 1,
          incomplete: 1,
        });
      else
        expect(h.text()).toContain(
          "Triage totals: needs-review: 1; no-notable-changes: 1; incomplete: 1.",
        );
    },
  );

  it.each([false, true])(
    "guards output language including arbitrary metadata and notes, JSON=%s",
    async (json) => {
      const h = harness((target) => {
        const report = triageReport(target);
        const text = "safe unsafe malicious clean verified";
        report.metadataSignals = [
          { ...triageSignal("provenance-dropped"), title: text, detail: text },
        ];
        report.coverage.notes = [text];
        report.limitations = [text];
        return report;
      });
      expect(
        await h.execute([
          ...check,
          "--out",
          "report.txt",
          ...(json ? ["--json"] : []),
        ]),
      ).toBe(0);
      expect(vi.mocked(h.io.writeFile).mock.calls[0][1]).toBe(h.text());
      expect(h.text()).not.toContain("riskScore");
    },
  );

  it("derives triage from comparison data rather than a stale supplied triage field", async () => {
    const h = harness((target) => ({
      ...reviewReport(target),
      triage: {
        tier: "no-notable-changes",
        reasons: [],
        disclaimer: TRIAGE_DISCLAIMER,
      },
    }));
    expect(await h.execute([...check, "--json", "--fail-on", "review"])).toBe(
      3,
    );
    expect(h.document().results[0]).toMatchObject({
      triage: { tier: "needs-review" },
    });
  });
});
