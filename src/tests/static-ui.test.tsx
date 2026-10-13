// @vitest-environment jsdom

import { Blob as NodeBlob } from "node:buffer";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ComparisonForm } from "@/components/comparison-form";
import { STATIC_POLL_INTERVAL, StaticAnalysisProgress } from "@/components/static-analysis-progress";
import { StaticReportView } from "@/components/static-report-view";
import { StaticReportActions } from "@/components/static-report-actions";
import type { AnalysisJob, StaticAnalysisReport } from "@/lib/types/static-analysis";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const input = { packageName: "@synthetic/static-ui-fixture", trustedVersion: "1.0.0", candidateVersion: "1.1.0" };
const job: AnalysisJob = { id: "static-test-123", input, mode: "static", status: "running", stage: 0, createdAt: "2026-10-13T00:00:00.000Z", updatedAt: "2026-10-13T00:00:00.000Z", error: null };
const release: StaticAnalysisReport["releases"]["trusted"] = {
  release: { name: input.packageName, version: input.trustedVersion, description: "Synthetic test fixture", license: "MIT", tarballUrl: "javascript:alert('source-url')", integrity: "sha512-synthetic", shasum: "a".repeat(40), scripts: {}, dependencies: {}, optionalDependencies: {}, peerDependencies: {}, deprecated: null },
  archiveSha256: "b".repeat(64), integrityVerified: "sha512", compressedBytes: 400, unpackedBytes: 1024, warnings: [], fileCount: 2,
};
const report: StaticAnalysisReport = {
  id: job.id, input, mode: "static", generatedAt: job.updatedAt, status: "INCONCLUSIVE", riskScore: null,
  summary: "A synthetic static fixture for UI testing. Runtime behavior was not assessed.",
  releases: { trusted: release, candidate: { ...release, release: { ...release.release, version: input.candidateVersion } } },
  fileChanges: [{ path: "index.js", change: "modified", oldSize: 30, newSize: 90, oldSha256: "c".repeat(64), newSha256: "d".repeat(64) }],
  manifestChanges: [{ kind: "script", name: "postinstall", oldValue: null, newValue: "node setup.js", evidenceId: "E-001" }],
  findings: [{ id: "F-001", category: "network", title: "New source pattern", description: "A new static network API match; execution is unverified.", status: "STATIC SIGNAL", severity: "medium", evidenceIds: ["E-001"] }],
  evidence: [{ id: "E-001", source: "npm-archive", file: "index.js", oldLine: null, newLine: 1, oldExcerpt: null, newExcerpt: '<script>alert("untrusted-source")</script>', oldSha256: null, newSha256: "d".repeat(64) }],
  signalCounts: [{ category: "network", oldCount: 0, newCount: 1 }],
  coverage: { trustedFilesScanned: 2, candidateFilesScanned: 2, skippedFiles: 0, truncated: false, notes: ["Only supported source text formats were scanned."] },
  limitations: ["Static pattern matching is not a complete security assessment."],
};

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

function fillForm() {
  fireEvent.change(screen.getByRole("textbox", { name: "Package name" }), { target: { value: input.packageName } });
  fireEvent.change(screen.getByRole("textbox", { name: /Trusted version/ }), { target: { value: input.trustedVersion } });
  fireEvent.change(screen.getByRole("textbox", { name: /Candidate version/ }), { target: { value: input.candidateVersion } });
}

beforeEach(() => { push.mockReset(); });
afterEach(() => {
  cleanup();
  if (vi.isFakeTimers()) { vi.clearAllTimers(); vi.useRealTimers(); }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("live static comparison form", () => {
  it("starts blank, submits exact versions once, and opens the returned analysis", async () => {
    let resolveRequest!: (response: Response) => void;
    const fetchMock = vi.fn().mockImplementation(() => new Promise<Response>((resolve) => { resolveRequest = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ComparisonForm enabled={false} staticEnabled />);
    expect((screen.getByRole("textbox", { name: "Package name" }) as HTMLInputElement).value).toBe("");
    expect(screen.queryByRole("link", { name: "Try Demo" })).toBeNull();
    expect(screen.getByText("Live static analysis.")).toBeTruthy();
    fillForm();
    const form = screen.getByRole("button", { name: "Analyze Update" }).closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/analyses");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
    expect((screen.getByRole("button", { name: "Starting analysis…" }) as HTMLButtonElement).disabled).toBe(true);
    expect(push).not.toHaveBeenCalled();
    await act(async () => { resolveRequest(json({ id: job.id }, 202)); });
    expect(push).toHaveBeenCalledExactlyOnceWith(`/analysis/${job.id}`);
  });

  it("shows API errors and allows a corrected submission", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ error: "Candidate release was not found. Check the exact version." }, 404)).mockResolvedValueOnce(json({ id: job.id }, 202));
    vi.stubGlobal("fetch", fetchMock);
    render(<ComparisonForm enabled staticEnabled />);
    fillForm();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Analyze Update" })); });
    expect(screen.getByRole("alert").textContent).toContain("Check the exact version");
    expect(push).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Analyze Update" }) as HTMLButtonElement).disabled).toBe(false);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Analyze Update" })); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(push).toHaveBeenCalledExactlyOnceWith(`/analysis/${job.id}`);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not navigate on an invalid response ID", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ id: "../unexpected" }, 202)));
    render(<ComparisonForm enabled={false} staticEnabled />);
    fillForm();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Analyze Update" })); });
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("invalid analysis ID");
  });

  it("rejects invalid input locally before creating a real job", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<ComparisonForm enabled={false} staticEnabled />);
    fireEvent.click(screen.getByRole("button", { name: "Analyze Update" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText("Enter an npm package name.")).toBeTruthy();
  });
});

describe("server-driven static progress", () => {
  it("shows confirmed stages, stops at completion, and offers a manual report link", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ job: { ...job, stage: 2 } })).mockResolvedValueOnce(json({ job: { ...job, stage: 5, status: "completed" } }));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => { render(<StaticAnalysisProgress initialJob={job} />); });
    const progress = screen.getByRole("progressbar", { name: "Static analysis progress" });
    expect(progress.getAttribute("aria-valuenow")).toBe("40");
    expect(screen.getByRole("status").textContent).toContain("Comparing package contents");
    expect(screen.queryByRole("link", { name: "View static report" })).toBeNull();
    await act(async () => { vi.advanceTimersByTime(STATIC_POLL_INTERVAL - 1); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(progress.getAttribute("aria-valuenow")).toBe("100");
    expect(screen.getByRole("link", { name: "View static report" }).getAttribute("href")).toBe(`/report/${job.id}`);
    await act(async () => { vi.advanceTimersByTime(STATIC_POLL_INTERVAL * 20); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(push).not.toHaveBeenCalled();
    expect(screen.getAllByText("Not run")).toHaveLength(4);
    expect(screen.getByText("Not connected")).toBeTruthy();
  });

  it("never advances a stage while waiting for the server", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockReturnValue(new Promise(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    render(<StaticAnalysisProgress initialJob={job} />);
    await act(async () => { vi.advanceTimersByTime(STATIC_POLL_INTERVAL * 10); });
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("0");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("pauses polling after a connection error and retries on request", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error("Network unavailable. Please reconnect.")).mockResolvedValueOnce(json({ job: { ...job, status: "completed", stage: 5 } }));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => { render(<StaticAnalysisProgress initialJob={job} />); });
    expect(screen.getByRole("alert").textContent).toContain("Network unavailable");
    expect(screen.getByRole("status").textContent).toContain("Last confirmed progress");
    await act(async () => { vi.advanceTimersByTime(STATIC_POLL_INTERVAL * 10); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Retry connection" })); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("link", { name: "View static report" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders failure without polling and retries the original input", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ id: "retry-456" }, 202));
    vi.stubGlobal("fetch", fetchMock);
    render(<StaticAnalysisProgress initialJob={{ ...job, status: "failed", stage: 1, error: "Archive integrity verification failed." }} />);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("Archive integrity verification failed.");
    expect(screen.queryByRole("link", { name: "View static report" })).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Retry analysis" })); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST", body: JSON.stringify(input) });
    expect(push).toHaveBeenCalledExactlyOnceWith("/analysis/retry-456");
  });

  it("aborts an in-flight progress request on unmount", async () => {
    const fetchMock = vi.fn().mockReturnValue(new Promise(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    const view = render(<StaticAnalysisProgress initialJob={job} />);
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    view.unmount();
    expect(signal.aborted).toBe(true);
  });

  it("rejects a mismatched job response instead of displaying another analysis", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ job: { ...job, id: "different-job", status: "completed", stage: 5 } })));
    await act(async () => { render(<StaticAnalysisProgress initialJob={job} />); });
    expect(screen.getByRole("alert").textContent).toContain("progress response was invalid");
    expect(screen.queryByRole("link", { name: "View static report" })).toBeNull();
  });
});

describe("static report evidence", () => {
  it("preserves uncertainty and renders untrusted source text without active links or markup", () => {
    const view = render(<StaticReportView report={report} />);
    expect(screen.getAllByText("INCONCLUSIVE")).toHaveLength(2);
    expect(screen.getAllByText("Not assessed")).toHaveLength(2);
    expect(screen.getByText("Not connected")).toBeTruthy();
    expect(screen.getAllByText("Not run")).toHaveLength(5);
    expect(screen.getByText('<script>alert("untrusted-source")</script>')).toBeTruthy();
    expect(view.container.querySelector("script")).toBeNull();
    expect(view.container.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(screen.getAllByText("javascript:alert('source-url')")).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "E-001" }).every((link) => link.getAttribute("href") === "#source-E-001")).toBe(true);
    expect(view.container.querySelector("#source-E-001")).toBeTruthy();
    expect(screen.getByRole("table", { name: "Static source signal counts by release" })).toBeTruthy();
  });

  it("exports the complete static report including evidence and limitations", async () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn().mockReturnValue("blob:static-report");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("Blob", NodeBlob);
    vi.stubGlobal("URL", class extends URL { static createObjectURL = createObjectURL; static revokeObjectURL = revokeObjectURL; });
    const downloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { downloads.push(this.download); });
    render(<StaticReportActions report={report} />);
    fireEvent.click(screen.getByRole("button", { name: "Export JSON" }));
    const blob = createObjectURL.mock.calls[0][0] as NodeBlob;
    expect(JSON.parse(await blob.text())).toEqual(report);
    expect(downloads).toEqual(["dependencyguard-static--synthetic-static-ui-fixture-1.1.0.json"]);
    expect(screen.getByRole("button", { name: "Exported" })).toBeTruthy();
    expect(document.querySelector("a[download]")).toBeNull();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:static-report");
  });
});
