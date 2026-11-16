import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCli, type CliAnalyzer } from "@/lib/cli";
import { CliAnalysisError } from "@/lib/cli/arguments";
import type { CliIO } from "@/lib/cli/io";
import type { CliDocument } from "@/lib/cli/output";
import oldFixture from "./fixtures/lockfile-v2-old.json";
import newFixture from "./fixtures/lockfile-v3-new.json";
import { cliReport } from "./helpers/cli-fixtures";

const check = ["check", "example-cli", "1.0.0", "1.1.0"];
const lockfile = ["lockfile", "old.json", "new.json"];
const changedPaths = [
  "node_modules/upgrade",
  "node_modules/downgrade",
  "node_modules/@scope/tool",
];
function subset(
  fixture: typeof oldFixture | typeof newFixture,
  paths: string[],
) {
  return {
    ...fixture,
    packages: Object.fromEntries(
      Object.entries(fixture.packages).filter(([path]) => paths.includes(path)),
    ),
  };
}
function harness(oldLock: unknown = oldFixture, newLock: unknown = newFixture) {
  const files = new Map([
    ["old.json", JSON.stringify(oldLock)],
    ["new.json", JSON.stringify(newLock)],
  ]);
  const saved = new Map<string, string>();
  const stdout = vi.fn<(text: string) => void>();
  const stderr = vi.fn<(text: string) => void>();
  const io: CliIO = {
    stdout,
    stderr,
    readFile: vi.fn(async (file) => {
      if (!files.has(file)) throw new Error("ENOENT");
      return files.get(file)!;
    }),
    writeFile: vi.fn(async (file, text) => {
      saved.set(file, text);
    }),
  };
  const analyzer = vi.fn<CliAnalyzer>(async (target, progress) => {
    progress("Fixture analysis stage");
    return cliReport(target);
  });
  const text = () => stdout.mock.calls.map(([value]) => value).join("");
  return {
    files,
    saved,
    io,
    stdout,
    stderr,
    analyzer,
    text,
    document: () => JSON.parse(text()) as CliDocument,
  };
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Network is forbidden in CLI tests.");
    }),
  );
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe("CLI check and presentation", () => {
  it("completes check with a fake analyzer and retains an INCONCLUSIVE summary", async () => {
    const h = harness();
    expect(await runCli([...check, "--json"], h.analyzer, h.io)).toBe(0);
    expect(h.analyzer).toHaveBeenCalledOnce();
    expect(h.document().results[0]).toMatchObject({
      name: "example-cli",
      from: "1.0.0",
      to: "1.1.0",
      outcome: "completed",
      status: "INCONCLUSIVE",
      findingsByCategory: { network: 1, process: 0 },
    });
    expect(h.document().summary).toEqual({
      completed: 1,
      failed: 0,
      skipped: 0,
    });
  });

  it("returns exit 2 for an analysis failure", async () => {
    const h = harness();
    h.analyzer.mockRejectedValue(new Error("Internal failure details"));
    expect(await runCli([...check, "--json"], h.analyzer, h.io)).toBe(2);
    expect(h.document().results[0]).toMatchObject({
      outcome: "failed",
      error: "Package analysis failed.",
    });
    expect(h.text()).not.toContain("Internal failure details");
  });

  it("keeps progress on stderr and emits exactly one parseable JSON document", async () => {
    const h = harness();
    await runCli([...check, "--json"], h.analyzer, h.io);
    expect(h.stdout).toHaveBeenCalledOnce();
    expect(() => JSON.parse(h.text())).not.toThrow();
    expect(h.text()).not.toContain("Fixture analysis stage");
    expect(h.stderr.mock.calls.flat().join("")).toContain(
      "Fixture analysis stage",
    );
    expect(h.stderr.mock.calls.flat().join("")).toContain(
      "Analyzing example-cli",
    );
  });

  it("prints versions, signals, category counts, coverage and limitations in human mode", async () => {
    const h = harness();
    await runCli(check, h.analyzer, h.io);
    for (const text of [
      "example-cli 1.0.0 -> 1.1.0",
      "INCONCLUSIVE",
      "dependency-added [review]",
      "example-extra",
      "network: 1",
      "process: 0",
      "truncated: true",
      "runtime behavior is untested",
      "One binary file excluded",
    ])
      expect(h.text()).toContain(text);
    expect(h.text()).not.toContain("riskScore");
  });

  it("does not base exit codes on findings or metadata signals", async () => {
    const h = harness();
    const report = cliReport();
    h.analyzer.mockResolvedValue(report);
    expect(await runCli(check, h.analyzer, h.io)).toBe(0);
    expect(report.findings).not.toHaveLength(0);
    expect(report.metadataSignals).not.toHaveLength(0);
    expect(report.riskScore).toBeNull();
  });

  it("permits identical exact versions required by the CLI smoke check", async () => {
    const h = harness();
    expect(
      await runCli(
        ["check", "example-cli", "7.0.0", "7.0.0"],
        h.analyzer,
        h.io,
      ),
    ).toBe(0);
    expect(h.analyzer.mock.calls[0][0]).toMatchObject({
      from: "7.0.0",
      to: "7.0.0",
    });
  });

  it.each([false, true])(
    "omits scores and prohibited verdict words in every output stream (JSON=%s)",
    async (json) => {
      const h = harness();
      const report = cliReport();
      report.limitations.push("SAFE unsafe malicious CLEAN \u001b[2J");
      report.metadataSignals!.push({
        id: "provenance-dropped",
        severity: "review",
        title: "safe",
        detail: "unsafe malicious clean",
        evidence: {
          oldAttestations: {
            riskScore: 99,
            safe: "malicious",
            nested: { riskScore: 82 },
          },
          newAttestations: null,
        },
      });
      const original = structuredClone(report);
      h.analyzer.mockImplementation(async (_, progress) => {
        progress("unsafe\u001b[2J");
        return report;
      });
      expect(
        await runCli(
          [...check, "--out", "report.txt", ...(json ? ["--json"] : [])],
          h.analyzer,
          h.io,
        ),
      ).toBe(0);
      for (const output of [
        h.text(),
        h.stderr.mock.calls.flat().join(""),
        h.saved.get("report.txt")!,
      ]) {
        expect(output).not.toMatch(/\b(?:safe|unsafe|malicious|clean)\b/i);
        expect(output).not.toMatch(/riskScore/);
        expect(output).not.toContain("\u001b");
      }
      if (json) expect(() => JSON.parse(h.text())).not.toThrow();
      expect(report).toEqual(original);
      expect(report.riskScore).toBeNull();
    },
  );

  it.each([false, true])(
    "filters package errors and argument errors (JSON=%s)",
    async (json) => {
      const h = harness();
      h.analyzer.mockRejectedValue(
        new CliAnalysisError("unsafe malicious clean safe"),
      );
      expect(
        await runCli([...check, ...(json ? ["--json"] : [])], h.analyzer, h.io),
      ).toBe(2);
      expect(h.text() + h.stderr.mock.calls.flat().join("")).not.toMatch(
        /\b(?:safe|unsafe|malicious|clean)\b/i,
      );
      const bad = harness();
      expect(
        await runCli(
          ["unsafe", ...(json ? ["--json"] : [])],
          bad.analyzer,
          bad.io,
        ),
      ).toBe(1);
      expect(bad.text()).not.toMatch(/\b(?:safe|unsafe|malicious|clean)\b/i);
    },
  );

  it("rejects an incompatible scored report without printing its score", async () => {
    const h = harness();
    h.analyzer.mockResolvedValue({
      ...cliReport(),
      riskScore: 82,
    } as unknown as ReturnType<typeof cliReport>);
    expect(await runCli([...check, "--json"], h.analyzer, h.io)).toBe(2);
    expect(h.text()).not.toMatch(/riskScore|82/);
    expect(h.document().results[0]).toMatchObject({
      outcome: "failed",
      status: "INCONCLUSIVE",
    });
  });
});

describe("CLI lockfile batches", () => {
  it("analyzes three changed packages sequentially in name order", async () => {
    const h = harness(
      subset(oldFixture, changedPaths),
      subset(newFixture, changedPaths),
    );
    const events: string[] = [];
    let active = 0;
    h.analyzer.mockImplementation(async (target) => {
      expect(active++).toBe(0);
      events.push(`start:${target.name}`);
      await new Promise<void>((resolve) => setTimeout(resolve, 1));
      events.push(`end:${target.name}`);
      active--;
      return cliReport(target);
    });
    expect(await runCli([...lockfile, "--json"], h.analyzer, h.io)).toBe(0);
    expect(h.document().results.map((entry) => entry.name)).toEqual([
      "@scope/tool",
      "downgrade",
      "upgrade",
    ]);
    expect(events).toEqual([
      "start:@scope/tool",
      "end:@scope/tool",
      "start:downgrade",
      "end:downgrade",
      "start:upgrade",
      "end:upgrade",
    ]);
  });

  it("continues after one failure and prints all results with exit 2", async () => {
    const h = harness(
      subset(oldFixture, changedPaths),
      subset(newFixture, changedPaths),
    );
    h.analyzer.mockImplementation(async (target) => {
      if (target.name === "downgrade")
        throw new CliAnalysisError("Registry request failed.");
      return cliReport(target);
    });
    expect(await runCli([...lockfile, "--json"], h.analyzer, h.io)).toBe(2);
    expect(h.analyzer).toHaveBeenCalledTimes(3);
    expect(h.document().results.map((entry) => entry.outcome)).toEqual([
      "completed",
      "failed",
      "completed",
    ]);
    expect(h.document().summary).toEqual({
      completed: 2,
      failed: 1,
      skipped: 0,
    });
  });

  it("lists root, git, file, link and removed entries with reasons", async () => {
    const h = harness();
    await runCli([...lockfile, "--json"], h.analyzer, h.io);
    expect(h.document().skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "", reason: "root package entry" }),
        expect.objectContaining({
          path: "node_modules/git-dependency",
          reason: "non-registry resolved URL",
        }),
        expect.objectContaining({
          path: "node_modules/file-dependency",
          reason: "non-registry resolved URL",
        }),
        expect.objectContaining({
          path: "node_modules/link-dependency",
          reason: "workspace or link entry",
        }),
        expect.objectContaining({
          name: "removed",
          reason: "Removed dependency; no candidate version to analyze.",
        }),
      ]),
    );
    expect(
      h.analyzer.mock.calls.some(([target]) => target.name === "unchanged"),
    ).toBe(false);
  });

  it("also includes skipped paths and reasons in human output", async () => {
    const h = harness();
    await runCli(lockfile, h.analyzer, h.io);
    expect(h.text()).toContain("Skipped entries:");
    expect(h.text()).toContain(
      "node_modules/git-dependency: non-registry resolved URL",
    );
  });

  it("excludes dev dependencies by default and explains the exclusion", async () => {
    const h = harness();
    await runCli([...lockfile, "--json"], h.analyzer, h.io);
    expect(h.analyzer.mock.calls.some(([target]) => target.dev)).toBe(false);
    expect(h.document().skipped).toContainEqual({
      name: "dev-only",
      path: "node_modules/dev-only",
      reason:
        "Development dependency excluded; use --include-dev to include it.",
    });
  });

  it("includes dev dependencies when --include-dev is supplied", async () => {
    const h = harness();
    await runCli([...lockfile, "--json", "--include-dev"], h.analyzer, h.io);
    expect(
      h.analyzer.mock.calls.some(
        ([target]) => target.dev && target.name === "dev-only",
      ),
    ).toBe(true);
    expect(
      h.document().skipped.some((entry) => entry.name === "dev-only"),
    ).toBe(false);
  });

  it("passes added entries to the injected analyzer with a null baseline", async () => {
    const h = harness();
    await runCli([...lockfile, "--json"], h.analyzer, h.io);
    expect(h.analyzer.mock.calls.map(([target]) => target)).toContainEqual({
      name: "added",
      from: null,
      to: "1.0.0",
      path: "node_modules/added",
      dev: false,
    });
  });

  it("retains duplicate names and even identical version pairs at separate paths", async () => {
    const paths = [
      "node_modules/one/node_modules/repeated",
      "node_modules/two/node_modules/repeated",
    ];
    const old = subset(oldFixture, paths);
    const next = subset(newFixture, paths);
    old.packages[paths[1]] = old.packages[paths[0]];
    next.packages[paths[1]] = next.packages[paths[0]];
    const h = harness(old, next);
    await runCli([...lockfile, "--json"], h.analyzer, h.io);
    expect(h.analyzer).toHaveBeenCalledTimes(2);
    expect(
      h.document().results.map(({ name, path }) => ({ name, path })),
    ).toEqual(paths.map((path) => ({ name: "repeated", path })));
  });

  it("produces identical ordered JSON when package-map insertion order changes", async () => {
    const reverse = (fixture: typeof oldFixture | typeof newFixture) => ({
      ...fixture,
      packages: Object.fromEntries(Object.entries(fixture.packages).reverse()),
    });
    const a = harness();
    const b = harness(reverse(oldFixture), reverse(newFixture));
    await runCli([...lockfile, "--json"], a.analyzer, a.io);
    await runCli([...lockfile, "--json"], b.analyzer, b.io);
    expect(a.document()).toEqual(b.document());
    expect(
      a.document().results.map(({ name, path }) => `${name}:${path}`),
    ).toEqual([
      "@scope/tool:node_modules/@scope/tool",
      "added:node_modules/added",
      "downgrade:node_modules/downgrade",
      "nested:node_modules/parent/node_modules/nested",
      "repeated:node_modules/one/node_modules/repeated",
      "repeated:node_modules/two/node_modules/repeated",
      "upgrade:node_modules/upgrade",
    ]);
  });

  it("returns exit 0 for an unchanged lockfile without calling the analyzer", async () => {
    const h = harness(oldFixture, oldFixture);
    expect(await runCli([...lockfile, "--json"], h.analyzer, h.io)).toBe(0);
    expect(h.analyzer).not.toHaveBeenCalled();
    expect(h.document().results).toEqual([]);
  });

  it("reports invalid registry version pairs as package failures and continues", async () => {
    const old = subset(oldFixture, changedPaths);
    const next = subset(newFixture, changedPaths);
    next.packages["node_modules/downgrade"] = {
      version: "latest",
      resolved: "https://registry.npmjs.org/downgrade/-/fixture.tgz",
    };
    const h = harness(old, next);
    expect(await runCli([...lockfile, "--json"], h.analyzer, h.io)).toBe(2);
    expect(h.analyzer).toHaveBeenCalledTimes(2);
    expect(h.document().results.map(({ outcome }) => outcome)).toEqual([
      "completed",
      "failed",
      "completed",
    ]);
  });
});

describe("CLI arguments and files", () => {
  it("returns exit 1 for a missing file before analyzing anything", async () => {
    const h = harness();
    expect(
      await runCli(
        ["lockfile", "missing.json", "new.json", "--json"],
        h.analyzer,
        h.io,
      ),
    ).toBe(1);
    expect(h.document().error).toMatchObject({
      code: "file-error",
      message: "Could not read lockfile: missing.json",
    });
    expect(h.analyzer).not.toHaveBeenCalled();
  });

  it("returns exit 1 for invalid JSON and emits one JSON error document", async () => {
    const h = harness();
    h.files.set("new.json", "{");
    expect(await runCli([...lockfile, "--json"], h.analyzer, h.io)).toBe(1);
    expect(h.document().error?.code).toBe("file-error");
    expect(h.stdout).toHaveBeenCalledOnce();
    expect(h.analyzer).not.toHaveBeenCalled();
  });

  it.each([
    null,
    { lockfileVersion: 1, dependencies: {} },
    { lockfileVersion: 3 },
  ])(
    "handles invalid or unsupported lockfile structure: %j",
    async (invalid) => {
      const h = harness(invalid);
      expect(await runCli([...lockfile, "--json"], h.analyzer, h.io)).toBe(1);
      expect(h.document().error?.code).toBe("file-error");
      expect(h.analyzer).not.toHaveBeenCalled();
    },
  );

  it.each(
    [
      [],
      ["check"],
      [...check, "extra"],
      ["check", "example-cli", "latest", "1.0.0"],
      [...check, "--include-dev"],
      [...check, "--unknown"],
      [...check, "--out"],
      [...check, "--json", "--json"],
    ].map((args) => ({ args })),
  )("returns exit 1 for bad arguments: $args", async ({ args }) => {
    const h = harness();
    expect(await runCli(args, h.analyzer, h.io)).toBe(1);
    expect(h.analyzer).not.toHaveBeenCalled();
    expect(h.text()).toContain("INCONCLUSIVE");
  });

  it.each([false, true])(
    "prints help without analysis or file access (JSON=%s)",
    async (json) => {
      const h = harness();
      expect(
        await runCli(["--help", ...(json ? ["--json"] : [])], h.analyzer, h.io),
      ).toBe(0);
      expect(h.text()).toContain("check <package>");
      expect(h.text()).toContain("lockfile <oldLockfile>");
      expect(h.analyzer).not.toHaveBeenCalled();
      expect(h.io.readFile).not.toHaveBeenCalled();
      if (json) expect(JSON.parse(h.text()).command).toBe("help");
    },
  );

  it.each([false, true])(
    "writes the selected output format unchanged to --out (JSON=%s)",
    async (json) => {
      const h = harness();
      expect(
        await runCli(
          [...check, "--out", "report.txt", ...(json ? ["--json"] : [])],
          h.analyzer,
          h.io,
        ),
      ).toBe(0);
      expect(h.saved.get("report.txt")).toBe(h.text());
    },
  );

  it("returns exit 1 for an output file error and retains the analysis results", async () => {
    const h = harness();
    vi.mocked(h.io.writeFile).mockRejectedValue(new Error("EEXIST"));
    expect(
      await runCli([...check, "--out", "old.json", "--json"], h.analyzer, h.io),
    ).toBe(1);
    expect(h.stdout).toHaveBeenCalledOnce();
    expect(h.document().summary.completed).toBe(1);
    expect(h.document().error?.code).toBe("file-error");
  });
});
