import { after } from "next/server";
import { staticAnalysisEnabled } from "@/lib/config";
import { comparisonInputSchema } from "@/lib/validation";
import { analysisJobs, BusyError } from "@/lib/analysis/jobs";
import { JobLimitError } from "@/lib/analysis/store";
import {
  jsonResponse,
  readComparisonRequest,
  RequestError,
} from "@/lib/analysis/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  if (!staticAnalysisEnabled)
    return jsonResponse(
      { error: "Static analysis is disabled on this server." },
      503,
    );
  try {
    const input = comparisonInputSchema.safeParse(
      await readComparisonRequest(request),
    );
    if (!input.success)
      return jsonResponse({ error: input.error.issues[0].message }, 400);
    const job = await analysisJobs.create(input.data);
    after(() => analysisJobs.run(job.id));
    return jsonResponse({ id: job.id }, 202);
  } catch (error) {
    if (error instanceof RequestError)
      return jsonResponse({ error: error.message }, error.status);
    if (error instanceof BusyError || error instanceof JobLimitError)
      return jsonResponse({ error: error.message }, 429);
    return jsonResponse(
      {
        error:
          "Could not create the analysis. Check local storage and try again.",
      },
      500,
    );
  }
}
