import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CircleAlert,
  FileSearch,
  Fingerprint,
  LockKeyhole,
  Package,
} from "lucide-react";
import type { StaticAnalysisReport } from "@/lib/types/static-analysis";
import { StaticReportActions } from "@/components/static-report-actions";
import { RuntimeReportPanel } from "@/components/runtime-report-panel";
import type { RuntimeEvidenceState } from "@/lib/runtime/contracts";

const navigation = [
  ["overview", "Executive summary"],
  ["releases", "Release metadata"],
  ["files", "File changes"],
  ["manifest", "Manifest changes"],
  ["signals", "Static findings"],
  ["evidence", "Source evidence"],
  ["coverage", "Scan coverage"],
  ["assessment", "Assessment limits"],
  ["runtime", "Runtime probe evidence"],
] as const;

const categoryLabels = {
  network: "Network APIs",
  environment: "Environment access",
  process: "Process execution",
  filesystem: "Filesystem APIs",
  "dynamic-code": "Dynamic code",
  lifecycle: "Lifecycle scripts",
  metadata: "Package metadata",
};

function bytes(value: number) {
  return value < 1024
    ? `${value} B`
    : value < 1024 * 1024
      ? `${(value / 1024).toFixed(1)} kB`
      : `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function Section({
  id,
  number,
  title,
  description,
  children,
}: {
  id: string;
  number: number;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24" aria-labelledby={`${id}-heading`}>
      <div className="mb-5">
        <h2
          id={`${id}-heading`}
          className="flex items-center gap-3 text-lg font-semibold tracking-tight"
        >
          <span className="mono text-xs font-normal text-[#728479]">
            {String(number).padStart(2, "0")}
          </span>
          {title}
        </h2>
        {description && (
          <p className="mt-2 text-sm leading-6 text-[#98aa9e]">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}

function EvidenceLinks({ ids }: { ids: string[] }) {
  return (
    <span className="inline-flex flex-wrap gap-3">
      {ids.map((id) => (
        <a
          key={id}
          href={`#source-${encodeURIComponent(id)}`}
          className="mono inline-flex items-center gap-1 text-xs text-[#a9dbb9] hover:underline"
        >
          {id}
          <ArrowUpRight size={12} aria-hidden="true" />
        </a>
      ))}
    </span>
  );
}

function ReleaseCard({
  release,
  candidate,
}: {
  release: StaticAnalysisReport["releases"]["trusted"];
  candidate?: boolean;
}) {
  const metadata = release.release;
  return (
    <article
      className={`panel min-w-0 p-5 ${candidate ? "!border-[#91d6a8]/25" : ""}`}
    >
      <div className="mb-4 flex items-center justify-between">
        <p className="eyebrow">
          {candidate ? "CANDIDATE RELEASE" : "TRUSTED BASELINE"}
        </p>
        <Package size={17} className="text-[#9ac5a8]" />
      </div>
      <h3 className="mono mb-2 break-all text-2xl">{metadata.version}</h3>
      <p className="mb-5 break-words text-xs leading-6 text-[#9bada1]">
        {metadata.description || "No registry description supplied."}
      </p>
      <dl className="space-y-3 text-xs">
        {[
          ["License", metadata.license || "Not supplied"],
          ["Archive files", release.fileCount.toLocaleString("en-US")],
          ["Archive size", bytes(release.compressedBytes)],
          ["Unpacked size", bytes(release.unpackedBytes)],
          [
            "Registry dependencies",
            String(Object.keys(metadata.dependencies).length),
          ],
        ].map(([label, value]) => (
          <div className="flex justify-between gap-4" key={label}>
            <dt className="text-[#93a699]">{label}</dt>
            <dd className="min-w-0 break-all text-right text-[#c7d8cd]">
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-5 border-t border-white/[0.07] pt-4">
        <p className="mb-2 flex items-center gap-2 text-xs text-[#a8d8b6]">
          <Fingerprint size={14} /> Archive integrity verified ·{" "}
          {release.integrityVerified.toUpperCase()}
        </p>
        <details className="mt-4 text-xs">
          <summary className="cursor-pointer text-[#a0b2a6] hover:text-[#d1e2d6]">
            Full hashes &amp; registry source
          </summary>
          <dl className="mt-4 space-y-4 text-[10px] leading-5">
            {[
              ["Downloaded archive SHA-256", release.archiveSha256],
              ["Registry integrity", metadata.integrity ?? "Not supplied"],
              ["Registry SHA-1", metadata.shasum ?? "Not supplied"],
              ["Registry tarball URL", metadata.tarballUrl],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="mb-1 text-[#8fa798]">{label}</dt>
                <dd className="mono break-all text-[#c3d2c8]">{value}</dd>
              </div>
            ))}
          </dl>
        </details>
      </div>
      {metadata.deprecated && (
        <p className="mt-4 break-words rounded border border-orange-300/15 bg-orange-200/[0.03] p-3 text-xs leading-6 text-orange-200">
          Registry deprecation notice: {metadata.deprecated}
        </p>
      )}
      {release.warnings.length > 0 && (
        <ul className="mt-4 space-y-2 text-xs leading-6 text-orange-200">
          {release.warnings.map((warning, index) => (
            <li key={index}>{warning}</li>
          ))}
        </ul>
      )}
    </article>
  );
}

export function StaticReportView({
  report,
  runtimeEvidence,
}: {
  report: StaticAnalysisReport;
  runtimeEvidence?: RuntimeEvidenceState;
}) {
  const fileCounts = { added: 0, modified: 0, removed: 0 };
  for (const file of report.fileChanges) fileCounts[file.change] += 1;
  const dependencyChanges = report.manifestChanges.filter(
    (change) => change.kind !== "script",
  ).length;

  return (
    <div className="mx-auto max-w-[1280px] px-5 py-9 sm:px-8 sm:py-12">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-xs text-[#9bb2a3] hover:text-[#c4e6ce]"
        >
          <ArrowLeft size={14} /> New comparison
        </Link>
        <StaticReportActions
          report={report}
          runtimeEvidence={runtimeEvidence}
        />
      </div>
      <header className="mb-8 mt-9">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <span className="badge badge-green">
            <FileSearch size={12} /> LIVE STATIC REPORT
          </span>
          <span className="mono text-[10px] text-[#839b8b]">
            PUBLIC NPM RELEASES
          </span>
        </div>
        <h1 className="break-all text-3xl font-medium tracking-tight sm:text-4xl">
          {report.input.packageName}
        </h1>
        <p className="mono mt-3 flex flex-wrap items-center gap-3 text-sm text-[#b1cbb9]">
          <span className="break-all">{report.input.trustedVersion}</span>
          <ArrowRight size={15} />
          <span className="break-all text-[#dccdac]">
            {report.input.candidateVersion}
          </span>
        </p>
        <p className="mt-4 text-xs leading-6 text-[#899e90]">
          Generated{" "}
          <time dateTime={report.generatedAt}>
            {new Date(report.generatedAt)
              .toISOString()
              .replace("T", " ")
              .replace(/\.\d{3}Z$/, " UTC")}
          </time>{" "}
          · <span className="mono break-all">{report.id}</span>
        </p>
      </header>
      <div className="mb-9 flex items-start gap-3 rounded-lg border border-[#a9d8b7]/15 bg-[#a9d8b7]/[0.04] p-4 text-xs leading-6 text-[#adc4b5]">
        <LockKeyhole className="mt-1 size-4 shrink-0" />
        <p>
          The static analysis below compares downloaded archives and source
          patterns without executing package code.
          {runtimeEvidence?.status === "available"
            ? " A separate experimental runtime supplement is attached at the end of this report."
            : " No verified runtime supplement is attached."}{" "}
          No AI conclusions are included.
        </p>
      </div>
      <div className="grid items-start gap-10 lg:grid-cols-[190px_minmax(0,1fr)]">
        <nav
          aria-label="Report sections"
          className="hidden lg:sticky lg:top-24 lg:block print:hidden"
        >
          <p className="eyebrow mb-5">IN THIS REPORT</p>
          <ol className="space-y-1">
            {navigation.map(([id, title], index) => (
              <li key={id}>
                <a
                  href={`#${id}`}
                  className="flex gap-3 rounded px-2 py-2.5 text-xs text-[#91a899] transition-colors hover:bg-white/[0.03] hover:text-[#d0e2d6]"
                >
                  <span className="mono text-[10px] text-[#5f7b69]">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  {title}
                </a>
              </li>
            ))}
          </ol>
          <div className="mt-7 border-t border-white/[0.07] pt-5 text-[11px] leading-6 text-[#8da495]">
            Static signals are leads for review. They do not prove execution or
            intent.
          </div>
        </nav>
        <div className="min-w-0 space-y-12">
          <Section id="overview" number={1} title="Executive summary">
            {report.coverage.truncated && (
              <p className="mb-4 rounded-lg border border-orange-300/20 p-4 text-xs leading-6 text-orange-200">
                Scan or output limits were reached. Displayed records are
                incomplete; review scan coverage before interpreting this
                report.
              </p>
            )}
            <div className="panel overflow-hidden">
              <div className="grid gap-6 p-6 md:grid-cols-[1fr_170px]">
                <div>
                  <span className="badge badge-orange">
                    <CircleAlert size={12} />
                    {report.status}
                  </span>
                  <p className="mt-4 text-sm leading-7 text-[#c5d5ca]">
                    {report.summary}
                  </p>
                </div>
                <div className="rounded-lg border border-white/[0.07] bg-[#0b120e] p-4">
                  <p className="eyebrow mb-3">RISK SCORE</p>
                  <p className="text-xl font-medium text-[#d4dfd7]">
                    Not assessed
                  </p>
                  <p className="mt-2 text-xs leading-5 text-[#91a597]">
                    Static findings do not establish runtime risk.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 border-t border-white/[0.07] sm:grid-cols-4">
                {[
                  ["Displayed changed files", report.fileChanges.length],
                  ["Static findings", report.findings.length],
                  ["Manifest changes", report.manifestChanges.length],
                  ["Evidence entries", report.evidence.length],
                ].map(([label, count]) => (
                  <div key={label} className="px-5 py-5">
                    <p className="mono text-2xl text-[#cbe4d3]">{count}</p>
                    <p className="mt-2 text-[11px] text-[#98ad9f]">{label}</p>
                  </div>
                ))}
              </div>
            </div>
          </Section>
          <Section
            id="releases"
            number={2}
            title="Release metadata"
            description="Integrity verifies that the downloaded bytes match the registry digest. It does not establish that a release is safe."
          >
            <div className="grid gap-4 md:grid-cols-2">
              <ReleaseCard release={report.releases.trusted} />
              <ReleaseCard release={report.releases.candidate} candidate />
            </div>
          </Section>
          <Section
            id="files"
            number={3}
            title="File changes"
            description="Content comparison uses file paths and SHA-256 hashes. Archives are inspected in memory without installing packages."
          >
            <div className="mb-4 flex flex-wrap gap-2">
              <span className="badge badge-green">
                + {fileCounts.added} ADDED
              </span>
              <span className="badge badge-orange">
                ~ {fileCounts.modified} MODIFIED
              </span>
              <span className="badge badge-neutral">
                − {fileCounts.removed} REMOVED
              </span>
            </div>
            {report.fileChanges.length ? (
              <div className="panel overflow-x-auto">
                <table className="data-table">
                  <caption className="sr-only">
                    Displayed changed archive files
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">File / SHA-256</th>
                      <th scope="col">Change</th>
                      <th scope="col">Trusted</th>
                      <th scope="col">Candidate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.fileChanges.map((file) => (
                      <tr key={file.path}>
                        <th
                          scope="row"
                          className="min-w-52 max-w-md !font-normal"
                        >
                          <span className="mono break-all text-xs text-[#c3d8ca]">
                            {file.path}
                          </span>
                          <details className="mt-2 text-[10px]">
                            <summary className="cursor-pointer text-[#8ca294]">
                              SHA-256 hashes
                            </summary>
                            <dl className="mono mt-2 space-y-2 break-all text-[10px]">
                              <div>
                                <dt className="text-[#8ca294]">Trusted</dt>
                                <dd>{file.oldSha256 ?? "No file"}</dd>
                              </div>
                              <div>
                                <dt className="text-[#8ca294]">Candidate</dt>
                                <dd>{file.newSha256 ?? "No file"}</dd>
                              </div>
                            </dl>
                          </details>
                        </th>
                        <td>
                          <span
                            className={`badge ${file.change === "added" ? "badge-green" : file.change === "modified" ? "badge-orange" : "badge-neutral"}`}
                          >
                            {file.change.toUpperCase()}
                          </span>
                        </td>
                        <td className="mono whitespace-nowrap">
                          {file.oldSize === null ? "—" : bytes(file.oldSize)}
                        </td>
                        <td className="mono whitespace-nowrap">
                          {file.newSize === null ? "—" : bytes(file.newSize)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="panel p-5 text-sm text-[#a6baae]">
                No file content differences were found in the compared archives.
              </p>
            )}
          </Section>
          <Section
            id="manifest"
            number={4}
            title="Manifest changes"
            description={`${dependencyChanges} displayed direct dependency declaration changes. Transitive dependency behavior is not assessed.`}
          >
            {report.manifestChanges.length ? (
              <div className="panel overflow-x-auto">
                <table className="data-table">
                  <caption className="sr-only">
                    Dependency and script declaration differences
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Declaration</th>
                      <th scope="col">Trusted</th>
                      <th scope="col">Candidate</th>
                      <th scope="col">Evidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.manifestChanges.map((change) => (
                      <tr key={`${change.kind}-${change.name}`}>
                        <th scope="row" className="!font-normal">
                          <p className="mono break-all text-xs text-[#c1d5c8]">
                            {change.name}
                          </p>
                          <p className="mt-2 text-[10px] text-[#859b8c]">
                            {change.kind}
                          </p>
                        </th>
                        <td className="mono max-w-xs break-all text-xs">
                          {change.oldValue ?? "Not declared"}
                        </td>
                        <td className="mono max-w-xs break-all text-xs">
                          {change.newValue ?? "Not declared"}
                        </td>
                        <td>
                          <EvidenceLinks ids={[change.evidenceId]} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="panel p-5 text-sm text-[#a6baae]">
                No changes to compared dependency or script declarations.
              </p>
            )}
            <p className="mt-3 text-xs leading-6 text-[#96aa9e]">
              Script strings are evidence only; they have not been run.
            </p>
          </Section>
          <Section
            id="signals"
            number={5}
            title="Static findings"
            description="Pattern matches identify code that may warrant review. Counts are source signals, not observed events or a measure of execution frequency."
          >
            <div className="panel mb-5 overflow-x-auto">
              <table className="data-table">
                <caption className="sr-only">
                  Static source signal counts by release
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Static signal category</th>
                    <th scope="col">Trusted matches</th>
                    <th scope="col">Candidate matches</th>
                  </tr>
                </thead>
                <tbody>
                  {report.signalCounts.map((signal) => (
                    <tr key={signal.category}>
                      <th scope="row" className="!font-normal text-[#bbd0c3]">
                        {categoryLabels[signal.category]}
                      </th>
                      <td className="mono">{signal.oldCount}</td>
                      <td className="mono">{signal.newCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="space-y-3">
              {report.findings.map((finding) => (
                <article key={finding.id} className="panel p-5">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <span className="badge badge-orange">{finding.status}</span>
                    <span className="mono text-[10px] uppercase text-[#9fb5a7]">
                      {categoryLabels[finding.category]} · {finding.severity}{" "}
                      review priority
                    </span>
                  </div>
                  <h3 className="break-all text-sm font-medium text-[#d2e3d8]">
                    {finding.title}
                  </h3>
                  <p className="my-3 text-xs leading-6 text-[#9fb4a7]">
                    {finding.description}
                  </p>
                  <EvidenceLinks ids={finding.evidenceIds} />
                </article>
              ))}
            </div>
            {!report.findings.length && (
              <p className="panel p-5 text-sm leading-7 text-[#a6baae]">
                No new findings were identified by the supported checks. This
                does not establish the absence of security-relevant changes.
              </p>
            )}
          </Section>
          <Section
            id="evidence"
            number={6}
            title="Source evidence"
            description="Excerpts come from registry metadata or downloaded archive files. They are displayed as text; references are not executed or opened."
          >
            <div className="space-y-5">
              {report.evidence.map((evidence) => (
                <article
                  key={evidence.id}
                  id={`source-${encodeURIComponent(evidence.id)}`}
                  className="panel scroll-mt-24 overflow-hidden"
                >
                  <header className="border-b border-white/[0.07] p-4">
                    <div className="mb-2 flex flex-wrap items-center gap-3">
                      <span className="mono text-xs text-[#b4e2c4]">
                        {evidence.id}
                      </span>
                      <span className="badge badge-neutral">
                        {evidence.source}
                      </span>
                    </div>
                    <h3 className="mono break-all text-xs text-[#c3d4c9]">
                      {evidence.file}
                    </h3>
                  </header>
                  <div className="grid md:grid-cols-2">
                    {[
                      {
                        label: "TRUSTED",
                        line: evidence.oldLine,
                        excerpt: evidence.oldExcerpt,
                        hash: evidence.oldSha256,
                      },
                      {
                        label: "CANDIDATE",
                        line: evidence.newLine,
                        excerpt: evidence.newExcerpt,
                        hash: evidence.newSha256,
                      },
                    ].map((side) => (
                      <div
                        key={side.label}
                        className="min-w-0 border-b border-white/[0.05] bg-[#0c130f] p-4 first:md:border-r"
                      >
                        <p className="mono mb-3 text-[9px] tracking-wider text-[#91a899]">
                          {side.label}
                          {side.line !== null ? ` · LINE ${side.line}` : ""}
                        </p>
                        <pre className="mono max-h-72 overflow-auto whitespace-pre-wrap break-all text-[11px] leading-6 text-[#c0d2c6]">
                          <code>
                            {side.excerpt ?? "No excerpt for this release."}
                          </code>
                        </pre>
                        {side.hash && (
                          <details className="mt-4 text-[10px]">
                            <summary className="cursor-pointer text-[#8fa396]">
                              Source SHA-256
                            </summary>
                            <p className="mono mt-2 break-all leading-5 text-[#a5bcae]">
                              {side.hash}
                            </p>
                          </details>
                        )}
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
            {!report.evidence.length && (
              <p className="panel p-5 text-sm text-[#a6baae]">
                No evidence excerpts were produced by the supported checks.
              </p>
            )}
          </Section>
          <Section
            id="coverage"
            number={7}
            title="Scan coverage"
            description="Coverage is part of the finding. Files outside the scanner’s limits and supported formats require separate review."
          >
            <div className="panel p-5">
              <dl className="grid gap-5 sm:grid-cols-3">
                {[
                  [
                    "Trusted files scanned",
                    report.coverage.trustedFilesScanned,
                  ],
                  [
                    "Candidate files scanned",
                    report.coverage.candidateFilesScanned,
                  ],
                  ["Files skipped", report.coverage.skippedFiles],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="mb-2 text-xs text-[#9bb1a2]">{label}</dt>
                    <dd className="mono text-2xl text-[#c5dfce]">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-5 border-t border-white/[0.07] pt-4 text-xs leading-6 text-[#acbfb2]">
                {report.coverage.truncated
                  ? "Scan limits were reached. Findings or excerpts may be incomplete."
                  : "No scan truncation was reported. Supported checks still have the limitations below."}
              </p>
              {report.coverage.notes.length > 0 && (
                <ul className="mt-3 list-disc space-y-2 pl-4 text-xs leading-6 text-[#9db2a5]">
                  {report.coverage.notes.map((note, index) => (
                    <li key={index}>{note}</li>
                  ))}
                </ul>
              )}
            </div>
          </Section>
          <Section
            id="assessment"
            number={8}
            title="Assessment limits"
            description="An inconclusive result preserves uncertainty. A static signal alone is not evidence that a package performed an action."
          >
            <div className="grid gap-4 md:grid-cols-2">
              <div className="panel p-5">
                <h3 className="mb-4 text-sm font-medium">
                  Runtime behavior in static analysis
                </h3>
                <dl className="space-y-4 text-xs">
                  {[
                    "Network activity",
                    "Environment-variable access",
                    "Child-process execution",
                    "Filesystem writes",
                    "Install scripts",
                  ].map((label) => (
                    <div className="flex justify-between gap-3" key={label}>
                      <dt className="text-[#a0b4a7]">{label}</dt>
                      <dd className="text-[#c3d4c9]">Not run</dd>
                    </div>
                  ))}
                </dl>
              </div>
              <div className="panel p-5">
                <h3 className="mb-4 text-sm font-medium">
                  Risk &amp; AI investigation
                </h3>
                <dl className="space-y-4 text-xs">
                  <div className="flex justify-between gap-3">
                    <dt className="text-[#a0b4a7]">Overall status</dt>
                    <dd className="text-[#d2c4a8]">INCONCLUSIVE</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-[#a0b4a7]">Risk score</dt>
                    <dd className="text-[#c3d4c9]">Not assessed</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-[#a0b4a7]">AI investigation</dt>
                    <dd className="text-[#c3d4c9]">Not connected</dd>
                  </div>
                </dl>
                <p className="mt-5 text-xs leading-6 text-[#93a99b]">
                  Findings and explanations come from deterministic static
                  checks. No model generated this report.
                </p>
              </div>
            </div>
            {report.limitations.length > 0 && (
              <ul className="mt-5 list-disc space-y-2 pl-5 text-xs leading-6 text-[#a2b8aa]">
                {report.limitations.map((limitation, index) => (
                  <li key={index}>{limitation}</li>
                ))}
              </ul>
            )}
          </Section>
          <RuntimeReportPanel state={runtimeEvidence} />
        </div>
      </div>
    </div>
  );
}
