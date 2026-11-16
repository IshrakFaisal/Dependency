import { runCli } from "../src/lib/cli";
import { staticAnalyzer } from "../src/lib/cli/analyzer";

// Await the entire batch before setting the exit code; there is no detached job.
void runCli(process.argv.slice(2), staticAnalyzer).then((code) => {
  process.exitCode = code;
});
