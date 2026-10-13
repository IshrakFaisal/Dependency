"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  Box,
  FlaskConical,
  GitCompareArrows,
  LoaderCircle,
  LockKeyhole,
  Play,
} from "lucide-react";
import { comparisonInputSchema, type ComparisonInput } from "@/lib/validation";
import { Button } from "@/components/ui/button";

export function ComparisonForm({
  enabled,
  staticEnabled = false,
}: {
  enabled: boolean;
  staticEnabled?: boolean;
}) {
  const router = useRouter();
  const available = enabled || staticEnabled;
  const [errors, setErrors] = useState<
    Partial<Record<keyof ComparisonInput, string>>
  >({});
  const [pending, setPending] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const submitting = useRef(false);
  const request = useRef<AbortController | null>(null);

  useEffect(() => () => request.current?.abort(), []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!available || submitting.current) return;
    setRequestError(null);
    const data = new FormData(event.currentTarget);
    const result = comparisonInputSchema.safeParse({
      packageName: data.get("packageName"),
      trustedVersion: data.get("trustedVersion"),
      candidateVersion: data.get("candidateVersion"),
    });
    if (!result.success) {
      const nextErrors: Partial<Record<keyof ComparisonInput, string>> = {};
      for (const issue of result.error.issues) {
        const key = issue.path[0] as keyof ComparisonInput;
        nextErrors[key] ??= issue.message;
      }
      setErrors(nextErrors);
      const firstField = Object.keys(nextErrors)[0];
      if (firstField)
        (
          event.currentTarget.elements.namedItem(
            firstField,
          ) as HTMLInputElement | null
        )?.focus();
      return;
    }
    setErrors({});
    submitting.current = true;
    setPending(true);
    if (!staticEnabled) {
      router.push("/analysis/demo-example-utils");
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    try {
      const response = await fetch("/api/analyses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result.data),
        signal: controller.signal,
      });
      const payload: unknown = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok) {
        throw new Error(
          payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
            ? payload.error
            : "The analysis could not be started. Please try again.",
        );
      }
      if (!payload || typeof payload !== "object" || !("id" in payload) || typeof payload.id !== "string" || !/^[a-zA-Z0-9-]+$/.test(payload.id)) {
        throw new Error("The server returned an invalid analysis ID. Please try again.");
      }
      router.push(`/analysis/${payload.id}`);
    } catch (error) {
      if (controller.signal.aborted) return;
      setRequestError(error instanceof Error ? error.message : "Unable to reach the analysis service. Please try again.");
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <section
      id="compare"
      className="comparison-panel scroll-mt-28"
      aria-labelledby="compare-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.07] px-6 py-5 sm:px-7">
        <div className="flex items-center gap-3">
          <span className="icon-well">
            <GitCompareArrows size={19} />
          </span>
          <div>
            <h2
              id="compare-title"
              className="text-[17px] font-semibold tracking-tight"
            >
              A second look before your next install.
            </h2>
            <p className="mt-1 text-xs text-[#87968d]">
              One package. Two releases. A clearer picture.
            </p>
          </div>
        </div>
        <span className="mono flex items-center gap-1.5 text-[10px] text-[#a0ada5]">
          <span className="text-[#cf635a] text-base font-bold">npm</span>{" "}
          PACKAGE COMPARISON
        </span>
      </div>
      <form
        onSubmit={submit}
        noValidate
        className="px-6 pt-6 sm:px-7"
        aria-describedby="demo-explanation"
      >
        <div className="comparison-fields">
          <div>
            <label htmlFor="packageName" className="field-label">
              Package name
            </label>
            <div className="relative">
              <Box
                size={16}
                className="pointer-events-none absolute left-3.5 top-3.5 text-[#6f8177]"
              />
              <input
                id="packageName"
                name="packageName"
                className="field-input pl-10"
                defaultValue={staticEnabled ? "" : "example-package"}
                placeholder={staticEnabled ? "zod or @scope/package-name" : "@scope/package-name"}
                autoComplete="off"
                spellCheck={false}
                maxLength={214}
                aria-invalid={!!errors.packageName}
                aria-describedby={
                  errors.packageName ? "packageName-error" : undefined
                }
                disabled={!available || pending}
              />
            </div>
            {errors.packageName && (
              <p id="packageName-error" className="field-error">
                {errors.packageName}
              </p>
            )}
          </div>
          <div>
            <label htmlFor="trustedVersion" className="field-label">
              Trusted version <span className="text-[#688f78]">BASELINE</span>
            </label>
            <input
              id="trustedVersion"
              name="trustedVersion"
              className="field-input"
              defaultValue={staticEnabled ? "" : "1.4.1"}
              placeholder={staticEnabled ? "3.23.8" : "1.4.1"}
              autoComplete="off"
              spellCheck={false}
              maxLength={128}
              aria-invalid={!!errors.trustedVersion}
              aria-describedby={
                errors.trustedVersion ? "trustedVersion-error" : undefined
              }
              disabled={!available || pending}
            />
            {errors.trustedVersion && (
              <p id="trustedVersion-error" className="field-error">
                {errors.trustedVersion}
              </p>
            )}
          </div>
          <ArrowRight
            className="comparison-arrow text-[#56645c]"
            size={18}
            aria-hidden="true"
          />
          <div>
            <label htmlFor="candidateVersion" className="field-label">
              Candidate version <span className="text-[#a3946c]">UPDATE</span>
            </label>
            <input
              id="candidateVersion"
              name="candidateVersion"
              className="field-input"
              defaultValue={staticEnabled ? "" : "1.4.2"}
              placeholder={staticEnabled ? "3.24.1" : "1.4.2"}
              autoComplete="off"
              spellCheck={false}
              maxLength={128}
              aria-invalid={!!errors.candidateVersion}
              aria-describedby={
                errors.candidateVersion ? "candidateVersion-error" : undefined
              }
              disabled={!available || pending}
            />
            {errors.candidateVersion && (
              <p id="candidateVersion-error" className="field-error">
                {errors.candidateVersion}
              </p>
            )}
          </div>
          <Button
            type="submit"
            size="lg"
            className="analyze-button"
            disabled={!available || pending}
          >
            {pending ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <GitCompareArrows />
            )}
            {pending ? staticEnabled ? "Starting analysis…" : "Opening demo…" : "Analyze Update"}
            <ArrowRight />
          </Button>
        </div>
        {requestError && (
          <p className="field-error mt-4" role="alert">
            {requestError}
          </p>
        )}
        <div className="my-5 flex flex-wrap items-center justify-between gap-3 text-xs">
          <span className="flex items-center gap-1.5 text-[#8a998f]">
            <LockKeyhole size={12} />
            No package code is executed. Install scripts are never run.
          </span>
          {enabled && (
            <Button variant="ghost" size="sm" asChild>
              <Link href="/analysis/demo-example-utils">
                <Play size={12} />
                Try Demo
                <ArrowRight size={13} />
              </Link>
            </Button>
          )}
        </div>
        <div id="demo-explanation" className="demo-note">
          <FlaskConical className="mt-0.5 size-3.5 shrink-0" />
          <p>
            {staticEnabled ? (
              <>
                <strong>Live static analysis.</strong> Fetch public npm releases,
                verify archive integrity, and compare files and source signals.
                Runtime behavior and AI investigation are not assessed.
              </>
            ) : enabled ? (
              <>
                <strong>Demo mode.</strong> Every valid comparison opens the
                synthetic{" "}
                <span className="mono">example-utils 1.4.1 → 1.4.2</span>{" "}
                fixture. Your input is never fetched or executed.
              </>
            ) : (
              <>
                <strong>Analysis is disabled.</strong> Enable static analysis
                or set DEMO_MODE=true to explore the synthetic demo.
              </>
            )}
          </p>
        </div>
      </form>
    </section>
  );
}
