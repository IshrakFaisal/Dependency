"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Box,
  Check,
  CheckCheck,
  Circle,
  FlaskConical,
  GitCompareArrows,
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import { ANALYSIS_STAGES } from "@/lib/demo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const DEMO_STAGE_DURATION = 900;

export function AnalysisProgress({ id }: { id: string }) {
  const [completed, setCompleted] = useState(0);
  const [paused, setPaused] = useState(false);
  const finished = completed === ANALYSIS_STAGES.length;
  const percentage = Math.round((completed / ANALYSIS_STAGES.length) * 100);
  const activeStage = ANALYSIS_STAGES[completed];

  useEffect(() => {
    if (paused || finished) return;
    const timer = setTimeout(
      () =>
        setCompleted((value) => Math.min(value + 1, ANALYSIS_STAGES.length)),
      DEMO_STAGE_DURATION,
    );
    return () => clearTimeout(timer);
  }, [completed, paused, finished]);

  function replay() {
    setCompleted(0);
    setPaused(false);
  }

  return (
    <div className="mx-auto max-w-[1060px] px-6 py-10 sm:py-12">
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-xs text-[#92a598] hover:text-[#b5e2c2]"
      >
        <ArrowLeft size={14} />
        Back to overview
      </Link>
      <div className="mb-7 mt-9 flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="eyebrow mb-3">THE DIFFERENCE IS IN THE DETAILS</p>
          <h1 className="text-3xl font-medium tracking-[-1px] sm:text-4xl">
            {finished
              ? "A clearer picture, ready for review."
              : "Looking between the versions."}
          </h1>
          <p className="muted mt-3 text-sm">
            A deterministic walkthrough of the DependencyGuard analysis
            pipeline.
          </p>
        </div>
        <span className="badge badge-green">
          <FlaskConical size={11} />
          SYNTHETIC DEMO
        </span>
      </div>
      <div className="mb-7 flex items-start gap-3 rounded-lg border border-[#94c9a6]/15 bg-[#94c9a6]/[0.04] px-4 py-3 text-xs leading-6 text-[#95b29e]">
        <FlaskConical className="mt-1 size-4 shrink-0" />
        <p>
          Every step below is simulated. No releases are downloaded, no package
          code is executed, and no AI service is called.
        </p>
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[1.3fr_1fr]">
        <section
          className="panel overflow-hidden"
          aria-labelledby="pipeline-heading"
        >
          <div className="border-b border-white/[0.07] p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2
                id="pipeline-heading"
                className="flex items-center gap-2 text-sm font-medium"
              >
                <GitCompareArrows size={16} className="text-[#a7c9b1]" />
                Analysis pipeline
              </h2>
              <span className="mono text-xs text-[#a4cbb1]">{percentage}%</span>
            </div>
            <div
              className="h-1 overflow-hidden rounded-full bg-white/[0.06]"
              role="progressbar"
              aria-label="Demo analysis progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percentage}
            >
              <div
                className="progress-line h-full rounded-full bg-[#9cdeb4]"
                style={{ width: `${percentage}%` }}
              />
            </div>
            <p
              className="mt-3 text-[11px] text-[#7f9587]"
              role="status"
              aria-live="polite"
            >
              {finished
                ? "Demo complete. The evidence report is ready."
                : paused
                  ? "Demo paused. Resume whenever you’re ready."
                  : `Stage ${completed + 1} of ${ANALYSIS_STAGES.length}: ${activeStage.label}`}
            </p>
          </div>
          <ol className="space-y-1 p-4">
            {ANALYSIS_STAGES.map((stage, index) => {
              const done = index < completed;
              const current = index === completed;
              return (
                <li
                  key={stage.id}
                  className={cn(
                    "flex items-start gap-3 rounded-md px-3 py-3",
                    current && "bg-[#92dca8]/[0.05]",
                  )}
                  aria-current={current ? "step" : undefined}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full",
                      done
                        ? "bg-[#a1d8b2]/10 text-[#a1d8b2]"
                        : current
                          ? "text-[#b8e7c6]"
                          : "text-[#4b5e51]",
                    )}
                  >
                    {done ? (
                      <Check size={12} />
                    ) : current && !paused ? (
                      <LoaderCircle size={16} className="animate-spin" />
                    ) : current ? (
                      <Pause size={14} />
                    ) : (
                      <Circle size={11} />
                    )}
                  </span>
                  <div className="min-w-0">
                    <p
                      className={cn(
                        "text-xs",
                        done
                          ? "text-[#a1b4a7]"
                          : current
                            ? "text-[#e0ece2]"
                            : "text-[#738579]",
                      )}
                    >
                      {stage.label}
                    </p>
                    {current && (
                      <p className="mt-1.5 text-[10px] leading-5 text-[#90a698]">
                        {stage.description}
                      </p>
                    )}
                  </div>
                  <span className="mono ml-auto pt-0.5 text-[8px] tracking-wider text-[#6f8879]">
                    {done
                      ? "SIMULATED"
                      : current
                        ? paused
                          ? "PAUSED"
                          : "ACTIVE"
                        : String(index + 1).padStart(2, "0")}
                  </span>
                </li>
              );
            })}
          </ol>
          <div className="flex items-center justify-between border-t border-white/[0.06] px-6 py-4">
            <span className="mono text-[9px] text-[#7d9485]">
              {completed} / {ANALYSIS_STAGES.length} STAGES COMPLETE
            </span>
            {finished ? (
              <Button variant="ghost" size="sm" onClick={replay}>
                <RotateCcw />
                Replay
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPaused(!paused)}
              >
                {paused ? <Play /> : <Pause />}
                {paused ? "Resume" : "Pause"}
              </Button>
            )}
          </div>
        </section>
        <div className="space-y-5">
          <section className="panel p-6" aria-labelledby="comparison-heading">
            <p id="comparison-heading" className="eyebrow mb-5">
              UNDER THE MICROSCOPE
            </p>
            <h2 className="flex items-center gap-2.5 text-xl font-medium">
              <Box size={20} className="text-[#9dc7ac]" />
              example-utils
            </h2>
            <div className="my-6 grid grid-cols-[1fr_20px_1fr] items-center gap-3">
              <div>
                <p className="mono mb-2 text-[8px] tracking-widest text-[#7f9c8a]">
                  TRUSTED
                </p>
                <p className="mono text-2xl text-[#c9dfd0]">1.4.1</p>
              </div>
              <ArrowRight size={15} className="text-[#587763]" />
              <div>
                <p className="mono mb-2 text-[8px] tracking-widest text-[#a9996e]">
                  CANDIDATE
                </p>
                <p className="mono text-2xl text-[#dacfaf]">1.4.2</p>
              </div>
            </div>
            <div className="space-y-3 border-t border-white/[0.07] pt-4 text-[11px] text-[#8ea395]">
              <div className="flex justify-between">
                <span>Analysis ID</span>
                <span className="mono text-[9px]">{id}</span>
              </div>
              <div className="flex justify-between">
                <span>Data source</span>
                <span className="text-[#b2c9b8]">
                  Bundled synthetic fixture
                </span>
              </div>
              <div className="flex justify-between">
                <span>Execution environment</span>
                <span>None · simulated</span>
              </div>
            </div>
          </section>
          <section
            className="panel overflow-hidden"
            aria-labelledby="log-heading"
          >
            <h2
              id="log-heading"
              className="flex items-center gap-2 border-b border-white/[0.06] px-5 py-4 text-[11px] text-[#a0b7a8]"
            >
              <Terminal size={14} />
              Demo event log
              <span className="mono ml-auto text-[8px] text-[#77927f]">
                REPLAY
              </span>
            </h2>
            <div className="min-h-40 space-y-3 bg-[#0e1510] p-5 mono text-[10px] leading-5">
              <p className="text-[#6f8e79]">[00.0] Synthetic fixture loaded</p>
              {ANALYSIS_STAGES.slice(0, completed)
                .slice(-4)
                .map((stage, index) => (
                  <p key={stage.id} className="flex gap-3">
                    <span className="shrink-0 text-[#506a58]">
                      [
                      {(
                        ((Math.max(0, completed - 4) + index + 1) *
                          DEMO_STAGE_DURATION) /
                        1000
                      )
                        .toFixed(1)
                        .padStart(4, "0")}
                      ]
                    </span>
                    <span className="text-[#95b49f]">
                      {stage.label}{" "}
                      <Check className="ml-1 inline size-3 text-[#a7ddb5]" />
                    </span>
                  </p>
                ))}
              {!finished && (
                <p className="text-[#bedcc7]">
                  {paused ? "Replay paused." : "> " + activeStage.description}
                </p>
              )}
              {finished && (
                <p className="text-[#b2eac3]">✓ All demo stages complete.</p>
              )}
            </div>
          </section>
          <section
            className={cn(
              "rounded-lg border p-5",
              finished
                ? "border-[#9addae]/30 bg-[#94dba8]/[0.06]"
                : "border-white/[0.07]",
            )}
          >
            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-[#c3d9ca]">
              {finished ? (
                <CheckCheck size={18} className="text-[#a4e1b7]" />
              ) : (
                <ShieldCheck size={17} />
              )}
              {finished
                ? "Your demo report is ready."
                : "Curious about the findings?"}
            </div>
            <p className="mb-5 text-xs leading-6 text-[#91a596]">
              Explore the synthetic evidence, behavioral differences, and
              reasoning behind the 82/100 demo risk score.
            </p>
            <Button
              asChild
              variant={finished ? "default" : "outline"}
              className="w-full"
            >
              <Link href={`/report/${id}`}>
                {finished ? "View evidence report" : "Skip to demo report"}
                <ArrowRight />
              </Link>
            </Button>
          </section>
        </div>
      </div>
    </div>
  );
}
