import { z } from "zod";

export const PROBE_PROFILE = "node-import-v1" as const;
export const MAX_RUNTIME_EVENTS = 256;
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
export const imageIdSchema = z
  .string()
  .regex(
    /^sha256:[a-f0-9]{64}$/,
    "Use an immutable local Docker image ID (sha256 plus 64 hex characters).",
  );
export const runtimeEventSchema = z
  .object({
    category: z.enum(["network", "environment", "process", "filesystem"]),
    operation: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-zA-Z0-9_.-]+$/),
    target: z.string().min(1).max(240),
    outcome: z.enum(["blocked", "attempted"]),
  })
  .strict();

// Container output is untrusted, including messages from our instrumented child.
export const probeOutputSchema = z
  .object({
    status: z.enum(["completed", "failed", "timed_out"]),
    events: z.array(runtimeEventSchema).max(MAX_RUNTIME_EVENTS),
    truncated: z.boolean(),
    reason: z.enum([
      "import_completed",
      "import_failed",
      "time_limit",
      "collector_failed",
    ]),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.status === "completed" && value.reason !== "import_completed")
      ctx.addIssue({
        code: "custom",
        message: "Inconsistent probe completion.",
      });
  });

export const runtimeRunSchema = z
  .object({
    version: z.string().min(1).max(128),
    archiveSha256: sha256,
    imageId: imageIdSchema,
    profile: z.literal(PROBE_PROFILE),
    status: z.enum([
      "completed",
      "failed",
      "timed_out",
      "unavailable",
      "unsupported",
    ]),
    reason: z.string().min(1).max(500),
    events: z.array(runtimeEventSchema).max(MAX_RUNTIME_EVENTS),
    truncated: z.boolean(),
    durationMs: z.number().int().min(0).max(120_000),
  })
  .strict();

export const runtimeBundleSchema = z
  .object({
    schemaVersion: z.literal(1),
    analysisId: z.string().uuid(),
    packageName: z.string().min(1).max(214),
    generatedAt: z.string().datetime(),
    source: z.literal("local-container-worker"),
    trusted: runtimeRunSchema,
    candidate: runtimeRunSchema,
  })
  .strict();

export type ProbeEvent = z.infer<typeof runtimeEventSchema>;
export type ProbeOutput = z.infer<typeof probeOutputSchema>;
export type RuntimeRun = z.infer<typeof runtimeRunSchema>;
export type RuntimeBundle = z.infer<typeof runtimeBundleSchema>;
export interface RuntimeDifference {
  id: string;
  category: ProbeEvent["category"];
  operation: string;
  target: string;
  outcome: ProbeEvent["outcome"];
  trustedCount: number;
  candidateCount: number;
  change: "introduced" | "increased" | "decreased" | "unchanged";
  evidenceIds: string[];
}
export interface RuntimeComparison {
  bundle: RuntimeBundle;
  comparable: boolean;
  summary: string;
  differences: RuntimeDifference[];
  counts: {
    category: ProbeEvent["category"];
    trusted: number;
    candidate: number;
  }[];
  limitations: string[];
}
export type RuntimeEvidenceState =
  | { status: "not_run" }
  | { status: "invalid" }
  | { status: "available"; comparison: RuntimeComparison };
