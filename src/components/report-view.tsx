import Link from "next/link";
import {
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Braces,
  Check,
  ChevronRight,
  CircleAlert,
  ExternalLink,
  FileCode2,
  FileText,
  FlaskConical,
  Globe2,
  Info,
  Layers3,
  LockKeyhole,
  Package,
  ShieldAlert,
  Sparkles,
  Terminal,
} from "lucide-react";
import type { ReactNode } from "react";

import type {
  AnalysisReport,
  FindingStatus,
  PackageMetadata,
} from "@/lib/types";

import { ReportActions } from "./report-actions";

const sections = [
  ["summary", "Executive summary"],
  ["versions", "Version comparison"],
  ["static", "Static changes"],
  ["behavior", "Behavioral diff"],
  ["network", "Network activity"],
  ["environment", "Environment access"],
  ["processes", "Process execution"],
  ["filesystem", "Filesystem changes"],
  ["dependencies", "Dependency changes"],
  ["evidence", "Evidence"],
  ["investigation", "AI investigation"],
  ["risk", "Risk score explanation"],
] as const;

function ReportSection({
  id,
  number,
  title,
  subtitle,
  trailing,
  children,
}: {
  id: string;
  number: number;
  title: string;
  subtitle?: string;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-title`} className="scroll-mt-24" id={id}>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            className="flex items-center gap-3 text-lg font-semibold tracking-tight text-zinc-100"
            id={`${id}-title`}
          >
            <span className="mono text-xs font-normal text-zinc-600">
              {String(number).padStart(2, "0")}
            </span>
            {title}
          </h2>
          {subtitle ? (
            <p className="mt-2 text-sm leading-6 text-zinc-400">{subtitle}</p>
          ) : null}
        </div>
        {trailing}
      </div>
      {children}
    </section>
  );
}

function FindingBadge({ status }: { status: FindingStatus }) {
  const tone =
    status === "NOT OBSERVED"
      ? "badge-neutral"
      : status === "OBSERVED"
        ? "badge-green"
        : "badge-orange";
  return (
    <span className={`badge ${tone} whitespace-nowrap !text-[10px]`}>
      {status}
    </span>
  );
}

function EvidenceLinks({ ids }: { ids: string[] }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {ids.map((id) => (
        <a
          className="mono inline-flex items-center gap-1 text-[11px] text-emerald-300 transition-colors hover:text-emerald-100 hover:underline"
          href={`#evidence-${id}`}
          key={id}
        >
          {id}
          <ArrowUpRight aria-hidden="true" size={11} />
        </a>
      ))}
    </span>
  );
}

function formatBytes(bytes: number) {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} kB`;
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(date));
}

function VersionCard({
  metadata,
  candidate,
}: {
  metadata: PackageMetadata;
  candidate?: boolean;
}) {
  const rows = [
    ["Published", formatDate(metadata.publishedAt)],
    ["License", metadata.license],
    ["Files", String(metadata.fileCount)],
    ["Unpacked size", formatBytes(metadata.unpackedSizeBytes)],
    ["Dependencies", String(Object.keys(metadata.dependencies).length)],
    ["Maintainers", metadata.maintainers.join(", ")],
  ];

  return (
    <div className={`panel p-5 ${candidate ? "!border-emerald-400/20" : ""}`}>
      <div className="mb-5 flex items-center justify-between">
        <span className="eyebrow">
          {candidate ? "CANDIDATE RELEASE" : "TRUSTED BASELINE"}
        </span>
        <Package
          aria-hidden="true"
          className={candidate ? "text-emerald-300" : "text-zinc-500"}
          size={18}
        />
      </div>
      <p className="mono mb-5 text-3xl tracking-tight text-zinc-100">
        v{metadata.version}
      </p>
      <dl className="space-y-3">
        {rows.map(([label, value]) => (
          <div
            className="flex items-start justify-between gap-4 text-xs"
            key={label}
          >
            <dt className="shrink-0 text-zinc-500">{label}</dt>
            <dd className="mono break-all text-right text-zinc-300">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-5 border-t border-white/[0.07] pt-4">
        <p className="mb-2 text-xs text-zinc-500">Lifecycle scripts</p>
        {Object.keys(metadata.scripts).length ? (
          Object.entries(metadata.scripts).map(([name, value]) => (
            <p
              className="mono break-all text-[11px] leading-5 text-orange-200"
              key={name}
            >
              {name}: {value}
            </p>
          ))
        ) : (
          <p className="mono text-[11px] text-zinc-400">None</p>
        )}
      </div>
    </div>
  );
}

export function ReportView({ report }: { report: AnalysisReport }) {
  const candidateWrites = report.filesystemEvents.filter(
    (event) => event.release === "candidate",
  );
  const baselineWrites = report.filesystemEvents.filter(
    (event) => event.release === "trusted",
  );

  return (
    <div className="mx-auto max-w-[1240px] px-5 pb-24 pt-8 sm:px-8">
      <div className="mb-7 flex flex-wrap items-center justify-between gap-4">
        <Link
          className="inline-flex items-center gap-2 text-xs text-zinc-400 transition-colors hover:text-zinc-100 print:hidden"
          href="/"
        >
          <ArrowLeft aria-hidden="true" size={14} />
          New comparison
        </Link>
        <p className="mono flex items-center gap-2 text-[11px] text-zinc-500">
          <span>ANALYSIS</span>
          <ChevronRight aria-hidden="true" size={12} />
          <span className="text-zinc-300">{report.id}</span>
        </p>
      </div>

      <div className="mb-7 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow mb-3">DEPENDENCY INTELLIGENCE REPORT</p>
          <h1 className="flex flex-wrap items-center gap-x-3 gap-y-2 text-3xl font-semibold tracking-[-0.04em] text-zinc-100 sm:text-4xl">
            {report.packageName}
            <span className="badge badge-neutral !text-[10px] !tracking-wide">
              SYNTHETIC PACKAGE
            </span>
          </h1>
          <p className="mono mt-3 flex items-center gap-3 text-sm text-zinc-400">
            <span>v{report.trustedVersion}</span>
            <ArrowRight aria-hidden="true" size={15} />
            <span className="text-zinc-200">v{report.candidateVersion}</span>
            <span className="text-zinc-700">/</span>
            <span className="text-[11px]">
              {formatDate(report.generatedAt)}
            </span>
          </p>
        </div>
        <ReportActions report={report} />
      </div>

      <div
        className="mb-7 flex items-start gap-3 rounded-lg border border-emerald-300/15 bg-emerald-300/[0.04] px-4 py-3 text-xs leading-5 text-zinc-400"
        role="note"
      >
        <FlaskConical
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-emerald-300"
          size={16}
        />
        <p>
          <strong className="font-medium text-emerald-200">Demo report.</strong>{" "}
          All package names, changes, runtime events, and evidence below are
          synthetic. No package was downloaded or executed, and no AI model was
          called.
        </p>
      </div>

      <div className="mb-9 grid overflow-hidden rounded-xl border border-orange-300/20 bg-[linear-gradient(115deg,rgba(251,146,60,0.07),rgba(251,146,60,0.01)_60%)] md:grid-cols-[1fr_240px]">
        <div className="p-6 sm:p-7">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-lg border border-orange-300/20 bg-orange-300/10 text-orange-300">
              <ShieldAlert aria-hidden="true" size={19} />
            </span>
            <span className="eyebrow !text-orange-200">
              {report.reviewAction}
            </span>
            <span className="badge badge-orange !text-[10px]">
              {report.status}
            </span>
          </div>
          <h2 className="mb-3 text-2xl font-semibold tracking-tight text-zinc-100">
            This update deserves a closer look.
          </h2>
          <p className="max-w-2xl text-sm leading-7 text-zinc-400">
            The candidate introduces capabilities absent from the trusted
            baseline. Review the supporting evidence before approving this
            synthetic update.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {report.newBehaviors.map((behavior) => (
              <span
                className="inline-flex items-center gap-1.5 rounded-md border border-orange-300/15 bg-orange-200/[0.04] px-2.5 py-1.5 text-[11px] text-orange-200/90"
                key={behavior}
              >
                <span className="size-1 rounded-full bg-orange-300" />
                {behavior}
              </span>
            ))}
          </div>
        </div>
        <div className="flex flex-col items-center justify-center gap-3 border-t border-orange-300/10 bg-black/10 px-7 py-6 md:border-l md:border-t-0">
          <div
            aria-label={`Risk score: ${report.riskScore} out of 100`}
            className="relative flex size-28 items-center justify-center"
            role="img"
          >
            <svg
              aria-hidden="true"
              className="absolute inset-0 size-full -rotate-90"
              viewBox="0 0 120 120"
            >
              <circle
                cx="60"
                cy="60"
                fill="none"
                r="52"
                stroke="rgba(253,186,116,0.10)"
                strokeWidth="5"
              />
              <circle
                cx="60"
                cy="60"
                fill="none"
                r="52"
                stroke="#fdba74"
                strokeDasharray={`${(report.riskScore / 100) * 326.73} 326.73`}
                strokeLinecap="round"
                strokeWidth="5"
              />
            </svg>
            <div className="text-center">
              <span className="mono text-4xl font-medium tracking-tight text-orange-200">
                {report.riskScore}
              </span>
              <span className="mono mt-0.5 block text-[10px] text-zinc-500">
                OUT OF 100
              </span>
            </div>
          </div>
          <span className="eyebrow !text-[10px]">DEMO RISK SCORE</span>
          <a
            className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200"
            href="#risk"
          >
            How is this calculated?
            <ArrowDownRight aria-hidden="true" size={12} />
          </a>
        </div>
      </div>

      <div className="mb-10 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {report.behaviorComparisons.map((comparison) => (
          <a
            className="panel group block p-4 transition-colors hover:!border-white/20"
            href="#behavior"
            key={comparison.id}
          >
            <span className="mb-3 block text-[11px] text-zinc-400">
              {comparison.label}
            </span>
            <span className="mono flex items-center gap-3">
              <span className="text-xl text-zinc-500">
                {comparison.oldValue}
              </span>
              <ArrowRight
                aria-hidden="true"
                className="text-zinc-600"
                size={15}
              />
              <span className="text-xl text-emerald-200">
                {comparison.newValue}
              </span>
            </span>
          </a>
        ))}
      </div>

      <div className="grid gap-10 lg:grid-cols-[180px_minmax(0,1fr)] lg:gap-12">
        <aside className="hidden lg:block print:hidden">
          <nav aria-label="Report sections" className="sticky top-24">
            <p className="eyebrow mb-5 !text-[10px]">IN THIS REPORT</p>
            <ol className="space-y-1 border-l border-white/10">
              {sections.map(([id, title], index) => (
                <li key={id}>
                  <a
                    className="-ml-px flex gap-2.5 border-l border-transparent py-2 pl-3 text-[11px] leading-4 text-zinc-500 transition-colors hover:border-emerald-300 hover:text-emerald-200"
                    href={`#${id}`}
                  >
                    <span className="mono text-zinc-600">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    {title}
                  </a>
                </li>
              ))}
            </ol>
            <div className="mt-7 rounded-lg border border-white/[0.07] p-3">
              <LockKeyhole
                aria-hidden="true"
                className="mb-2 text-zinc-500"
                size={15}
              />
              <p className="text-[11px] leading-5 text-zinc-500">
                Evidence first.
                <br />A risk signal is a reason to investigate, not proof of
                intent.
              </p>
            </div>
          </nav>
        </aside>

        <div className="min-w-0 space-y-12">
          <ReportSection id="summary" number={1} title="Executive summary">
            <div className="panel p-5 sm:p-6">
              <p className="text-sm leading-7 text-zinc-300">
                {report.summary}
              </p>
              <div className="mt-5 flex items-start gap-2.5 border-t border-white/[0.07] pt-4">
                <Info
                  aria-hidden="true"
                  className="mt-0.5 shrink-0 text-zinc-500"
                  size={15}
                />
                <p className="text-xs leading-6 text-zinc-500">
                  Observed behavior describes this authored demo trace. It does
                  not establish intent, data exfiltration, or a conclusion about
                  any real package.
                </p>
              </div>
            </div>
          </ReportSection>

          <ReportSection
            id="versions"
            number={2}
            subtitle="A side-by-side view of the synthetic release metadata."
            title="Version comparison"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <VersionCard metadata={report.metadata.trusted} />
              <VersionCard candidate metadata={report.metadata.candidate} />
            </div>
          </ReportSection>

          <ReportSection
            id="static"
            number={3}
            subtitle="Security-relevant source changes that warrant inspection."
            title="Static changes"
            trailing={
              <span className="badge badge-neutral">
                {report.staticFindings.length} findings
              </span>
            }
          >
            <div className="space-y-3">
              {report.staticFindings.map((finding) => (
                <article className="panel overflow-hidden" key={finding.id}>
                  <div className="p-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h3 className="flex items-center gap-2 text-sm font-medium text-zinc-200">
                        <FileCode2
                          aria-hidden="true"
                          className="shrink-0 text-zinc-500"
                          size={16}
                        />
                        {finding.title}
                      </h3>
                      <FindingBadge status={finding.status} />
                    </div>
                    <p className="mb-3 mt-3 text-xs leading-6 text-zinc-400">
                      {finding.description}
                    </p>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <span className="mono text-[11px] text-zinc-500">
                        {finding.file}:{finding.line}
                      </span>
                      <EvidenceLinks ids={finding.evidenceIds} />
                    </div>
                  </div>
                  <div className="overflow-x-auto border-t border-white/[0.06] bg-black/15 px-5 py-3">
                    <pre className="mono text-[11px] leading-6">
                      <code>
                        <span className="block text-zinc-500">
                          {finding.oldCode
                            ? `− ${finding.oldCode}`
                            : "  // Not present in the trusted version"}
                        </span>
                        <span className="block text-emerald-200/90">
                          + {finding.newCode}
                        </span>
                      </code>
                    </pre>
                  </div>
                </article>
              ))}
            </div>
          </ReportSection>

          <ReportSection
            id="behavior"
            number={4}
            subtitle="What the candidate does differently in the synthetic trace."
            title="Behavioral diff"
            trailing={
              <span className="badge badge-green">DIFFERENTIAL VIEW</span>
            }
          >
            <div className="panel table-wrap">
              <table className="data-table w-full text-left text-xs">
                <caption className="sr-only">
                  Behavior counts in trusted and candidate releases
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Behavior</th>
                    <th scope="col">Old</th>
                    <th scope="col">New</th>
                    <th scope="col">Delta</th>
                    <th scope="col">Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {report.behaviorComparisons.map((comparison) => (
                    <tr key={comparison.id}>
                      <th className="font-normal !text-zinc-300" scope="row">
                        {comparison.label}
                      </th>
                      <td className="mono text-zinc-500">
                        {comparison.oldValue}
                      </td>
                      <td className="mono !text-emerald-200">
                        {comparison.newValue}
                      </td>
                      <td>
                        <span className="mono rounded bg-orange-300/10 px-2 py-1 text-[11px] text-orange-200">
                          +{comparison.newValue - comparison.oldValue}
                        </span>
                      </td>
                      <td>
                        <EvidenceLinks ids={comparison.evidenceIds} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-[11px] leading-5 text-zinc-500">
              Counts compare the same authored scenario for each release. A zero
              means the behavior is absent from this demo trace.
            </p>
          </ReportSection>

          <ReportSection
            id="network"
            number={5}
            subtitle="New outbound destinations introduced by the candidate release."
            title="Network activity"
            trailing={
              <span className="badge badge-orange">
                {report.networkEvents.length} new requests
              </span>
            }
          >
            <div className="space-y-3">
              {report.networkEvents.map((event) => (
                <article className="panel p-5" key={event.id}>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2">
                      <Globe2
                        aria-hidden="true"
                        className="shrink-0 text-zinc-500"
                        size={16}
                      />
                      <span className="mono rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-zinc-300">
                        {event.method}
                      </span>
                      <span className="mono break-all text-xs text-zinc-200">
                        {event.host}
                      </span>
                    </span>
                    <FindingBadge status={event.status} />
                  </div>
                  <p className="mono mb-3 break-all text-[11px] leading-5 text-zinc-500">
                    {event.url}
                  </p>
                  <p className="text-xs leading-6 text-zinc-400">
                    {event.summary}
                  </p>
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.07] pt-3">
                    <span className="mono text-[10px] text-zinc-500">
                      {event.protocol}:{event.port} ·{" "}
                      {formatBytes(event.bytesSent)} sent ·{" "}
                      {formatBytes(event.bytesReceived)} received · +
                      {event.timestampMs} ms
                    </span>
                    <EvidenceLinks ids={event.evidenceIds} />
                  </div>
                </article>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-zinc-500">
              Reserved .invalid destinations. No network requests were made.
            </p>
          </ReportSection>

          <ReportSection
            id="environment"
            number={6}
            subtitle="Sensitive variable names accessed in the candidate's authored trace."
            title="Environment-variable access"
          >
            <div className="panel table-wrap">
              <table className="data-table w-full text-left text-xs">
                <caption className="sr-only">
                  Synthetic environment variable reads
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Variable</th>
                    <th scope="col">Call site</th>
                    <th scope="col">Status</th>
                    <th scope="col">Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {report.environmentAccesses.map((event) => (
                    <tr key={event.id}>
                      <th
                        className="mono font-normal !text-zinc-200"
                        scope="row"
                      >
                        {event.variable}
                        <span className="mt-1 block text-[9px] text-zinc-600">
                          SYNTHETIC VALUE REDACTED
                        </span>
                      </th>
                      <td className="mono text-[10px]">{event.callsite}</td>
                      <td>
                        <FindingBadge status={event.status} />
                      </td>
                      <td>
                        <EvidenceLinks ids={event.evidenceIds} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex items-start gap-2 text-[11px] leading-5 text-zinc-500">
              <LockKeyhole
                aria-hidden="true"
                className="mt-0.5 shrink-0"
                size={13}
              />
              <p>
                All values are fabricated and redacted. Variable access alone
                does not prove that a value was transmitted.
              </p>
            </div>
          </ReportSection>

          <ReportSection
            id="processes"
            number={7}
            subtitle="A new child process appears in the candidate release trace."
            title="Process execution"
          >
            <div className="space-y-3">
              {report.processEvents.map((event) => (
                <article className="panel overflow-hidden" key={event.id}>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] px-5 py-3">
                    <span className="flex items-center gap-2 text-xs text-zinc-400">
                      <Terminal aria-hidden="true" size={15} />
                      Synthetic process trace
                    </span>
                    <FindingBadge status={event.status} />
                  </div>
                  <div className="p-5">
                    <p className="mono mb-3 text-[11px] text-zinc-500">
                      {event.parent}
                      <span className="mx-2 text-zinc-700">→</span>
                      {event.executable}
                    </p>
                    <pre className="mono overflow-x-auto rounded-md border border-white/[0.06] bg-black/20 p-4 text-xs leading-6 text-emerald-200">
                      <code>
                        {event.executable} {event.args.join(" ")}
                      </code>
                    </pre>
                    <p className="mt-4 text-xs leading-6 text-zinc-400">
                      {event.summary}
                    </p>
                    <div className="mt-4 flex items-center justify-between gap-3">
                      <span className="mono text-[10px] text-zinc-500">
                        SIMULATED · exit {event.exitCode} · +{event.timestampMs}{" "}
                        ms
                      </span>
                      <EvidenceLinks ids={event.evidenceIds} />
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </ReportSection>

          <ReportSection
            id="filesystem"
            number={8}
            subtitle={`${baselineWrites.length} baseline writes → ${candidateWrites.length} candidate writes in the synthetic scenario.`}
            title="Filesystem changes"
          >
            <div className="panel table-wrap">
              <table className="data-table w-full text-left text-xs">
                <caption className="sr-only">
                  Synthetic filesystem write events for both releases
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Path</th>
                    <th scope="col">Release</th>
                    <th scope="col">Size</th>
                    <th scope="col">Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {report.filesystemEvents.map((event) => (
                    <tr key={event.id}>
                      <th
                        className="mono font-normal !text-zinc-300"
                        scope="row"
                      >
                        {event.path}
                        <span className="mt-1 block font-sans text-[10px] text-zinc-600">
                          {event.scope} · {event.operation}
                        </span>
                      </th>
                      <td>
                        <span
                          className={
                            event.release === "candidate"
                              ? "text-emerald-200"
                              : "text-zinc-500"
                          }
                        >
                          {event.release}
                        </span>
                      </td>
                      <td className="mono whitespace-nowrap">
                        {formatBytes(event.bytes)}
                      </td>
                      <td>
                        <EvidenceLinks ids={event.evidenceIds} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ReportSection>

          <ReportSection
            id="dependencies"
            number={9}
            subtitle="Changes to the release's declared dependency graph."
            title="Dependency changes"
          >
            {report.dependencyChanges.map((dependency) => (
              <article className="panel p-5" key={dependency.name}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="mono flex items-center gap-2 text-sm text-zinc-200">
                    <Layers3
                      aria-hidden="true"
                      className="text-zinc-500"
                      size={16}
                    />
                    {dependency.name}
                  </h3>
                  <span className="badge badge-green">
                    {dependency.change.toUpperCase()}
                  </span>
                </div>
                <div className="mono my-4 flex items-center gap-3 text-xs">
                  <span className="text-zinc-500">
                    {dependency.oldVersion ?? "not present"}
                  </span>
                  <ArrowRight
                    aria-hidden="true"
                    className="text-zinc-600"
                    size={13}
                  />
                  <span className="text-emerald-200">
                    {dependency.newVersion ?? "removed"}
                  </span>
                  <span className="text-zinc-600">· {dependency.kind}</span>
                </div>
                <p className="mb-4 text-xs leading-6 text-zinc-400">
                  {dependency.description}
                </p>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <FindingBadge status={dependency.status} />
                  <EvidenceLinks ids={dependency.evidenceIds} />
                </div>
              </article>
            ))}
          </ReportSection>

          <ReportSection
            id="evidence"
            number={10}
            subtitle="Every finding links back to inspectable, authored demo evidence."
            title="Evidence"
            trailing={
              <span className="badge badge-neutral">
                {report.evidence.length} artifacts
              </span>
            }
          >
            <div className="space-y-3">
              {report.evidence.map((evidence) => (
                <article
                  className="panel scroll-mt-24 overflow-hidden target:!border-emerald-300/60"
                  id={`evidence-${evidence.id}`}
                  key={evidence.id}
                >
                  <div className="p-5">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="mono rounded border border-white/10 bg-white/[0.03] px-2 py-1 text-[10px] text-emerald-200">
                        {evidence.id}
                      </span>
                      <h3 className="text-sm font-medium text-zinc-200">
                        {evidence.title}
                      </h3>
                      <span className="ml-auto text-[10px] text-zinc-500">
                        {evidence.kind}
                      </span>
                    </div>
                    <p className="mono mt-3 flex items-start gap-2 break-all text-[10px] leading-5 text-zinc-500">
                      <FileText
                        aria-hidden="true"
                        className="mt-0.5 shrink-0"
                        size={12}
                      />
                      {evidence.location}
                    </p>
                  </div>
                  <pre className="mono max-h-72 overflow-auto border-y border-white/[0.06] bg-black/20 px-5 py-4 text-[11px] leading-6 text-zinc-300">
                    <code>{evidence.excerpt}</code>
                  </pre>
                  <p className="px-5 py-4 text-xs leading-6 text-zinc-400">
                    {evidence.interpretation}
                  </p>
                </article>
              ))}
            </div>
          </ReportSection>

          <ReportSection
            id="investigation"
            number={11}
            subtitle="A preview of how evidence-backed explanations will be presented."
            title="AI investigation summary"
            trailing={
              <span className="badge badge-neutral">AUTHORED DEMO</span>
            }
          >
            <div className="panel !border-emerald-300/15 p-5 sm:p-6">
              <div className="mb-5 flex items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-300/10 text-emerald-200">
                  <Sparkles aria-hidden="true" size={17} />
                </span>
                <div>
                  <h3 className="text-sm font-medium text-zinc-200">
                    {report.aiInvestigation.title}
                  </h3>
                  <p className="mt-1.5 text-[11px] leading-5 text-zinc-500">
                    Prerecorded synthetic explanation. No model or AI service
                    was called.
                  </p>
                </div>
              </div>
              <p className="text-sm leading-7 text-zinc-300">
                {report.aiInvestigation.summary}
              </p>
              <div className="mt-6 grid gap-6 sm:grid-cols-2">
                <div>
                  <h4 className="eyebrow mb-3 !text-[10px]">
                    EVIDENCE SUPPORTS
                  </h4>
                  <ul className="space-y-3">
                    {report.aiInvestigation.observations.map((observation) => (
                      <li
                        className="flex items-start gap-2 text-xs leading-6 text-zinc-400"
                        key={observation}
                      >
                        <Check
                          aria-hidden="true"
                          className="mt-1 shrink-0 text-emerald-300"
                          size={13}
                        />
                        {observation}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4 className="eyebrow mb-3 !text-[10px]">
                    UNVERIFIED HYPOTHESES
                  </h4>
                  <ul className="space-y-3">
                    {report.aiInvestigation.hypotheses.map((hypothesis) => (
                      <li
                        className="flex items-start gap-2 text-xs leading-6 text-zinc-400"
                        key={hypothesis}
                      >
                        <CircleAlert
                          aria-hidden="true"
                          className="mt-1 shrink-0 text-orange-300"
                          size={13}
                        />
                        {hypothesis}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              <div className="mt-6 border-t border-white/[0.07] pt-5">
                <h4 className="eyebrow mb-3 !text-[10px]">
                  SUGGESTED REVIEW STEPS
                </h4>
                <ol className="space-y-2">
                  {report.aiInvestigation.recommendedActions.map(
                    (action, index) => (
                      <li
                        className="flex gap-3 text-xs leading-6 text-zinc-400"
                        key={action}
                      >
                        <span className="mono text-zinc-600">{index + 1}.</span>
                        {action}
                      </li>
                    ),
                  )}
                </ol>
              </div>
              <p className="mono mt-5 text-[10px] text-zinc-500">
                CONFIDENCE: {report.aiInvestigation.confidence.toUpperCase()}
              </p>
            </div>
          </ReportSection>

          <ReportSection
            id="risk"
            number={12}
            subtitle="A transparent, additive demo rubric. This score is not a probability of harm."
            title="Risk score explanation"
          >
            <div className="panel overflow-hidden">
              {report.riskSignals.map((signal) => (
                <div
                  className="flex gap-4 border-b border-white/[0.07] p-5 last:border-b-0"
                  key={signal.id}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-3">
                      <h3 className="text-xs font-medium text-zinc-200">
                        {signal.title}
                      </h3>
                      <FindingBadge status={signal.status} />
                    </div>
                    <p className="mb-3 mt-2 text-xs leading-6 text-zinc-500">
                      {signal.description}
                    </p>
                    <EvidenceLinks ids={signal.evidenceIds} />
                  </div>
                  <span className="mono shrink-0 pt-1 text-lg text-orange-200">
                    +{signal.points}
                  </span>
                </div>
              ))}
              <div className="flex items-center justify-between border-t border-orange-300/15 bg-orange-300/[0.04] px-5 py-4">
                <span className="text-xs font-medium text-zinc-300">
                  Combined demo risk score
                </span>
                <span className="mono text-lg text-orange-200">
                  {report.riskScore}
                  <span className="text-xs text-zinc-500"> / 100</span>
                </span>
              </div>
            </div>
            <div className="mt-5 rounded-lg border border-white/[0.07] p-5">
              <h3 className="mb-3 flex items-center gap-2 text-xs font-medium text-zinc-300">
                <Info aria-hidden="true" size={14} />
                Scope & limitations
              </h3>
              <ul className="space-y-2">
                {report.limitations.map((limitation) => (
                  <li
                    className="flex gap-2 text-[11px] leading-6 text-zinc-500"
                    key={limitation}
                  >
                    <span aria-hidden="true">·</span>
                    {limitation}
                  </li>
                ))}
              </ul>
            </div>
          </ReportSection>

          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-white/[0.07] pt-6 print:hidden">
            <span className="flex items-center gap-2 text-[11px] text-zinc-500">
              <Braces aria-hidden="true" size={15} />
              Built for evidence. Designed for review.
            </span>
            <Link
              className="inline-flex items-center gap-2 text-xs text-emerald-200 hover:text-emerald-100"
              href="/"
            >
              Compare another release
              <ExternalLink aria-hidden="true" size={13} />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
