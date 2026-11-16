import "server-only";
import { randomUUID } from "node:crypto";
import { AnalysisInputError } from "@/lib/analysis/errors";
import { STATIC_STAGES, type AnalysisJob } from "@/lib/types/static-analysis";
import { CliAnalysisError } from "./arguments";
import type { CliAnalyzer } from "./index";

/** Call the existing static pipeline directly, without a job store or Next.js. */
export const staticAnalyzer: CliAnalyzer = async (target, progress) => {
  if (target.from === null)
    throw new CliAnalysisError(
      "No trusted baseline for this added package. Run check with two explicit versions.",
    );
  const now = new Date().toISOString();
  const job: AnalysisJob = {
    id: randomUUID(),
    mode: "static",
    status: "running",
    stage: 0,
    input: {
      packageName: target.name,
      trustedVersion: target.from,
      candidateVersion: target.to,
    },
    createdAt: now,
    updatedAt: now,
    error: null,
  };
  // Help, argument errors and lockfile parsing do not load the registry worker.
  const { analyzeReleases } = await import("@/lib/analysis/jobs");
  try {
    return await analyzeReleases(job, async (stage) => {
      progress(STATIC_STAGES[stage] ?? "Building evidence report");
    });
  } catch (error) {
    if (error instanceof AnalysisInputError)
      throw new CliAnalysisError(error.message);
    throw error;
  }
};
