import { z } from "zod";

const count = z.number().int().nonnegative();
/** Kind and cause counts only. Existing source selection and limits are retained. */
export const skipBreakdownSchema = z.strictObject({
  nonSource: count,
  sourceUnavailable: count,
  sourceOversized: count,
  sourceBudget: count,
});
export type SkipBreakdown = z.infer<typeof skipBreakdownSchema>;

export function usableSkipBreakdown(coverage: {
  skippedFiles: number;
  skipBreakdown?: unknown;
}): SkipBreakdown | null {
  const result = skipBreakdownSchema.safeParse(coverage.skipBreakdown);
  if (!result.success) return null;
  const counts = result.data;
  return counts.nonSource +
    counts.sourceUnavailable +
    counts.sourceOversized +
    counts.sourceBudget ===
    coverage.skippedFiles
    ? counts
    : null;
}
