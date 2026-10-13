import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AnalysisProgress } from "@/components/analysis-progress";
import { StaticAnalysisProgress } from "@/components/static-analysis-progress";
import { DEMO_ANALYSIS_ID } from "@/lib/demo";
import { demoMode, staticAnalysisEnabled } from "@/lib/config";
import { analysisJobs } from "@/lib/analysis/jobs";

export const metadata: Metadata = { title: "Analysis progress" };
export const dynamic = "force-dynamic";

export default async function AnalysisPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (id === DEMO_ANALYSIS_ID) {
    if (!demoMode) notFound();
    return <AnalysisProgress id={id} />;
  }
  if (!staticAnalysisEnabled) notFound();
  const job = await analysisJobs.get(id);
  if (!job) notFound();
  return <StaticAnalysisProgress key={job.id} initialJob={job} />;
}
