import { z } from "zod";
import { staticAnalysisEnabled } from "@/lib/config";
import { analysisJobs } from "@/lib/analysis/jobs";
import {
  jsonResponse,
  readComparisonRequest,
  RequestError,
} from "@/lib/analysis/http";
import { investigations } from "@/lib/investigation/service";
import { InvestigationError } from "@/lib/investigation/provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
type Context = { params: Promise<{ id: string }> };

async function handle(request: Request, context: Context, generate: boolean) {
  if (!staticAnalysisEnabled)
    return jsonResponse({ error: "Analysis is disabled." }, 503);
  try {
    const body = generate
      ? z
          .strictObject({ fingerprint: z.string().regex(/^[a-f0-9]{64}$/) })
          .safeParse(await readComparisonRequest(request))
      : null;
    if (body && !body.success)
      return jsonResponse(
        { error: "Send only the evidence preview fingerprint." },
        400,
      );
    const { id } = await context.params;
    const report = await analysisJobs.store.getReport(id);
    if (!report)
      return jsonResponse({ error: "Completed analysis not found." }, 404);
    return jsonResponse(
      body?.success
        ? await investigations.generate(report, body.data.fingerprint)
        : await investigations.view(report),
    );
  } catch (error) {
    if (error instanceof RequestError || error instanceof InvestigationError)
      return jsonResponse({ error: error.message }, error.status);
    return jsonResponse(
      {
        error:
          "AI investigation is unavailable. No report assessment was changed.",
      },
      500,
    );
  }
}

/** Read-only preview/status. No provider request occurs on GET. */
export function GET(request: Request, context: Context) {
  return handle(request, context, false);
}
/** Explicit user action; model, endpoint, prompt, and evidence are server-controlled. */
export function POST(request: Request, context: Context) {
  return handle(request, context, true);
}
