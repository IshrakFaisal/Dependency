import { afterEach, describe, expect, it, vi } from "vitest";

const { create, get, run, schedule } = vi.hoisted(() => ({
  create: vi.fn(),
  get: vi.fn(),
  run: vi.fn(),
  schedule: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: schedule }));
vi.mock("@/lib/analysis/jobs", () => ({
  analysisJobs: { create, get, run },
  BusyError: class BusyError extends Error {},
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.clearAllMocks();
});
const input = {
  packageName: "synthetic-test",
  trustedVersion: "1.0.0",
  candidateVersion: "1.1.0",
};
function request(body: unknown = input, headers: Record<string, string> = {}) {
  return new Request("http://localhost:3000/api/analyses", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("analysis HTTP boundary", () => {
  it("accepts the browser Host when Next normalizes its internal URL", async () => {
    const { POST } = await import("@/app/api/analyses/route");
    create.mockResolvedValue({ id: "test-job" });
    const response = await POST(
      request(input, {
        host: "127.0.0.1:3000",
        origin: "http://127.0.0.1:3000",
      }),
    );
    expect(response.status).toBe(202);
  });

  it("creates a job and schedules work after the response", async () => {
    const { POST } = await import("@/app/api/analyses/route");
    create.mockResolvedValue({ id: "test-job" });
    const response = await POST(request());
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ id: "test-job" });
    expect(create).toHaveBeenCalledExactlyOnceWith(input);
    expect(run).not.toHaveBeenCalled();
    await schedule.mock.calls[0][0]();
    expect(run).toHaveBeenCalledExactlyOnceWith("test-job");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("blocks cross-origin submission before starting work", async () => {
    const { POST } = await import("@/app/api/analyses/route");
    expect(
      (await POST(request(input, { origin: "https://untrusted.invalid" })))
        .status,
    ).toBe(403);
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    { ...input, command: "echo unexpected" },
    { ...input, packageName: "https://untrusted.invalid" },
    { ...input, trustedVersion: "latest" },
  ])("rejects non-comparison input %#", async (body) => {
    const { POST } = await import("@/app/api/analyses/route");
    expect((await POST(request(body))).status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("enforces request limits on streamed content without Content-Length", async () => {
    const { POST } = await import("@/app/api/analyses/route");
    expect(
      (await POST(request({ packageName: "x".repeat(5000) }))).status,
    ).toBe(413);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects unsupported content types and malformed JSON", async () => {
    const { POST } = await import("@/app/api/analyses/route");
    expect(
      (await POST(request(input, { "content-type": "text/plain" }))).status,
    ).toBe(415);
    expect(
      (
        await POST(
          new Request("http://localhost:3000/api/analyses", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{",
          }),
        )
      ).status,
    ).toBe(400);
  });

  it("disables actual analysis independently of DEMO_MODE", async () => {
    vi.stubEnv("STATIC_ANALYSIS_ENABLED", "false");
    vi.stubEnv("DEMO_MODE", "true");
    const { POST } = await import("@/app/api/analyses/route");
    expect((await POST(request())).status).toBe(503);
    expect(create).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown job with no cached response", async () => {
    get.mockResolvedValue(null);
    const { GET } = await import("@/app/api/analyses/[id]/route");
    const response = await GET(
      new Request("http://localhost:3000/api/analyses/unknown"),
      { params: Promise.resolve({ id: "unknown" }) },
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
