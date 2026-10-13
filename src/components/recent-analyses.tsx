import Link from "next/link";
import { ArrowUpRight, History } from "lucide-react";
import { analysisJobs } from "@/lib/analysis/jobs";

export async function RecentAnalyses() {
  let jobs;
  try { jobs = await analysisJobs.recent(); }
  catch { return <p className="muted my-6 text-xs">Local analysis history is unavailable. Check the server’s storage permissions.</p>; }
  if (!jobs.length) return null;
  return <section className="mt-9" aria-labelledby="recent-heading">
    <div className="mb-4 flex items-center justify-between"><h2 id="recent-heading" className="flex items-center gap-2 text-sm"><History size={16} />Recent static analyses</h2><span className="eyebrow">LOCAL HISTORY</span></div>
    <div className="panel divide-y divide-white/5">{jobs.map((job) => <Link key={job.id} href={`/${job.status === "completed" ? "report" : "analysis"}/${job.id}`} className="flex flex-wrap items-center gap-3 px-5 py-4 transition-colors hover:bg-white/5"><span className="min-w-0 flex-1"><span className="block break-all text-sm text-[#c6dfcf]">{job.input.packageName}</span><span className="mono mt-1 block text-[11px] text-[#879d8e]">{job.input.trustedVersion} → {job.input.candidateVersion}</span></span><span className={`badge ${job.status === "failed" ? "badge-orange" : "badge-neutral"}`}>{job.status.toUpperCase()}</span><ArrowUpRight size={15} /></Link>)}</div>
  </section>;
}
