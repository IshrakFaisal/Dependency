import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { comparisonInputSchema, type ComparisonInput } from "@/lib/validation";
import type {
  AnalysisJob,
  StaticAnalysisReport,
} from "@/lib/types/static-analysis";

export const analysisIdSchema = z.string().uuid();
const jobSchema = z.object({
  id: analysisIdSchema,
  input: comparisonInputSchema,
  mode: z.literal("static"),
  status: z.enum(["queued", "running", "completed", "failed"]),
  stage: z.number().int().min(0).max(5),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  error: z.string().nullable(),
});

export class JobLimitError extends Error {}

/** Local single-process storage. Only UUID-derived filenames are ever written. */
export class AnalysisStore {
  constructor(private readonly directory: string) {}

  private file(id: string, suffix: "job" | "report") {
    return path.join(
      this.directory,
      `${analysisIdSchema.parse(id)}.${suffix}.json`,
    );
  }

  private async save(id: string, suffix: "job" | "report", value: unknown) {
    const data = JSON.stringify(value);
    if (Buffer.byteLength(data) > 8 * 1024 * 1024)
      throw new JobLimitError(
        "This report exceeds the local storage limit. Try a smaller package.",
      );
    await mkdir(this.directory, { recursive: true });
    const destination = this.file(id, suffix);
    const temporary = `${destination}.${randomUUID()}.tmp`;
    await writeFile(temporary, data, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporary, destination);
  }

  async create(input: ComparisonInput): Promise<AnalysisJob> {
    await mkdir(this.directory, { recursive: true });
    const existing = await readdir(this.directory);
    if (existing.filter((name) => name.endsWith(".job.json")).length >= 100) {
      throw new JobLimitError(
        "Local history has reached 100 analyses. Archive older files from .dependencyguard/analyses before starting another.",
      );
    }
    const now = new Date().toISOString();
    const job: AnalysisJob = {
      id: randomUUID(),
      input,
      mode: "static",
      status: "queued",
      stage: 0,
      createdAt: now,
      updatedAt: now,
      error: null,
    };
    await this.saveJob(job);
    return job;
  }

  async saveJob(job: AnalysisJob) {
    await this.save(job.id, "job", jobSchema.parse(job));
  }
  async saveReport(report: StaticAnalysisReport) {
    await this.save(report.id, "report", report);
  }

  async getJob(id: string): Promise<AnalysisJob | null> {
    if (!analysisIdSchema.safeParse(id).success) return null;
    try {
      const job = jobSchema.parse(
        JSON.parse(await readFile(this.file(id, "job"), "utf8")),
      );
      return job.id === id ? job : null;
    } catch (error) {
      if (
        error instanceof SyntaxError ||
        error instanceof z.ZodError ||
        (error as NodeJS.ErrnoException).code === "ENOENT"
      )
        return null;
      throw error;
    }
  }

  async getReport(id: string): Promise<StaticAnalysisReport | null> {
    if (!analysisIdSchema.safeParse(id).success) return null;
    const job = await this.getJob(id);
    if (job?.status !== "completed") return null;
    try {
      const report: StaticAnalysisReport = JSON.parse(
        await readFile(this.file(id, "report"), "utf8"),
      );
      return report.id === id &&
        report.mode === "static" &&
        report.status === "INCONCLUSIVE" &&
        report.riskScore === null
        ? report
        : null;
    } catch (error) {
      if (
        error instanceof SyntaxError ||
        (error as NodeJS.ErrnoException).code === "ENOENT"
      )
        return null;
      throw error;
    }
  }

  async listJobs(): Promise<AnalysisJob[]> {
    let names: string[];
    try {
      names = await readdir(this.directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const jobs = await Promise.all(
      names
        .filter((name) => name.endsWith(".job.json"))
        .slice(0, 100)
        .map((name) => this.getJob(name.slice(0, -9))),
    );
    return jobs
      .filter((job): job is AnalysisJob => job !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
