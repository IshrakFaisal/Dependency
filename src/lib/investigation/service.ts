import "server-only";
import { mkdir, open, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { StaticAnalysisReport } from "@/lib/types/static-analysis";
import { analysisIdSchema } from "@/lib/analysis/store";
import { buildInvestigationPacket } from "./packet";
import {
  investigationArtifactSchema,
  PROMPT_VERSION,
  validateCitations,
  type InvestigationArtifact,
  type InvestigationView,
} from "./contracts";
import {
  investigationConfig,
  InvestigationError,
  requestInvestigation,
} from "./provider";

export class InvestigationService {
  private starts: number[] = [];
  constructor(
    private readonly directory = path.join(
      process.cwd(),
      ".dependencyguard",
      "investigations",
    ),
    private readonly provider = requestInvestigation,
  ) {}

  private file(id: string) {
    return path.join(
      this.directory,
      `${analysisIdSchema.parse(id)}.investigation.json`,
    );
  }

  async view(report: StaticAnalysisReport): Promise<InvestigationView> {
    const config = investigationConfig();
    const packet = buildInvestigationPacket(report, config.model);
    const base: InvestigationView = {
      availability: !config.enabled
        ? "disabled"
        : !config.configured
          ? "not_configured"
          : !packet.ids.size
            ? "no_evidence"
            : "ready",
      status: "not_generated",
      model: config.model,
      fingerprint: packet.fingerprint,
      packetJson: packet.packetJson,
      artifact: null,
    };
    try {
      const handle = await open(this.file(report.id), "r");
      let data: Buffer;
      try {
        if ((await handle.stat()).size > 64 * 1024)
          return { ...base, status: "invalid" };
        data = Buffer.alloc(64 * 1024 + 1);
        const { bytesRead } = await handle.read(data, 0, data.length, 0);
        if (bytesRead > 64 * 1024) return { ...base, status: "invalid" };
        data = data.subarray(0, bytesRead);
      } finally {
        await handle.close();
      }
      const artifact = investigationArtifactSchema.parse(
        JSON.parse(data.toString("utf8")),
      );
      if (artifact.analysisId !== report.id)
        return { ...base, status: "invalid" };
      if (
        artifact.fingerprint !== packet.fingerprint ||
        artifact.model !== config.model
      )
        return { ...base, status: "stale" };
      validateCitations(artifact.output, packet.ids);
      return { ...base, status: "available", artifact };
    } catch (error) {
      return {
        ...base,
        status:
          (error as NodeJS.ErrnoException).code === "ENOENT"
            ? "not_generated"
            : "invalid",
      };
    }
  }

  async generate(
    report: StaticAnalysisReport,
    expectedFingerprint: string,
  ): Promise<InvestigationView> {
    const view = await this.view(report);
    if (view.availability !== "ready")
      throw new InvestigationError(
        view.availability === "no_evidence"
          ? "There are no static evidence excerpts to investigate."
          : "AI investigation is disabled or not configured.",
        503,
      );
    if (expectedFingerprint !== view.fingerprint)
      throw new InvestigationError(
        "Evidence or model configuration changed. Reload and review the preview before trying again.",
        409,
      );
    if (view.status === "available") return view;
    this.starts = this.starts.filter((time) => Date.now() - time < 60_000);
    if (this.starts.length >= 3)
      throw new InvestigationError(
        "AI request limit reached. Try again in a minute.",
        429,
      );
    await mkdir(this.directory, { recursive: true });
    const lock = path.join(this.directory, "investigation.lock");
    try {
      await writeFile(
        lock,
        JSON.stringify({
          startedAt: new Date().toISOString(),
          analysisId: report.id,
        }),
        { flag: "wx", mode: 0o600 },
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST")
        throw new InvestigationError(
          "An AI investigation is already running. Try again later. If this persists after a server restart, ask the operator to inspect the investigation lock.",
          409,
        );
      throw error;
    }
    try {
      // Recheck under the disk lock so concurrent requests cannot bill twice.
      const current = await this.view(report);
      if (current.status === "available") return current;
      const config = investigationConfig();
      const packet = buildInvestigationPacket(report, config.model);
      if (packet.fingerprint !== expectedFingerprint)
        throw new InvestigationError(
          "Configuration changed. Reload the report.",
          409,
        );
      this.starts.push(Date.now());
      const output = validateCitations(
        await this.provider(packet, config),
        packet.ids,
      );
      const artifact: InvestigationArtifact = investigationArtifactSchema.parse(
        {
          schemaVersion: 1,
          analysisId: report.id,
          fingerprint: packet.fingerprint,
          promptVersion: PROMPT_VERSION,
          provider: "Nebius Token Factory",
          model: config.model,
          generatedAt: new Date().toISOString(),
          output,
        },
      );
      const destination = this.file(report.id);
      const temporary = `${destination}.${randomUUID()}.tmp`;
      const data = JSON.stringify(artifact);
      if (Buffer.byteLength(data) > 64 * 1024)
        throw new InvestigationError("AI result exceeds the storage limit.");
      try {
        await writeFile(temporary, data, { flag: "wx", mode: 0o600 });
        await rename(temporary, destination);
      } finally {
        await unlink(temporary).catch(() => {});
      }
      return { ...current, status: "available", artifact };
    } finally {
      await unlink(lock);
    }
  }
}

const globalInvestigation = globalThis as typeof globalThis & {
  dependencyGuardInvestigations?: InvestigationService;
};
export const investigations =
  (globalInvestigation.dependencyGuardInvestigations ??=
    new InvestigationService());
