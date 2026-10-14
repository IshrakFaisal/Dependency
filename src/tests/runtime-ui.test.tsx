// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Blob as NodeBlob } from "node:buffer";
import { RuntimeReportPanel } from "@/components/runtime-report-panel";
import { compareRuntime } from "@/lib/runtime/compare";
import { bindingReport, bundle } from "./helpers/runtime-fixtures";
import { StaticReportActions } from "@/components/static-report-actions";
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("runtime supplement UI", () => {
  it("exports runtime evidence separately from static evidence", async () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn().mockReturnValue("blob:runtime-fixture");
    vi.stubGlobal("Blob", NodeBlob);
    vi.stubGlobal(
      "URL",
      class extends URL {
        static createObjectURL = createObjectURL;
        static revokeObjectURL = vi.fn();
      },
    );
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const comparison = compareRuntime(bundle());
    render(
      <StaticReportActions
        report={bindingReport}
        runtimeEvidence={{ status: "available", comparison }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Export JSON" }));
    const blob = createObjectURL.mock.calls[0][0] as NodeBlob;
    expect(JSON.parse(await blob.text())).toEqual({
      ...bindingReport,
      runtimeSupplement: comparison,
    });
    vi.runOnlyPendingTimers();
  });
  it("shows no execution claim when evidence is absent", () => {
    render(<RuntimeReportPanel />);
    expect(screen.getByText("Not run")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
  it("shows invalid evidence separately from no execution", () => {
    render(<RuntimeReportPanel state={{ status: "invalid" }} />);
    expect(screen.getByRole("alert").textContent).toContain(
      "could not be verified",
    );
    expect(screen.queryByText("Not run")).toBeNull();
  });
  it("renders source-controlled targets as inert text and links captured evidence", () => {
    const value = bundle();
    value.candidate.events = [
      {
        category: "network",
        operation: "fetch",
        target: "<script>alert('fixture')</script>",
        outcome: "blocked",
      },
    ];
    const { container } = render(
      <RuntimeReportPanel
        state={{ status: "available", comparison: compareRuntime(value) }}
      />,
    );
    expect(screen.getByText("UNVERIFIED RISK · INCONCLUSIVE")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "RUN-C-1" }).getAttribute("href"),
    ).toBe("#RUN-C-1");
    expect(container.querySelector("#RUN-C-1")).toBeTruthy();
    expect(container.querySelector("script")).toBeNull();
    expect(
      screen.getByRole("table", { name: "Runtime behavior differences" }),
    ).toBeTruthy();
  });
  it("withholds differential conclusions when the baseline failed", () => {
    const value = bundle();
    value.trusted.status = "failed";
    render(
      <RuntimeReportPanel
        state={{ status: "available", comparison: compareRuntime(value) }}
      />,
    );
    expect(
      screen.queryByRole("table", { name: "Runtime behavior differences" }),
    ).toBeNull();
    expect(screen.getByText(/These runs are not comparable/)).toBeTruthy();
  });
});
