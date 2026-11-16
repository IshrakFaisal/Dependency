import { z } from "zod";
import { runCli, type CliAnalyzer, type CliExitCode } from "@/lib/cli";
import type { CliTarget } from "@/lib/cli/output";
import { diffLockfiles } from "@/lib/lockfile/diff";
import { cliJsonSchema, maxPackagesSchema, type CliJson } from "./cli-json";
import type { PullRequestContext } from "./context";
import { renderTriageComment, type CommentOptions } from "./render-comment";
import {
  upsertComment,
  type CommentClient,
  type UpsertResult,
} from "./upsert-comment";

export const actionOptionsSchema = z.object({
  maxPackages: maxPackagesSchema,
  failOn: z.enum(["review", "incomplete"]).optional(),
  summaryOnly: z.boolean().default(false),
});
type ActionOptions = z.input<typeof actionOptionsSchema>;
export interface ActionDependencies {
  analyzer: CliAnalyzer;
  readLockfile: (side: "base" | "head", sha: string) => Promise<string | null>;
  writeSummary: (body: string) => Promise<void>;
  progress: (message: string) => void;
  client?: CommentClient;
}
export type ActionResult = {
  exitCode: CliExitCode;
  body: string;
  document: CliJson;
  notAnalyzed: CliTarget[];
  comment: UpsertResult | null;
};

export function actionOptionsFromEnv(
  env: Record<string, string | undefined>,
): ActionOptions {
  const failOn = env.DG_FAIL_ON?.trim();
  const summaryOnly = env.DG_SUMMARY_ONLY?.trim();
  if (summaryOnly && summaryOnly !== "true" && summaryOnly !== "false")
    throw new Error("DG_SUMMARY_ONLY must be true or false.");
  return actionOptionsSchema.parse({
    maxPackages: env.DG_MAX_PACKAGES ? Number(env.DG_MAX_PACKAGES) : undefined,
    failOn: !failOn || failOn === "off" ? undefined : failOn,
    summaryOnly: summaryOnly === "true",
  });
}

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const emptyDocument = (): CliJson => ({
  command: "lockfile",
  status: "INCONCLUSIVE",
  results: [],
  skipped: [],
  summary: { completed: 0, failed: 0, skipped: 0 },
  triageSummary: { "needs-review": 0, "no-notable-changes": 0, incomplete: 0 },
});

/** Restrict only the virtual inputs given to the existing CLI. Removing an
 * overflow path from BOTH maps keeps it out of the CLI's analysis queue without
 * changing CLI behavior, package paths, skipped/dev entries or exit codes.
 */
function boundedInputs(base: string, head: string, maxPackages: number) {
  const original = {
    base,
    head,
    notAnalyzed: [] as CliTarget[],
    noChanges: false,
  };
  let before: unknown;
  let after: unknown;
  try {
    before = JSON.parse(base.replace(/^\uFEFF/, ""));
    after = JSON.parse(head.replace(/^\uFEFF/, ""));
  } catch {
    return original;
  } // The CLI produces its existing JSON input error.
  const diff = diffLockfiles(before, after);
  if (diff.kind === "error") return original;
  const targets: CliTarget[] = [
    ...diff.changed.map(({ name, from, to, path, dev }) => ({
      name,
      from,
      to,
      path,
      dev,
    })),
    ...diff.added.map(({ name, version, path, dev }) => ({
      name,
      from: null,
      to: version,
      path,
      dev,
    })),
  ]
    .filter((entry) => !entry.dev)
    .sort(
      (a, b) =>
        compareText(a.name, b.name) || compareText(a.path ?? "", b.path ?? ""),
    );
  const notAnalyzed = targets.slice(maxPackages);
  const noChanges =
    !diff.changed.length && !diff.added.length && !diff.removed.length;
  if (!notAnalyzed.length) return { ...original, noChanges };
  const lockSchema = z
    .object({ packages: z.record(z.string(), z.unknown()) })
    .passthrough();
  const trim = (lock: unknown) => {
    const parsed = lockSchema.parse(lock);
    const packages = { ...parsed.packages };
    for (const entry of notAnalyzed) delete packages[entry.path!];
    return JSON.stringify({ ...parsed, packages });
  };
  return { base: trim(before), head: trim(after), notAnalyzed, noChanges };
}

/** Import the CLI and await its sequential batch, then publish identical Markdown
 * to the job summary and (only for same-repository PRs) the marker comment.
 */
export async function runPullRequestAction(
  context: PullRequestContext,
  options: ActionOptions,
  dependencies: ActionDependencies,
): Promise<ActionResult> {
  const settings = actionOptionsSchema.parse(options);
  const base = await dependencies.readLockfile("base", context.baseSha);
  const head = await dependencies.readLockfile("head", context.headSha);
  let document = emptyDocument();
  let exitCode: CliExitCode = 0;
  let notAnalyzed: CliTarget[] = [];
  let notice: CommentOptions["notice"];
  if (base === null || head === null) {
    notice =
      base === null && head === null
        ? "missing-both-lockfiles"
        : base === null
          ? "missing-base-lockfile"
          : "missing-head-lockfile";
  } else {
    const bounded = boundedInputs(base, head, settings.maxPackages);
    notAnalyzed = bounded.notAnalyzed;
    if (bounded.noChanges) notice = "no-dependency-changes";
    let stdout = "";
    exitCode = await runCli(
      [
        "lockfile",
        "base-package-lock.json",
        "head-package-lock.json",
        "--json",
        ...(settings.failOn ? ["--fail-on", settings.failOn] : []),
      ],
      dependencies.analyzer,
      {
        readFile: async (path) => {
          if (path === "base-package-lock.json") return bounded.base;
          if (path === "head-package-lock.json") return bounded.head;
          throw new Error("Unexpected CLI input path.");
        },
        writeFile: async () => {
          throw new Error("The action does not request CLI output files.");
        },
        stdout: (text) => {
          stdout += text;
        },
        stderr: dependencies.progress,
      },
    );
    document = cliJsonSchema.parse(JSON.parse(stdout));
  }
  const body = renderTriageComment(document, {
    maxPackages: settings.maxPackages,
    notAnalyzed,
    notice,
  });
  await dependencies.writeSummary(body);
  let comment: UpsertResult | null = null;
  if (!context.isFork && !settings.summaryOnly) {
    if (!dependencies.client)
      throw new Error("A GitHub client is required for PR comments.");
    comment = await upsertComment(dependencies.client, { ...context, body });
  }
  return { exitCode, body, document, notAnalyzed, comment };
}
