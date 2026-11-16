import { createHash } from "node:crypto";
import { mkdtemp, readdir, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { AnalysisJobs } from "@/lib/analysis/jobs";
import { AnalysisStore } from "@/lib/analysis/store";
import { compareSnapshots } from "@/lib/analysis/compare";
import { computeTriage } from "@/lib/analysis/triage";
import type { PackageSnapshot } from "@/lib/types/static-analysis";
import {
  expectReferencedTriage,
  triageCategories,
  triageReport,
  triageSignal,
} from "./helpers/triage-fixtures";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Network is disabled in triage report tests.");
    }),
  );
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

function snapshot(
  version: string,
  sources: Record<string, string | null>,
): PackageSnapshot {
  const report = triageReport();
  return {
    ...report.releases.trusted,
    release: { ...report.releases.trusted.release, version },
    manifest: {
      name: report.input.packageName,
      version,
      scripts: {},
      dependencies: {},
      optionalDependencies: {},
      peerDependencies: {},
    },
    files: Object.entries(sources).map(([name, text]) => ({
      path: name,
      size: Buffer.byteLength(text ?? "\0"),
      text,
      sha256: createHash("sha256")
        .update(text ?? "\0")
        .digest("hex"),
    })),
  };
}
function compare(old: PackageSnapshot, next: PackageSnapshot) {
  const fixture = triageReport();
  const report = compareSnapshots(fixture.id, fixture.input, old, next);
  const triage = computeTriage(report);
  expectReferencedTriage(triage, report);
  expect(report.riskScore).toBeNull();
  expect(report.status).toBe("INCONCLUSIVE");
  return { report, triage };
}

it("uses actual comparer categories and old/new totals on authored source", () => {
  const { triage } = compare(
    snapshot("1.0.0", { "index.js": "module.exports = 1;" }),
    snapshot("1.1.0", {
      "index.js":
        "fetch('https://example.invalid'); process.env.PUBLIC; spawn('example'); writeFile('example'); eval('1');",
    }),
  );
  expect(triage.tier).toBe("needs-review");
  expect(triage.reasons.map((reason) => reason.id).sort()).toEqual(
    triageCategories.map((category) => `${category}-matches-increased`).sort(),
  );
  expect(
    triage.reasons.every((reason) =>
      reason.evidenceRef.startsWith("#/signalCounts/"),
    ),
  ).toBe(true);
});

it("uses actual added-file evidence when aggregate match totals stay equal", () => {
  const { report, triage } = compare(
    snapshot("1.0.0", { "old.js": "fetch('https://example.invalid');" }),
    snapshot("1.1.0", { "added.js": "fetch('https://example.invalid');" }),
  );
  expect(report.signalCounts[0]).toMatchObject({ oldCount: 1, newCount: 1 });
  expect(triage.tier).toBe("needs-review");
  expect(triage.reasons).toHaveLength(1);
  expect(triage.reasons[0].id).toBe("new-file:STATIC-001");
});

it.each([
  { name: "binary", text: null, oversized: false, truncated: false },
  {
    name: "oversized",
    text: "module.exports = 1;",
    oversized: true,
    truncated: true,
  },
  {
    name: "non-source",
    text: "Authored documentation",
    oversized: false,
    truncated: false,
  },
])(
  "reflects the existing $name exclusion flags without new scanning",
  ({ name, text, oversized, truncated }) => {
    const filename = name === "non-source" ? "README.md" : "index.js";
    const old = snapshot("1.0.0", { [filename]: text });
    const next = snapshot("1.1.0", { [filename]: text });
    if (oversized) {
      old.files[0].size = 256 * 1024 + 1;
      next.files[0].size = 256 * 1024 + 1;
    }
    const { report, triage } = compare(old, next);
    expect(report.coverage).toMatchObject({ skippedFiles: 2, truncated });
    expect(triage.tier).toBe("incomplete");
    expect(triage.reasons).toHaveLength(truncated ? 2 : 1);
  },
);

it("persists additive triage on completed real reports without changing their existing fields", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "dg-triage-report-"));
  try {
    const fixture = triageReport();
    fixture.metadataSignals = [triageSignal("maintainer-changed")];
    fixture.coverage.skippedFiles = 2;
    const store = new AnalysisStore(directory);
    const jobs = new AnalysisJobs(store, async (job) => ({
      ...fixture,
      id: job.id,
      input: job.input,
    }));
    const job = await jobs.create(fixture.input);
    await jobs.run(job.id);
    const stored = await store.getReport(job.id);
    expect(stored).not.toBeNull();
    const { triage, ...existingFields } = stored!;
    expect(existingFields).toEqual({
      ...fixture,
      id: job.id,
      input: job.input,
    });
    expectReferencedTriage(triage!, stored!);
    expect(triage!.tier).toBe("needs-review");
    expect(stored!.riskScore).toBeNull();
    expect(stored!.status).toBe("INCONCLUSIVE");
    expect((await jobs.get(job.id))?.status).toBe("completed");
    const restored = await new AnalysisStore(directory).getReport(job.id);
    expect(restored?.triage).toEqual(triage);
  } finally {
    for (const filename of await readdir(directory))
      await unlink(path.join(directory, filename));
    await rmdir(directory);
  }
});
