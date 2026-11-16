import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/analysis/jobs", () => ({ analyzeReleases: vi.fn() }));
import { analyzeReleases } from "@/lib/analysis/jobs";
import { AnalysisInputError } from "@/lib/analysis/errors";
import { staticAnalyzer } from "@/lib/cli/analyzer";
import { CliAnalysisError } from "@/lib/cli/arguments";
import { STATIC_STAGES } from "@/lib/types/static-analysis";
import { cliReport, cliTarget } from "./helpers/cli-fixtures";

afterEach(() => {
  vi.resetAllMocks();
});

it("calls the existing runner directly and relays stages without creating persisted jobs", async () => {
  const report = cliReport();
  vi.mocked(analyzeReleases).mockImplementation(async (_, progress) => {
    for (let stage = 0; stage < STATIC_STAGES.length; stage++)
      await progress(stage);
    return report;
  });
  const progress = vi.fn();
  expect(await staticAnalyzer(cliTarget, progress)).toBe(report);
  expect(analyzeReleases).toHaveBeenCalledOnce();
  expect(vi.mocked(analyzeReleases).mock.calls[0][0]).toMatchObject({
    mode: "static",
    status: "running",
    input: report.input,
  });
  expect(progress.mock.calls.flat()).toEqual([...STATIC_STAGES]);
  expect(report.riskScore).toBeNull();
  expect(report.status).toBe("INCONCLUSIVE");
});

it("rejects an added package without a trusted baseline before invoking the runner", async () => {
  await expect(
    staticAnalyzer({ ...cliTarget, from: null }, vi.fn()),
  ).rejects.toThrow("No trusted baseline");
  expect(analyzeReleases).not.toHaveBeenCalled();
});

it("passes identical versions through to the static runner", async () => {
  const target = { ...cliTarget, from: "7.0.0", to: "7.0.0" };
  vi.mocked(analyzeReleases).mockResolvedValue(cliReport(target));
  await staticAnalyzer(target, vi.fn());
  expect(vi.mocked(analyzeReleases).mock.calls[0][0].input).toMatchObject({
    trustedVersion: "7.0.0",
    candidateVersion: "7.0.0",
  });
});

it("preserves actionable registry error messages as typed CLI failures", async () => {
  vi.mocked(analyzeReleases).mockRejectedValue(
    new AnalysisInputError("Release was not found."),
  );
  await expect(staticAnalyzer(cliTarget, vi.fn())).rejects.toThrow(
    CliAnalysisError,
  );
  await expect(staticAnalyzer(cliTarget, vi.fn())).rejects.toThrow(
    "Release was not found.",
  );
});
