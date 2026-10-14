"use client";

import { Check, Download, Printer } from "lucide-react";
import { useState } from "react";
import type { StaticAnalysisReport } from "@/lib/types/static-analysis";
import type { RuntimeEvidenceState } from "@/lib/runtime/contracts";

export function StaticReportActions({
  report,
  runtimeEvidence,
}: {
  report: StaticAnalysisReport;
  runtimeEvidence?: RuntimeEvidenceState;
}) {
  const [exported, setExported] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function download() {
    let url: string | undefined;
    let link: HTMLAnchorElement | undefined;
    try {
      const exportedReport =
        runtimeEvidence?.status === "available"
          ? { ...report, runtimeSupplement: runtimeEvidence.comparison }
          : report;
      const blob = new Blob([JSON.stringify(exportedReport, null, 2)], {
        type: "application/json",
      });
      url = URL.createObjectURL(blob);
      link = document.createElement("a");
      link.href = url;
      link.download = `dependencyguard-static-${report.input.packageName.replace(/[^a-z0-9.-]/gi, "-")}-${report.input.candidateVersion}.json`;
      document.body.appendChild(link);
      link.click();
      setExported(true);
      setError(null);
    } catch {
      setError("The report could not be exported. Please try again.");
    } finally {
      link?.remove();
      if (url) {
        const objectUrl = url;
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      }
    }
  }

  return (
    <div className="print:hidden">
      <div className="flex items-center gap-2">
        <button type="button" className="button-secondary" onClick={download}>
          {exported ? <Check size={15} /> : <Download size={15} />}
          {exported ? "Exported" : "Export JSON"}
        </button>
        <button
          type="button"
          className="button-secondary !px-3"
          aria-label="Print report"
          title="Print report"
          onClick={() => window.print()}
        >
          <Printer size={16} />
        </button>
      </div>
      <p aria-live="polite" className="sr-only">
        {exported
          ? "The static analysis report has been exported as JSON."
          : ""}
      </p>
      {error && (
        <p className="mt-2 text-xs text-orange-300" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
