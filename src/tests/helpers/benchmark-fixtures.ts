import { z } from "zod";
import {
  corpusEntrySchema,
  replayReportFieldsSchema,
} from "@/lib/benchmark/schema";
import { triageSchema } from "@/lib/analysis/triage";
import postinstall from "../fixtures/synthetic/postinstall-added.json";
import network from "../fixtures/synthetic/network-added.json";
import environment from "../fixtures/synthetic/environment-added.json";
import dynamic from "../fixtures/synthetic/dynamic-code-added.json";
import maintainer from "../fixtures/synthetic/maintainer-changed.json";
import provenance from "../fixtures/synthetic/provenance-dropped.json";
import dependency from "../fixtures/synthetic/dependency-added.json";
import indirect from "../fixtures/synthetic/indirect-call-known-miss.json";
import { triageReport } from "./triage-fixtures";

const fixtureSchema = corpusEntrySchema.safeExtend({
  report: replayReportFieldsSchema.pick({
    status: true,
    riskScore: true,
    metadataSignals: true,
    signalCounts: true,
    findings: true,
    evidence: true,
    fileChanges: true,
    coverage: true,
  }),
  expected: z.object({
    tier: triageSchema.shape.tier,
    reasonIds: z.array(z.string()),
  }),
  metadata: z.object({ old: z.unknown(), new: z.unknown() }).optional(),
  scanner: z
    .object({
      category: z.enum(["network", "environment", "dynamic-code"]),
      oldText: z.string(),
      newText: z.string(),
    })
    .optional(),
  knownLimitation: z.string().min(1).optional(),
});
export const syntheticFixtures = [
  postinstall,
  network,
  environment,
  dynamic,
  maintainer,
  provenance,
  dependency,
  indirect,
].map((value) => fixtureSchema.parse(value));
export function syntheticReport(fixture: (typeof syntheticFixtures)[number]) {
  return {
    ...triageReport({
      name: fixture.name,
      from: fixture.from,
      to: fixture.to,
      dev: false,
      path: null,
    }),
    summary: "Authored report-level fixture; no behavior was executed.",
    ...structuredClone(fixture.report),
  };
}
export function fixtureEntry(fixture: (typeof syntheticFixtures)[number]) {
  const { name, from, to, label, notes } = fixture;
  return { name, from, to, label, notes };
}
