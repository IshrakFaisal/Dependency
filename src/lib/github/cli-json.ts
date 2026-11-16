import { z } from "zod";
import { metadataSignalSchema } from "@/lib/analysis/metadata-signals";
import { triageSchema } from "@/lib/analysis/triage";

const count = z.number().int().nonnegative();
export const targetSchema = z.object({
  name: z.string(),
  from: z.string().nullable(),
  to: z.string(),
  path: z.string().nullable(),
  dev: z.boolean(),
});
const base = { ...targetSchema.shape, status: z.literal("INCONCLUSIVE") };
export const cliJsonSchema = z
  .object({
    command: z.enum(["check", "lockfile"]).nullable(),
    status: z.literal("INCONCLUSIVE"),
    results: z.array(
      z.discriminatedUnion("outcome", [
        z.object({
          ...base,
          outcome: z.literal("completed"),
          metadataSignals: z.array(metadataSignalSchema),
          triage: triageSchema,
          findingsByCategory: z.object({
            network: count,
            environment: count,
            process: count,
            filesystem: count,
            "dynamic-code": count,
            lifecycle: count,
            metadata: count,
          }),
          coverage: z.object({
            trustedFilesScanned: count,
            candidateFilesScanned: count,
            skippedFiles: count,
            truncated: z.boolean(),
            notes: z.array(z.string()),
          }),
          limitations: z.array(z.string()),
        }),
        z.object({ ...base, outcome: z.literal("failed"), error: z.string() }),
      ]),
    ),
    skipped: z.array(
      z.object({
        name: z.string().nullable(),
        path: z.string(),
        reason: z.string(),
      }),
    ),
    summary: z.object({ completed: count, failed: count, skipped: count }),
    triageSummary: z
      .object({
        "needs-review": count,
        "no-notable-changes": count,
        incomplete: count,
      })
      .optional(),
    error: z
      .object({
        code: z.enum(["usage-error", "file-error"]),
        message: z.string(),
      })
      .optional(),
  })
  .superRefine((document, context) => {
    const completed = document.results.filter(
      (item) => item.outcome === "completed",
    );
    if (
      document.summary.completed !== completed.length ||
      document.summary.failed !== document.results.length - completed.length ||
      document.summary.skipped !== document.skipped.length
    )
      context.addIssue({
        code: "custom",
        message: "CLI summary does not match its records.",
      });
    if (document.triageSummary)
      for (const tier of [
        "needs-review",
        "no-notable-changes",
        "incomplete",
      ] as const) {
        if (
          document.triageSummary[tier] !==
          completed.filter((item) => item.triage.tier === tier).length
        )
          context.addIssue({
            code: "custom",
            message: "CLI tier counts do not match its records.",
          });
      }
  });
export type CliJson = z.infer<typeof cliJsonSchema>;
export const maxPackagesSchema = z.number().int().min(0).max(1000).default(25);
