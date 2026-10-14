import { createHash } from "node:crypto";
import type {
  PackageSnapshot,
  StaticAnalysisReport,
} from "@/lib/types/static-analysis";
import {
  PROBE_PROFILE,
  type RuntimeBundle,
  type RuntimeRun,
} from "@/lib/runtime/contracts";

export const imageId = `sha256:${"a".repeat(64)}`;
export const analysisId = "2d0f908e-f5de-48fd-a412-4f1262823258";
export function run(overrides: Partial<RuntimeRun> = {}): RuntimeRun {
  return {
    version: "1.0.0",
    archiveSha256: "b".repeat(64),
    imageId,
    profile: PROBE_PROFILE,
    status: "completed",
    reason: "import_completed",
    events: [],
    truncated: false,
    durationMs: 800,
    ...overrides,
  };
}
export function bundle(): RuntimeBundle {
  return {
    schemaVersion: 1,
    analysisId,
    packageName: "dependencyguard-synthetic-runtime",
    generatedAt: "2026-10-14T00:00:00.000Z",
    source: "local-container-worker",
    trusted: run(),
    candidate: run({ version: "1.1.0", archiveSha256: "c".repeat(64) }),
  };
}
export const bindingReport = {
  id: analysisId,
  input: {
    packageName: "dependencyguard-synthetic-runtime",
    trustedVersion: "1.0.0",
    candidateVersion: "1.1.0",
  },
  releases: {
    trusted: { archiveSha256: "b".repeat(64) },
    candidate: { archiveSha256: "c".repeat(64) },
  },
} as StaticAnalysisReport;

export function probeSnapshot(
  source = "module.exports = 1;",
  version = "1.0.0",
): PackageSnapshot {
  const manifest = {
    name: "dependencyguard-synthetic-runtime",
    version,
    scripts: {},
    dependencies: {},
    optionalDependencies: {},
    peerDependencies: {},
  };
  const files = [
    { path: "package.json", text: JSON.stringify(manifest) },
    { path: "index.js", text: source },
  ].map((file) => ({
    ...file,
    size: Buffer.byteLength(file.text),
    sha256: createHash("sha256").update(file.text).digest("hex"),
  }));
  return {
    release: {
      ...manifest,
      tarballUrl:
        "https://registry.npmjs.org/dependencyguard-synthetic-runtime/-/fixture.tgz",
      description: "Synthetic fixture",
      license: "MIT",
      deprecated: null,
      integrity: null,
      shasum: null,
    },
    manifest,
    files,
    archiveSha256: "b".repeat(64),
    integrityVerified: "sha512",
    compressedBytes: 100,
    unpackedBytes: 200,
    warnings: [],
  };
}
