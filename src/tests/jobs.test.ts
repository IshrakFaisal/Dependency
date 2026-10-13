import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AnalysisJob,
  StaticAnalysisReport,
} from "@/lib/types/static-analysis";

vi.mock("server-only", () => ({}));
import { AnalysisStore } from "@/lib/analysis/store";
import { AnalysisJobs } from "@/lib/analysis/jobs";
import { AnalysisInputError } from "@/lib/analysis/errors";

let directory: string;
const input = {
  packageName: "test-fixture",
  trustedVersion: "1.0.0",
  candidateVersion: "1.1.0",
};
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "dependencyguard-test-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function report(job: AnalysisJob): StaticAnalysisReport {
  return {
    id: job.id,
    mode: "static",
    input: job.input,
    status: "INCONCLUSIVE",
    riskScore: null,
    generatedAt: job.createdAt,
    summary: "Static fixture",
    releases: {} as StaticAnalysisReport["releases"],
    fileChanges: [],
    manifestChanges: [],
    findings: [],
    evidence: [],
    signalCounts: [],
    coverage: {
      trustedFilesScanned: 0,
      candidateFilesScanned: 0,
      skippedFiles: 0,
      truncated: false,
      notes: [],
    },
    limitations: [],
  };
}

describe("persistent local analysis jobs", () => {
  it("persists progress and the final report, which survives a new service instance", async () => {
    const store = new AnalysisStore(directory);
    const stages: number[] = [];
    const jobs = new AnalysisJobs(store, async (job, progress) => {
      for (let stage = 0; stage < 5; stage++) {
        await progress(stage);
        stages.push((await store.getJob(job.id))!.stage);
      }
      return report(job);
    });
    const job = await jobs.create(input);
    expect((await jobs.get(job.id))?.status).toBe("queued");
    expect(await store.getReport(job.id)).toBeNull();
    await jobs.run(job.id);
    expect(stages).toEqual([0, 1, 2, 3, 4]);
    const restored = new AnalysisJobs(new AnalysisStore(directory));
    expect((await restored.get(job.id))?.status).toBe("completed");
    expect((await restored.store.getReport(job.id))?.riskScore).toBeNull();
    expect((await restored.recent())[0].id).toBe(job.id);
  });

  it("recovers interrupted jobs as failures instead of fabricating progress", async () => {
    const store = new AnalysisStore(directory);
    const job = await store.create(input);
    await store.saveJob({ ...job, status: "running", stage: 2 });
    const restored = new AnalysisJobs(store);
    expect(await restored.get(job.id)).toMatchObject({
      status: "failed",
      stage: 2,
      error: expect.stringContaining("restarted"),
    });
    expect(await store.getReport(job.id)).toBeNull();
  });

  it("bounds concurrent admission even when requests race during storage writes", async () => {
    const jobs = new AnalysisJobs(new AnalysisStore(directory), async (job) =>
      report(job),
    );
    const results = await Promise.allSettled([
      jobs.create(input),
      jobs.create(input),
      jobs.create(input),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(2);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    for (const result of results)
      if (result.status === "fulfilled") await jobs.run(result.value.id);
    expect((await jobs.create(input)).status).toBe("queued");
  });

  it("runs an accepted job only once", async () => {
    const pipeline = vi.fn(async (job: AnalysisJob) => report(job));
    const jobs = new AnalysisJobs(new AnalysisStore(directory), pipeline);
    const job = await jobs.create(input);
    await Promise.all([jobs.run(job.id), jobs.run(job.id)]);
    expect(pipeline).toHaveBeenCalledTimes(1);
  });

  it("persists a safe upstream failure and releases the concurrency slot", async () => {
    const jobs = new AnalysisJobs(new AnalysisStore(directory), async () => {
      throw new AnalysisInputError("Archive integrity verification failed.");
    });
    const job = await jobs.create(input);
    await jobs.run(job.id);
    expect(await jobs.get(job.id)).toMatchObject({
      status: "failed",
      error: "Archive integrity verification failed.",
    });
    expect(await jobs.store.getReport(job.id)).toBeNull();
    expect((await jobs.create(input)).status).toBe("queued");
  });

  it("does not disclose internal exceptions to API clients", async () => {
    const jobs = new AnalysisJobs(new AnalysisStore(directory), async () => {
      throw new Error("secret local path and credential");
    });
    const job = await jobs.create(input);
    await jobs.run(job.id);
    expect((await jobs.get(job.id))?.error).not.toContain("secret");
  });

  it("rate limits repeated analyses even after each finishes", async () => {
    const jobs = new AnalysisJobs(new AnalysisStore(directory), async (job) =>
      report(job),
    );
    for (let index = 0; index < 10; index++) {
      const job = await jobs.create(input);
      await jobs.run(job.id);
    }
    await expect(jobs.create(input)).rejects.toThrow("one minute");
  });

  it("rejects path-like report identifiers without touching other files", async () => {
    const store = new AnalysisStore(directory);
    expect(await store.getJob("../../package")).toBeNull();
    expect(await store.getReport("C:\\Windows\\system.ini")).toBeNull();
  });
});
