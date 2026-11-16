import { expect } from "vitest";
import {
  computeMetadataSignals,
  type MetadataSignal,
} from "@/lib/analysis/metadata-signals";
import {
  TRIAGE_DISCLAIMER,
  triageSchema,
  type Triage,
  type TriageInput,
} from "@/lib/analysis/triage";
import type { CliTarget } from "@/lib/cli/output";
import type {
  ReleaseFinding,
  StaticAnalysisReport,
} from "@/lib/types/static-analysis";
import metadataFixture from "../fixtures/metadata-packument.json";
import { cliReport, cliTarget } from "./cli-fixtures";

export const triageCategories = [
  "network",
  "environment",
  "process",
  "filesystem",
  "dynamic-code",
] as const;
export function triageReport(
  target: CliTarget = cliTarget,
): StaticAnalysisReport {
  return {
    ...cliReport(target),
    metadataSignals: [],
    findings: [],
    evidence: [],
    fileChanges: [],
    signalCounts: triageCategories.map((category) => ({
      category,
      oldCount: 0,
      newCount: 0,
    })),
    coverage: {
      trustedFilesScanned: 1,
      candidateFilesScanned: 1,
      skippedFiles: 0,
      truncated: false,
      notes: ["All selected source files were inspected."],
    },
  };
}
export function triageSignal(id: MetadataSignal["id"]): MetadataSignal {
  const signals = computeMetadataSignals(
    { ...metadataFixture.versions["1.0.0"], time: metadataFixture.time },
    { ...metadataFixture.versions["1.1.0"], time: metadataFixture.time },
    "2026-11-15T00:00:00.000Z",
  );
  return signals.find((signal) => signal.id === id)!;
}
export function triageFinding(
  category: ReleaseFinding["category"],
  id = "STATIC-001",
): ReleaseFinding {
  return {
    id,
    category,
    status: "STATIC SIGNAL",
    severity: "low",
    title: "Authored finding",
    description: "Authored description",
    evidenceIds: [],
  };
}
export function withAddedFinding(
  report: StaticAnalysisReport,
  category: ReleaseFinding["category"] = "network",
) {
  const finding = {
    ...triageFinding(category),
    evidenceIds: ["STATIC-EVD-001"],
  };
  report.findings.push(finding);
  report.fileChanges.push({
    path: "added.js",
    change: "added",
    oldSize: null,
    newSize: 20,
    oldSha256: null,
    newSha256: "b".repeat(64),
  });
  report.evidence.push({
    id: "STATIC-EVD-001",
    source: "npm-archive",
    file: "added.js",
    oldLine: null,
    newLine: 1,
    oldExcerpt: null,
    newExcerpt: "Authored candidate source",
    oldSha256: null,
    newSha256: "b".repeat(64),
  });
  return report;
}

export const prohibitedTriageWords =
  /\b(?:safe|unsafe|malicious|clean|verified)\b/i;
/** Exclude only an exact fixed disclaimer property, never other prose fields. */
export function serializeWithoutDisclaimer(value: unknown): string {
  return JSON.stringify(value, (key, item) =>
    key === "disclaimer" && item === TRIAGE_DISCLAIMER ? undefined : item,
  );
}
export function expectReferencedTriage(triage: Triage, input: TriageInput) {
  expect(triageSchema.parse(triage)).toEqual(triage);
  expect(triage.disclaimer).toBe(TRIAGE_DISCLAIMER);
  expect(serializeWithoutDisclaimer(triage)).not.toMatch(prohibitedTriageWords);
  expect(triage.reasons.map(({ source, id }) => `${source}:${id}`)).toEqual(
    triage.reasons.map(({ source, id }) => `${source}:${id}`).sort(),
  );
  for (const reason of triage.reasons) {
    expect(reason.evidenceRef.trim()).not.toBe("");
    if (reason.evidenceRef.startsWith("#/")) {
      const tokens = reason.evidenceRef.slice(2).split("/");
      let value: unknown = input;
      for (const token of tokens) {
        expect(value !== null && typeof value === "object").toBe(true);
        value = (value as Record<string, unknown>)[token];
      }
      expect(value).not.toBeUndefined();
    } else {
      expect([
        ...(input.metadataSignals ?? []).map((signal) => signal.id),
        ...input.findings.map((finding) => finding.id),
      ]).toContain(reason.evidenceRef);
    }
  }
}
