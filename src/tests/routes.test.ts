import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("demo route boundaries", () => {
  it.each(["analysis", "report"] as const)(
    "rejects unknown %s identifiers",
    async (route) => {
      vi.stubEnv("DEMO_MODE", "true");
      const { default: Page } =
        route === "analysis"
          ? await import("@/app/analysis/[id]/page")
          : await import("@/app/report/[id]/page");
      await expect(
        Page({ params: Promise.resolve({ id: "unrecognized-package" }) }),
      ).rejects.toThrow("NEXT_NOT_FOUND");
    },
  );

  it.each(["analysis", "report"] as const)(
    "disables the valid %s fixture when demo mode is false",
    async (route) => {
      vi.stubEnv("DEMO_MODE", "false");
      const { default: Page } =
        route === "analysis"
          ? await import("@/app/analysis/[id]/page")
          : await import("@/app/report/[id]/page");
      await expect(
        Page({ params: Promise.resolve({ id: "demo-example-utils" }) }),
      ).rejects.toThrow("NEXT_NOT_FOUND");
    },
  );

  it.each(["analysis", "report"] as const)(
    "renders the known %s fixture when demo mode is true",
    async (route) => {
      vi.stubEnv("DEMO_MODE", "true");
      const { default: Page } =
        route === "analysis"
          ? await import("@/app/analysis/[id]/page")
          : await import("@/app/report/[id]/page");
      await expect(
        Page({ params: Promise.resolve({ id: "demo-example-utils" }) }),
      ).resolves.toBeTruthy();
    },
  );

  it("fails closed for an unrecognized configuration value", async () => {
    vi.stubEnv("DEMO_MODE", "enabled");
    const { demoMode } = await import("@/lib/config");
    expect(demoMode).toBe(false);
  });
});
