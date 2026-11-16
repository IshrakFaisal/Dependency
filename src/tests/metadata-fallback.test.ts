import { afterEach, describe, expect, it, vi } from "vitest";
import versions from "./fixtures/metadata-packument.json";
import oversized from "./fixtures/oversized-packument.json";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/analysis/archive", () => ({ fetchSnapshot: vi.fn() }));
import { fetchSnapshot } from "@/lib/analysis/archive";
import { analyzeReleases } from "@/lib/analysis/jobs";
import { fetchVersionMetadata, REGISTRY_LIMITS } from "@/lib/analysis/registry";
import { computeMetadataSignals } from "@/lib/analysis/metadata-signals";
import { computeTriage } from "@/lib/analysis/triage";
import type { AnalysisJob } from "@/lib/types/static-analysis";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
const fullPackument = JSON.stringify({
  name: oversized.name,
  versions: versions.versions,
  time: oversized.time,
  [oversized.padding.field]: oversized.padding.character.repeat(
    oversized.padding.bytes,
  ),
});
const now = "2026-11-15T00:00:00.000Z";
function registry(fullResponse: () => Response) {
  const fetcher = vi.fn(async (url: URL) => {
    const version = url.pathname.split("/").at(-1)!;
    if (version === "1.0.0" || version === "1.1.0")
      return Response.json(versions.versions[version]);
    return fullResponse();
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
describe("optional full packument fallback (authored HTTP only)", () => {
  it.each([false, true])(
    "retains per-version metadata when oversized body has content-length=%s",
    async (advertised) => {
      expect(Buffer.byteLength(fullPackument)).toBeGreaterThan(
        REGISTRY_LIMITS.metadataBytes,
      );
      const fetcher = registry(
        () =>
          new Response(fullPackument, {
            headers: advertised
              ? { "content-length": String(Buffer.byteLength(fullPackument)) }
              : {},
          }),
      );
      const before = await fetchVersionMetadata(versions.name, "1.0.0");
      const after = await fetchVersionMetadata(versions.name, "1.1.0");
      expect(after._npmUser).toEqual(versions.versions["1.1.0"]._npmUser);
      expect(fetcher.mock.calls[0][0].pathname).toMatch(/\/1\.0\.0$/);
      const signals = computeMetadataSignals(before, after, now);
      expect(signals.find(({ id }) => id === "recent-release")).toMatchObject({
        severity: "info",
        detail: "metadata unavailable",
        evidence: { publishedAt: null, ageMs: null },
      });
      expect(signals.map(({ id }) => id)).toContain("maintainer-changed");
      expect(REGISTRY_LIMITS.metadataBytes).toBe(2 * 1024 * 1024);
    },
  );
  it("completes the static pipeline despite oversized full packuments", async () => {
    registry(() => new Response(fullPackument));
    vi.mocked(fetchSnapshot).mockImplementation(async (release) => ({
      release,
      manifest: { ...release },
      files: [],
      archiveSha256: "a".repeat(64),
      integrityVerified: "sha1",
      compressedBytes: 100,
      unpackedBytes: 100,
      warnings: [],
    }));
    const job: AnalysisJob = {
      id: "19885bae-9370-4cab-85dd-45fe6707df7a",
      mode: "static",
      status: "running",
      stage: 0,
      input: {
        packageName: versions.name,
        trustedVersion: "1.0.0",
        candidateVersion: "1.1.0",
      },
      createdAt: now,
      updatedAt: now,
      error: null,
    };
    const report = await analyzeReleases(job, async () => {});
    expect(report.status).toBe("INCONCLUSIVE");
    expect(report.riskScore).toBeNull();
    expect(
      report.metadataSignals!.find(({ id }) => id === "recent-release")?.detail,
    ).toBe("metadata unavailable");
    expect(fetchSnapshot).toHaveBeenCalledTimes(2);
  });
  it("retains a genuine archive acquisition failure", async () => {
    registry(() => new Response(fullPackument));
    vi.mocked(fetchSnapshot).mockRejectedValueOnce(
      new Error("Archive entry limit"),
    );
    await expect(
      analyzeReleases(
        {
          id: "fixture",
          mode: "static",
          status: "running",
          stage: 0,
          input: {
            packageName: versions.name,
            trustedVersion: "1.0.0",
            candidateVersion: "1.1.0",
          },
          createdAt: now,
          updatedAt: now,
          error: null,
        },
        async () => {},
      ),
    ).rejects.toThrow("Archive entry limit");
  });
  it("ignores version-local time and availability flags during an oversized packument fallback", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL) =>
        url.pathname.endsWith("/1.1.0")
          ? Response.json({
              ...versions.versions["1.1.0"],
              time: oversized.time,
              metadataUnavailable: true,
              publicationTimeUnavailable: false,
            })
          : new Response(fullPackument),
      ),
    );
    const candidate = await fetchVersionMetadata(versions.name, "1.1.0");
    const signals = computeMetadataSignals(
      versions.versions["1.0.0"],
      candidate,
      now,
    );
    expect(candidate.metadataUnavailable).toBeUndefined();
    expect(signals.map(({ id }) => id)).toContain("maintainer-changed");
    expect(signals.find(({ id }) => id === "recent-release")).toMatchObject({
      severity: "info",
      detail: "metadata unavailable",
      evidence: { publishedAt: null },
    });
    expect(
      computeMetadataSignals(versions.versions["1.0.0"], candidate, now),
    ).toEqual(signals);
  });
  it("keeps bounded publish time and degrades missing/invalid time without a recency claim", async () => {
    registry(() =>
      Response.json({ name: versions.name, time: oversized.time }),
    );
    const known = await fetchVersionMetadata(versions.name, "1.1.0");
    expect(
      computeMetadataSignals({}, known, now).find(
        ({ id }) => id === "recent-release",
      )!.evidence,
    ).toMatchObject({ publishedAt: oversized.time["1.1.0"] });
    registry(() =>
      Response.json({ name: versions.name, time: { "1.1.0": "invalid" } }),
    );
    const unknown = await fetchVersionMetadata(versions.name, "1.1.0");
    const signals = computeMetadataSignals({}, unknown, now);
    const { triageReport } = await import("./helpers/triage-fixtures");
    const triage = computeTriage({
      ...triageReport(),
      metadataSignals: signals,
    });
    expect(
      triage.reasons.find(({ id }) => id === "recent-release")!.detail,
    ).toBe("metadata unavailable");
  });
  it("does not infer a provenance drop when candidate optional metadata is unavailable", () => {
    const signals = computeMetadataSignals(
      versions.versions["1.0.0"],
      { version: "1.1.0", metadataUnavailable: true },
      now,
    );
    expect(signals.map(({ id }) => id)).toEqual(["recent-release"]);
  });
  it("retains a known candidate publication time when only the old metadata is unavailable", () => {
    const signals = computeMetadataSignals(
      { version: "1.0.0", metadataUnavailable: true },
      { ...versions.versions["1.1.0"], time: oversized.time },
      now,
    );
    expect(signals.map(({ id }) => id)).toEqual(["recent-release"]);
    expect(signals[0].evidence).toMatchObject({
      publishedAt: oversized.time["1.1.0"],
    });
  });
});
