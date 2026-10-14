"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BrainCircuit, LoaderCircle } from "lucide-react";
import {
  investigationArtifactSchema,
  type InvestigationView,
} from "@/lib/investigation/contracts";

const availabilityText = {
  disabled:
    "AI investigation is disabled. An operator can enable it in the server configuration.",
  not_configured:
    "AI is enabled but the server needs a valid Nebius API key and model ID.",
  no_evidence:
    "This report has no static evidence excerpts to send. An empty finding list does not establish safety.",
  ready: "Ready for an optional evidence review.",
};

export function InvestigationPanel({
  analysisId,
  initial,
}: {
  analysisId: string;
  initial?: InvestigationView;
}) {
  const router = useRouter();
  const [result, setResult] = useState<InvestigationView | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Never display a locally completed result against a newer server preview.
  const view = result?.fingerprint === initial?.fingerprint ? result : initial;
  const artifact = view?.artifact;

  async function generate() {
    if (!view || pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/analyses/${encodeURIComponent(analysisId)}/investigation`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fingerprint: view.fingerprint }),
          signal: AbortSignal.timeout(60_000),
        },
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(
          typeof data.error === "string"
            ? data.error
            : "Investigation failed. Try again later.",
        );
      const saved = investigationArtifactSchema.parse(data.artifact);
      if (
        saved.analysisId !== analysisId ||
        saved.fingerprint !== view.fingerprint
      )
        throw new Error("Evidence changed. Reload the report.");
      setResult({ ...view, status: "available", artifact: saved });
      router.refresh();
    } catch (failure) {
      setError(
        failure instanceof Error &&
          failure.name !== "TimeoutError" &&
          failure.name !== "ZodError"
          ? failure.message
          : "The request did not complete. Reload to check for a saved result before retrying.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      id="investigation"
      className="scroll-mt-24"
      aria-labelledby="investigation-heading"
    >
      <h2
        id="investigation-heading"
        className="mb-5 flex items-center gap-3 text-lg font-semibold"
      >
        <span className="mono text-xs font-normal text-[#728479]">10</span>
        AI investigation <BrainCircuit size={18} className="text-[#a9dbb9]" />
      </h2>
      <div className="panel space-y-5 p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <span className="badge badge-neutral">OPTIONAL · NEBIUS</span>
          <span className="badge badge-orange">UNVERIFIED RISK</span>
        </div>
        <p className="text-sm leading-7 text-[#b6cbbc]">
          A model can help interpret static evidence and suggest follow-up
          checks. Its explanations are unverified hypotheses. Citations are
          checked for existence, not factual support. The deterministic report
          stays INCONCLUSIVE with no risk score.
        </p>
        <p className="text-xs leading-6 text-[#98aa9e]">
          Generation sends the preview below to Nebius Token Factory and may
          incur provider charges. It includes public package identity, archive
          hashes, scan coverage and up to 24 source evidence entries with
          excerpts capped at 800 characters. Common token patterns are redacted,
          but this is not a complete secret detector. Runtime telemetry, local
          environment values and credentials are not included in the evidence.
        </p>
        {view?.model && (
          <p className="mono break-all text-xs text-[#a9dbb9]">
            Model: {view.model}
          </p>
        )}
        {view && (
          <details className="rounded-lg border border-white/10 p-4 text-xs">
            <summary className="cursor-pointer text-[#b4d8c1]">
              Review exact evidence sent to Nebius
            </summary>
            <pre className="mono mt-4 max-h-80 overflow-auto whitespace-pre-wrap break-all text-[11px] leading-6 text-[#a3b7aa]">
              {view.packetJson}
            </pre>
            <p className="mono mt-3 break-all text-[10px] text-[#84978b]">
              Input fingerprint: {view.fingerprint}
            </p>
          </details>
        )}
        {view?.status === "stale" && (
          <p role="status" className="text-xs text-orange-200">
            A saved investigation no longer matches this evidence or model.
            Generate a new investigation after reviewing the preview.
          </p>
        )}
        {view?.status === "invalid" && (
          <p role="status" className="text-xs text-orange-200">
            The saved investigation failed validation and is not displayed.
          </p>
        )}
        {!artifact && (
          <p className="text-xs leading-6 text-[#a3b7aa]">
            {availabilityText[view?.availability ?? "disabled"]}
          </p>
        )}
        {!artifact && view?.availability === "ready" && (
          <button
            type="button"
            className="button-primary print:hidden"
            disabled={pending}
            onClick={generate}
          >
            {pending ? (
              <LoaderCircle size={16} className="animate-spin" />
            ) : (
              <BrainCircuit size={16} />
            )}
            {pending ? "Investigating evidence…" : "Generate with Nebius"}
          </button>
        )}
        <p role="status" aria-live="polite" className="text-xs text-[#a3b7aa]">
          {pending
            ? "Waiting for a validated explanation. This can take up to 45 seconds."
            : artifact
              ? "Saved investigation loaded. No new provider request is needed."
              : ""}
        </p>
        {error && (
          <p role="alert" className="text-xs leading-6 text-orange-200">
            {error}
          </p>
        )}
        {artifact && (
          <div className="space-y-5 border-t border-white/10 pt-5">
            <p className="mono break-all text-[10px] leading-6 text-[#90a597]">
              {artifact.provider} · {artifact.model}
              <br />
              {artifact.generatedAt} · {artifact.promptVersion}
            </p>
            {!artifact.output.observations.length && (
              <p className="text-sm text-[#b6cbbc]">
                The model did not produce evidence-supported observations.
                Review its limitations below.
              </p>
            )}
            {artifact.output.observations.map((item, index) => (
              <article
                key={index}
                className="rounded-lg border border-white/10 p-4"
              >
                <p className="eyebrow mb-3">AI HYPOTHESIS · UNVERIFIED RISK</p>
                <h3 className="break-words text-sm font-medium text-[#d2e3d8]">
                  {item.title}
                </h3>
                <p className="my-3 whitespace-pre-wrap break-words text-xs leading-6 text-[#b1c4b8]">
                  {item.interpretation}
                </p>
                <dl className="space-y-3 text-xs leading-6 text-[#98aa9e]">
                  <div>
                    <dt className="text-[#c4d6ca]">
                      Possible benign explanation
                    </dt>
                    <dd className="break-words">{item.benignAlternative}</dd>
                  </div>
                  <div>
                    <dt className="text-[#c4d6ca]">Suggested manual check</dt>
                    <dd className="break-words">{item.recommendedCheck}</dd>
                  </div>
                </dl>
                <div className="mt-4 flex flex-wrap gap-3">
                  {item.evidenceIds.map((id) => (
                    <a
                      key={id}
                      className="mono text-xs text-[#a9dbb9] hover:underline"
                      href={`#source-${encodeURIComponent(id)}`}
                    >
                      {id}
                    </a>
                  ))}
                </div>
              </article>
            ))}
            <div>
              <h3 className="mb-2 text-sm text-[#c4d6ca]">
                Model-reported limitations
              </h3>
              <ul className="list-disc space-y-2 pl-5 text-xs leading-6 text-[#98aa9e]">
                {artifact.output.limitations.map((item, index) => (
                  <li className="break-words" key={index}>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
