import { afterEach, expect, it, vi } from "vitest";
import fixture from "./fixtures/metadata-packument.json";
import type {
  AnalysisJob,
  PackageSnapshot,
  RegistryRelease,
} from "@/lib/types/static-analysis";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/analysis/archive", () => ({ fetchSnapshot: vi.fn() }));
import { fetchSnapshot } from "@/lib/analysis/archive";
import { analyzeReleases } from "@/lib/analysis/jobs";
import { compareSnapshots } from "@/lib/analysis/compare";
import { computeMetadataSignals } from "@/lib/analysis/metadata-signals";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.clearAllMocks();
});

it("attaches metadataSignals to a real pipeline report while every existing field and null riskScore remain unchanged", async () => {
  const now = "2026-11-15T00:00:00.000Z";
  vi.useFakeTimers();
  vi.setSystemTime(new Date(now));
  const snapshots: PackageSnapshot[] = [];
  vi.mocked(fetchSnapshot).mockImplementation(
    async (release: RegistryRelease) => {
      const snapshot: PackageSnapshot = {
        release,
        manifest: {
          name: release.name,
          version: release.version,
          scripts: release.scripts,
          dependencies: release.dependencies,
          optionalDependencies: release.optionalDependencies,
          peerDependencies: release.peerDependencies,
        },
        files: [],
        archiveSha256: "a".repeat(64),
        integrityVerified: "sha1",
        compressedBytes: 100,
        unpackedBytes: 100,
        warnings: [],
      };
      snapshots.push(snapshot);
      return snapshot;
    },
  );
  // All HTTP responses are authored fixtures. No registry/archive calls escape.
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(Response.json(fixture.versions["1.0.0"]))
    .mockResolvedValueOnce(Response.json(fixture.versions["1.1.0"]))
    .mockResolvedValueOnce(Response.json(fixture))
    .mockResolvedValueOnce(Response.json(fixture));
  vi.stubGlobal("fetch", fetchMock);
  const job: AnalysisJob = {
    id: "19885bae-9370-4cab-85dd-45fe6707df7a",
    mode: "static",
    status: "running",
    stage: 0,
    input: {
      packageName: fixture.name,
      trustedVersion: "1.0.0",
      candidateVersion: "1.1.0",
    },
    createdAt: now,
    updatedAt: now,
    error: null,
  };
  const progress = vi.fn().mockResolvedValue(undefined);
  const report = await analyzeReleases(job, progress);
  const { metadataSignals, ...existingFields } = report;
  expect(metadataSignals).toEqual(
    computeMetadataSignals(
      { ...fixture.versions["1.0.0"], time: fixture.time },
      { ...fixture.versions["1.1.0"], time: fixture.time },
      now,
    ),
  );
  expect(metadataSignals).toHaveLength(5);
  expect(existingFields).toEqual(
    compareSnapshots(job.id, job.input, snapshots[0], snapshots[1]),
  );
  expect(report.riskScore).toBeNull();
  expect(report.status).toBe("INCONCLUSIVE");
  expect(progress.mock.calls.map(([stage]) => stage)).toEqual([0, 1, 2, 3, 4]);
  expect(fetchMock).toHaveBeenCalledTimes(4);
});
