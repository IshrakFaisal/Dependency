import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { version } from "../package.json";
import type { CliAnalyzer } from "../src/lib/cli";
import { displayText } from "../src/lib/cli/output";
import { corpusSchema } from "../src/lib/benchmark/schema";
import { measureCorpus, replayBenchmark } from "../src/lib/benchmark/measure";
import { renderBenchmarkSummary } from "../src/lib/benchmark/summary";
import { renderBenchmarkAudit } from "../src/lib/benchmark/audit";

const HELP = `DependencyGuard benchmark

node --conditions=react-server --import tsx scripts/benchmark.ts [--corpus benchmark/corpus.json] [--out-dir benchmark/results]
node --conditions=react-server --import tsx scripts/benchmark.ts --replay <results.json> [--out-dir benchmark/results]
node --conditions=react-server --import tsx scripts/benchmark.ts --audit <results.json> [--out-dir benchmark/results]

Corpus mode performs sequential static registry/archive analysis. Replay and audit are offline.
Audit writes <input-name>-audit.md from saved tiers and evidence; it does not assign reviewer labels.
Exit codes: 0 completed; 1 usage/file error; 2 one or more analysis failures.
`;
export interface BenchmarkIO {
  read(path: string): Promise<string>;
  mkdir(path: string): Promise<void>;
  writeNew(path: string, text: string): Promise<void>;
  stdout(text: string): void;
  stderr(text: string): void;
}
const nodeIO: BenchmarkIO = {
  async read(path) {
    if ((await stat(path)).size > 128 * 1024 * 1024)
      throw new Error("Benchmark input exceeds 128 MiB.");
    return readFile(path, "utf8");
  },
  async mkdir(path) {
    await mkdir(path, { recursive: true });
  },
  async writeNew(path, text) {
    await writeFile(path, text, { encoding: "utf8", flag: "wx", mode: 0o600 });
  },
  stdout: (text) => {
    process.stdout.write(text);
  },
  stderr: (text) => {
    process.stderr.write(text);
  },
};
export interface BenchmarkDependencies {
  analyzer?: CliAnalyzer;
  io?: BenchmarkIO;
  now?: () => Date;
}

/** Importable for injected, offline command tests. Default analysis is loaded
 * only after corpus validation; --replay, --audit and --help never load the registry.
 */
export async function benchmarkMain(
  args: string[],
  dependencies: BenchmarkDependencies = {},
): Promise<0 | 1 | 2> {
  const io = dependencies.io ?? nodeIO;
  const now = dependencies.now ?? (() => new Date());
  try {
    const { values, positionals, tokens } = parseArgs({
      args,
      strict: true,
      allowPositionals: true,
      tokens: true,
      options: {
        corpus: { type: "string" },
        replay: { type: "string" },
        audit: { type: "string" },
        "out-dir": { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    });
    const options = tokens
      .filter((token) => token.kind === "option")
      .map((token) => token.name);
    if (
      positionals.length ||
      new Set(options).size !== options.length ||
      [values.replay, values.corpus, values.audit].filter(
        (value) => value !== undefined,
      ).length > 1 ||
      (values.help && options.length !== 1)
    )
      throw new Error("Invalid benchmark arguments.");
    if (values.help) {
      io.stdout(HELP);
      return 0;
    }
    const inputFile =
      values.audit ?? values.replay ?? values.corpus ?? "benchmark/corpus.json";
    if (!inputFile.trim() || values["out-dir"]?.trim() === "")
      throw new Error("Empty file path.");
    const data: unknown = JSON.parse(
      (await io.read(inputFile)).replace(/^\uFEFF/, ""),
    );
    if (values.audit !== undefined) {
      const markdown = renderBenchmarkAudit(data);
      const directory = values["out-dir"] ?? "benchmark/results";
      const file = resolve(
        directory,
        `${basename(inputFile, extname(inputFile))}-audit.md`,
      );
      await io.mkdir(directory);
      await io.writeNew(file, markdown);
      io.stdout(markdown);
      io.stderr(`${displayText(`Audit written to ${file}`)}\n`);
      return 0;
    }
    const startedAt = now();
    const progress = (text: string) => io.stderr(`${displayText(text)}\n`);
    let measurement;
    if (values.replay !== undefined) {
      measurement = replayBenchmark(data);
    } else {
      const corpus = corpusSchema.parse(data);
      // Synthetic names are never sent to the registry. Tests/operators can
      // supply an offline analyzer for synthetic corpora through this function.
      if (
        !dependencies.analyzer &&
        corpus.some((entry) => entry.label === "synthetic-suspicious")
      )
        throw new Error(
          "Synthetic corpora require an injected offline analyzer or replay.",
        );
      const analyzer =
        dependencies.analyzer ??
        (await import("../src/lib/cli/analyzer")).staticAnalyzer;
      measurement = await measureCorpus(corpus, analyzer, progress);
    }
    const finishedAt = now();
    const result = {
      schemaVersion: 1,
      toolVersion: version,
      mode: values.replay !== undefined ? "replay" : "analysis",
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
      ...measurement,
    };
    const directory = values["out-dir"] ?? "benchmark/results";
    const base = resolve(
      directory,
      finishedAt.toISOString().replace(/[:.]/g, "-"),
    );
    await io.mkdir(directory);
    const markdown = renderBenchmarkSummary(measurement);
    await io.writeNew(`${base}.json`, JSON.stringify(result, null, 2) + "\n");
    await io.writeNew(`${base}.md`, markdown);
    io.stdout(markdown);
    progress(`Results written to ${base}.json and ${base}.md`);
    return measurement.aggregates.analysisFailures ? 2 : 0;
  } catch {
    io.stderr(
      "Benchmark could not complete: check arguments, corpus/report data, input files and unused output paths. Synthetic corpus mode requires an injected offline analyzer.\n",
    );
    return 1;
  }
}

// The repository's tsx runner uses CommonJS. Importing this file in Vitest never
// enters the operator path or constructs the real analyzer.
if (
  typeof require !== "undefined" &&
  typeof module !== "undefined" &&
  require.main === module
) {
  void benchmarkMain(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
