import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { nodeCliIO } from "@/lib/cli/io";

function invoke(args: string[]) {
  return spawnSync(
    process.execPath,
    [
      "--env-file-if-exists=.env.local",
      "--conditions=react-server",
      "--import",
      "tsx",
      "scripts/dependencyguard.ts",
      ...args,
    ],
    { cwd: process.cwd(), encoding: "utf8", timeout: 10_000 },
  );
}

it("boots the TypeScript entry point without Next.js and keeps JSON help on stdout", () => {
  const result = invoke(["--help", "--json"]);
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ command: "help" });
  expect(result.stdout).not.toContain(".env.local not found");
});

it("propagates an entry-point usage error as exit 1 with separate stderr", () => {
  const result = invoke(["check", "--json"]);
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({
    error: { code: "usage-error" },
  });
  expect(result.stderr).toContain("Invalid arguments");
  expect(result.stdout).not.toMatch(/\b(?:safe|unsafe|malicious|clean)\b/i);
});

it("writes a new output file and refuses to overwrite an existing file", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "dg-cli-output-"));
  const file = path.join(directory, "report.json");
  try {
    await nodeCliIO.writeFile(file, '{"status":"INCONCLUSIVE"}\n');
    expect(await nodeCliIO.readFile(file)).toBe('{"status":"INCONCLUSIVE"}\n');
    await expect(
      nodeCliIO.writeFile(file, "replacement"),
    ).rejects.toMatchObject({ code: "EEXIST" });
    expect(await readFile(file, "utf8")).toBe('{"status":"INCONCLUSIVE"}\n');
  } finally {
    await unlink(file).catch(() => undefined);
    await rmdir(directory);
  }
});
