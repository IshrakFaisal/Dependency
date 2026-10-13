"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Circle, CircleAlert, FileSearch, LoaderCircle, LockKeyhole, RotateCcw } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { STATIC_STAGES, type AnalysisJob } from "@/lib/types/static-analysis";
import { comparisonInputSchema } from "@/lib/validation";
import { cn } from "@/lib/utils";

export const STATIC_POLL_INTERVAL = 1500;

const jobEnvelopeSchema = z.object({
  job: z.object({
    id: z.string(),
    input: comparisonInputSchema,
    mode: z.literal("static"),
    status: z.enum(["queued", "running", "completed", "failed"]),
    stage: z.number().int().min(0).max(STATIC_STAGES.length),
    createdAt: z.string(),
    updatedAt: z.string(),
    error: z.string().nullable(),
  }),
});

function responseError(payload: unknown, fallback: string) {
  return payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
    ? payload.error
    : fallback;
}

export function StaticAnalysisProgress({ initialJob }: { initialJob: AnalysisJob }) {
  const router = useRouter();
  const [job, setJob] = useState(initialJob);
  const [pollError, setPollError] = useState<string | null>(null);
  const [pollAttempt, setPollAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const retryRequest = useRef<AbortController | null>(null);
  const finished = job.status === "completed";
  const failed = job.status === "failed";
  const percentage = finished ? 100 : Math.round((job.stage / STATIC_STAGES.length) * 100);

  useEffect(() => () => retryRequest.current?.abort(), []);

  useEffect(() => {
    if (job.status === "completed" || job.status === "failed") return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      try {
        const response = await fetch(`/api/analyses/${encodeURIComponent(job.id)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload: unknown = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok) throw new Error(responseError(payload, "Unable to refresh analysis progress. Try reconnecting below."));
        const result = jobEnvelopeSchema.safeParse(payload);
        if (!result.success || result.data.job.id !== job.id) throw new Error("The progress response was invalid. Try reconnecting below.");
        setJob(result.data.job);
        setPollError(null);
        if (result.data.job.status !== "completed" && result.data.job.status !== "failed") {
          timer = setTimeout(poll, STATIC_POLL_INTERVAL);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        setPollError(error instanceof Error ? error.message : "Connection interrupted. Try reconnecting below.");
      }
    }

    void poll();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [job.id, job.status, pollAttempt]);

  async function retryAnalysis() {
    if (retryRequest.current || !failed) return;
    const controller = new AbortController();
    retryRequest.current = controller;
    setRetrying(true);
    setRetryError(null);
    try {
      const response = await fetch("/api/analyses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(job.input),
        signal: controller.signal,
      });
      const payload: unknown = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok) throw new Error(responseError(payload, "The analysis could not be restarted. Please try again."));
      if (!payload || typeof payload !== "object" || !("id" in payload) || typeof payload.id !== "string" || !/^[a-zA-Z0-9-]+$/.test(payload.id)) {
        throw new Error("The server returned an invalid analysis ID. Please try again.");
      }
      router.push(`/analysis/${payload.id}`);
    } catch (error) {
      if (controller.signal.aborted) return;
      setRetryError(error instanceof Error ? error.message : "Unable to restart. Please try again.");
      retryRequest.current = null;
      setRetrying(false);
    }
  }

  return (
    <div className="mx-auto max-w-[1060px] px-6 py-10 sm:py-12">
      <Link href="/" className="inline-flex items-center gap-2 text-xs text-[#92a598] hover:text-[#b5e2c2]">
        <ArrowLeft size={14} /> Back to overview
      </Link>
      <div className="mb-7 mt-9 flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="eyebrow mb-3">PUBLIC NPM · STATIC ANALYSIS</p>
          <h1 className="text-3xl font-medium tracking-[-1px] sm:text-4xl">
            {finished ? "The release diff is ready." : failed ? "This comparison needs attention." : "Looking between the versions."}
          </h1>
          <p className="muted mt-3 text-sm">Verified archives. Source signals. Evidence you can inspect.</p>
        </div>
        <span className="badge badge-green"><FileSearch size={12} /> LIVE STATIC ANALYSIS</span>
      </div>
      <div className="mb-7 flex items-start gap-3 rounded-lg border border-[#94c9a6]/15 bg-[#94c9a6]/[0.04] px-4 py-3 text-xs leading-6 text-[#95b29e]">
        <LockKeyhole className="mt-1 size-4 shrink-0" />
        <p>Package archives are inspected as data. Install scripts and package code are never executed. Static signals do not establish runtime behavior or malicious intent.</p>
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[1.3fr_1fr]">
        <section className="panel overflow-hidden" aria-labelledby="static-pipeline-heading">
          <div className="border-b border-white/[0.07] p-6">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 id="static-pipeline-heading" className="text-sm font-medium">Analysis pipeline</h2>
              <span className="mono text-xs text-[#a4cbb1]">{finished ? 5 : job.stage} / {STATIC_STAGES.length} stages</span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-white/[0.06]" role="progressbar" aria-label="Static analysis progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage} aria-valuetext={finished ? "All stages complete" : `${job.stage} of ${STATIC_STAGES.length} stages complete`}>
              <div className="progress-line h-full rounded-full bg-[#9cdeb4]" style={{ width: `${percentage}%` }} />
            </div>
            <p className="mt-3 text-xs leading-6 text-[#95aa9b]" role="status" aria-live="polite">
              {finished ? "Analysis complete. The static evidence report is ready." : failed ? "Analysis failed. No completed report is available." : pollError ? "Updates paused. Last confirmed progress is shown." : job.status === "queued" ? "Queued. Waiting for analysis to start." : `Stage ${job.stage + 1} of ${STATIC_STAGES.length}: ${STATIC_STAGES[job.stage]}`}
            </p>
          </div>
          <ol className="space-y-1 p-4">
            {STATIC_STAGES.map((label, index) => {
              const done = finished || index < job.stage;
              const active = !finished && index === job.stage;
              return (
                <li key={label} aria-current={active ? "step" : undefined} className={cn("flex items-center gap-3 rounded-md px-3 py-4", active && "bg-[#92dca8]/[0.05]")}>
                  <span aria-hidden="true" className={cn("flex size-5 shrink-0 items-center justify-center", done ? "text-[#a1d8b2]" : "text-[#728c7b]")}>
                    {done ? <Check size={15} /> : active && failed ? <CircleAlert size={16} /> : active && job.status === "running" && !pollError ? <LoaderCircle className="animate-spin" size={16} /> : <Circle size={11} />}
                  </span>
                  <span className={cn("text-xs", active ? "text-[#e0ece2]" : "text-[#95aa9b]")}>{label}</span>
                  <span className="mono ml-auto text-[9px] text-[#8fa698]">{done ? "COMPLETE" : active ? failed ? "FAILED" : pollError ? "LAST SEEN" : job.status === "queued" ? "QUEUED" : "ACTIVE" : "PENDING"}</span>
                </li>
              );
            })}
          </ol>
          {pollError && (
            <div className="border-t border-white/[0.07] p-5">
              <p role="alert" className="mb-3 text-xs leading-6 text-orange-200">{pollError}</p>
              <Button variant="outline" size="sm" onClick={() => { setPollError(null); setPollAttempt((value) => value + 1); }}><RotateCcw /> Retry connection</Button>
            </div>
          )}
          {failed && (
            <div className="border-t border-white/[0.07] p-5">
              <p role="alert" className="mb-4 text-xs leading-6 text-orange-200">{job.error ?? "The analysis did not finish. Check the package and release versions, then retry."}</p>
              <Button variant="outline" size="sm" disabled={retrying} onClick={() => void retryAnalysis()}>{retrying ? <LoaderCircle className="animate-spin" /> : <RotateCcw />}{retrying ? "Restarting…" : "Retry analysis"}</Button>
              {retryError && <p className="mt-3 text-xs text-orange-200" role="alert">{retryError}</p>}
            </div>
          )}
        </section>
        <div className="space-y-5">
          <section className="panel p-6" aria-labelledby="static-comparison-heading">
            <p className="eyebrow mb-4">UNDER THE MICROSCOPE</p>
            <h2 id="static-comparison-heading" className="break-all text-xl font-medium">{job.input.packageName}</h2>
            <div className="my-6 grid grid-cols-[1fr_20px_1fr] items-center gap-3">
              <div className="min-w-0"><p className="mono mb-2 text-[9px] text-[#8ead98]">TRUSTED</p><p className="mono break-all text-xl text-[#c9dfd0]">{job.input.trustedVersion}</p></div>
              <ArrowRight size={15} className="text-[#587763]" />
              <div className="min-w-0"><p className="mono mb-2 text-[9px] text-[#b3a784]">CANDIDATE</p><p className="mono break-all text-xl text-[#dacfaf]">{job.input.candidateVersion}</p></div>
            </div>
            <dl className="space-y-3 border-t border-white/[0.07] pt-4 text-xs text-[#9db1a4]">
              <div className="flex justify-between gap-4"><dt>Data source</dt><dd>Public npm registry</dd></div>
              <div><dt className="mb-1">Analysis ID</dt><dd className="mono break-all text-[10px]">{job.id}</dd></div>
            </dl>
          </section>
          <section className="panel p-6" aria-labelledby="execution-heading">
            <h2 id="execution-heading" className="mb-4 text-sm font-medium">Execution &amp; investigation</h2>
            <dl className="space-y-4 text-xs text-[#9db1a4]">
              {['Install scripts', 'Trusted release execution', 'Candidate release execution', 'Runtime behavior comparison'].map((label) => <div className="flex justify-between gap-3" key={label}><dt>{label}</dt><dd className="text-[#c5d4cb]">Not run</dd></div>)}
              <div className="flex justify-between gap-3"><dt>AI investigation</dt><dd className="text-[#c5d4cb]">Not connected</dd></div>
            </dl>
          </section>
          {finished && <section className="rounded-lg border border-[#9addae]/30 bg-[#94dba8]/[0.06] p-5"><h2 className="mb-2 text-sm font-medium text-[#c3d9ca]">Evidence ready for review.</h2><p className="mb-5 text-xs leading-6 text-[#91a596]">Review changed files, manifest differences, source excerpts, and scan limitations.</p><Button asChild className="w-full"><Link href={`/report/${encodeURIComponent(job.id)}`}>View static report <ArrowRight /></Link></Button></section>}
        </div>
      </div>
    </div>
  );
}
