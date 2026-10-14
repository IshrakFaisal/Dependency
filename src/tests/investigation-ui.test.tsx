// @vitest-environment jsdom
import { Blob as NodeBlob } from "node:buffer";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { InvestigationPanel } from "@/components/investigation-panel";
import { StaticReportActions } from "@/components/static-report-actions";
import {
  investigationArtifact as artifact,
  investigationView as view,
  investigationReport as report,
} from "./helpers/investigation-fixtures";
const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it("discloses the external transfer and waits for an explicit generation action", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(
      Response.json({ ...view, artifact, status: "available" }),
    );
  vi.stubGlobal("fetch", fetchMock);
  render(<InvestigationPanel analysisId={report.id} initial={view} />);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(screen.getByText(/may incur provider charges/)).toBeTruthy();
  expect(screen.getByText(view.packetJson)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Generate with Nebius" }));
  expect(
    screen
      .getByRole("button", { name: /Investigating evidence/ })
      .hasAttribute("disabled"),
  ).toBe(true);
  await waitFor(() =>
    expect(
      screen.getByText(artifact.output.observations[0].title),
    ).toBeTruthy(),
  );
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
    fingerprint: view.fingerprint,
  });
  expect(refresh).toHaveBeenCalled();
  expect(
    screen.getByRole("link", { name: "STATIC-EVD-001" }).getAttribute("href"),
  ).toBe("#source-STATIC-EVD-001");
});
it.each(["disabled", "not_configured", "no_evidence"] as const)(
  "does not offer a billed request when %s",
  (availability) => {
    render(
      <InvestigationPanel
        analysisId={report.id}
        initial={{ ...view, availability }}
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
  },
);
it("shows provider failure without inventing a successful explanation and permits retry", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        Response.json({ error: "Nebius is unavailable." }, { status: 502 }),
      ),
  );
  render(<InvestigationPanel analysisId={report.id} initial={view} />);
  fireEvent.click(screen.getByRole("button", { name: "Generate with Nebius" }));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toBe(
      "Nebius is unavailable.",
    ),
  );
  expect(
    screen
      .getByRole("button", { name: "Generate with Nebius" })
      .hasAttribute("disabled"),
  ).toBe(false);
  expect(screen.queryByText(artifact.output.observations[0].title)).toBeNull();
});
it("renders model text inertly and does not generate again for a cached result", () => {
  const unsafe = structuredClone(artifact);
  unsafe.output.observations[0].title = '<script>alert("model")</script>';
  const { container } = render(
    <InvestigationPanel
      analysisId={report.id}
      initial={{ ...view, status: "available", artifact: unsafe }}
    />,
  );
  expect(screen.getByText(unsafe.output.observations[0].title)).toBeTruthy();
  expect(container.querySelector("script")).toBeNull();
  expect(screen.queryByRole("button")).toBeNull();
});
it("explains why stale results are hidden", () => {
  render(
    <InvestigationPanel
      analysisId={report.id}
      initial={{ ...view, status: "stale" }}
    />,
  );
  expect(screen.getByText(/no longer matches/)).toBeTruthy();
});
it("exports AI provenance as a separate supplement without changing the report", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("Blob", NodeBlob);
  const createObjectURL = vi.fn<(blob: NodeBlob) => string>(
    () => "blob:synthetic-ai",
  );
  vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  render(<StaticReportActions report={report} investigation={artifact} />);
  fireEvent.click(screen.getByRole("button", { name: "Export JSON" }));
  const exported = JSON.parse(
    await (createObjectURL.mock.calls[0][0] as NodeBlob).text(),
  );
  expect(exported.aiInvestigation).toEqual(artifact);
  expect(exported.status).toBe("INCONCLUSIVE");
  expect(exported.riskScore).toBeNull();
  vi.runOnlyPendingTimers();
});
