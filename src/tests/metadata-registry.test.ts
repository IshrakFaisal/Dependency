import { afterEach, describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/metadata-packument.json";
vi.mock("server-only", () => ({}));
import { fetchVersionMetadata, REGISTRY_LIMITS } from "@/lib/analysis/registry";

afterEach(() => vi.unstubAllGlobals());
function mockPackument(value: unknown = fixture) {
  const fetchMock = vi.fn().mockResolvedValue(Response.json(value));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
describe("version metadata fetch helper (mocked registry only)", () => {
  it("reuses bounded no-store registry transport and requests full metadata for a scoped name", async () => {
    const fetchMock = mockPackument();
    const result = await fetchVersionMetadata(fixture.name, "1.0.0");
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      new URL("https://registry.npmjs.org/%40dg-fixture%2Fmetadata-signals"),
      expect.objectContaining({
        method: "GET",
        redirect: "error",
        cache: "no-store",
        signal: expect.any(AbortSignal),
        headers: { Accept: "application/json" },
      }),
    );
    expect(result._npmUser).toEqual(fixture.versions["1.0.0"]._npmUser);
    expect(result.maintainers).toEqual(fixture.versions["1.0.0"].maintainers);
    expect(result.dist?.attestations).toEqual(
      fixture.versions["1.0.0"].dist.attestations,
    );
    expect(result.time).toEqual({ "1.0.0": fixture.time["1.0.0"] });
    expect(result).not.toHaveProperty("versions");
  });
  it("handles missing optional fields and never substitutes current owners or modified time", async () => {
    mockPackument();
    const result = await fetchVersionMetadata(fixture.name, "2.0.0");
    expect(result).toEqual({
      name: fixture.name,
      version: "2.0.0",
      time: undefined,
    });
  });
  it("takes publication time from the packument, not a version-local time object", async () => {
    const value = structuredClone(fixture);
    const version = {
      ...value.versions["1.1.0"],
      time: { "1.1.0": "2000-01-01T00:00:00.000Z" },
    };
    mockPackument({
      ...value,
      versions: { ...value.versions, "1.1.0": version },
    });
    expect((await fetchVersionMetadata(fixture.name, "1.1.0")).time).toEqual({
      "1.1.0": fixture.time["1.1.0"],
    });
  });
  it("accepts a packument with no time map", async () => {
    mockPackument({ ...fixture, time: undefined });
    expect(
      (await fetchVersionMetadata(fixture.name, "1.0.0")).time,
    ).toBeUndefined();
  });
  it.each([
    ["../private", "1.0.0"],
    [fixture.name, "latest"],
    [fixture.name, "1.0.0 "],
  ])("rejects invalid identifiers before transport", async (name, version) => {
    const fetchMock = mockPackument();
    await expect(fetchVersionMetadata(name, version)).rejects.toThrow(
      "valid npm package name",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rejects missing versions and mismatched package/version identities", async () => {
    mockPackument();
    await expect(fetchVersionMetadata(fixture.name, "9.0.0")).rejects.toThrow(
      "missing",
    );
    mockPackument({ ...fixture, name: "another-fixture" });
    await expect(fetchVersionMetadata(fixture.name, "1.0.0")).rejects.toThrow(
      "mismatched",
    );
    mockPackument({
      ...fixture,
      versions: { "1.0.0": fixture.versions["1.1.0"] },
    });
    await expect(fetchVersionMetadata(fixture.name, "1.0.0")).rejects.toThrow(
      "identity",
    );
  });
  it("rejects invalid JSON and oversized packuments through the existing client", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{invalid")));
    await expect(fetchVersionMetadata(fixture.name, "1.0.0")).rejects.toThrow(
      "invalid package metadata",
    );
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("x", {
            headers: {
              "content-length": String(REGISTRY_LIMITS.metadataBytes + 1),
            },
          }),
        ),
    );
    await expect(fetchVersionMetadata(fixture.name, "1.0.0")).rejects.toThrow(
      "download size",
    );
  });
});
