import { afterEach, describe, expect, it, vi } from "vitest";

const { get, getReport } = vi.hoisted(() => ({
  get: vi.fn(),
  getReport: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/analysis/jobs", () => ({
  analysisJobs: { get, store: { getReport } },
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (destination: string) => {
    throw new Error(`REDIRECT:${destination}`);
  },
}));

const id = "ae910c30-366e-4f3c-8677-8401df2fa044";
const props = { params: Promise.resolve({ id }) };
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.resetAllMocks();
});

describe("static page boundaries", () => {
  it.each(["analysis", "report"] as const)(
    "gates %s without reading storage",
    async (route) => {
      vi.stubEnv("STATIC_ANALYSIS_ENABLED", "false");
      const { default: Page } =
        route === "analysis"
          ? await import("@/app/analysis/[id]/page")
          : await import("@/app/report/[id]/page");
      await expect(Page(props)).rejects.toThrow("NEXT_NOT_FOUND");
      expect(get).not.toHaveBeenCalled();
    },
  );

  it("redirects unfinished reports to actual progress", async () => {
    get.mockResolvedValue({ id, status: "running" });
    const { default: Page } = await import("@/app/report/[id]/page");
    await expect(Page(props)).rejects.toThrow(`REDIRECT:/analysis/${id}`);
    expect(getReport).not.toHaveBeenCalled();
  });

  it("does not render a completed job whose report is missing", async () => {
    get.mockResolvedValue({ id, status: "completed" });
    getReport.mockResolvedValue(null);
    const { default: Page } = await import("@/app/report/[id]/page");
    await expect(Page(props)).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("renders stored report data instead of the synthetic fixture", async () => {
    get.mockResolvedValue({ id, status: "completed" });
    const report = { id, mode: "static" };
    getReport.mockResolvedValue(report);
    const { default: Page } = await import("@/app/report/[id]/page");
    const element = await Page(props);
    expect(element.props.report).toBe(report);
  });
});
