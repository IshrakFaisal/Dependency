import { imageIdSchema, PROBE_PROFILE } from "@/lib/runtime/contracts";
import type { PackageSnapshot } from "@/lib/types/static-analysis";
import { createHash } from "node:crypto";

export function runtimeConfiguration(env: Record<string, string | undefined>) {
  if (env.RUNTIME_PROBE_ENABLED !== "true")
    throw new Error(
      "Runtime probes are disabled. Set RUNTIME_PROBE_ENABLED=true on the dedicated worker host.",
    );
  const imageId = imageIdSchema.parse(env.SANDBOX_IMAGE_ID);
  return { imageId, profile: PROBE_PROFILE };
}

export function containerArgs(imageId: string, name: string) {
  imageIdSchema.parse(imageId);
  if (!/^dependencyguard-[a-f0-9-]{36}$/.test(name))
    throw new Error("Invalid generated container name.");
  return [
    "run",
    "--interactive",
    "--pull=never",
    "--name",
    name,
    "--network=none",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--user=10001:10001",
    "--pids-limit=32",
    "--memory=256m",
    "--memory-swap=256m",
    "--cpus=0.5",
    "--ulimit=nofile=256:256",
    "--ulimit=core=0",
    "--ipc=none",
    "--log-driver=none",
    "--tmpfs=/work:rw,noexec,nosuid,nodev,size=16777216,uid=10001,gid=10001,mode=700",
    "--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=8388608,uid=10001,gid=10001,mode=700",
    "--workdir=/work",
    "--entrypoint=node",
    imageId,
    "/opt/dependencyguard/runner.mjs",
  ];
}

/** Preserve exact source bytes; never silently omit binary/unavailable files. */
export function probePayload(snapshot: PackageSnapshot): string {
  if (
    snapshot.files.length > 256 ||
    snapshot.files.reduce((n, file) => n + file.size, 0) > 4 * 1024 * 1024
  )
    throw new Error(
      "Import probes support at most 256 files and 4 MiB of package contents.",
    );
  const files = snapshot.files.map((file) => {
    if (file.text === null)
      throw new Error(
        "This profile requires every package file to be losslessly readable UTF-8 text; binary or oversized files are unsupported.",
      );
    const bytes = Buffer.from(file.text, "utf8");
    if (
      bytes.length !== file.size ||
      createHash("sha256").update(bytes).digest("hex") !== file.sha256
    )
      throw new Error(
        "This package cannot be reproduced byte-for-byte by the text-only import profile.",
      );
    return { path: file.path, content: bytes.toString("base64") };
  });
  return JSON.stringify({ profile: PROBE_PROFILE, files });
}
