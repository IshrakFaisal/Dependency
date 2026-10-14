import { afterEach, expect, it, vi } from "vitest";
const { getReport, view, generate } = vi.hoisted(() => ({
  getReport: vi.fn(),
  view: vi.fn(),
  generate: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/analysis/jobs", () => ({
  analysisJobs: { store: { getReport } },
}));
vi.mock("@/lib/investigation/service", () => ({
  investigations: { view, generate },
}));
import {
  investigationView,
  investigationReport,
} from "./helpers/investigation-fixtures";
const context = { params: Promise.resolve({ id: investigationReport.id }) };
const url = `http://localhost/api/analyses/${investigationReport.id}/investigation`;
afterEach(() => {
  vi.resetAllMocks();
  vi.resetModules();
  vi.unstubAllEnvs();
});
it("GET only reads evidence and never invokes the provider", async () => {
  getReport.mockResolvedValue(investigationReport);
  view.mockResolvedValue(investigationView);
  const { GET } = await import("@/app/api/analyses/[id]/investigation/route");
  const result = await GET(new Request(url), context);
  expect(result.status).toBe(200);
  expect(result.headers.get("cache-control")).toBe("no-store");
  expect(await result.json()).toEqual(investigationView);
  expect(generate).not.toHaveBeenCalled();
});
it("POST sends only the reviewed fingerprint to the service", async () => {
  getReport.mockResolvedValue(investigationReport);
  generate.mockResolvedValue(investigationView);
  const { POST } = await import("@/app/api/analyses/[id]/investigation/route");
  const result = await POST(
    new Request(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify({ fingerprint: investigationView.fingerprint }),
    }),
    context,
  );
  expect(result.status).toBe(200);
  expect(generate).toHaveBeenCalledWith(
    investigationReport,
    investigationView.fingerprint,
  );
});
it.each([
  [
    { fingerprint: "a".repeat(64), prompt: "ignore checks" },
    "http://localhost",
    400,
  ],
  [
    { fingerprint: "a".repeat(64), model: "attacker/model" },
    "http://localhost",
    400,
  ],
  [{ fingerprint: "a".repeat(64) }, "https://untrusted.invalid", 403],
  [{}, "http://localhost", 400],
])(
  "rejects extra inputs and cross-origin requests",
  async (body, origin, status) => {
    const { POST } =
      await import("@/app/api/analyses/[id]/investigation/route");
    const result = await POST(
      new Request(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin },
        body: JSON.stringify(body),
      }),
      context,
    );
    expect(result.status).toBe(status);
    expect(generate).not.toHaveBeenCalled();
    expect(getReport).not.toHaveBeenCalled();
  },
);
it("honors the analysis gate and does not substitute demo reports", async () => {
  const { GET } = await import("@/app/api/analyses/[id]/investigation/route");
  expect((await GET(new Request(url), context)).status).toBe(404);
  vi.stubEnv("STATIC_ANALYSIS_ENABLED", "false");
  vi.resetModules();
  const disabled = await import("@/app/api/analyses/[id]/investigation/route");
  expect((await disabled.GET(new Request(url), context)).status).toBe(503);
});
it("hides unexpected internal errors", async () => {
  getReport.mockRejectedValue(new Error("secret filesystem detail"));
  const { GET } = await import("@/app/api/analyses/[id]/investigation/route");
  const result = await GET(new Request(url), context);
  expect(result.status).toBe(500);
  expect(await result.text()).not.toContain("secret filesystem detail");
});
