import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { commitShaSchema } from "./context";

const execFileAsync = promisify(execFile);
export type GitReader = (args: string[], cwd: string) => Promise<string>;
const readGit: GitReader = async (args, cwd) =>
  (
    await execFileAsync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      timeout: 30_000,
      windowsHide: true,
    })
  ).stdout;

/** Only a literal repository path and a validated commit SHA reach git. The
 * proposed checkout supplies data; no package code or shell command is run.
 */
export async function readLockfileAtCommit(
  cwd: string,
  sha: string,
  runGit: GitReader = readGit,
): Promise<string | null> {
  commitShaSchema.parse(sha);
  const entry = await runGit(["ls-tree", sha, "--", "package-lock.json"], cwd);
  if (!entry.trim()) return null;
  if (
    !/^100(?:644|755) blob [0-9a-f]{40}\tpackage-lock\.json\r?\n?$/i.test(entry)
  )
    throw new Error("package-lock.json must be a regular Git file.");
  return runGit(["show", `${sha}:package-lock.json`], cwd);
}
