import { afterEach, expect, it, vi } from "vitest";
const { getReport, load } = vi.hoisted(() => ({
  getReport: vi.fn(),
  load: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/analysis/jobs", () => ({
  analysisJobs: { store: { getReport } },
}));
vi.mock("@/lib/runtime/storage", () => ({ loadRuntimeEvidence: load }));
afterEach(() => {
  vi.resetAllMocks();
  vi.resetModules();
  vi.unstubAllEnvs();
});
const request = new Request("http://localhost/api/analyses/id/runtime");
const context = { params: Promise.resolve({ id: "fixture-id" }) };
it("only reads completed report evidence with no cached response", async () => {
  getReport.mockResolvedValue({ id: "fixture-id" });
  load.mockResolvedValue({ status: "not_run" });
  const { GET } = await import("@/app/api/analyses/[id]/runtime/route");
  const response = await GET(request, context);
  expect(await response.json()).toEqual({ status: "not_run" });
  expect(response.headers.get("cache-control")).toBe("no-store");
});
it("returns 404 for missing reports and honors the analysis gate", async () => {
  const { GET } = await import("@/app/api/analyses/[id]/runtime/route");
  expect((await GET(request, context)).status).toBe(404);
  expect(load).not.toHaveBeenCalled();
  vi.stubEnv("STATIC_ANALYSIS_ENABLED", "false");
  vi.resetModules();
  const disabled = await import("@/app/api/analyses/[id]/runtime/route");
  expect((await disabled.GET(request, context)).status).toBe(503);
});
