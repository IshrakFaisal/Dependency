import { afterEach, describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/metadata-packument.json";
vi.mock("server-only", () => ({}));
import { fetchVersionMetadata, REGISTRY_LIMITS } from "@/lib/analysis/registry";

afterEach(() => vi.unstubAllGlobals());
function mockPackument(value: unknown = fixture) {
  const fetchMock = vi.fn(async (url: URL) => {
    const packument = value as typeof fixture;
    const version = decodeURIComponent(url.pathname.split("/").at(-1)!);
    if (/^\d/.test(version)) {
      const manifest = (packument.versions as Record<string, unknown>)[version];
      return manifest
        ? Response.json({ ...(manifest as object), name: packument.name })
        : new Response("", { status: 404 });
    }
    return Response.json(value);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
describe("version metadata fetch helper (mocked registry only)", () => {
  it("requests a per-version manifest and optional publication time with bounded transport", async () => {
    const fetchMock = mockPackument();
    const result = await fetchVersionMetadata(fixture.name, "1.0.0");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      new URL(
        "https://registry.npmjs.org/%40dg-fixture%2Fmetadata-signals/1.0.0",
      ),
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
      publicationTimeUnavailable: true,
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
  it("marks optional metadata unavailable for missing or mismatched identities", async () => {
    mockPackument();
    await expect(
      fetchVersionMetadata(fixture.name, "9.0.0"),
    ).resolves.toMatchObject({ metadataUnavailable: true });
    mockPackument({ ...fixture, name: "another-fixture" });
    await expect(
      fetchVersionMetadata(fixture.name, "1.0.0"),
    ).resolves.toMatchObject({ metadataUnavailable: true });
    mockPackument({
      ...fixture,
      versions: { "1.0.0": fixture.versions["1.1.0"] },
    });
    await expect(
      fetchVersionMetadata(fixture.name, "1.0.0"),
    ).resolves.toMatchObject({ metadataUnavailable: true });
  });
  it("degrades invalid JSON and oversized optional metadata without failing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{invalid")));
    await expect(
      fetchVersionMetadata(fixture.name, "1.0.0"),
    ).resolves.toMatchObject({ metadataUnavailable: true });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("x", {
          headers: {
            "content-length": String(REGISTRY_LIMITS.metadataBytes + 1),
          },
        }),
      ),
    );
    await expect(
      fetchVersionMetadata(fixture.name, "1.0.0"),
    ).resolves.toMatchObject({ metadataUnavailable: true });
  });
});
