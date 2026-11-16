import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { benchmarkMain, type BenchmarkIO } from "../../scripts/benchmark";
import { auditPathHints, renderBenchmarkAudit } from "@/lib/benchmark/audit";
import {
  benchmarkEntrySchema,
  corpusSchema,
  pairKey,
} from "@/lib/benchmark/schema";
import { TRIAGE_DISCLAIMER } from "@/lib/analysis/triage";
import { escapeCommentText } from "@/lib/github/escape";
import corpus from "../../benchmark/corpus.json";
import fixture from "./fixtures/benchmark-audit.json";

const realAnalyzer = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("Analyzer prohibited in audit tests.");
  }),
);
vi.mock("@/lib/cli/analyzer", () => ({ staticAnalyzer: realAnalyzer }));
beforeEach(() => {
  realAnalyzer.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Network prohibited in audit tests.");
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const saved = () => ({
  schemaVersion: 1,
  entries: fixture.entries.map((entry) =>
    benchmarkEntrySchema.parse(structuredClone(entry)),
  ),
});
function selectedFixture(name = "audit-aggregate") {
  const data = saved();
  const result = data.entries.find(({ entry }) => entry.name === name)!;
  if (result.outcome !== "completed")
    throw new Error("Expected fixture report.");
  return { data, result };
}
function memory(input: unknown = fixture) {
  const files = new Map([["inputs/run.json", JSON.stringify(input)]]);
  let stdout = "";
  let stderr = "";
  const io: BenchmarkIO = {
    read: vi.fn(async (path) => {
      if (!files.has(path)) throw new Error("Missing fixture.");
      return files.get(path)!;
    }),
    mkdir: vi.fn(async () => undefined),
    writeNew: vi.fn(async (path, text) => {
      if (files.has(path)) throw new Error("Output exists.");
      files.set(path, text);
    }),
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
  };
  return { files, io, stdout: () => stdout, stderr: () => stderr };
}

describe("saved benchmark audit", () => {
  it("lists exactly review and incomplete pairs, all reasons and blank reviewer labels", () => {
    const output = renderBenchmarkAudit(fixture);
    expect(output.match(/^## Pair .*$/gm)).toEqual([
      `## Pair 1: ${escapeCommentText("audit-aggregate 1.0.0 -> 1.1.0")}`,
      `## Pair 2: ${escapeCommentText("audit-finding 1.0.0 -> 1.1.0")}`,
      `## Pair 3: ${escapeCommentText("audit-limited 1.0.0 -> 1.1.0")}`,
    ]);
    expect(output).not.toContain("audit&#45;unflagged");
    expect(output).not.toContain("audit&#45;failed");
    expect(output.match(/^Reviewer label: ____$/gm)).toHaveLength(3);
    for (const id of [
      "network-matches-increased",
      "new-file:finding-added",
      "scan-truncated",
    ])
      expect(output).toContain(`### Reason: ${escapeCommentText(id)}`);
    expect(output).toContain("Tier: incomplete");
  });
  it("shows aggregate category totals and all linked category evidence without assigning a single location", () => {
    const output = renderBenchmarkAudit(fixture);
    expect(output).toContain(
      "Source location: not attributable to a single finding",
    );
    expect(output).toContain(
      "Category: <code>network</code>; old total: 1; new total: 4.",
    );
    for (const path of [
      "tests/request.test.js",
      "docs/request.js",
      "examples/demo.js",
      "dist/index.js",
    ])
      expect(output).toContain(`File: ${escapeCommentText(path)}`);
    for (const hint of ["test", "docs", "example", "build-output"])
      expect(output).toContain(`Path-kind hint (path heuristic only): ${hint}`);
    expect(output).toContain(
      "Old line: 3; excerpt: <code>&#47;&#47; old inert fixture text</code>",
    );
    expect(output).toContain(
      "New line: 7; excerpt: <code>&#47;&#47; new inert fixture text</code>",
    );
    expect(output).toContain("does not attribute the aggregate increase");
  });
  it("follows direct finding references without borrowing evidence from another category", () => {
    const { data, result } = selectedFixture("audit-finding");
    result.report.findings.push({
      ...result.report.findings[0],
      id: "unrelated",
      category: "environment",
      evidenceIds: ["other"],
    });
    result.report.evidence.push({
      ...result.report.evidence[0],
      id: "other",
      file: "do-not-include.js",
    });
    const output = renderBenchmarkAudit(data);
    expect(output).toContain(`File: ${escapeCommentText("src/added.js")}`);
    expect(output).not.toContain(escapeCommentText("do-not-include.js"));
  });
  it("reports absent evidence and nullable lines explicitly", () => {
    const { data, result } = selectedFixture();
    result.report.findings[0].evidenceIds.push("absent");
    result.report.evidence[0].oldLine = null;
    result.report.evidence[0].oldExcerpt = null;
    let output = renderBenchmarkAudit(data);
    expect(output).toContain("Old line: not retained; excerpt: not retained");
    expect(output).toContain(
      "Referenced evidence not retained: <code>absent</code>",
    );
    result.report.evidence = [];
    output = renderBenchmarkAudit(data);
    expect(output).toContain(
      "No linked evidence entries retained for this reason.",
    );
  });
  it("is deterministic under reordered results, findings, reasons and evidence and does not mutate input", () => {
    const data = saved();
    const before = structuredClone(data);
    const first = renderBenchmarkAudit(data);
    expect(data).toEqual(before);
    data.entries.reverse();
    for (const result of data.entries)
      if (result.outcome === "completed") {
        result.report.evidence.reverse();
        result.report.findings.reverse();
        result.triage.reasons.reverse();
      }
    expect(renderBenchmarkAudit(data)).toBe(first);
    expect(renderBenchmarkAudit(data)).toBe(renderBenchmarkAudit(data));
  });
  it("uses the saved tier and reasons without recomputing triage", () => {
    const { data, result } = selectedFixture();
    result.report.findings = [];
    result.report.signalCounts = [];
    expect(renderBenchmarkAudit(data)).toContain(
      escapeCommentText("audit-aggregate 1.0.0 -> 1.1.0"),
    );
    expect(renderBenchmarkAudit(data)).toContain(
      "Category totals not retained at the referenced row.",
    );
  });
  it("truncates excerpts to 200 characters including the marker before escaping", () => {
    const { data, result } = selectedFixture();
    result.report.evidence[0].newExcerpt = "x".repeat(240);
    const output = renderBenchmarkAudit(data);
    expect(output).toContain(escapeCommentText("x".repeat(199) + "…"));
    expect(output).not.toContain("x".repeat(200));
  });
  it("escapes hostile source, paths, IDs and titles and enforces the wording guard", () => {
    const { data, result } = selectedFixture("audit-finding");
    const attack =
      "``` | <img src=x> @person [link](https://fixture.invalid)\n# heading\r\n<!-- comment --> safe unsafe malicious clean verified";
    result.report.evidence[0].file = attack;
    result.report.evidence[0].newExcerpt = attack;
    result.report.evidence[0].oldExcerpt = attack;
    result.triage.reasons[0].id = attack;
    result.triage.reasons[0].title = attack;
    result.triage.reasons[0].detail = attack + TRIAGE_DISCLAIMER;
    const output = renderBenchmarkAudit(data);
    expect(output).toContain(escapeCommentText(attack));
    for (const fragment of [
      "```",
      "<img",
      "@person",
      "[link](",
      "https://",
      "\n# heading",
      "<!--",
      " | ",
    ])
      expect(output).not.toContain(fragment);
    expect(output.split(TRIAGE_DISCLAIMER)).toHaveLength(2);
    expect(output.replace(TRIAGE_DISCLAIMER, "")).not.toMatch(
      /\b(?:safe|unsafe|malicious|clean|verified)\b/i,
    );
    expect(output).not.toContain("riskScore");
    expect(output).toContain("INCONCLUSIVE");
  });
  it("escapes scoped package names and filters reserved wording in valid package names", () => {
    const { data, result } = selectedFixture();
    const name = "@audit/safe";
    result.entry.name = name;
    result.report.input.packageName = name;
    result.report.releases.trusted.release.name = name;
    result.report.releases.candidate.release.name = name;
    const output = renderBenchmarkAudit(data);
    expect(output).toContain(escapeCommentText(`${name} 1.0.0 -> 1.1.0`));
    expect(output).not.toContain("@audit");
    expect(output.replace(TRIAGE_DISCLAIMER, "")).not.toMatch(/\bsafe\b/i);
  });
  it.each([
    ["src/request.spec.ts", ["test"]],
    ["EXAMPLES\\BUILD\\test.js", ["example", "build-output"]],
    ["README.md", ["docs"]],
    ["assets/app.min.js", ["build-output"]],
    ["lib/latest.js", []],
    ["src/testing.js", []],
  ])("uses path boundaries for %s", (path, hints) => {
    expect(auditPathHints(path as string)).toEqual(hints);
  });
});

describe("audit command offline", () => {
  it("writes only the named audit Markdown, without an analyzer or clock", async () => {
    const m = memory();
    const analyzer = vi.fn();
    const now = vi.fn();
    expect(
      await benchmarkMain(["--audit", "inputs/run.json"], {
        io: m.io,
        analyzer,
        now,
      }),
    ).toBe(0);
    const path = resolve("benchmark/results/run-audit.md");
    expect(m.io.writeNew).toHaveBeenCalledExactlyOnceWith(
      path,
      renderBenchmarkAudit(fixture),
    );
    expect(m.stdout()).toBe(m.files.get(path));
    expect(m.stdout()).not.toContain("Audit written to");
    expect(m.stderr()).toContain("Audit written to");
    expect(m.files.get("inputs/run.json")).toBe(JSON.stringify(fixture));
    expect(analyzer).not.toHaveBeenCalled();
    expect(realAnalyzer).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(now).not.toHaveBeenCalled();
  });
  it("supports out-dir and refuses to overwrite an existing audit", async () => {
    const m = memory();
    const args = ["--audit", "inputs/run.json", "--out-dir", "audit-output"];
    expect(await benchmarkMain(args, { io: m.io })).toBe(0);
    const before = [...m.files];
    expect(await benchmarkMain(args, { io: m.io })).toBe(1);
    expect([...m.files]).toEqual(before);
    expect(m.files.has(resolve("audit-output/run-audit.md"))).toBe(true);
  });
  it.each([
    ["--audit"],
    ["--audit", ""],
    ["--audit", "inputs/run.json", "--replay", "other.json"],
    ["--audit", "inputs/run.json", "--corpus", "other.json"],
    ["--audit", "a", "--audit", "b"],
    ["--audit", "inputs/run.json", "--help"],
    ["--audit", "absent.json"],
  ])("rejects missing files or incompatible arguments %j", async (...args) => {
    const m = memory();
    expect(await benchmarkMain(args, { io: m.io })).toBe(1);
    expect(m.io.writeNew).not.toHaveBeenCalled();
    expect(realAnalyzer).not.toHaveBeenCalled();
  });
  it.each(["tier", "score", "identity", "duplicate"])(
    "rejects invalid saved %s before writing",
    async (kind) => {
      const { data, result } = selectedFixture();
      if (kind === "tier") Object.assign(result.triage, { tier: "invalid" });
      if (kind === "score") Object.assign(result.report, { riskScore: 50 });
      if (kind === "identity")
        result.report.input.packageName = "another-package";
      if (kind === "duplicate") data.entries.push(structuredClone(result));
      const m = memory(data);
      expect(
        await benchmarkMain(["--audit", "inputs/run.json"], { io: m.io }),
      ).toBe(1);
      expect(m.io.writeNew).not.toHaveBeenCalled();
    },
  );
});

describe("expanded audit corpus", () => {
  it("contains 60 unique pairs and preserves the original 30 records exactly", () => {
    const parsed = corpusSchema.parse(corpus);
    expect(parsed).toHaveLength(60);
    expect(new Set(parsed.map(pairKey)).size).toBe(60);
    // SHA-256 of JSON.stringify(original corpus at 9c52877), including notes/order.
    expect(
      createHash("sha256")
        .update(JSON.stringify(corpus.slice(0, 30)))
        .digest("hex"),
    ).toBe("4c7474e9f8e0aea14d19add22c3c18a40a1fe3437f9b8e3a6493b1722b78f80e");
  });
  it("records the actual mix and the six install-script and ten small-package selections", () => {
    const counts = { major: 0, minor: 0, patch: 0 };
    for (const pair of corpus.slice(30)) {
      const before = pair.from.split(".");
      const after = pair.to.split(".");
      counts[
        before[0] !== after[0]
          ? "major"
          : before[1] !== after[1]
            ? "minor"
            : "patch"
      ]++;
    }
    expect(counts).toEqual({ major: 6, minor: 16, patch: 8 });
    expect(
      corpus
        .slice(30)
        .filter((entry) => entry.notes.startsWith("Install-script cohort")),
    ).toHaveLength(6);
    expect(
      corpus
        .slice(30)
        .filter((entry) =>
          entry.notes.startsWith("Small utility package cohort"),
        ),
    ).toHaveLength(10);
  });
});
