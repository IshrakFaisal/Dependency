import "server-only";
import { createHash } from "node:crypto";
import type { StaticAnalysisReport } from "@/lib/types/static-analysis";
import { PROMPT_VERSION } from "./contracts";

// Defense in depth, not a promise to find all secrets in public source text.
function excerpt(value: string | null) {
  return value === null
    ? null
    : value
        .replace(
          /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g,
          "[REDACTED PRIVATE KEY]",
        )
        .replace(
          /\b(?:npm_[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})\b/g,
          "[REDACTED TOKEN]",
        )
        .replace(
          /\b(password|secret|token|api[_-]?key)\s*[:=]\s*(["'`])[^"'`\r\n]*\2/gi,
          "$1=[REDACTED]",
        )
        .slice(0, 800);
}

export function buildInvestigationPacket(
  report: StaticAnalysisReport,
  model: string | null,
) {
  const evidence = report.evidence.slice(0, 24).map((entry) => ({
    id: entry.id,
    source: entry.source,
    file: entry.file.slice(0, 240),
    oldLine: entry.oldLine,
    newLine: entry.newLine,
    oldExcerpt: excerpt(entry.oldExcerpt),
    newExcerpt: excerpt(entry.newExcerpt),
  }));
  const ids = new Set(evidence.map((entry) => entry.id));
  const packet = {
    scope:
      "Static source evidence only. Runtime execution and intent are unverified. No CVE lookup was performed.",
    input: report.input,
    archives: {
      trusted: report.releases.trusted.archiveSha256,
      candidate: report.releases.candidate.archiveSha256,
    },
    evidence,
    coverage: {
      trustedFilesScanned: report.coverage.trustedFilesScanned,
      candidateFilesScanned: report.coverage.candidateFilesScanned,
      skippedFiles: report.coverage.skippedFiles,
      scanTruncated: report.coverage.truncated,
      omittedEvidence: report.evidence.length - evidence.length,
      excerptLimit: 800,
      note: "Excerpts may be truncated or redacted. Text matching can miss behavior or match comments and dead code. No absence-of-risk conclusion is supported.",
    },
  };
  const packetJson = JSON.stringify(packet, null, 2);
  if (Buffer.byteLength(packetJson) > 128 * 1024)
    throw new Error("Evidence packet exceeds limit.");
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        prompt: PROMPT_VERSION,
        model,
        reportId: report.id,
        packet,
      }),
    )
    .digest("hex");
  return { packetJson, fingerprint, ids };
}
