"use client";

import { Check, Download, Printer } from "lucide-react";
import { useState } from "react";

import type { AnalysisReport } from "@/lib/types";

export function ReportActions({ report }: { report: AnalysisReport }) {
  const [downloaded, setDownloaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function downloadReport() {
    try {
      const blob = new Blob([JSON.stringify(report, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `dependencyguard-${report.packageName.replace(/[^a-z0-9.-]/gi, "-")}-${report.candidateVersion}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setDownloaded(true);
      setError(null);
    } catch {
      setError("The report could not be exported. Please try again.");
    }
  }

  return (
    <div className="print:hidden">
      <div className="flex items-center gap-2">
        <button
          className="button-secondary"
          onClick={downloadReport}
          type="button"
        >
          {downloaded ? <Check size={15} /> : <Download size={15} />}
          {downloaded ? "Exported" : "Export JSON"}
        </button>
        <button
          aria-label="Print report"
          className="button-secondary !px-3"
          onClick={() => window.print()}
          title="Print report"
          type="button"
        >
          <Printer size={16} />
        </button>
      </div>
      <p aria-live="polite" className="sr-only">
        {downloaded
          ? "The synthetic demo report has been exported as JSON."
          : ""}
      </p>
      {error ? (
        <p className="mt-2 text-xs text-orange-300" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
