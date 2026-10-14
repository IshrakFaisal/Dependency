import { staticAnalysisEnabled } from "@/lib/config";
import { analysisJobs } from "@/lib/analysis/jobs";
import { jsonResponse } from "@/lib/analysis/http";
import { loadRuntimeEvidence } from "@/lib/runtime/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Read-only evidence endpoint. It cannot schedule execution or accept commands. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!staticAnalysisEnabled)
    return jsonResponse({ error: "Analysis is disabled." }, 503);
  try {
    const { id } = await params;
    const report = await analysisJobs.store.getReport(id);
    if (!report)
      return jsonResponse({ error: "Completed analysis not found." }, 404);
    return jsonResponse(await loadRuntimeEvidence(report));
  } catch {
    return jsonResponse({ error: "Runtime evidence is unavailable." }, 500);
  }
}
