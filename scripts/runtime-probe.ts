import path from "node:path";
import { AnalysisStore } from "../src/lib/analysis/store";
import { fetchRelease } from "../src/lib/analysis/registry";
import { fetchSnapshot } from "../src/lib/analysis/archive";
import { runtimeConfiguration } from "../src/lib/runtime/policy";
import {
  checkDocker,
  runProbe,
  ContainerCleanupError,
} from "../src/lib/runtime/docker";
import {
  acquireRuntimeLock,
  saveRuntimeEvidence,
} from "../src/lib/runtime/storage";
import { compareRuntime } from "../src/lib/runtime/compare";
import type { RuntimeBundle } from "../src/lib/runtime/contracts";

async function main() {
  const [id, ...extra] = process.argv.slice(2);
  if (!id || extra.length)
    throw new Error(
      "Usage: npm run runtime:probe -- <analysis-uuid> or --check",
    );
  const config = runtimeConfiguration(process.env);
  console.log("Checking the pinned local image and Linux container engine…");
  await checkDocker(config.imageId);
  if (id === "--check") {
    console.log("Worker ready. No package code was executed.");
    return;
  }
  const store = new AnalysisStore(
    path.join(process.cwd(), ".dependencyguard", "analyses"),
  );
  const report = await store.getReport(id);
  if (!report)
    throw new Error(
      "Create a completed static report before probing its UUID.",
    );
  const release = await acquireRuntimeLock();
  const controller = new AbortController();
  let retainLock = false;
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    const runs = [];
    for (const role of ["trusted", "candidate"] as const) {
      if (controller.signal.aborted) throw new Error("Probe canceled.");
      const expected = report.releases[role];
      console.log(`Verifying ${role} archive against the saved static report…`);
      const metadata = await fetchRelease(
        report.input.packageName,
        expected.release.version,
      );
      const snapshot = await fetchSnapshot(metadata);
      if (snapshot.archiveSha256 !== expected.archiveSha256)
        throw new Error(
          "Downloaded archive changed since static analysis. Create a new static report.",
        );
      if (controller.signal.aborted) throw new Error("Probe canceled.");
      console.log(`Running ${role} import probe in a disposable container…`);
      runs.push(
        await runProbe(snapshot, config.imageId, undefined, controller.signal),
      );
    }
    if (controller.signal.aborted) throw new Error("Probe canceled.");
    const bundle: RuntimeBundle = {
      schemaVersion: 1,
      analysisId: id,
      packageName: report.input.packageName,
      source: "local-container-worker",
      generatedAt: new Date().toISOString(),
      trusted: runs[0],
      candidate: runs[1],
    };
    await saveRuntimeEvidence(report, bundle);
    const comparison = compareRuntime(bundle);
    console.log(comparison.summary);
    console.log(
      `Evidence saved. Reload /report/${id} to inspect the runtime supplement.`,
    );
    if (!comparison.comparable) process.exitCode = 2;
  } catch (error) {
    retainLock = error instanceof ContainerCleanupError;
    throw error;
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    if (!retainLock) await release();
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "The runtime worker failed.",
  );
  process.exitCode = 1;
});
