import "server-only";
import path from "node:path";
import { AnalysisStore, JobLimitError } from "@/lib/analysis/store";
import { fetchRelease } from "@/lib/analysis/registry";
import { fetchSnapshot } from "@/lib/analysis/archive";
import { compareSnapshots } from "@/lib/analysis/compare";
import { AnalysisInputError } from "@/lib/analysis/errors";
import { comparisonInputSchema, type ComparisonInput } from "@/lib/validation";
import type { AnalysisJob, StaticAnalysisReport } from "@/lib/types/static-analysis";

export class BusyError extends Error {}

type Pipeline = (job: AnalysisJob, progress: (stage: number) => Promise<void>) => Promise<StaticAnalysisReport>;

export async function analyzeReleases(job: AnalysisJob, progress: (stage: number) => Promise<void>): Promise<StaticAnalysisReport> {
  await progress(0);
  // Sequential acquisitions bound memory and upstream load per job.
  const trustedRelease = await fetchRelease(job.input.packageName, job.input.trustedVersion);
  const candidateRelease = await fetchRelease(job.input.packageName, job.input.candidateVersion);
  await progress(1);
  const trusted = await fetchSnapshot(trustedRelease);
  const candidate = await fetchSnapshot(candidateRelease);
  await progress(2);
  await progress(3);
  const report = compareSnapshots(job.id, job.input, trusted, candidate);
  await progress(4);
  return report;
}

export class AnalysisJobs {
  private readonly active = new Map<string, { job: AnalysisJob; running: boolean }>();
  private reservations = 0;
  private starts: number[] = [];
  constructor(readonly store: AnalysisStore, private readonly pipeline: Pipeline = analyzeReleases) {}

  async create(input: ComparisonInput) {
    const validated = comparisonInputSchema.parse(input);
    const now = Date.now();
    this.starts = this.starts.filter((at) => at > now - 60_000);
    if (this.active.size + this.reservations >= 2) throw new BusyError("Two analyses are already running. Wait for one to finish and try again.");
    if (this.starts.length >= 10) throw new BusyError("Analysis limit reached. Please wait one minute before starting another.");
    this.starts.push(now);
    this.reservations += 1;
    try {
      const job = await this.store.create(validated);
      this.active.set(job.id, { job, running: false });
      return job;
    } finally { this.reservations -= 1; }
  }

  async run(id: string) {
    const entry = this.active.get(id);
    if (!entry || entry.running) return;
    entry.running = true;
    const update = async (patch: Partial<AnalysisJob>) => {
      entry.job = { ...entry.job, ...patch, updatedAt: new Date().toISOString() };
      await this.store.saveJob(entry.job);
    };
    try {
      const report = await this.pipeline(entry.job, async (stage) => update({ status: "running", stage }));
      await this.store.saveReport(report);
      await update({ status: "completed", stage: 5 });
    } catch (error) {
      const message = error instanceof AnalysisInputError || error instanceof JobLimitError ? error.message : "Analysis could not finish. Check the server connection and local storage, then retry.";
      try { await update({ status: "failed", error: message }); }
      catch { /* A later read recovers an interrupted persisted job. */ }
    } finally { this.active.delete(id); }
  }

  async get(id: string): Promise<AnalysisJob | null> {
    const active = this.active.get(id);
    if (active) return { ...active.job };
    const job = await this.store.getJob(id);
    if (job && (job.status === "running" || job.status === "queued")) {
      const interrupted: AnalysisJob = { ...job, status: "failed", error: "The server restarted before this analysis finished. Start a new analysis to retry.", updatedAt: new Date().toISOString() };
      await this.store.saveJob(interrupted);
      return interrupted;
    }
    return job;
  }

  async recent() {
    const jobs = await this.store.listJobs();
    return Promise.all(jobs.slice(0, 12).map(async (job) => (await this.get(job.id))!));
  }
}

// Shared across Next.js route bundles and development hot reloads in one Node process.
const host = globalThis as typeof globalThis & { dependencyGuardJobs?: AnalysisJobs };
export const analysisJobs = host.dependencyGuardJobs ??= new AnalysisJobs(new AnalysisStore(path.join(process.cwd(), ".dependencyguard", "analyses")));
