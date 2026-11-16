import { readFile, writeFile } from "node:fs/promises";

export interface CliIO {
  readFile(file: string): Promise<string>;
  writeFile(file: string, content: string): Promise<void>;
  stdout(text: string): void;
  stderr(text: string): void;
}

export const nodeCliIO: CliIO = {
  readFile: (file) => readFile(file, "utf8"),
  // Do not overwrite either lockfile, an existing report, or a symlink target.
  writeFile: (file, content) =>
    writeFile(file, content, { encoding: "utf8", flag: "wx", mode: 0o600 }),
  stdout: (text) => {
    process.stdout.write(text);
  },
  stderr: (text) => {
    process.stderr.write(text);
  },
};
