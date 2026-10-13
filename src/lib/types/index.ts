export type RiskStatus =
  "LOW RISK" | "REVIEW RECOMMENDED" | "HIGH RISK" | "INCONCLUSIVE";

export type FindingStatus =
  "OBSERVED" | "NOT OBSERVED" | "STATIC SIGNAL" | "UNVERIFIED RISK";

export type ReleaseRole = "trusted" | "candidate";
export type Severity = "info" | "low" | "medium" | "high";

export interface PackageVersion {
  packageName: string;
  version: string;
}

export interface PackageMetadata extends PackageVersion {
  source: "synthetic";
  publishedAt: string;
  license: string;
  maintainers: string[];
  fileCount: number;
  unpackedSizeBytes: number;
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
}

export interface StaticFinding {
  id: string;
  title: string;
  description: string;
  status: FindingStatus;
  severity: Severity;
  file: string;
  line: number;
  oldCode: string | null;
  newCode: string;
  evidenceIds: string[];
}

interface RuntimeEventBase {
  id: string;
  release: ReleaseRole;
  timestampMs: number;
  status: "OBSERVED" | "NOT OBSERVED";
  source: "synthetic";
  summary: string;
  evidenceIds: string[];
}

export interface NetworkEvent extends RuntimeEventBase {
  type: "network";
  method: "GET" | "POST";
  url: string;
  host: string;
  port: number;
  protocol: "HTTPS";
  bytesSent: number;
  bytesReceived: number;
  outcome: "simulated";
}

export interface ProcessEvent extends RuntimeEventBase {
  type: "process";
  executable: string;
  args: string[];
  parent: string;
  exitCode: number;
  outcome: "simulated";
}

export interface EnvironmentAccess extends RuntimeEventBase {
  type: "environment";
  variable: string;
  sensitive: boolean;
  value: "[SYNTHETIC VALUE REDACTED]";
  callsite: string;
}

export interface FilesystemEvent extends RuntimeEventBase {
  type: "filesystem";
  operation: "write";
  path: string;
  bytes: number;
  scope: "package-cache" | "workspace";
}

export type RuntimeEvent =
  NetworkEvent | ProcessEvent | EnvironmentAccess | FilesystemEvent;

export interface BehaviorComparison {
  id: string;
  label: string;
  oldValue: number;
  newValue: number;
  unit: string;
  description: string;
  status: FindingStatus;
  evidenceIds: string[];
}

export interface DependencyChange {
  name: string;
  oldVersion: string | null;
  newVersion: string | null;
  change: "added" | "removed" | "updated";
  kind: "runtime" | "development";
  description: string;
  status: FindingStatus;
  evidenceIds: string[];
}

export interface Evidence {
  id: string;
  title: string;
  kind: "source-diff" | "runtime-trace" | "metadata-diff";
  source: "synthetic";
  location: string;
  excerpt: string;
  interpretation: string;
}

export interface RiskSignal {
  id: string;
  title: string;
  description: string;
  points: number;
  status: FindingStatus;
  evidenceIds: string[];
}

export interface InvestigationSummary {
  source: "authored-demo";
  title: string;
  summary: string;
  observations: string[];
  hypotheses: string[];
  recommendedActions: string[];
  confidence: "Limited to synthetic evidence";
}

export interface AnalysisReport {
  id: string;
  isDemo: true;
  generatedAt: string;
  packageName: string;
  trustedVersion: string;
  candidateVersion: string;
  status: RiskStatus;
  reviewAction: "REVIEW REQUIRED";
  riskScore: number;
  summary: string;
  newBehaviors: string[];
  metadata: {
    trusted: PackageMetadata;
    candidate: PackageMetadata;
  };
  staticFindings: StaticFinding[];
  behaviorComparisons: BehaviorComparison[];
  networkEvents: NetworkEvent[];
  environmentAccesses: EnvironmentAccess[];
  processEvents: ProcessEvent[];
  filesystemEvents: FilesystemEvent[];
  dependencyChanges: DependencyChange[];
  evidence: Evidence[];
  aiInvestigation: InvestigationSummary;
  riskSignals: RiskSignal[];
  limitations: string[];
}

export interface AnalysisStage {
  id: string;
  label: string;
  description: string;
}
