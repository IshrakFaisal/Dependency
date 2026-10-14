import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { compareRuntime, validateRuntimeBinding } from "@/lib/runtime/compare";
import { runtimeBundleSchema } from "@/lib/runtime/contracts";
import {
  containerArgs,
  probePayload,
  runtimeConfiguration,
} from "@/lib/runtime/policy";
import {
  checkDocker,
  DockerFailure,
  runProbe,
  type DockerCommand,
} from "@/lib/runtime/docker";
import {
  acquireRuntimeLock,
  loadRuntimeEvidence,
  runtimePath,
  saveRuntimeEvidence,
} from "@/lib/runtime/storage";
import {
  bindingReport,
  bundle,
  imageId,
  probeSnapshot,
} from "./helpers/runtime-fixtures";
vi.mock("server-only", () => ({}));

const network = {
  category: "network",
  operation: "fetch",
  target: "synthetic.invalid",
  outcome: "blocked",
} as const;
const folders: string[] = [];
async function temp() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "dg-runtime-"));
  folders.push(directory);
  return directory;
}
afterEach(async () => {
  await Promise.all(
    folders
      .splice(0)
      .map((folder) => rm(folder, { recursive: true, force: true })),
  );
});

describe("runtime evidence comparison", () => {
  it("identifies new targets and repeated attempts with stable evidence references", () => {
    const value = bundle();
    value.trusted.events = [network];
    value.candidate.events = [
      network,
      network,
      { ...network, target: "second.invalid" },
    ];
    const result = compareRuntime(value);
    expect(result.comparable).toBe(true);
    expect(result.differences.map((row) => row.change).sort()).toEqual([
      "increased",
      "introduced",
    ]);
    expect(
      result.differences.find((row) => row.target === "synthetic.invalid")
        ?.evidenceIds,
    ).toEqual(["RUN-T-1", "RUN-C-1", "RUN-C-2"]);
    expect(result.counts[0]).toEqual({
      category: "network",
      trusted: 1,
      candidate: 3,
    });
  });
  it.each(["failed", "timed_out", "unavailable", "unsupported"] as const)(
    "does not mistake a %s baseline for zero behavior",
    (status) => {
      const value = bundle();
      value.trusted.status = status;
      value.candidate.events = [network];
      expect(compareRuntime(value)).toMatchObject({
        comparable: false,
        differences: [],
      });
    },
  );
  it("withholds differences for truncated events and different environments", () => {
    const value = bundle();
    value.candidate.truncated = true;
    expect(compareRuntime(value).comparable).toBe(false);
    value.candidate.truncated = false;
    value.candidate.imageId = `sha256:${"d".repeat(64)}`;
    expect(compareRuntime(value).comparable).toBe(false);
  });
  it("separates blocked from attempted events and retains removed signals", () => {
    const value = bundle();
    value.trusted.events = [network];
    value.candidate.events = [{ ...network, outcome: "attempted" }];
    expect(
      compareRuntime(value)
        .differences.map((row) => row.change)
        .sort(),
    ).toEqual(["decreased", "introduced"]);
  });
  it("requires both exact release identities and archive hashes", () => {
    expect(validateRuntimeBinding(bundle(), bindingReport).analysisId).toBe(
      bindingReport.id,
    );
    for (const mutate of [
      (value: ReturnType<typeof bundle>) => {
        value.packageName = "different-fixture";
      },
      (value: ReturnType<typeof bundle>) => {
        value.candidate.version = "2.0.0";
      },
      (value: ReturnType<typeof bundle>) => {
        value.trusted.archiveSha256 = "e".repeat(64);
      },
    ]) {
      const value = bundle();
      mutate(value);
      expect(() => validateRuntimeBinding(value, bindingReport)).toThrow(
        /does not match/,
      );
    }
  });
  it("rejects extra command fields, invalid statuses, and oversized event streams", () => {
    expect(
      runtimeBundleSchema.safeParse({ ...bundle(), command: "sh" }).success,
    ).toBe(false);
    const value = bundle();
    value.candidate.events = Array.from({ length: 257 }, () => network);
    expect(runtimeBundleSchema.safeParse(value).success).toBe(false);
    expect(
      runtimeBundleSchema.safeParse({
        ...bundle(),
        source: "verified-kernel-trace",
      }).success,
    ).toBe(false);
  });
});

describe("operator-only container boundary", () => {
  it("fails closed until explicitly enabled with an immutable image", () => {
    expect(() => runtimeConfiguration({})).toThrow(/disabled/);
    expect(() =>
      runtimeConfiguration({
        RUNTIME_PROBE_ENABLED: "true",
        SANDBOX_IMAGE_ID: "node:latest",
      }),
    ).toThrow();
    expect(
      runtimeConfiguration({
        RUNTIME_PROBE_ENABLED: "true",
        SANDBOX_IMAGE_ID: imageId,
      }).imageId,
    ).toBe(imageId);
  });
  it("uses fixed isolation limits without host mounts, secrets, commands, or image pulls", () => {
    const args = containerArgs(imageId, `dependencyguard-${bindingReport.id}`);
    for (const required of [
      "--network=none",
      "--read-only",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",
      "--user=10001:10001",
      "--pids-limit=32",
      "--pull=never",
      "--memory=256m",
      "--log-driver=none",
    ])
      expect(args).toContain(required);
    expect(
      args.some(
        (value) =>
          /^(--privileged|--volume|--mount|--env|--publish|--pid)/.test(
            value,
          ) && value !== "--pids-limit=32",
      ),
    ).toBe(false);
    expect(args.slice(-2)).toEqual([
      imageId,
      "/opt/dependencyguard/runner.mjs",
    ]);
    expect(() => containerArgs("node:latest", "bad-name")).toThrow();
  });
  it("refuses lossy, binary, and oversized snapshots instead of importing altered source", () => {
    const snapshot = probeSnapshot();
    expect(JSON.parse(probePayload(snapshot)).files).toHaveLength(2);
    snapshot.files[1].text = null;
    expect(() => probePayload(snapshot)).toThrow(/UTF-8/);
    snapshot.files[1].text = "altered";
    expect(() => probePayload(snapshot)).toThrow(/byte-for-byte/);
    snapshot.files[1].size = 5 * 1024 * 1024;
    expect(() => probePayload(snapshot)).toThrow(/4 MiB/);
  });
  it("checks Linux engine and exact local image without pulling", async () => {
    const command = vi
      .fn<DockerCommand>()
      .mockResolvedValueOnce({ code: 0, stdout: "linux\n", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: imageId, stderr: "" });
    await checkDocker(imageId, command);
    expect(command.mock.calls.map(([args]) => args[0])).toEqual([
      "info",
      "image",
    ]);
    command.mockResolvedValue({ code: 0, stdout: "windows", stderr: "" });
    await expect(checkDocker(imageId, command)).rejects.toThrow(/Linux/);
  });
  it("validates collector output and always removes the named container", async () => {
    const command = vi
      .fn<DockerCommand>()
      .mockResolvedValueOnce({
        code: 0,
        stdout: JSON.stringify({
          status: "completed",
          reason: "import_completed",
          events: [network],
          truncated: false,
        }),
        stderr: "",
      })
      .mockResolvedValue({ code: 0, stdout: "", stderr: "" });
    expect(await runProbe(probeSnapshot(), imageId, command)).toMatchObject({
      status: "completed",
      events: [network],
    });
    expect(command.mock.calls[1][0].slice(0, 2)).toEqual(["rm", "--force"]);
    const args = command.mock.calls[0][0];
    expect(command.mock.calls[1][0][2]).toBe(args[args.indexOf("--name") + 1]);
  });
  it.each(["timeout", "bad-json", "wrong-shape", "exit-failure"])(
    "cleans up after %s and does not turn it into clean evidence",
    async (mode) => {
      const command = vi.fn<DockerCommand>();
      if (mode === "timeout")
        command.mockRejectedValueOnce(
          new DockerFailure("timed_out", "time limit"),
        );
      else
        command.mockResolvedValueOnce({
          code: mode === "exit-failure" ? 1 : 0,
          stdout: mode === "bad-json" ? "not json" : "{}",
          stderr: "untrusted error",
        });
      command.mockResolvedValue({ code: 0, stdout: "", stderr: "" });
      const result = await runProbe(probeSnapshot(), imageId, command);
      expect(result.status).toBe(mode === "timeout" ? "timed_out" : "failed");
      expect(result.events).toEqual([]);
      expect(result.reason).not.toContain("untrusted error");
      expect(command.mock.calls[1][0][0]).toBe("rm");
    },
  );
  it("halts on cleanup failure instead of silently leaving a container", async () => {
    const command = vi.fn<DockerCommand>().mockResolvedValue({
      code: 1,
      stdout: "",
      stderr: "daemon disconnected",
    });
    await expect(runProbe(probeSnapshot(), imageId, command)).rejects.toThrow(
      /cleanup failed/,
    );
  });
  it("does not launch Docker for unsupported snapshots", async () => {
    const snapshot = probeSnapshot();
    snapshot.files[1].text = null;
    const command = vi.fn<DockerCommand>();
    expect((await runProbe(snapshot, imageId, command)).status).toBe(
      "unsupported",
    );
    expect(command).not.toHaveBeenCalled();
  });
});

describe("runtime persistence", () => {
  it("distinguishes absent, valid, mismatched, and corrupt evidence", async () => {
    const directory = await temp();
    expect(await loadRuntimeEvidence(bindingReport, directory)).toEqual({
      status: "not_run",
    });
    await saveRuntimeEvidence(bindingReport, bundle(), directory);
    expect((await loadRuntimeEvidence(bindingReport, directory)).status).toBe(
      "available",
    );
    const bad = bundle();
    bad.trusted.archiveSha256 = "e".repeat(64);
    await writeFile(
      runtimePath(bindingReport.id, directory),
      JSON.stringify(bad),
    );
    expect((await loadRuntimeEvidence(bindingReport, directory)).status).toBe(
      "invalid",
    );
    await writeFile(runtimePath(bindingReport.id, directory), "{");
    expect((await loadRuntimeEvidence(bindingReport, directory)).status).toBe(
      "invalid",
    );
  });
  it("rejects evidence files above the read limit", async () => {
    const directory = await temp();
    await writeFile(
      runtimePath(bindingReport.id, directory),
      " ".repeat(512 * 1024 + 1),
    );
    expect((await loadRuntimeEvidence(bindingReport, directory)).status).toBe(
      "invalid",
    );
    expect(() => runtimePath("../escape", directory)).toThrow();
  });
  it("excludes concurrent workers and releases the lock explicitly", async () => {
    const directory = await temp();
    const release = await acquireRuntimeLock(directory);
    await expect(acquireRuntimeLock(directory)).rejects.toMatchObject({
      code: "EEXIST",
    });
    await release();
    await (
      await acquireRuntimeLock(directory)
    )();
  });
});
