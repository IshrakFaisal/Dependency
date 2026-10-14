import { z } from "zod";

export const PROMPT_VERSION = "static-investigation-v1";
const prose = z.string().trim().min(1).max(1600);
export const investigationOutputSchema = z.strictObject({
  observations: z
    .array(
      z.strictObject({
        title: z.string().trim().min(1).max(160),
        interpretation: prose,
        benignAlternative: prose,
        recommendedCheck: prose,
        evidenceIds: z.array(z.string().min(1).max(80)).min(1).max(8),
      }),
    )
    .max(8),
  limitations: z.array(prose).min(1).max(6),
});
export type InvestigationOutput = z.infer<typeof investigationOutputSchema>;
export const investigationArtifactSchema = z.strictObject({
  schemaVersion: z.literal(1),
  analysisId: z.string().uuid(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  promptVersion: z.literal(PROMPT_VERSION),
  provider: z.literal("Nebius Token Factory"),
  model: z.string().min(1).max(200),
  generatedAt: z.string().datetime(),
  output: investigationOutputSchema,
});
export type InvestigationArtifact = z.infer<typeof investigationArtifactSchema>;
export type InvestigationView = {
  availability: "disabled" | "not_configured" | "no_evidence" | "ready";
  status: "not_generated" | "available" | "stale" | "invalid";
  model: string | null;
  fingerprint: string;
  packetJson: string;
  artifact: InvestigationArtifact | null;
};

export function validateCitations(value: unknown, ids: ReadonlySet<string>) {
  const output = investigationOutputSchema.parse(value);
  for (const observation of output.observations) {
    if (
      new Set(observation.evidenceIds).size !==
        observation.evidenceIds.length ||
      observation.evidenceIds.some((id) => !ids.has(id))
    ) {
      throw new Error("Invalid evidence citation.");
    }
  }
  return output;
}
