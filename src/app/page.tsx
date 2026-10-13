import Link from "next/link";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Box,
  Fingerprint,
  GitCompareArrows,
  Layers3,
  ScanLine,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { ComparisonForm } from "@/components/comparison-form";
import { ReleaseVisual } from "@/components/release-visual";
import { demoMode, staticAnalysisEnabled } from "@/lib/config";
import { RecentAnalyses } from "@/components/recent-analyses";

export const dynamic = "force-dynamic";

const stages = [
  {
    n: "01",
    icon: GitCompareArrows,
    label: "COMPARE",
    title: "Look beyond the changelog.",
    description:
      "Compare package contents and metadata. See the files, scripts, and dependencies that changed.",
    footer: "CONTENTS + METADATA",
  },
  {
    n: "02",
    icon: ScanLine,
    label: "DETONATE",
    title: "Observe the difference.",
    description:
      "The planned sandbox will run both releases in isolated environments to capture what they actually do.",
    footer: "ISOLATED EXECUTION · NOT ENABLED",
  },
  {
    n: "03",
    icon: Fingerprint,
    label: "VERIFY",
    title: "Follow the evidence.",
    description:
      "Understand security-relevant behavioral differences with traceable findings and a clear risk explanation.",
    footer: "BEHAVIOR + CONTEXT",
  },
];

export default function Home() {
  return (
    <div className="home-container">
      <section className="hero-section" aria-labelledby="hero-heading">
        <div className="hero-copy">
          <div className="eyebrow mb-6 flex items-center gap-2">
            <span className="h-px w-6 bg-[#8acba4]" />
            DEPENDENCYGUARD <span className="text-[#5b7163]">/</span> TRUST,
            VERIFIED.
          </div>
          <h1 id="hero-heading">
            Know what changed
            <br />
            before you{" "}
            <span>
              trust
              <br className="hidden lg:block" /> the update.
            </span>
          </h1>
          <p className="hero-description">
            Compare npm releases, observe behavioral changes, and investigate
            suspicious dependency updates before they reach your machine or CI
            pipeline.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-[#94a59a]">
            <span className="flex items-center gap-1.5">
              <GitCompareArrows size={13} className="text-[#80b995]" />
              Version-to-version insight
            </span>
            <span className="flex items-center gap-1.5">
              <ShieldCheck size={13} className="text-[#80b995]" />
              Evidence-backed findings
            </span>
          </div>
        </div>
        <div className="hero-art">
          <div className="visual-orbit" aria-hidden="true" />
          <ReleaseVisual />
          <div className="visual-caption">
            <span className="size-1 rounded-full bg-[#85b795]" /> A version
            number tells you what’s new. We help you see what’s different.
          </div>
        </div>
      </section>
      <ComparisonForm
        enabled={demoMode}
        staticEnabled={staticAnalysisEnabled}
      />
      {staticAnalysisEnabled && <RecentAnalyses />}
      <section
        id="how-it-works"
        className="scroll-mt-24 pt-16"
        aria-labelledby="workflow-heading"
      >
        <div className="mb-7 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow mb-3">A DIFFERENT KIND OF DEPENDENCY CHECK</p>
            <h2
              id="workflow-heading"
              className="text-[27px] font-medium tracking-[-0.8px]"
            >
              Less guessing. More understanding.
            </h2>
          </div>
          <p className="flex items-center gap-2 pb-1 text-[11px] text-[#7f9185]">
            From release to reason
            <ArrowRight size={13} />
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {stages.map(
            ({ n, icon: Icon, label, title, description, footer }) => (
              <article key={n} className="stage-card group">
                <div className="mb-6 flex items-center justify-between">
                  <span className="stage-icon">
                    <Icon size={22} strokeWidth={1.5} />
                  </span>
                  <span className="mono text-[11px] text-[#52665a]">/{n}</span>
                </div>
                <p className="mono mb-2 text-[10px] tracking-[1.8px] text-[#9ad2ad]">
                  {label}
                </p>
                <h3 className="mb-3 text-[17px] font-medium tracking-tight">
                  {title}
                </h3>
                <p className="min-h-16 text-[12px] leading-6 text-[#8c9d91]">
                  {description}
                </p>
                <div className="mono mt-7 flex items-center gap-2 border-t border-white/[0.06] pt-4 text-[8px] tracking-[1px] text-[#819589]">
                  <span className="h-1 w-1 rounded-full bg-[#7fac8f]" />
                  {footer}
                </div>
              </article>
            ),
          )}
        </div>
      </section>
      <section className="py-12" aria-labelledby="demo-heading">
        <div className="mb-5 flex items-center justify-between">
          <h2
            id="demo-heading"
            className="flex items-center gap-2 text-sm font-medium"
          >
            <Layers3 size={16} className="text-[#8caa96]" />
            See what a report reveals
          </h2>
          <span className="mono text-[9px] text-[#7b8c80]">
            01 SYNTHETIC EXAMPLE
          </span>
        </div>
        <div className="demo-report-row">
          <span className="icon-well hidden sm:flex">
            <Box size={20} />
          </span>
          <div>
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium">example-utils</span>
              <span className="badge badge-neutral">DEMO</span>
            </div>
            <p className="mono mt-1.5 text-[11px] text-[#8b9c90]">
              1.4.1 <span className="mx-1 text-[#59705f]">→</span> 1.4.2
            </p>
          </div>
          <div className="hidden border-l border-white/[0.08] pl-6 text-xs leading-6 text-[#9aa99e] md:block">
            A small release. Three new behaviors.
            <br />
            <span className="text-[#62786a]">
              Network activity, environment reads, process execution.
            </span>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-5">
            <span className="badge badge-orange">
              <span className="size-1 rounded-full bg-current" />
              REVIEW REQUIRED
            </span>
            {demoMode && (
              <Link
                href="/report/demo-example-utils"
                className="group inline-flex items-center gap-2 text-xs font-medium text-[#b6dcc1]"
              >
                Explore report
                <ArrowUpRight
                  size={15}
                  className="transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                />
              </Link>
            )}
          </div>
        </div>
      </section>
      <div className="mb-12 flex flex-col items-center justify-between gap-3 border-t border-white/[0.05] pt-7 text-[11px] text-[#788c7d] sm:flex-row">
        <span className="flex items-center gap-2">
          <Sparkles size={13} />
          Built for a world where an update deserves a closer look.
        </span>
        <Link
          href="#compare"
          className="inline-flex items-center gap-2 hover:text-[#b6dcc1]"
        >
          Start a comparison <ArrowDown size={12} className="rotate-180" />
        </Link>
      </div>
    </div>
  );
}
