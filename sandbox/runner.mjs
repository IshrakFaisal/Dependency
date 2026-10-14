import { mkdir, writeFile } from "node:fs/promises";
import { fork } from "node:child_process";
import path from "node:path";

// This collector is only run inside the pinned image. It never runs on the host.
const events = [];
let truncated = false;
function output(status, reason) {
  process.stdout.write(JSON.stringify({ status, reason, events, truncated }));
}

try {
  let size = 0;
  const chunks = [];
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 6 * 1024 * 1024) throw new Error("input limit");
    chunks.push(chunk);
  }
  const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (
    input.profile !== "node-import-v1" ||
    !Array.isArray(input.files) ||
    input.files.length > 256
  )
    throw new Error("invalid profile");
  const paths = new Set();
  let bytes = 0;
  await mkdir("/work/package");
  for (const file of input.files) {
    if (
      typeof file.path !== "string" ||
      file.path.length > 4096 ||
      /[\\:\x00-\x1f\x7f]/.test(file.path) ||
      file.path.startsWith("/") ||
      file.path
        .split("/")
        .some((part) => !part || part === "." || part === "..") ||
      paths.has(file.path)
    )
      throw new Error("unsafe path");
    if (
      typeof file.content !== "string" ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        file.content,
      )
    )
      throw new Error("invalid bytes");
    const content = Buffer.from(file.content, "base64");
    bytes += content.length;
    if (bytes > 4 * 1024 * 1024) throw new Error("content limit");
    const destination = path.join("/work/package", file.path);
    paths.add(file.path);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, content, { flag: "wx", mode: 0o400 });
  }
  const child = fork("/opt/dependencyguard/probe.cjs", [], {
    cwd: "/work/package",
    execArgv: [],
    stdio: ["ignore", "ignore", "ignore", "ipc"],
    env: {
      PATH: "/usr/local/bin:/usr/bin:/bin",
      HOME: "/work",
      NODE_ENV: "production",
      NPM_TOKEN: "DEPENDENCYGUARD_SYNTHETIC",
      AWS_ACCESS_KEY_ID: "DEPENDENCYGUARD_SYNTHETIC",
      AWS_SECRET_ACCESS_KEY: "DEPENDENCYGUARD_SYNTHETIC",
    },
  });
  let imported = false;
  let timedOut = false;
  let settled = false;
  let observationTimer;
  let windowEnded = false;
  const deadline = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, 5000);
  const done = (status, reason) => {
    if (settled) return;
    settled = true;
    clearTimeout(deadline);
    clearTimeout(observationTimer);
    output(status, reason);
  };
  child.on("message", (message) => {
    if (!message || typeof message !== "object") return;
    if (message.type === "imported" && !imported) {
      imported = true;
      // The parent ends the observation window even if the package leaves timers.
      observationTimer = setTimeout(() => {
        windowEnded = true;
        child.kill("SIGKILL");
      }, 750);
    }
    if (message.type !== "event") return;
    if (events.length >= 256) {
      truncated = true;
      return;
    }
    const event = message.event;
    if (
      !event ||
      !["network", "environment", "process", "filesystem"].includes(
        event.category,
      ) ||
      typeof event.operation !== "string" ||
      !/^[a-zA-Z0-9_.-]{1,64}$/.test(event.operation) ||
      typeof event.target !== "string" ||
      !event.target.length ||
      event.target.length > 240 ||
      !["blocked", "attempted"].includes(event.outcome)
    ) {
      truncated = true;
      return;
    }
    events.push({
      category: event.category,
      operation: event.operation,
      target: event.target,
      outcome: event.outcome,
    });
  });
  child.on("error", () => done("failed", "collector_failed"));
  child.on("exit", (code, signal) => {
    if (timedOut) done("timed_out", "time_limit");
    else if (imported && windowEnded && signal === "SIGKILL")
      done("completed", "import_completed");
    else done("failed", "import_failed");
  });
} catch {
  output("failed", "collector_failed");
}
