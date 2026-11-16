import { z } from "zod";
import { metadataSignalSchema } from "@/lib/analysis/metadata-signals";
import { triageSchema } from "@/lib/analysis/triage";
import { comparisonInputSchema } from "@/lib/validation";
import type { StaticAnalysisReport } from "@/lib/types/static-analysis";

export const corpusEntrySchema = z
  .strictObject({
    name: comparisonInputSchema.shape.packageName,
    from: comparisonInputSchema.shape.trustedVersion,
    to: comparisonInputSchema.shape.candidateVersion,
    label: z.enum(["benign-update", "synthetic-suspicious"]),
    notes: z.string().trim().min(1),
  })
  .refine(
    (entry) => entry.from !== entry.to,
    "Corpus pairs must compare distinct versions.",
  );
export type CorpusEntry = z.infer<typeof corpusEntrySchema>;
export const pairKey = (entry: Pick<CorpusEntry, "name" | "from" | "to">) =>
  JSON.stringify([entry.name, entry.from, entry.to]);
export const corpusSchema = z
  .array(corpusEntrySchema)
  .min(1)
  .max(1000)
  .superRefine((entries, context) => {
    const keys = new Set<string>();
    for (const [index, entry] of entries.entries()) {
      const key = pairKey(entry);
      if (keys.has(key))
        context.addIssue({
          code: "custom",
          path: [index],
          message: "Duplicate corpus pair.",
        });
      keys.add(key);
    }
  });
const count = z.number().int().nonnegative();
const category = z.enum([
  "network",
  "environment",
  "process",
  "filesystem",
  "dynamic-code",
  "lifecycle",
  "metadata",
]);
const strings = z.record(z.string(), z.string());
const releaseSchema = z.object({
  release: z.object({
    name: z.string(),
    version: z.string(),
    description: z.string(),
    license: z.string(),
    tarballUrl: z.string(),
    integrity: z.string().nullable(),
    shasum: z.string().nullable(),
    scripts: strings,
    dependencies: strings,
    optionalDependencies: strings,
    peerDependencies: strings,
    deprecated: z.string().nullable(),
  }),
  archiveSha256: z.string(),
  integrityVerified: z.enum(["sha512", "sha384", "sha256", "sha1"]),
  compressedBytes: count,
  unpackedBytes: count,
  warnings: z.array(z.string()),
  fileCount: count,
});
/** Validate saved static reports at this boundary without changing the application
 * report contract. Older triage is ignored and replaced by the current rules.
 */
export const replayReportFieldsSchema = z.object({
  id: z.string(),
  mode: z.literal("static"),
  input: comparisonInputSchema,
  generatedAt: z.string().datetime(),
  status: z.literal("INCONCLUSIVE"),
  riskScore: z.null(),
  summary: z.string(),
  releases: z.object({ trusted: releaseSchema, candidate: releaseSchema }),
  metadataSignals: z.array(metadataSignalSchema).optional(),
  fileChanges: z.array(
    z.object({
      path: z.string(),
      change: z.enum(["added", "removed", "modified"]),
      oldSize: count.nullable(),
      newSize: count.nullable(),
      oldSha256: z.string().nullable(),
      newSha256: z.string().nullable(),
    }),
  ),
  manifestChanges: z.array(
    z.object({
      name: z.string(),
      kind: z.enum([
        "dependency",
        "optionalDependency",
        "peerDependency",
        "script",
      ]),
      oldValue: z.string().nullable(),
      newValue: z.string().nullable(),
      evidenceId: z.string(),
    }),
  ),
  findings: z.array(
    z.object({
      id: z.string(),
      category,
      title: z.string(),
      description: z.string(),
      status: z.enum([
        "OBSERVED",
        "NOT OBSERVED",
        "STATIC SIGNAL",
        "UNVERIFIED RISK",
      ]),
      severity: z.enum(["info", "low", "medium", "high"]),
      evidenceIds: z.array(z.string()),
    }),
  ),
  evidence: z.array(
    z.object({
      id: z.string(),
      source: z.enum(["npm-archive", "npm-registry"]),
      file: z.string(),
      oldLine: count.nullable(),
      newLine: count.nullable(),
      oldExcerpt: z.string().nullable(),
      newExcerpt: z.string().nullable(),
      oldSha256: z.string().nullable(),
      newSha256: z.string().nullable(),
    }),
  ),
  signalCounts: z.array(
    z.object({ category, oldCount: count, newCount: count }),
  ),
  coverage: z.object({
    trustedFilesScanned: count,
    candidateFilesScanned: count,
    skippedFiles: count,
    truncated: z.boolean(),
    notes: z.array(z.string()),
  }),
  limitations: z.array(z.string()),
}) satisfies z.ZodType<Omit<StaticAnalysisReport, "triage">>;

// Validate fields needed by the current contract, but retain the original JSON
// object, including older triage and additional evidence fields. Zod's usual
// object projection would otherwise discard those fields during replay.
export const replayReportSchema = z.unknown().transform((value, context) => {
  const parsed = replayReportFieldsSchema.safeParse(value);
  if (!parsed.success) {
    for (const issue of parsed.error.issues)
      context.addIssue({
        code: "custom",
        path: issue.path,
        message: issue.message,
      });
    return z.NEVER;
  }
  return value as z.infer<typeof replayReportFieldsSchema> & {
    triage?: unknown;
  };
});

export const benchmarkEntrySchema = z.discriminatedUnion("outcome", [
  z.object({
    entry: corpusEntrySchema,
    outcome: z.literal("completed"),
    report: replayReportSchema,
    triage: triageSchema,
  }),
  z.object({
    entry: corpusEntrySchema,
    outcome: z.literal("failed"),
    error: z.string().min(1),
  }),
]);
export type BenchmarkEntry = z.infer<typeof benchmarkEntrySchema>;

// Previous aggregates and derived triage are deliberately not trusted on replay.
export const replayFileSchema = z
  .object({
    schemaVersion: z.literal(1),
    entries: z
      .array(
        z.discriminatedUnion("outcome", [
          z.object({
            entry: corpusEntrySchema,
            outcome: z.literal("completed"),
            report: replayReportSchema,
          }),
          z.object({
            entry: corpusEntrySchema,
            outcome: z.literal("failed"),
            error: z.string().min(1),
          }),
        ]),
      )
      .min(1)
      .max(1000),
  })
  .superRefine((file, context) => {
    const result = corpusSchema.safeParse(
      file.entries.map(({ entry }) => entry),
    );
    if (!result.success)
      context.addIssue({
        code: "custom",
        message: "Saved results contain invalid or duplicate corpus entries.",
      });
  });
