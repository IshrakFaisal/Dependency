import type { FindingStatus, Severity } from "@/lib/types";
import type { ComparisonInput } from "@/lib/validation";

export interface RegistryRelease {
  name: string;
  version: string;
  description: string;
  license: string;
  tarballUrl: string;
  integrity: string | null;
  shasum: string | null;
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  optionalDependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
  deprecated: string | null;
}

export interface ArchiveFile {
  path: string;
  size: number;
  sha256: string;
  text: string | null;
}

export interface PackageSnapshot {
  release: RegistryRelease;
  manifest: {
    name: string;
    version: string;
    scripts: Record<string, string>;
    dependencies: Record<string, string>;
    optionalDependencies: Record<string, string>;
    peerDependencies: Record<string, string>;
  };
  files: ArchiveFile[];
  archiveSha256: string;
  integrityVerified: "sha512" | "sha384" | "sha256" | "sha1";
  compressedBytes: number;
  unpackedBytes: number;
  warnings: string[];
}

export interface FileChange {
  path: string;
  change: "added" | "removed" | "modified";
  oldSize: number | null;
  newSize: number | null;
  oldSha256: string | null;
  newSha256: string | null;
}

export interface StaticEvidence {
  id: string;
  source: "npm-archive" | "npm-registry";
  file: string;
  oldLine: number | null;
  newLine: number | null;
  oldExcerpt: string | null;
  newExcerpt: string | null;
  oldSha256: string | null;
  newSha256: string | null;
}

export interface ReleaseFinding {
  id: string;
  category:
    | "network"
    | "environment"
    | "process"
    | "filesystem"
    | "dynamic-code"
    | "lifecycle"
    | "metadata";
  title: string;
  description: string;
  status: FindingStatus;
  severity: Severity;
  evidenceIds: string[];
}

export interface ManifestChange {
  name: string;
  kind: "dependency" | "optionalDependency" | "peerDependency" | "script";
  oldValue: string | null;
  newValue: string | null;
  evidenceId: string;
}

export interface StaticAnalysisReport {
  id: string;
  mode: "static";
  input: ComparisonInput;
  generatedAt: string;
  status: "INCONCLUSIVE";
  riskScore: null;
  summary: string;
  releases: {
    trusted: Omit<PackageSnapshot, "files" | "manifest"> & {
      fileCount: number;
    };
    candidate: Omit<PackageSnapshot, "files" | "manifest"> & {
      fileCount: number;
    };
  };
  fileChanges: FileChange[];
  manifestChanges: ManifestChange[];
  findings: ReleaseFinding[];
  evidence: StaticEvidence[];
  signalCounts: {
    category: ReleaseFinding["category"];
    oldCount: number;
    newCount: number;
  }[];
  coverage: {
    trustedFilesScanned: number;
    candidateFilesScanned: number;
    skippedFiles: number;
    truncated: boolean;
    notes: string[];
  };
  limitations: string[];
}

export const STATIC_STAGES = [
  "Fetching npm release metadata",
  "Downloading and verifying archives",
  "Comparing package contents",
  "Inspecting static signals",
  "Building evidence report",
] as const;

export interface AnalysisJob {
  id: string;
  input: ComparisonInput;
  mode: "static";
  status: "queued" | "running" | "completed" | "failed";
  stage: number;
  createdAt: string;
  updatedAt: string;
  error: string | null;
}
