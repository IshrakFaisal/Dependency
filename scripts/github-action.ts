import { appendFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { staticAnalyzer } from "../src/lib/cli/analyzer";
import {
  actionOptionsFromEnv,
  runPullRequestAction,
} from "../src/lib/github/action";
import { parsePullRequestContext } from "../src/lib/github/context";
import { readLockfileAtCommit } from "../src/lib/github/git-lockfile";
import { createGitHubClient } from "../src/lib/github/rest-client";

async function main() {
  const { GITHUB_EVENT_PATH, GITHUB_WORKSPACE, GITHUB_STEP_SUMMARY } =
    process.env;
  if (!GITHUB_EVENT_PATH || !GITHUB_WORKSPACE || !GITHUB_STEP_SUMMARY)
    throw new Error(
      "The GitHub event, workspace and job summary paths are required.",
    );
  const eventBytes = await readFile(GITHUB_EVENT_PATH);
  if (eventBytes.byteLength > 8 * 1024 * 1024)
    throw new Error("GitHub event exceeds its size limit.");
  const context = parsePullRequestContext(
    process.env,
    JSON.parse(eventBytes.toString("utf8")),
  );
  const options = actionOptionsFromEnv(process.env);
  const client =
    context.isFork || options.summaryOnly
      ? undefined
      : createGitHubClient(process.env.GITHUB_TOKEN ?? "");
  const result = await runPullRequestAction(context, options, {
    analyzer: staticAnalyzer,
    readLockfile: (side, sha) =>
      readLockfileAtCommit(
        side === "base"
          ? GITHUB_WORKSPACE
          : resolve(GITHUB_WORKSPACE, ".dependencyguard/pr"),
        sha,
      ),
    client,
    writeSummary: (body) => appendFile(GITHUB_STEP_SUMMARY, body, "utf8"),
    // Prevent package-controlled progress from being interpreted as workflow commands.
    progress: (message) =>
      process.stderr.write(
        message
          .split(/\r?\n/)
          .filter(Boolean)
          .map((line) => `[DependencyGuard] ${line}`)
          .join("\n") + "\n",
      ),
  });
  return result.exitCode;
}

void main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch(() => {
    // Do not echo tokens, event data, upstream response bodies or credentialed URLs.
    process.stderr.write(
      "DependencyGuard action could not complete. Check the event, lockfile, configuration and comment permissions.\n",
    );
    process.exitCode = 1;
  });
