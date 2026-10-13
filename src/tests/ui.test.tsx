// @vitest-environment jsdom

import { Blob as NodeBlob } from "node:buffer";

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AnalysisProgress,
  DEMO_STAGE_DURATION,
} from "@/components/analysis-progress";
import { ComparisonForm } from "@/components/comparison-form";
import { ReportActions } from "@/components/report-actions";
import { ANALYSIS_STAGES, DEMO_ANALYSIS_ID, DEMO_REPORT } from "@/lib/demo";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

beforeEach(() => {
  push.mockReset();
});

afterEach(() => {
  cleanup();
  if (vi.isFakeTimers()) {
    vi.clearAllTimers();
    vi.useRealTimers();
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("package comparison form", () => {
  it("blocks invalid input and focuses the first invalid field", async () => {
    const user = userEvent.setup();
    render(<ComparisonForm enabled />);
    const packageName = screen.getByRole("textbox", { name: "Package name" });
    const trustedVersion = screen.getByRole("textbox", {
      name: /Trusted version/,
    });

    await user.clear(packageName);
    await user.clear(trustedVersion);
    await user.click(screen.getByRole("button", { name: "Analyze Update" }));

    expect(push).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(packageName);
    expect(packageName.getAttribute("aria-invalid")).toBe("true");
    expect(trustedVersion.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Enter an npm package name.")).toBeTruthy();

    await user.type(packageName, "@synthetic/example-widget");
    await user.click(screen.getByRole("button", { name: "Analyze Update" }));

    expect(push).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trustedVersion);
    expect(packageName.getAttribute("aria-invalid")).toBe("false");
    expect(screen.getByText("Enter a version.")).toBeTruthy();
  });

  it("rejects equal releases and identifies the candidate field", async () => {
    const user = userEvent.setup();
    render(<ComparisonForm enabled />);
    const candidateVersion = screen.getByRole("textbox", {
      name: /Candidate version/,
    });

    await user.clear(candidateVersion);
    await user.type(candidateVersion, "1.4.1");
    await user.click(screen.getByRole("button", { name: "Analyze Update" }));

    expect(push).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(candidateVersion);
    expect(candidateVersion.getAttribute("aria-invalid")).toBe("true");
    expect(
      screen.getByText("Choose two different versions to compare."),
    ).toBeTruthy();
  });

  it("routes valid custom input only to the fixed synthetic demo", async () => {
    const user = userEvent.setup();
    render(<ComparisonForm enabled />);
    const packageName = screen.getByRole("textbox", { name: "Package name" });
    const trustedVersion = screen.getByRole("textbox", {
      name: /Trusted version/,
    });
    const candidateVersion = screen.getByRole("textbox", {
      name: /Candidate version/,
    });

    await user.clear(packageName);
    await user.type(packageName, "@synthetic/another-package");
    await user.clear(trustedVersion);
    await user.type(trustedVersion, "10.2.3");
    await user.clear(candidateVersion);
    await user.type(candidateVersion, "99.0.1-beta.2");
    await user.click(screen.getByRole("button", { name: "Analyze Update" }));

    expect(push).toHaveBeenCalledExactlyOnceWith(
      `/analysis/${DEMO_ANALYSIS_ID}`,
    );
    expect(
      (
        screen.getByRole("button", {
          name: /Opening demo/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      screen.getByText(/Your input is never fetched or executed/),
    ).toBeTruthy();
  });

  it("disables inputs and blocks even a programmatic submission when demo mode is off", () => {
    render(<ComparisonForm enabled={false} />);
    const button = screen.getByRole("button", {
      name: "Analyze Update",
    }) as HTMLButtonElement;

    expect(button.disabled).toBe(true);
    for (const input of screen.getAllByRole("textbox")) {
      expect((input as HTMLInputElement).disabled).toBe(true);
    }
    const form = button.closest("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form!);

    expect(push).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: "Try Demo" })).toBeNull();
    expect(screen.getByText("Analysis is disabled.")).toBeTruthy();
  });

  it("offers an explicit demo link to the same synthetic fixture", () => {
    render(<ComparisonForm enabled />);
    expect(
      screen.getByRole("link", { name: "Try Demo" }).getAttribute("href"),
    ).toBe(`/analysis/${DEMO_ANALYSIS_ID}`);
  });
});

describe("deterministic analysis walkthrough", () => {
  it("advances on exact stage boundaries and stops while paused", async () => {
    vi.useFakeTimers();
    render(<AnalysisProgress id={DEMO_ANALYSIS_ID} />);
    const progress = screen.getByRole("progressbar", {
      name: "Demo analysis progress",
    });

    expect(progress.getAttribute("aria-valuenow")).toBe("0");
    expect(screen.getByRole("status").textContent).toContain(
      "Stage 1 of 10: Fetching package metadata",
    );
    act(() => {
      vi.advanceTimersByTime(DEMO_STAGE_DURATION - 1);
    });
    expect(progress.getAttribute("aria-valuenow")).toBe("0");
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(progress.getAttribute("aria-valuenow")).toBe("10");
    expect(screen.getByRole("status").textContent).toContain(
      "Stage 2 of 10: Downloading releases",
    );

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    act(() => {
      vi.advanceTimersByTime(DEMO_STAGE_DURATION * 20);
    });
    expect(progress.getAttribute("aria-valuenow")).toBe("10");
    expect(screen.getByRole("status").textContent).toContain("Demo paused");

    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    act(() => {
      vi.advanceTimersByTime(DEMO_STAGE_DURATION);
    });
    expect(progress.getAttribute("aria-valuenow")).toBe("20");
    expect(screen.getByRole("status").textContent).toContain(
      "Stage 3 of 10: Comparing package contents",
    );
  });

  it("completes every stage, links the report, and can replay from the beginning", async () => {
    vi.useFakeTimers();
    render(<AnalysisProgress id={DEMO_ANALYSIS_ID} />);
    const progress = screen.getByRole("progressbar", {
      name: "Demo analysis progress",
    });

    for (let index = 0; index < ANALYSIS_STAGES.length; index += 1) {
      act(() => {
        vi.advanceTimersByTime(DEMO_STAGE_DURATION);
      });
      expect(progress.getAttribute("aria-valuenow")).toBe(
        String((index + 1) * 10),
      );
    }

    expect(screen.getByRole("status").textContent).toBe(
      "Demo complete. The evidence report is ready.",
    );
    expect(
      screen
        .getByRole("link", { name: "View evidence report" })
        .getAttribute("href"),
    ).toBe(`/report/${DEMO_ANALYSIS_ID}`);
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
    expect(push).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Replay" }));
    expect(progress.getAttribute("aria-valuenow")).toBe("0");
    expect(screen.getByRole("status").textContent).toContain("Stage 1 of 10");
    expect(
      screen.getByRole("link", { name: "Skip to demo report" }),
    ).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(DEMO_STAGE_DURATION);
    });
    expect(progress.getAttribute("aria-valuenow")).toBe("10");
  });
});

describe("report export", () => {
  it("downloads the complete synthetic report as JSON and releases the blob URL", async () => {
    vi.useFakeTimers();
    const createObjectURL = vi
      .fn<(value: Blob | MediaSource) => string>()
      .mockReturnValue("blob:synthetic-report");
    const revokeObjectURL = vi.fn<(url: string) => void>();
    vi.stubGlobal("Blob", NodeBlob);
    vi.stubGlobal(
      "URL",
      class extends URL {
        static createObjectURL = createObjectURL;
        static revokeObjectURL = revokeObjectURL;
      },
    );
    const downloads: { href: string; filename: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloads.push({ href: this.href, filename: this.download });
    });
    render(<ReportActions report={DEMO_REPORT} />);

    fireEvent.click(screen.getByRole("button", { name: "Export JSON" }));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const exportedBlob = createObjectURL.mock
      .calls[0][0] as unknown as NodeBlob;
    expect(exportedBlob.type).toBe("application/json");
    expect(JSON.parse(await exportedBlob.text())).toEqual(DEMO_REPORT);
    expect(downloads).toEqual([
      {
        href: "blob:synthetic-report",
        filename: "dependencyguard-example-utils-1.4.2.json",
      },
    ]);
    expect(screen.getByRole("button", { name: "Exported" })).toBeTruthy();
    expect(document.querySelector("a[download]")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith(
      "blob:synthetic-report",
    );
  });

  it("announces export failure without reporting a successful download", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "URL",
      class extends URL {
        static createObjectURL(): string {
          throw new Error("Object URLs unavailable");
        }
      },
    );
    render(<ReportActions report={DEMO_REPORT} />);

    await user.click(screen.getByRole("button", { name: "Export JSON" }));

    expect(screen.getByRole("alert").textContent).toBe(
      "The report could not be exported. Please try again.",
    );
    expect(screen.queryByRole("button", { name: "Exported" })).toBeNull();
    expect(screen.getByRole("button", { name: "Export JSON" })).toBeTruthy();
  });
});
