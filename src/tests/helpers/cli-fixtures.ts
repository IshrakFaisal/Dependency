import type { CliTarget } from "@/lib/cli/output";
import type { StaticAnalysisReport } from "@/lib/types/static-analysis";

export const cliTarget: CliTarget = {
  name: "example-cli",
  from: "1.0.0",
  to: "1.1.0",
  path: null,
  dev: false,
};

export function cliReport(target: CliTarget = cliTarget): StaticAnalysisReport {
  const release = (
    version: string,
  ): StaticAnalysisReport["releases"]["trusted"] => ({
    release: {
      name: target.name,
      version,
      description: "Authored CLI fixture",
      license: "MIT",
      tarballUrl:
        "https://registry.npmjs.org/example-cli/-/example-cli-1.0.0.tgz",
      integrity: null,
      shasum: "a".repeat(40),
      scripts: {},
      dependencies: {},
      optionalDependencies: {},
      peerDependencies: {},
      deprecated: null,
    },
    archiveSha256: "a".repeat(64),
    integrityVerified: "sha1",
    compressedBytes: 100,
    unpackedBytes: 200,
    warnings: [],
    fileCount: 3,
  });
  return {
    id: "19885bae-9370-4cab-85dd-45fe6707df7a",
    mode: "static",
    input: {
      packageName: target.name,
      trustedVersion: target.from ?? target.to,
      candidateVersion: target.to,
    },
    generatedAt: "2026-11-15T00:00:00.000Z",
    status: "INCONCLUSIVE",
    riskScore: null,
    summary: "The static report cannot establish malicious intent.",
    releases: {
      trusted: release(target.from ?? target.to),
      candidate: release(target.to),
    },
    fileChanges: [],
    manifestChanges: [],
    evidence: [],
    signalCounts: [],
    findings: [
      {
        id: "finding-1",
        category: "network",
        title: "New reference",
        description: "Synthetic text reference.",
        status: "STATIC SIGNAL",
        severity: "medium",
        evidenceIds: [],
      },
    ],
    metadataSignals: [
      {
        id: "dependency-added",
        severity: "review",
        title: "Direct dependency added",
        detail: "A dependency declaration was added.",
        evidence: { names: ["example-extra"] },
      },
    ],
    coverage: {
      trustedFilesScanned: 2,
      candidateFilesScanned: 3,
      skippedFiles: 1,
      truncated: true,
      notes: ["One binary file excluded."],
    },
    limitations: ["Static analysis only; runtime behavior is untested."],
  };
}
