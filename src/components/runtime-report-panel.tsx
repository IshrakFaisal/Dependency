import { ShieldAlert, Container, ArrowUpRight } from "lucide-react";
import type { RuntimeEvidenceState } from "@/lib/runtime/contracts";

export function RuntimeReportPanel({
  state = { status: "not_run" },
}: {
  state?: RuntimeEvidenceState;
}) {
  return (
    <section
      id="runtime"
      className="scroll-mt-24"
      aria-labelledby="runtime-heading"
    >
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2
          id="runtime-heading"
          className="flex items-center gap-3 text-lg font-semibold"
        >
          <Container size={18} className="text-[#91edbe]" />
          Runtime probe evidence
        </h2>
        <span className="badge badge-orange">EXPERIMENTAL · IMPORT ONLY</span>
      </div>
      {state.status === "not_run" ? (
        <div className="panel p-6">
          <p className="text-sm text-[#d4dfd7]">Not run</p>
          <p className="mt-3 text-xs leading-6 text-[#9db2a5]">
            No runtime evidence is attached to this comparison. An isolated
            worker can probe each release’s entry-point import and attach a
            separate supplement. A static analysis does not start execution.
          </p>
        </div>
      ) : state.status === "invalid" ? (
        <div
          role="alert"
          className="panel border-orange-300/30 p-6 text-sm leading-7 text-orange-200"
        >
          Runtime evidence could not be verified against this report. It may be
          corrupt, incomplete, or belong to different archive bytes. No runtime
          conclusions are shown.
        </div>
      ) : (
        <RuntimeDetails comparison={state.comparison} />
      )}
    </section>
  );
}

function RuntimeDetails({
  comparison,
}: {
  comparison: Extract<
    RuntimeEvidenceState,
    { status: "available" }
  >["comparison"];
}) {
  const { bundle } = comparison;
  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-orange-300/20 bg-orange-200/[0.03] p-5">
        <p className="mb-3 flex items-center gap-2 text-xs font-medium text-orange-200">
          <ShieldAlert size={16} />
          UNVERIFIED RISK · INCONCLUSIVE
        </p>
        <p className="text-sm leading-7 text-[#c7d8cd]">{comparison.summary}</p>
        <p className="mt-3 text-xs leading-6 text-[#9db2a5]">
          These are instrumented API attempts reported by package-controlled
          processes. They can be bypassed or forged. No successful outbound
          connection or process launch is inferred.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {(["trusted", "candidate"] as const).map((role) => {
          const run = bundle[role];
          return (
            <article className="panel min-w-0 p-5" key={role}>
              <p className="eyebrow">{role} PROBE</p>
              <h3 className="mono my-3 break-all text-lg">{run.version}</h3>
              <p className="text-xs uppercase text-[#d2c4a8]">
                {run.status.replaceAll("_", " ")}
                {run.truncated ? " · TRUNCATED" : ""}
              </p>
              <p className="mt-3 break-words text-xs leading-6 text-[#a0b4a7]">
                {run.reason}
              </p>
              <dl className="mt-4 space-y-2 text-xs text-[#9db2a5]">
                <div className="flex justify-between">
                  <dt>Recorded events</dt>
                  <dd>{run.events.length}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Elapsed</dt>
                  <dd>{(run.durationMs / 1000).toFixed(2)} s</dd>
                </div>
              </dl>
              <details className="mt-4 text-xs text-[#9db2a5]">
                <summary className="cursor-pointer">
                  Profile &amp; artifact identity
                </summary>
                <p className="mono mt-3 break-all leading-6">
                  {run.profile}
                  <br />
                  Image: {run.imageId}
                  <br />
                  Archive: {run.archiveSha256}
                </p>
              </details>
            </article>
          );
        })}
      </div>
      <div className="panel overflow-x-auto">
        <table className="data-table">
          <caption className="sr-only">
            Instrumented runtime event counts
          </caption>
          <thead>
            <tr>
              <th scope="col">API category</th>
              <th scope="col">Trusted</th>
              <th scope="col">Candidate</th>
            </tr>
          </thead>
          <tbody>
            {comparison.counts.map((row) => (
              <tr key={row.category}>
                <th scope="row" className="capitalize !font-normal">
                  {row.category}
                </th>
                <td className="mono">{row.trusted}</td>
                <td className="mono">{row.candidate}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs leading-6 text-[#9db2a5]">
        Counts cover captured hook events only. Zero means no events were
        captured in this probe, not that the package lacks that behavior.
        {!comparison.comparable &&
          " These runs are not comparable; counts may be partial."}
      </p>
      {comparison.comparable && (
        <div className="panel overflow-x-auto">
          <table className="data-table">
            <caption className="sr-only">Runtime behavior differences</caption>
            <thead>
              <tr>
                <th scope="col">API / target</th>
                <th scope="col">Old → New</th>
                <th scope="col">Change</th>
                <th scope="col">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {comparison.differences.map((row) => (
                <tr key={row.id}>
                  <th scope="row" className="max-w-xs !font-normal">
                    <p className="mono text-xs">{row.operation}</p>
                    <p className="mt-2 break-all text-xs text-[#9db2a5]">
                      {row.target} · {row.outcome}
                    </p>
                  </th>
                  <td className="mono whitespace-nowrap">
                    {row.trustedCount} → {row.candidateCount}
                  </td>
                  <td className="text-xs uppercase">{row.change}</td>
                  <td>
                    <a
                      className="inline-flex items-center gap-1 text-xs text-[#a9dbb9]"
                      href={`#${row.evidenceIds[0]}`}
                    >
                      {row.evidenceIds[0]}
                      <ArrowUpRight size={12} />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!comparison.differences.length && (
            <p className="p-5 text-xs text-[#9db2a5]">
              No hook events were captured. This is not a safety verdict.
            </p>
          )}
        </div>
      )}
      <details className="panel p-5">
        <summary className="cursor-pointer text-sm">
          Raw instrumented evidence
        </summary>
        <div className="mt-4 space-y-3">
          {(["trusted", "candidate"] as const).flatMap((role) =>
            bundle[role].events.map((event, index) => {
              const id = `RUN-${role === "trusted" ? "T" : "C"}-${index + 1}`;
              return (
                <article
                  id={id}
                  key={id}
                  className="scroll-mt-24 rounded border border-white/10 p-3"
                >
                  <p className="mono mb-2 text-xs text-[#a9dbb9]">
                    {id} · {role}
                  </p>
                  <p className="break-all text-xs leading-6 text-[#bdcfc3]">
                    {event.category} / {event.operation} / {event.target} /{" "}
                    {event.outcome}
                  </p>
                </article>
              );
            }),
          )}
        </div>
      </details>
      <details className="panel p-5" open>
        <summary className="cursor-pointer text-sm">
          Probe coverage and limitations
        </summary>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-xs leading-6 text-[#9db2a5]">
          {comparison.limitations.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
        <p className="mono mt-4 break-all text-[10px] text-[#8fa798]">
          Collected {bundle.generatedAt} · {bundle.source}
        </p>
      </details>
    </div>
  );
}
