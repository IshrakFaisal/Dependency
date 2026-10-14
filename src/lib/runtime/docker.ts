// Operator worker only. Never import this module from an app route or component.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { containerArgs, probePayload } from "@/lib/runtime/policy";
import {
  imageIdSchema,
  probeOutputSchema,
  PROBE_PROFILE,
  type RuntimeRun,
} from "@/lib/runtime/contracts";
import type { PackageSnapshot } from "@/lib/types/static-analysis";

export class DockerFailure extends Error {
  constructor(
    readonly kind: "unavailable" | "timed_out" | "failed",
    message: string,
  ) {
    super(message);
  }
}
export class ContainerCleanupError extends DockerFailure {}
export type DockerCommand = (
  args: string[],
  options?: { input?: string; timeoutMs?: number; signal?: AbortSignal },
) => Promise<{ code: number; stdout: string; stderr: string }>;

export const dockerCommand: DockerCommand = (args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn("docker", args, {
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const output: Buffer[] = [],
      errors: Buffer[] = [];
    let total = 0;
    let settled = false;
    const finish = (error?: Error, code = -1) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      if (error) {
        child.kill();
        reject(error);
      } else
        resolve({
          code,
          stdout: Buffer.concat(output).toString("utf8"),
          stderr: Buffer.concat(errors).toString("utf8"),
        });
    };
    const abort = () => finish(new DockerFailure("failed", "Probe canceled."));
    const timer = setTimeout(
      () =>
        finish(
          new DockerFailure(
            "timed_out",
            "Container command exceeded its time limit.",
          ),
        ),
      options.timeoutMs ?? 10_000,
    );
    options.signal?.addEventListener("abort", abort, { once: true });
    child.on("error", () =>
      finish(
        new DockerFailure(
          "unavailable",
          "Docker is unavailable. Install and start a Linux Docker engine on the dedicated worker host.",
        ),
      ),
    );
    child.on("close", (code) => finish(undefined, code ?? -1));
    for (const [stream, destination] of [
      [child.stdout, output],
      [child.stderr, errors],
    ] as const)
      stream.on("data", (data: Buffer) => {
        total += data.length;
        if (total > 256 * 1024)
          finish(
            new DockerFailure(
              "failed",
              "Container output exceeded the evidence limit.",
            ),
          );
        else destination.push(data);
      });
    child.stdin.on("error", () =>
      finish(new DockerFailure("failed", "Container input was interrupted.")),
    );
    if (options.signal?.aborted) abort();
    else child.stdin.end(options.input ?? "");
  });

export async function checkDocker(
  imageId: string,
  command: DockerCommand = dockerCommand,
) {
  imageIdSchema.parse(imageId);
  const info = await command(["info", "--format", "{{.OSType}}"]);
  if (info.code !== 0 || info.stdout.trim() !== "linux")
    throw new DockerFailure(
      "unavailable",
      "A running Linux Docker engine is required.",
    );
  const inspected = await command([
    "image",
    "inspect",
    "--format",
    "{{.Id}}",
    imageId,
  ]);
  if (inspected.code !== 0 || inspected.stdout.trim() !== imageId)
    throw new DockerFailure(
      "unavailable",
      "The configured immutable worker image is not available locally. No image will be pulled automatically.",
    );
}

export async function runProbe(
  snapshot: PackageSnapshot,
  imageId: string,
  command: DockerCommand = dockerCommand,
  signal?: AbortSignal,
): Promise<RuntimeRun> {
  imageIdSchema.parse(imageId);
  const base = {
    version: snapshot.release.version,
    archiveSha256: snapshot.archiveSha256,
    imageId,
    profile: PROBE_PROFILE,
    events: [],
    truncated: false,
    durationMs: 0,
  };
  let input: string;
  try {
    input = probePayload(snapshot);
  } catch (error) {
    return { ...base, status: "unsupported", reason: (error as Error).message };
  }
  const name = `dependencyguard-${randomUUID()}`;
  const started = Date.now();
  try {
    const result = await command(containerArgs(imageId, name), {
      input,
      timeoutMs: 20_000,
      signal,
    });
    if (result.code !== 0)
      throw new DockerFailure(
        "failed",
        "The isolated probe did not produce a successful collector result.",
      );
    const parsed = probeOutputSchema.safeParse(JSON.parse(result.stdout));
    if (!parsed.success)
      throw new DockerFailure(
        "failed",
        "The container returned invalid evidence.",
      );
    return {
      ...base,
      ...parsed.data,
      durationMs: Math.min(Date.now() - started, 120_000),
    };
  } catch (error) {
    return {
      ...base,
      status: error instanceof DockerFailure ? error.kind : "failed",
      reason:
        error instanceof DockerFailure
          ? error.message
          : "The container returned invalid evidence.",
      durationMs: Math.min(Date.now() - started, 120_000),
    };
  } finally {
    // Killing a Docker CLI does not kill its container. Always remove it by our
    // generated name, even on timeout, malformed output, and cancellation.
    let cleanup;
    try {
      cleanup = await command(["rm", "--force", name]);
    } catch {
      throw new ContainerCleanupError(
        "failed",
        `Container cleanup failed. Inspect and remove ${name} before releasing the worker lock.`,
      );
    }
    if (cleanup.code !== 0 && !cleanup.stderr.includes("No such container"))
      throw new ContainerCleanupError(
        "failed",
        `Container cleanup failed. Inspect and remove ${name} before running another probe.`,
      );
  }
}
