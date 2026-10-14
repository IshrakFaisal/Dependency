import type {
  InvestigationArtifact,
  InvestigationOutput,
  InvestigationView,
} from "@/lib/investigation/contracts";
import { PROMPT_VERSION } from "@/lib/investigation/contracts";
import { analysisId, bindingReport } from "./runtime-fixtures";
import type { StaticAnalysisReport } from "@/lib/types/static-analysis";

export const investigationReport: StaticAnalysisReport = {
  ...bindingReport,
  mode: "static",
  status: "INCONCLUSIVE",
  riskScore: null,
  generatedAt: "2026-10-14T00:00:00.000Z",
  summary: "Synthetic static fixture.",
  evidence: [
    {
      id: "STATIC-EVD-001",
      source: "npm-archive",
      file: "index.js",
      oldLine: null,
      newLine: 1,
      oldExcerpt: null,
      newExcerpt: "fetch('https://synthetic.invalid')",
      oldSha256: null,
      newSha256: "a".repeat(64),
    },
  ],
  findings: [],
  fileChanges: [],
  manifestChanges: [],
  signalCounts: [],
  limitations: [],
  coverage: {
    trustedFilesScanned: 1,
    candidateFilesScanned: 1,
    skippedFiles: 0,
    truncated: false,
    notes: [],
  },
};
export const investigationOutput: InvestigationOutput = {
  observations: [
    {
      title: "A network API appears in source",
      interpretation:
        "The added source could attempt a request if reached; execution is unverified.",
      benignAlternative: "It could be optional update metadata fetching.",
      recommendedCheck:
        "Review whether the call is reachable during normal use.",
      evidenceIds: ["STATIC-EVD-001"],
    },
  ],
  limitations: ["Static text cannot establish runtime execution or intent."],
};
export const investigationArtifact: InvestigationArtifact = {
  schemaVersion: 1,
  analysisId,
  fingerprint: "a".repeat(64),
  promptVersion: PROMPT_VERSION,
  provider: "Nebius Token Factory",
  model: "nvidia/synthetic-test-model",
  generatedAt: "2026-10-14T00:00:00.000Z",
  output: investigationOutput,
};
export const investigationView: InvestigationView = {
  availability: "ready",
  status: "not_generated",
  model: investigationArtifact.model,
  fingerprint: investigationArtifact.fingerprint,
  packetJson: '{"scope":"Synthetic fixture"}',
  artifact: null,
};
