import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ReportView } from "@/components/report-view";
import { DEMO_ANALYSIS_ID, DEMO_REPORT } from "@/lib/demo";
import { demoMode, staticAnalysisEnabled } from "@/lib/config";
import { analysisJobs } from "@/lib/analysis/jobs";
import { StaticReportView } from "@/components/static-report-view";
import { loadRuntimeEvidence } from "@/lib/runtime/storage";
import { investigations } from "@/lib/investigation/service";

export const metadata: Metadata = {
  title: "Evidence report",
};
export const dynamic = "force-dynamic";

export default async function ReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (id === DEMO_ANALYSIS_ID) {
    if (!demoMode) notFound();
    return <ReportView report={DEMO_REPORT} />;
  }
  if (!staticAnalysisEnabled) notFound();
  const job = await analysisJobs.get(id);
  if (!job) notFound();
  if (job.status !== "completed") redirect(`/analysis/${id}`);
  const report = await analysisJobs.store.getReport(id);
  if (!report) notFound();
  return (
    <StaticReportView
      report={report}
      runtimeEvidence={await loadRuntimeEvidence(report)}
      investigation={await investigations.view(report)}
    />
  );
}
