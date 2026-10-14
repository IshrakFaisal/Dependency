import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
vi.mock("server-only", () => ({}));
import {
  investigationConfig,
  NEBIUS_ENDPOINT,
  requestInvestigation,
} from "@/lib/investigation/provider";
import { buildInvestigationPacket } from "@/lib/investigation/packet";
import { validateCitations } from "@/lib/investigation/contracts";
import { InvestigationService } from "@/lib/investigation/service";
import {
  investigationReport as report,
  investigationOutput as output,
} from "./helpers/investigation-fixtures";

const config = investigationConfig({
  AI_INVESTIGATION_ENABLED: "true",
  NEBIUS_API_KEY: "synthetic-key-not-a-secret",
  NEBIUS_MODEL: "nvidia/synthetic-test-model",
});
const packet = () => buildInvestigationPacket(report, config.model);
const response = (value: unknown = output, finish = "stop") =>
  Response.json({
    choices: [
      { finish_reason: finish, message: { content: JSON.stringify(value) } },
    ],
  });
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("evidence packet and configuration", () => {
  it("defaults off, requires model and key, and rejects malformed configuration", () => {
    expect(investigationConfig({}).enabled).toBe(false);
    expect(
      investigationConfig({ AI_INVESTIGATION_ENABLED: "TRUE" }).enabled,
    ).toBe(false);
    for (const value of [
      { NEBIUS_MODEL: "x" },
      { NEBIUS_API_KEY: "x" },
      { NEBIUS_API_KEY: "x\ninjected", NEBIUS_MODEL: "x" },
      { NEBIUS_API_KEY: "x", NEBIUS_MODEL: "https://evil.invalid?x" },
    ]) {
      expect(investigationConfig(value).configured).toBe(false);
    }
  });
  it("bounds excerpts and evidence, redacts common secrets, and discloses omissions", () => {
    const value = structuredClone(report);
    value.evidence = Array.from({ length: 30 }, (_, i) => ({
      ...report.evidence[0],
      id: `E-${i}`,
      newExcerpt: 'api_key="synthetic-secret"; ' + "a".repeat(2000),
    }));
    const built = buildInvestigationPacket(value, config.model);
    const parsed = JSON.parse(built.packetJson);
    expect(parsed.evidence).toHaveLength(24);
    expect(parsed.coverage.omittedEvidence).toBe(6);
    expect(parsed.evidence[0].newExcerpt).toHaveLength(800);
    expect(built.packetJson).not.toContain("synthetic-secret");
    expect(built.packetJson).not.toContain("synthetic-key-not-a-secret");
    expect(built.packetJson).not.toContain("runtimeSupplement");
  });
  it("binds the cache to model, evidence, coverage and both archives", () => {
    const initial = packet().fingerprint;
    expect(packet().fingerprint).toBe(initial);
    expect(
      buildInvestigationPacket(report, "another/model").fingerprint,
    ).not.toBe(initial);
    for (const change of [
      (r: typeof report) => {
        r.evidence[0].newExcerpt = "changed";
      },
      (r: typeof report) => {
        r.coverage.truncated = true;
      },
      (r: typeof report) => {
        r.releases.trusted.archiveSha256 = "d".repeat(64);
      },
    ]) {
      const r = structuredClone(report);
      change(r);
      expect(buildInvestigationPacket(r, config.model).fingerprint).not.toBe(
        initial,
      );
    }
  });
  it("rejects fabricated/duplicate citations, unsolicited scores and oversized prose", () => {
    for (const value of [
      { ...output, riskScore: 99 },
      {
        ...output,
        observations: [
          { ...output.observations[0], evidenceIds: ["FABRICATED"] },
        ],
      },
      {
        ...output,
        observations: [
          {
            ...output.observations[0],
            evidenceIds: ["STATIC-EVD-001", "STATIC-EVD-001"],
          },
        ],
      },
      {
        ...output,
        observations: [
          { ...output.observations[0], interpretation: "a".repeat(1601) },
        ],
      },
    ])
      expect(() => validateCitations(value, packet().ids)).toThrow();
  });
});

describe("Nebius transport", () => {
  it("uses a fixed HTTPS endpoint, no redirects/tools, bounded output and a separate untrusted-data message", async () => {
    const transport = vi.fn().mockResolvedValue(response());
    expect(await requestInvestigation(packet(), config, transport)).toEqual(
      output,
    );
    const [url, init] = transport.mock.calls[0];
    expect(url).toBe(NEBIUS_ENDPOINT);
    expect(init.redirect).toBe("error");
    const body = JSON.parse(init.body);
    expect(body.max_tokens).toBe(4096);
    expect(body.tools).toBeUndefined();
    expect(body.messages[0].content).toContain("UNTRUSTED DATA");
    expect(body.messages[1].content).toBe(packet().packetJson);
    expect(body.response_format.type).toBe("json_schema");
  });
  it("makes no call when disabled", async () => {
    const transport = vi.fn();
    await expect(
      requestInvestigation(packet(), { ...config, enabled: false }, transport),
    ).rejects.toThrow("not configured");
    expect(transport).not.toHaveBeenCalled();
  });
  it.each([401, 429, 500, 302])(
    "handles provider status %s without exposing provider body or retrying",
    async (status) => {
      const transport = vi
        .fn()
        .mockResolvedValue(
          new Response("sensitive-provider-error", { status }),
        );
      await expect(
        requestInvestigation(packet(), config, transport),
      ).rejects.not.toThrow("sensitive-provider-error");
      expect(transport).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["length", "tool_calls", "content_filter"])(
    "rejects incomplete output (%s)",
    async (finish) => {
      await expect(
        requestInvestigation(
          packet(),
          config,
          vi.fn().mockResolvedValue(response(output, finish)),
        ),
      ).rejects.toThrow("could not be verified");
    },
  );
  it("rejects refusals and unknown evidence", async () => {
    const refusal = Response.json({
      choices: [
        { finish_reason: "stop", message: { content: "{}", refusal: "No" } },
      ],
    });
    await expect(
      requestInvestigation(
        packet(),
        config,
        vi.fn().mockResolvedValue(refusal),
      ),
    ).rejects.toThrow("could not be verified");
    const invalid = {
      ...output,
      observations: [{ ...output.observations[0], evidenceIds: ["RUN-C-1"] }],
    };
    await expect(
      requestInvestigation(
        packet(),
        config,
        vi.fn().mockResolvedValue(response(invalid)),
      ),
    ).rejects.toThrow("could not be verified");
  });
  it("caps streamed response size without trusting content-length", async () => {
    await expect(
      requestInvestigation(
        packet(),
        config,
        vi.fn().mockResolvedValue(new Response("x".repeat(128 * 1024 + 1))),
      ),
    ).rejects.toThrow("oversized");
  });
  it("aborts on the request deadline", async () => {
    vi.useFakeTimers();
    const transport = vi.fn(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal.addEventListener("abort", () =>
            reject(new Error("raw-transport-detail")),
          );
        }),
    );
    const result = expect(
      requestInvestigation(packet(), config, transport),
    ).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(45_000);
    await result;
  });
});

describe("persistent investigations", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "dependencyguard-ai-"));
    vi.stubEnv("AI_INVESTIGATION_ENABLED", "true");
    vi.stubEnv("NEBIUS_API_KEY", "synthetic-key-not-a-secret");
    vi.stubEnv("NEBIUS_MODEL", config.model!);
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  it("never calls the provider on view and reuses a validated saved result", async () => {
    const provider = vi.fn().mockResolvedValue(output);
    const service = new InvestigationService(directory, provider);
    expect((await service.view(report)).status).toBe("not_generated");
    expect(provider).not.toHaveBeenCalled();
    const generated = await service.generate(report, packet().fingerprint);
    expect(generated.artifact?.output).toEqual(output);
    expect(
      (await service.generate(report, packet().fingerprint)).artifact,
    ).toEqual(generated.artifact);
    expect(provider).toHaveBeenCalledTimes(1);
    const restarted = new InvestigationService(directory, provider);
    expect((await restarted.view(report)).status).toBe("available");
    expect(report.status).toBe("INCONCLUSIVE");
    expect(report.riskScore).toBeNull();
  });
  it("withholds stale artifacts, rejects stale consent and preserves previous evidence on failure", async () => {
    const provider = vi
      .fn()
      .mockResolvedValueOnce(output)
      .mockRejectedValue(new Error("provider failed"));
    const service = new InvestigationService(directory, provider);
    await service.generate(report, packet().fingerprint);
    vi.stubEnv("NEBIUS_MODEL", "nvidia/new-synthetic-model");
    const current = await service.view(report);
    expect(current.status).toBe("stale");
    expect(current.artifact).toBeNull();
    await expect(
      service.generate(report, packet().fingerprint),
    ).rejects.toThrow("changed");
    await expect(service.generate(report, current.fingerprint)).rejects.toThrow(
      "provider failed",
    );
    vi.stubEnv("NEBIUS_MODEL", config.model!);
    expect((await service.view(report)).status).toBe("available");
  });
  it("gates disabled, missing credentials and absent evidence without contacting Nebius", async () => {
    const provider = vi.fn();
    const service = new InvestigationService(directory, provider);
    await expect(
      service.generate({ ...report, evidence: [] }, packet().fingerprint),
    ).rejects.toThrow("no static evidence");
    vi.stubEnv("NEBIUS_API_KEY", "");
    expect((await service.view(report)).availability).toBe("not_configured");
    await expect(
      service.generate(report, packet().fingerprint),
    ).rejects.toThrow("not configured");
    vi.stubEnv("AI_INVESTIGATION_ENABLED", "false");
    expect((await service.view(report)).availability).toBe("disabled");
    expect(provider).not.toHaveBeenCalled();
  });
  it("holds an exclusive lock across service instances and releases it after failure", async () => {
    let finish!: (value: typeof output) => void;
    const provider = vi.fn(
      () =>
        new Promise<typeof output>((resolve) => {
          finish = resolve;
        }),
    );
    const first = new InvestigationService(directory, provider);
    const second = new InvestigationService(directory, provider);
    const running = first.generate(report, packet().fingerprint);
    await vi.waitFor(() => expect(provider).toHaveBeenCalledOnce());
    await expect(second.generate(report, packet().fingerprint)).rejects.toThrow(
      "already running",
    );
    finish(output);
    await running;
    await expect(
      readFile(path.join(directory, "investigation.lock")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("rejects malformed, oversized and misbound saved output", async () => {
    const service = new InvestigationService(
      directory,
      vi.fn().mockResolvedValue(output),
    );
    const filename = path.join(directory, `${report.id}.investigation.json`);
    for (const contents of ["not JSON", "x".repeat(64 * 1024 + 1)]) {
      await writeFile(filename, contents);
      expect((await service.view(report)).status).toBe("invalid");
    }
    const generated = await service.generate(report, packet().fingerprint);
    await writeFile(
      filename,
      JSON.stringify({
        ...generated.artifact,
        analysisId: "b5b39ab3-e1a1-41d6-a612-b2e7bdb466b4",
      }),
    );
    expect((await service.view(report)).status).toBe("invalid");
  });
  it("rate limits failed provider attempts and does not retain their lock", async () => {
    const service = new InvestigationService(
      directory,
      vi.fn().mockRejectedValue(new Error("failed")),
    );
    for (let i = 0; i < 3; i++)
      await expect(
        service.generate(report, packet().fingerprint),
      ).rejects.toThrow("failed");
    await expect(
      service.generate(report, packet().fingerprint),
    ).rejects.toThrow("limit reached");
  });
});
