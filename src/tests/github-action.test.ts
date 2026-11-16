import { describe, expect, it, vi } from "vitest";
import type { CliAnalyzer } from "@/lib/cli";
import {
  actionOptionsFromEnv,
  runPullRequestAction,
} from "@/lib/github/action";
import { escapeCommentText } from "@/lib/github/escape";
import {
  fakeCommentClient,
  githubLockfile,
  prContext,
  registryEntry,
} from "./helpers/github-fixtures";
import { triageReport, triageSignal } from "./helpers/triage-fixtures";

function setup(base: string | null, head: string | null) {
  const fake = fakeCommentClient();
  const dependencies = {
    client: fake.client,
    analyzer: vi.fn<CliAnalyzer>(async (target) => triageReport(target)),
    readLockfile: vi.fn(async (side: "base" | "head") =>
      side === "base" ? base : head,
    ),
    writeSummary: vi.fn(async () => undefined),
    progress: vi.fn(),
  };
  return { ...fake, dependencies };
}
function changedLocks(names = ["example-a"]) {
  return ["1.0.0", "1.1.0"].map((version) =>
    githubLockfile(
      Object.fromEntries(
        names.map((name) => [`node_modules/${name}`, registryEntry(version)]),
      ),
    ),
  );
}

describe("PR action through the existing CLI with fake analyzer/client", () => {
  it.each(["base", "head", "both"])(
    "posts a short missing-%s-lockfile comment and exits zero",
    async (missing) => {
      const { dependencies, comments } = setup(
        missing !== "head" ? null : githubLockfile(),
        missing !== "base" ? null : githubLockfile(),
      );
      const result = await runPullRequestAction(prContext, {}, dependencies);
      expect(result.exitCode).toBe(0);
      expect(result.body).toContain("missing");
      expect(result.body.length).toBeLessThan(1000);
      expect(dependencies.analyzer).not.toHaveBeenCalled();
      expect(comments).toHaveLength(1);
      expect(dependencies.writeSummary).toHaveBeenCalledWith(comments[0].body);
    },
  );
  it("posts and then updates a brief no-dependency-changes result", async () => {
    const [base, head] = changedLocks();
    const { dependencies, comments } = setup(base, head);
    await runPullRequestAction(prContext, {}, dependencies);
    dependencies.readLockfile.mockResolvedValue(base);
    const result = await runPullRequestAction(prContext, {}, dependencies);
    expect(result.exitCode).toBe(0);
    expect(result.body).toContain("No dependency changes");
    expect(comments).toHaveLength(1);
    expect(dependencies.client.updateComment).toHaveBeenCalledTimes(1);
    expect(dependencies.analyzer).toHaveBeenCalledTimes(1);
  });
  it("analyzes only the first N eligible packages by name/path and lists the rest", async () => {
    const [base, head] = changedLocks(["example-c", "example-b", "example-a"]);
    const { dependencies } = setup(base, head);
    const result = await runPullRequestAction(
      prContext,
      { maxPackages: 1 },
      dependencies,
    );
    expect(
      dependencies.analyzer.mock.calls.map(([target]) => target.name),
    ).toEqual(["example-a"]);
    expect(result.notAnalyzed.map((entry) => entry.name)).toEqual([
      "example-b",
      "example-c",
    ]);
    expect(result.body).toContain(escapeCommentText("example-b"));
    expect(result.body).toContain(escapeCommentText("example-c"));
    expect(result.body).toContain("not analyzed: 2");
  });
  it("preserves separate installation paths when limiting repeated names", async () => {
    const paths = [
      "node_modules/example-a",
      "node_modules/example-z/node_modules/example-a",
    ];
    const locks = ["1.0.0", "1.1.0"].map((version) =>
      githubLockfile(
        Object.fromEntries(paths.map((path) => [path, registryEntry(version)])),
      ),
    );
    const { dependencies } = setup(locks[0], locks[1]);
    const result = await runPullRequestAction(
      prContext,
      { maxPackages: 1 },
      dependencies,
    );
    expect(dependencies.analyzer.mock.calls[0][0].path).toBe(paths[0]);
    expect(result.notAnalyzed[0].path).toBe(paths[1]);
  });
  it("runs analyses sequentially even after one fails, preserving exit 2", async () => {
    const [base, head] = changedLocks(["example-c", "example-b", "example-a"]);
    const { dependencies } = setup(base, head);
    let active = 0;
    let peak = 0;
    const order: string[] = [];
    dependencies.analyzer.mockImplementation(async (target, progress) => {
      peak = Math.max(peak, ++active);
      order.push(target.name);
      await Promise.resolve();
      active--;
      progress("Authored progress");
      if (target.name === "example-b") throw new Error("Authored failure");
      return {
        ...triageReport(target),
        metadataSignals: [triageSignal("maintainer-changed")],
      };
    });
    const result = await runPullRequestAction(
      prContext,
      { failOn: "review" },
      dependencies,
    );
    expect(peak).toBe(1);
    expect(order).toEqual(["example-a", "example-b", "example-c"]);
    expect(result.exitCode).toBe(2);
    expect(result.document.summary.completed).toBe(2);
    expect(result.document.summary.failed).toBe(1);
    expect(dependencies.progress).toHaveBeenCalled();
    expect(dependencies.client.createComment).toHaveBeenCalledTimes(1);
  });
  it("does not fail on findings by default but forwards opt-in fail-on", async () => {
    const [base, head] = changedLocks();
    const { dependencies } = setup(base, head);
    dependencies.analyzer.mockImplementation(async (target) => ({
      ...triageReport(target),
      metadataSignals: [triageSignal("maintainer-changed")],
    }));
    expect(
      (await runPullRequestAction(prContext, {}, dependencies)).exitCode,
    ).toBe(0);
    expect(
      (
        await runPullRequestAction(
          prContext,
          { failOn: "review" },
          dependencies,
        )
      ).exitCode,
    ).toBe(3);
  });
  it("forces forks to summary-only even if a comment client is supplied", async () => {
    const [base, head] = changedLocks();
    const { dependencies } = setup(base, head);
    const result = await runPullRequestAction(
      { ...prContext, isFork: true },
      { summaryOnly: false },
      dependencies,
    );
    expect(result.comment).toBeNull();
    expect(dependencies.client.listComments).not.toHaveBeenCalled();
    expect(dependencies.client.createComment).not.toHaveBeenCalled();
    expect(dependencies.writeSummary).toHaveBeenCalledWith(result.body);
    const normal = await runPullRequestAction(prContext, {}, dependencies);
    expect(result.body).toBe(normal.body);
  });
  it("supports explicitly requested summary-only mode", async () => {
    const { dependencies } = setup(null, null);
    await runPullRequestAction(prContext, { summaryOnly: true }, dependencies);
    expect(dependencies.client.listComments).not.toHaveBeenCalled();
    expect(dependencies.writeSummary).toHaveBeenCalledTimes(1);
  });
  it("excludes dev entries without spending the analysis limit and retains skipped reasons", async () => {
    const locks = ["1.0.0", "1.1.0"].map((version) =>
      githubLockfile({
        "node_modules/example-a": registryEntry(version, true),
        "node_modules/example-b": registryEntry(version),
        "node_modules/example-git": {
          version,
          resolved: "git+https://example.invalid/repo.git",
        },
      }),
    );
    const { dependencies } = setup(locks[0], locks[1]);
    const result = await runPullRequestAction(
      prContext,
      { maxPackages: 1 },
      dependencies,
    );
    expect(
      dependencies.analyzer.mock.calls.map(([target]) => target.name),
    ).toEqual(["example-b"]);
    expect(result.document.skipped.map((entry) => entry.reason)).toContain(
      "Development dependency excluded; use --include-dev to include it.",
    );
    expect(result.document.skipped.map((entry) => entry.reason)).toContain(
      "non-registry resolved URL",
    );
  });
  it("includes added packages with a null trusted baseline in the bounded CLI batch", async () => {
    const { dependencies } = setup(
      githubLockfile(),
      githubLockfile({ "node_modules/example-added": registryEntry("1.0.0") }),
    );
    await runPullRequestAction(prContext, {}, dependencies);
    expect(dependencies.analyzer.mock.calls[0][0]).toMatchObject({
      name: "example-added",
      from: null,
      to: "1.0.0",
    });
  });
  it("allows a zero analysis limit and labels every eligible entry not analyzed", async () => {
    const [base, head] = changedLocks();
    const { dependencies } = setup(base, head);
    const result = await runPullRequestAction(
      prContext,
      { maxPackages: 0 },
      dependencies,
    );
    expect(result.exitCode).toBe(0);
    expect(dependencies.analyzer).not.toHaveBeenCalled();
    expect(result.body).toContain("not analyzed: 1");
    expect(result.body).toContain("Analysis package limit reached");
    expect(result.body).not.toContain("No dependency changes");
  });
  it.each(["{", '{"lockfileVersion":1}'])(
    "preserves the CLI file-error exit for invalid input %s",
    async (input) => {
      const { dependencies } = setup(input, githubLockfile());
      const result = await runPullRequestAction(prContext, {}, dependencies);
      expect(result.exitCode).toBe(1);
      expect(result.document.error?.code).toBe("file-error");
      expect(dependencies.analyzer).not.toHaveBeenCalled();
      expect(dependencies.client.createComment).toHaveBeenCalledTimes(1);
    },
  );
  it("keeps the summary available when comment publication fails", async () => {
    const { dependencies } = setup(null, null);
    dependencies.client.createComment.mockRejectedValue(
      new Error("Permission denied"),
    );
    await expect(
      runPullRequestAction(prContext, {}, dependencies),
    ).rejects.toThrow("Permission denied");
    expect(dependencies.writeSummary).toHaveBeenCalledTimes(1);
  });
  it("parses action variables with fail-on disabled by default", () => {
    expect(actionOptionsFromEnv({})).toEqual({
      maxPackages: 25,
      summaryOnly: false,
    });
    expect(
      actionOptionsFromEnv({
        DG_FAIL_ON: "off",
        DG_MAX_PACKAGES: "2",
        DG_SUMMARY_ONLY: "true",
      }),
    ).toEqual({ maxPackages: 2, summaryOnly: true, failOn: undefined });
    expect(actionOptionsFromEnv({ DG_FAIL_ON: "incomplete" }).failOn).toBe(
      "incomplete",
    );
    expect(() => actionOptionsFromEnv({ DG_FAIL_ON: "anything" })).toThrow();
    expect(() => actionOptionsFromEnv({ DG_MAX_PACKAGES: "-1" })).toThrow();
    expect(() => actionOptionsFromEnv({ DG_SUMMARY_ONLY: "yes" })).toThrow();
  });
});
