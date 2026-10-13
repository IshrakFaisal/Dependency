import { staticAnalysisEnabled } from "@/lib/config";
import { analysisJobs } from "@/lib/analysis/jobs";
import { jsonResponse } from "@/lib/analysis/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!staticAnalysisEnabled) return jsonResponse({ error: "Static analysis is disabled on this server." }, 503);
  try {
    const { id } = await params;
    const job = await analysisJobs.get(id);
    return job ? jsonResponse({ job }) : jsonResponse({ error: "Analysis not found." }, 404);
  } catch { return jsonResponse({ error: "Unable to read this analysis. Retry in a moment." }, 500); }
}
