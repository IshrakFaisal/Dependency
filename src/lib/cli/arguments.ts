import { parseArgs } from "node:util";
import { z } from "zod";
import { comparisonInputSchema } from "@/lib/validation";

export const CLI_HELP = `DependencyGuard static analysis

Usage:
  dg check <package> <fromVersion> <toVersion> [--json] [--out <file>] [--fail-on review|incomplete]
  dg lockfile <oldLockfile> <newLockfile> [--json] [--out <file>] [--include-dev] [--fail-on review|incomplete]
  dg --help

Options:
  --json         Print one JSON summary document; progress goes to stderr.
  --out <file>   Also save the selected output format to a new file.
  --include-dev Include development packages in lockfile comparisons.
  --fail-on     review: exit 3 on needs-review; incomplete: also on incomplete.
  --help, -h    Show this help.

Analyses run sequentially. Assessment: INCONCLUSIVE.
Added packages without a trusted baseline are reported as analysis failures.
Exit codes: 0 completed; 1 usage/file error; 2 package analysis failure.
Exit 3 is opt-in for the selected triage threshold; exit 2 takes precedence.
For JSON through npm, use: npm --silent run dg -- <command> ... --json
`;

export class CliInputError extends Error {}
export class CliAnalysisError extends Error {}

// Reuse the existing field schemas while permitting identical versions in the
// CLI. The web form's distinct-version refinement is intentionally unchanged.
export const analysisPairSchema = z.strictObject({
  name: comparisonInputSchema.shape.packageName,
  from: comparisonInputSchema.shape.trustedVersion.nullable(),
  to: comparisonInputSchema.shape.candidateVersion,
});

export type CliOptions =
  | { command: "help"; json: boolean }
  | {
      command: "check";
      json: boolean;
      out?: string;
      failOn?: "review" | "incomplete";
      name: string;
      from: string;
      to: string;
    }
  | {
      command: "lockfile";
      json: boolean;
      out?: string;
      failOn?: "review" | "incomplete";
      oldFile: string;
      newFile: string;
      includeDev: boolean;
    };

function readArgs(args: string[]) {
  try {
    return parseArgs({
      args,
      strict: true,
      allowPositionals: true,
      tokens: true,
      options: {
        json: { type: "boolean" },
        out: { type: "string" },
        "include-dev": { type: "boolean" },
        "fail-on": { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch {
    throw new CliInputError(
      "Invalid command options. Run dg --help for usage.",
    );
  }
}

export function parseCliArgs(args: string[]): CliOptions {
  const parsed = readArgs(args);
  const seen = new Set<string>();
  for (const token of parsed.tokens) {
    if (token.kind !== "option") continue;
    if (seen.has(token.name))
      throw new CliInputError("Options may be supplied only once.");
    seen.add(token.name);
  }
  const { values, positionals } = parsed;
  const [command, ...rest] = positionals;
  const json = values.json ?? false;
  if (values.help) {
    if (
      values.out !== undefined ||
      values["include-dev"] ||
      values["fail-on"] !== undefined ||
      rest.length ||
      (command && command !== "check" && command !== "lockfile")
    )
      throw new CliInputError(
        "Use dg --help, dg check --help, or dg lockfile --help.",
      );
    return { command: "help", json };
  }
  if (
    values.out !== undefined &&
    (!values.out.trim() || values.out.includes("\0"))
  )
    throw new CliInputError("Provide a non-empty output file path.");
  const failOn = values["fail-on"];
  if (failOn !== undefined && failOn !== "review" && failOn !== "incomplete")
    throw new CliInputError("--fail-on requires review or incomplete.");
  if (
    command === "check" &&
    rest.length === 3 &&
    values["include-dev"] === undefined
  ) {
    const pair = analysisPairSchema.safeParse({
      name: rest[0],
      from: rest[1],
      to: rest[2],
    });
    if (!pair.success || pair.data.from === null)
      throw new CliInputError(
        "Check requires an npm package name and two exact versions.",
      );
    return {
      command,
      json,
      out: values.out,
      failOn,
      ...pair.data,
      from: pair.data.from,
    };
  }
  if (
    command === "lockfile" &&
    rest.length === 2 &&
    rest.every((file) => file.trim() && !file.includes("\0"))
  )
    return {
      command,
      json,
      out: values.out,
      failOn,
      oldFile: rest[0],
      newFile: rest[1],
      includeDev: values["include-dev"] ?? false,
    };
  throw new CliInputError("Invalid arguments. Run dg --help for usage.");
}
