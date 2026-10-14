/* Trusted hook code loaded by the container collector, never by the web app. */
const { pathToFileURL } = require("node:url");
const { syncBuiltinESMExports } = require("node:module");
const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");
const send = process.send.bind(process);
let sending = false;
let emitted = 0;

function event(category, operation, target, outcome) {
  if (sending || emitted > 256) return;
  sending = true;
  emitted++;
  try {
    send({
      type: "event",
      event: {
        category,
        operation,
        target:
          String(target)
            .replace(/[\x00-\x1f\x7f]/g, "?")
            .slice(0, 240) || "unknown",
        outcome,
      },
    });
  } finally {
    sending = false;
  }
}

function denied(category, operation, target) {
  event(category, operation, target, "blocked");
  const error = new Error("Blocked by the DependencyGuard import probe.");
  error.code = "DG_PROBE_BLOCKED";
  throw error;
}

function destination(value) {
  // Exclude credentials, URL paths/query strings, request bodies, and headers.
  try {
    if (typeof value === "string" || value instanceof URL) {
      const url = new URL(String(value));
      return url.hostname || "unknown-destination";
    }
    if (value && typeof value === "object") {
      const host = value.hostname ?? value.host;
      if (typeof host === "string" && /^[a-zA-Z0-9.:[\]-]+$/.test(host))
        return host;
    }
  } catch {
    /* Unknown destinations are still recorded without sensitive details. */
  }
  return "unknown-destination";
}

function installHooks() {
  for (const name of [
    "exec",
    "execSync",
    "execFile",
    "execFileSync",
    "spawn",
    "spawnSync",
    "fork",
  ]) {
    childProcess[name] = () => denied("process", name, "child-process");
  }
  for (const [module, methods] of [
    ["http", ["get", "request"]],
    ["https", ["get", "request"]],
    ["net", ["connect", "createConnection"]],
    ["tls", ["connect"]],
    ["dns", ["lookup", "resolve", "resolve4", "resolve6"]],
  ]) {
    const api = require(`node:${module}`);
    for (const name of methods)
      api[name] = (target) =>
        denied("network", `${module}.${name}`, destination(target));
  }
  const net = require("node:net");
  net.Socket.prototype.connect = (target) =>
    denied("network", "socket.connect", destination(target));
  globalThis.fetch = (target) =>
    denied("network", "fetch", destination(target));
  const mutations = [
    "writeFile",
    "writeFileSync",
    "appendFile",
    "appendFileSync",
    "createWriteStream",
    "mkdir",
    "mkdirSync",
    "rm",
    "rmSync",
    "unlink",
    "unlinkSync",
    "rename",
    "renameSync",
    "copyFile",
    "copyFileSync",
  ];
  for (const api of [fs, fs.promises])
    for (const name of mutations) {
      if (typeof api[name] !== "function") continue;
      const original = api[name].bind(api);
      api[name] = (...args) => {
        const value = args[0];
        const target =
          typeof value === "string" ? path.resolve(value) : "non-string-path";
        event("filesystem", name, target, "attempted");
        return original(...args);
      };
    }
  process.env = new Proxy(process.env, {
    get(target, key) {
      if (typeof key === "string")
        event("environment", "env.get", key, "attempted");
      return Reflect.get(target, key);
    },
    ownKeys(target) {
      event("environment", "env.enumerate", "environment-names", "attempted");
      return Reflect.ownKeys(target);
    },
  });
  syncBuiltinESMExports();
}

(async () => {
  try {
    const entry = require.resolve("/work/package");
    if (!entry.startsWith("/work/package/"))
      throw new Error("Entry outside package.");
    installHooks();
    await import(pathToFileURL(entry).href);
    send({ type: "imported" });
    // Keep the process alive for the collector's observation window.
    setInterval(() => {}, 1000);
  } catch {
    // Error messages and package output can contain secrets; never export them.
    process.exitCode = 1;
    process.disconnect();
  }
})();
