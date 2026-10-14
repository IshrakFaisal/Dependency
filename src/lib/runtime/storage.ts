import "server-only";
import { writeFile, rename, mkdir, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { StaticAnalysisReport } from "@/lib/types/static-analysis";
import type { RuntimeEvidenceState } from "@/lib/runtime/contracts";
import { compareRuntime, validateRuntimeBinding } from "@/lib/runtime/compare";

export const runtimeDirectory = path.join(
  process.cwd(),
  ".dependencyguard",
  "runtime",
);
const limit = 512 * 1024;
export function runtimePath(id: string, directory = runtimeDirectory) {
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)
  )
    throw new Error("Invalid analysis ID.");
  return path.join(directory, `${id}.runtime.json`);
}

export async function loadRuntimeEvidence(
  report: StaticAnalysisReport,
  directory = runtimeDirectory,
): Promise<RuntimeEvidenceState> {
  try {
    const { open } = await import("node:fs/promises");
    const handle = await open(runtimePath(report.id, directory), "r");
    let data: Buffer;
    try {
      if ((await handle.stat()).size > limit) return { status: "invalid" };
      data = Buffer.alloc(limit + 1);
      const { bytesRead } = await handle.read(data, 0, data.length, 0);
      if (bytesRead > limit) return { status: "invalid" };
      data = data.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
    const bundle = validateRuntimeBinding(
      JSON.parse(data.toString("utf8")),
      report,
    );
    return { status: "available", comparison: compareRuntime(bundle) };
  } catch (error) {
    return {
      status:
        (error as NodeJS.ErrnoException).code === "ENOENT"
          ? "not_run"
          : "invalid",
    };
  }
}

export async function saveRuntimeEvidence(
  report: StaticAnalysisReport,
  value: unknown,
  directory = runtimeDirectory,
) {
  const data = JSON.stringify(validateRuntimeBinding(value, report));
  if (Buffer.byteLength(data) > limit)
    throw new Error("Runtime evidence exceeds the storage limit.");
  await mkdir(directory, { recursive: true });
  const destination = runtimePath(report.id, directory);
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, data, { flag: "wx", mode: 0o600 });
    await rename(temporary, destination);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

// A worker-wide exclusive lock prevents concurrent container runs. It is never
// silently stolen after a crash; the operator must inspect containers first.
export async function acquireRuntimeLock(directory = runtimeDirectory) {
  await mkdir(directory, { recursive: true });
  const lock = path.join(directory, "worker.lock");
  await writeFile(
    lock,
    JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
    { flag: "wx", mode: 0o600 },
  );
  return () => unlink(lock);
}
