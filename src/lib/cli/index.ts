import {
  diffLockfiles,
  selectAnalyzable,
  type LockfileDiff,
} from "@/lib/lockfile/diff";
import type { StaticAnalysisReport } from "@/lib/types/static-analysis";
import {
  analysisPairSchema,
  CLI_HELP,
  CliAnalysisError,
  CliInputError,
  parseCliArgs,
} from "./arguments";
import { nodeCliIO, type CliIO } from "./io";
import {
  displayText,
  humanOutput,
  jsonOutput,
  summarizeReport,
  type CliDocument,
  type CliTarget,
} from "./output";

export type CliAnalyzer = (
  target: CliTarget,
  progress: (message: string) => void,
) => Promise<StaticAnalysisReport>;
export type CliExitCode = 0 | 1 | 2 | 3;
class CliFileError extends Error {}

function compareText(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function byNameThenPath(a: CliTarget, b: CliTarget) {
  return compareText(a.name, b.name) || compareText(a.path ?? "", b.path ?? "");
}

function pairKey(pair: { name: string; from: string | null; to: string }) {
  return JSON.stringify([pair.name, pair.from, pair.to]);
}

function selectTargets(
  diff: Extract<LockfileDiff, { kind: "success" }>,
  includeDev: boolean,
) {
  const filtered = {
    ...diff,
    added: diff.added.filter((entry) => includeDev || !entry.dev),
    changed: diff.changed.filter((entry) => includeDev || !entry.dev),
  };
  const candidates: CliTarget[] = [
    ...filtered.changed.map(({ name, from, to, path, dev }) => ({
      name,
      from,
      to,
      path,
      dev,
    })),
    ...filtered.added.map(({ name, version, path, dev }) => ({
      name,
      from: null,
      to: version,
      path,
      dev,
    })),
  ];
  // selectAnalyzable intentionally omits installation paths. Keep a queue for
  // every version pair so repeated names/versions still retain every path.
  const byPair = new Map<string, CliTarget[]>();
  for (const target of candidates.sort(byNameThenPath)) {
    const key = pairKey(target);
    byPair.set(key, [...(byPair.get(key) ?? []), target]);
  }
  return selectAnalyzable(filtered)
    .map((pair) => byPair.get(pairKey(pair))!.shift()!)
    .sort(byNameThenPath);
}

async function readLockfile(file: string, io: CliIO): Promise<unknown> {
  let text: string;
  try {
    text = await io.readFile(file);
  } catch {
    throw new CliFileError(`Could not read lockfile: ${file}`);
  }
  try {
    return JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw new CliFileError(`Lockfile is not valid JSON: ${file}`);
  }
}

/** No analyzer is constructed here: callers inject it, along with optional I/O. */
export async function runCli(
  args: string[],
  analyzer: CliAnalyzer,
  io: CliIO = nodeCliIO,
): Promise<CliExitCode> {
  const terminator = args.indexOf("--");
  let json = (terminator < 0 ? args : args.slice(0, terminator)).includes(
    "--json",
  );
  let out: string | undefined;
  let failOn: "review" | "incomplete" | undefined;
  let exitCode: CliExitCode = 0;
  const document: CliDocument = {
    command: null,
    status: "INCONCLUSIVE",
    results: [],
    skipped: [],
    summary: { completed: 0, failed: 0, skipped: 0 },
  };
  const progress = (message: string) => io.stderr(`${displayText(message)}\n`);
  try {
    const options = parseCliArgs(args);
    json = options.json;
    if (options.command === "help") {
      io.stdout(
        json ? jsonOutput({ command: "help", usage: CLI_HELP }) : CLI_HELP,
      );
      return 0;
    }
    document.command = options.command;
    out = options.out;
    failOn = options.failOn;
    let targets: CliTarget[];
    if (options.command === "check") {
      targets = [
        {
          name: options.name,
          from: options.from,
          to: options.to,
          path: null,
          dev: false,
        },
      ];
    } else {
      const oldLock = await readLockfile(options.oldFile, io);
      const newLock = await readLockfile(options.newFile, io);
      const diff = diffLockfiles(oldLock, newLock);
      if (diff.kind === "error") throw new CliFileError(diff.error.message);
      targets = selectTargets(diff, options.includeDev);
      document.skipped = [
        ...diff.skipped.map((entry) => ({ ...entry, name: null })),
        ...diff.removed.map(({ name, path }) => ({
          name,
          path,
          reason: "Removed dependency; no candidate version to analyze.",
        })),
        ...(!options.includeDev
          ? [...diff.changed, ...diff.added]
              .filter((entry) => entry.dev)
              .map(({ name, path }) => ({
                name,
                path,
                reason:
                  "Development dependency excluded; use --include-dev to include it.",
              }))
          : []),
      ].sort(
        (a, b) =>
          compareText(a.name ?? "", b.name ?? "") ||
          compareText(a.path, b.path) ||
          compareText(a.reason, b.reason),
      );
    }
    // Await each analysis before starting the next, including after failures.
    for (const target of targets) {
      progress(
        `Analyzing ${target.name}: ${target.from ?? "(no trusted baseline)"} -> ${target.to}`,
      );
      try {
        const pair = analysisPairSchema.safeParse({
          name: target.name,
          from: target.from,
          to: target.to,
        });
        if (!pair.success)
          throw new CliAnalysisError(
            "Analysis requires an npm package name and exact versions.",
          );
        const report = await analyzer(target, progress);
        document.results.push(summarizeReport(target, report));
      } catch (error) {
        const message =
          error instanceof CliAnalysisError
            ? error.message
            : "Package analysis failed.";
        document.results.push({
          ...target,
          outcome: "failed",
          status: "INCONCLUSIVE",
          error: message,
        });
        progress(`${target.name}: ${message}`);
        exitCode = 2;
      }
    }
  } catch (error) {
    const fileError = error instanceof CliFileError;
    document.error = {
      code: fileError ? "file-error" : "usage-error",
      message:
        error instanceof CliFileError || error instanceof CliInputError
          ? error.message
          : "The CLI could not process this input.",
    };
    progress(document.error.message);
    exitCode = 1;
  }
  document.summary = {
    completed: document.results.filter(
      (result) => result.outcome === "completed",
    ).length,
    failed: document.results.filter((result) => result.outcome === "failed")
      .length,
    skipped: document.skipped.length,
  };
  if (document.command === "lockfile") {
    document.triageSummary = {
      "needs-review": 0,
      "no-notable-changes": 0,
      incomplete: 0,
    };
    for (const result of document.results)
      if (result.outcome === "completed")
        document.triageSummary[result.triage.tier]++;
  }
  if (
    exitCode === 0 &&
    failOn !== undefined &&
    document.results.some(
      (result) =>
        result.outcome === "completed" &&
        (result.triage.tier === "needs-review" ||
          (failOn === "incomplete" && result.triage.tier === "incomplete")),
    )
  )
    exitCode = 3;
  const format = () => (json ? jsonOutput(document) : humanOutput(document));
  let output = format();
  if (out !== undefined) {
    try {
      await io.writeFile(out, output);
    } catch {
      document.error = {
        code: "file-error",
        message:
          "Could not write output file. Use a new path in an existing directory.",
      };
      progress(document.error.message);
      exitCode = 1;
      output = format();
    }
  }
  io.stdout(output);
  return exitCode;
}
