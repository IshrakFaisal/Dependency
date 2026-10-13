import { assessRisk } from "@/lib/risk";
import type {
  AnalysisReport,
  AnalysisStage,
  Evidence,
  FilesystemEvent,
  RiskSignal,
} from "@/lib/types";

export const DEMO_ANALYSIS_ID = "demo-example-utils";

export const ANALYSIS_STAGES: readonly AnalysisStage[] = [
  {
    id: "metadata",
    label: "Fetching package metadata",
    description: "Loading the synthetic release manifests.",
  },
  {
    id: "download",
    label: "Downloading releases",
    description: "Opening the two bundled demo snapshots.",
  },
  {
    id: "contents",
    label: "Comparing package contents",
    description: "Comparing the fixture file inventories and entry points.",
  },
  {
    id: "static",
    label: "Performing static analysis",
    description: "Reading authored source changes in the demo fixture.",
  },
  {
    id: "prepare",
    label: "Preparing isolated environments",
    description: "Simulated stage. No environments are created.",
  },
  {
    id: "trusted",
    label: "Executing trusted version",
    description:
      "Replaying synthetic trusted-version events. No package code runs.",
  },
  {
    id: "candidate",
    label: "Executing candidate version",
    description:
      "Replaying synthetic candidate-version events. No package code runs.",
  },
  {
    id: "behavior",
    label: "Comparing behavior",
    description: "Counting the differences in the synthetic event traces.",
  },
  {
    id: "explanation",
    label: "Generating security explanation",
    description: "Loading an authored explanation. No AI service is called.",
  },
  {
    id: "report",
    label: "Building evidence report",
    description:
      "Assembling the fixture findings and their evidence references.",
  },
];

const evidence: Evidence[] = [
  {
    id: "EVD-001",
    title: "Installation hook added",
    kind: "metadata-diff",
    source: "synthetic",
    location: "package.json:8",
    excerpt:
      '- "scripts": {}\n+ "scripts": { "postinstall": "node scripts/setup.cjs" }',
    interpretation:
      "The candidate fixture adds a lifecycle hook. This is a static change and does not by itself establish harmful intent.",
  },
  {
    id: "EVD-002",
    title: "Two outbound requests in the candidate trace",
    kind: "runtime-trace",
    source: "synthetic",
    location: "candidate/network.jsonl:1–2",
    excerpt:
      "[+182ms] POST https://telemetry.example.invalid/v1/install sent=248B received=42B\n[+241ms] GET  https://updates.example.invalid/channel.json sent=0B received=186B\ntrusted: 0 network requests",
    interpretation:
      "The fictional candidate trace introduces two HTTPS requests. Reserved .invalid destinations cannot represent live endpoints. The trace does not establish that credentials were transmitted.",
  },
  {
    id: "EVD-003",
    title: "Three token-like environment reads",
    kind: "runtime-trace",
    source: "synthetic",
    location: "candidate/environment.jsonl:1–3",
    excerpt:
      "[+162ms] read NPM_TOKEN         value=[SYNTHETIC VALUE REDACTED]\n[+164ms] read GITHUB_TOKEN      value=[SYNTHETIC VALUE REDACTED]\n[+167ms] read AWS_ACCESS_KEY_ID value=[SYNTHETIC VALUE REDACTED]\ntrusted: 0 sensitive environment reads",
    interpretation:
      "Three fixture events represent access to variables that commonly hold credentials. All values are synthetic, and no local environment variables were inspected.",
  },
  {
    id: "EVD-004",
    title: "Helper process launched by installation script",
    kind: "runtime-trace",
    source: "synthetic",
    location: "candidate/processes.jsonl:1",
    excerpt:
      '[+156ms] parent=node scripts/setup.cjs\nspawn executable=node args=["scripts/collect.cjs"]\nexit=0\ntrusted: 0 child processes',
    interpretation:
      "The synthetic installation trace includes one new child process. The command is displayed only as evidence; it has never been executed by this application.",
  },
  {
    id: "EVD-005",
    title: "Filesystem writes grow from two to seven",
    kind: "runtime-trace",
    source: "synthetic",
    location: "comparison/filesystem.json",
    excerpt:
      "trusted writes: 2 (package cache)\ncandidate writes: 7 (5 package cache, 2 workspace)\nnew workspace paths:\n  /workspace/.example-utils/install-state.json\n  /workspace/.example-utils/diagnostics.json",
    interpretation:
      "Five additional writes appear in the fixture, including two outside the package cache. No files were written by package code.",
  },
  {
    id: "EVD-006",
    title: "New runtime dependency",
    kind: "metadata-diff",
    source: "synthetic",
    location: "package.json:14",
    excerpt:
      '  "dependencies": {\n    "example-string-core": "0.8.0",\n+   "example-metrics-transport": "0.1.0"\n  }',
    interpretation:
      "The candidate manifest introduces one fictional runtime dependency. Its implementation has not been independently evaluated.",
  },
  {
    id: "EVD-007",
    title: "Source references credential-like variables",
    kind: "source-diff",
    source: "synthetic",
    location: "scripts/collect.cjs:4–8",
    excerpt:
      '+ const keys = ["NPM_TOKEN", "GITHUB_TOKEN", "AWS_ACCESS_KEY_ID"];\n+ const present = keys.map((key) => Boolean(process.env[key]));\n+ writeDiagnostics({ tokenPresence: present });',
    interpretation:
      "The authored snippet checks whether three variables are present. Presence checks warrant review but do not prove that their values leave the environment.",
  },
  {
    id: "EVD-008",
    title: "Network client and child-process imports added",
    kind: "source-diff",
    source: "synthetic",
    location: "scripts/setup.cjs:1–6",
    excerpt:
      '+ const { spawnSync } = require("node:child_process");\n+ const transport = require("example-metrics-transport");\n+ spawnSync(process.execPath, ["scripts/collect.cjs"]);\n+ transport.send("https://telemetry.example.invalid/v1/install", { event: "install" });',
    interpretation:
      "The fixture combines installation-time process creation and networking. The purpose of those new capabilities needs maintainer explanation.",
  },
];

const riskSignals: RiskSignal[] = [
  {
    id: "new-network",
    title: "New outbound network activity",
    description:
      "Two candidate-only requests introduce destinations absent from the trusted trace.",
    points: 25,
    status: "OBSERVED",
    evidenceIds: ["EVD-002"],
  },
  {
    id: "sensitive-environment",
    title: "Sensitive environment-variable access",
    description:
      "The candidate fixture reads three credential-like variables during installation.",
    points: 22,
    status: "OBSERVED",
    evidenceIds: ["EVD-003", "EVD-007"],
  },
  {
    id: "child-process",
    title: "New installation-time child process",
    description:
      "A new lifecycle hook starts a helper process, expanding installation behavior.",
    points: 18,
    status: "OBSERVED",
    evidenceIds: ["EVD-001", "EVD-004"],
  },
  {
    id: "filesystem-expansion",
    title: "Expanded filesystem writes",
    description:
      "The candidate writes five additional files, including two workspace files.",
    points: 9,
    status: "OBSERVED",
    evidenceIds: ["EVD-005"],
  },
  {
    id: "new-dependency",
    title: "Additional runtime dependency",
    description:
      "A new transport dependency adds code that needs review; its risk is unverified.",
    points: 8,
    status: "UNVERIFIED RISK",
    evidenceIds: ["EVD-006"],
  },
];

const writeEvents: Array<{
  release: "trusted" | "candidate";
  path: string;
  bytes: number;
  timestampMs: number;
  scope: "package-cache" | "workspace";
}> = [
  {
    release: "trusted",
    path: "/workspace/node_modules/.cache/example-utils/index.json",
    bytes: 112,
    timestampMs: 60,
    scope: "package-cache",
  },
  {
    release: "trusted",
    path: "/workspace/node_modules/.cache/example-utils/ready",
    bytes: 2,
    timestampMs: 64,
    scope: "package-cache",
  },
  {
    release: "candidate",
    path: "/workspace/node_modules/.cache/example-utils/index.json",
    bytes: 144,
    timestampMs: 61,
    scope: "package-cache",
  },
  {
    release: "candidate",
    path: "/workspace/node_modules/.cache/example-utils/ready",
    bytes: 2,
    timestampMs: 65,
    scope: "package-cache",
  },
  {
    release: "candidate",
    path: "/workspace/node_modules/.cache/example-utils/session.json",
    bytes: 72,
    timestampMs: 122,
    scope: "package-cache",
  },
  {
    release: "candidate",
    path: "/workspace/node_modules/.cache/example-utils/install.log",
    bytes: 224,
    timestampMs: 143,
    scope: "package-cache",
  },
  {
    release: "candidate",
    path: "/workspace/node_modules/.cache/example-utils/channel.json",
    bytes: 186,
    timestampMs: 260,
    scope: "package-cache",
  },
  {
    release: "candidate",
    path: "/workspace/.example-utils/install-state.json",
    bytes: 94,
    timestampMs: 281,
    scope: "workspace",
  },
  {
    release: "candidate",
    path: "/workspace/.example-utils/diagnostics.json",
    bytes: 136,
    timestampMs: 174,
    scope: "workspace",
  },
];

const filesystemEvents: FilesystemEvent[] = writeEvents.map((event, index) => ({
  ...event,
  id: `fs-${String(index + 1).padStart(2, "0")}`,
  type: "filesystem",
  operation: "write",
  status: "OBSERVED",
  source: "synthetic",
  summary: `Write to ${event.scope === "workspace" ? "workspace" : "package cache"}`,
  evidenceIds: ["EVD-005"],
}));

const assessment = assessRisk(riskSignals);

export const DEMO_REPORT: AnalysisReport = {
  id: DEMO_ANALYSIS_ID,
  isDemo: true,
  generatedAt: "2026-09-30T09:00:00.000Z",
  packageName: "example-utils",
  trustedVersion: "1.4.1",
  candidateVersion: "1.4.2",
  status: assessment.status,
  reviewAction: "REVIEW REQUIRED",
  riskScore: assessment.score,
  summary:
    "The candidate fixture introduces installation-time network activity, reads three credential-like environment variables, and starts a helper process. These changes expand the behavior of a small utility package and warrant review before adoption. The evidence does not establish malicious intent.",
  newBehaviors: [
    "Outbound network activity",
    "Environment-variable access",
    "Child-process execution",
  ],
  metadata: {
    trusted: {
      packageName: "example-utils",
      version: "1.4.1",
      source: "synthetic",
      publishedAt: "2026-09-12T10:00:00.000Z",
      license: "MIT",
      maintainers: ["example-maintainer"],
      fileCount: 12,
      unpackedSizeBytes: 18432,
      scripts: {},
      dependencies: { "example-string-core": "0.8.0" },
    },
    candidate: {
      packageName: "example-utils",
      version: "1.4.2",
      source: "synthetic",
      publishedAt: "2026-09-29T14:30:00.000Z",
      license: "MIT",
      maintainers: ["example-maintainer"],
      fileCount: 18,
      unpackedSizeBytes: 31744,
      scripts: { postinstall: "node scripts/setup.cjs" },
      dependencies: {
        "example-string-core": "0.8.0",
        "example-metrics-transport": "0.1.0",
      },
    },
  },
  staticFindings: [
    {
      id: "static-install-hook",
      title: "New postinstall lifecycle script",
      description:
        "The candidate manifest adds a script that would run during a normal npm installation. The application does not run this script.",
      status: "STATIC SIGNAL",
      severity: "high",
      file: "package.json",
      line: 8,
      oldCode: '"scripts": {}',
      newCode: '"scripts": { "postinstall": "node scripts/setup.cjs" }',
      evidenceIds: ["EVD-001"],
    },
    {
      id: "static-env",
      title: "Credential-like variable references",
      description:
        "A new collection helper checks the presence of token-like variables. Static references do not prove credential transmission.",
      status: "STATIC SIGNAL",
      severity: "high",
      file: "scripts/collect.cjs",
      line: 4,
      oldCode: null,
      newCode:
        'const keys = ["NPM_TOKEN", "GITHUB_TOKEN", "AWS_ACCESS_KEY_ID"];',
      evidenceIds: ["EVD-007"],
    },
    {
      id: "static-capabilities",
      title: "Network and process capabilities added",
      description:
        "The new setup script imports a transport module and Node's child-process API.",
      status: "STATIC SIGNAL",
      severity: "medium",
      file: "scripts/setup.cjs",
      line: 1,
      oldCode: null,
      newCode: 'const { spawnSync } = require("node:child_process");',
      evidenceIds: ["EVD-008"],
    },
  ],
  behaviorComparisons: [
    {
      id: "network",
      label: "Network requests",
      oldValue: 0,
      newValue: 2,
      unit: "requests",
      description: "Two candidate-only HTTPS destinations.",
      status: "OBSERVED",
      evidenceIds: ["EVD-002"],
    },
    {
      id: "processes",
      label: "Child processes",
      oldValue: 0,
      newValue: 1,
      unit: "processes",
      description: "One helper process starts during installation.",
      status: "OBSERVED",
      evidenceIds: ["EVD-004"],
    },
    {
      id: "environment",
      label: "Sensitive env reads",
      oldValue: 0,
      newValue: 3,
      unit: "reads",
      description: "Three credential-like variable accesses.",
      status: "OBSERVED",
      evidenceIds: ["EVD-003"],
    },
    {
      id: "filesystem",
      label: "Filesystem writes",
      oldValue: 2,
      newValue: 7,
      unit: "writes",
      description: "Five additional writes, including two workspace files.",
      status: "OBSERVED",
      evidenceIds: ["EVD-005"],
    },
    {
      id: "dependencies",
      label: "New dependencies",
      oldValue: 0,
      newValue: 1,
      unit: "dependencies",
      description:
        "One new runtime dependency relative to the trusted manifest.",
      status: "STATIC SIGNAL",
      evidenceIds: ["EVD-006"],
    },
  ],
  networkEvents: [
    {
      id: "net-01",
      type: "network",
      release: "candidate",
      timestampMs: 182,
      status: "OBSERVED",
      source: "synthetic",
      summary: "Installation telemetry request",
      method: "POST",
      url: "https://telemetry.example.invalid/v1/install",
      host: "telemetry.example.invalid",
      port: 443,
      protocol: "HTTPS",
      bytesSent: 248,
      bytesReceived: 42,
      outcome: "simulated",
      evidenceIds: ["EVD-002"],
    },
    {
      id: "net-02",
      type: "network",
      release: "candidate",
      timestampMs: 241,
      status: "OBSERVED",
      source: "synthetic",
      summary: "Update-channel metadata request",
      method: "GET",
      url: "https://updates.example.invalid/channel.json",
      host: "updates.example.invalid",
      port: 443,
      protocol: "HTTPS",
      bytesSent: 0,
      bytesReceived: 186,
      outcome: "simulated",
      evidenceIds: ["EVD-002"],
    },
  ],
  environmentAccesses: ["NPM_TOKEN", "GITHUB_TOKEN", "AWS_ACCESS_KEY_ID"].map(
    (variable, index) => ({
      id: `env-${index + 1}`,
      type: "environment",
      release: "candidate",
      timestampMs: [162, 164, 167][index] ?? 167,
      status: "OBSERVED",
      source: "synthetic",
      summary: `Presence check for ${variable}`,
      variable,
      sensitive: true,
      value: "[SYNTHETIC VALUE REDACTED]",
      callsite: "scripts/collect.cjs:5",
      evidenceIds: ["EVD-003", "EVD-007"],
    }),
  ),
  processEvents: [
    {
      id: "proc-01",
      type: "process",
      release: "candidate",
      timestampMs: 156,
      status: "OBSERVED",
      source: "synthetic",
      summary: "Installation script starts a collection helper",
      executable: "node",
      args: ["scripts/collect.cjs"],
      parent: "node scripts/setup.cjs",
      exitCode: 0,
      outcome: "simulated",
      evidenceIds: ["EVD-004"],
    },
  ],
  filesystemEvents,
  dependencyChanges: [
    {
      name: "example-metrics-transport",
      oldVersion: null,
      newVersion: "0.1.0",
      change: "added",
      kind: "runtime",
      description:
        "Fictional transport helper added to the candidate manifest. No independent dependency audit has been performed.",
      status: "STATIC SIGNAL",
      evidenceIds: ["EVD-006"],
    },
  ],
  evidence,
  aiInvestigation: {
    source: "authored-demo",
    title: "A new installation path deserves review",
    summary:
      "This is an authored demonstration of a future evidence-based investigation, not output from an AI model. The fixture links a new installation hook with network requests, environment access, and a helper process. It supports reviewing the update; it does not prove the package is malicious.",
    observations: [
      "EVD-001 adds a postinstall hook; EVD-004 depicts the helper it starts.",
      "EVD-002 depicts two network requests absent from the trusted trace.",
      "EVD-003 and EVD-007 show credential-like variable access and presence checks.",
      "EVD-005 depicts two writes outside the package cache.",
    ],
    hypotheses: [
      "The changes may implement installation diagnostics or telemetry; intent is unverified.",
      "The fixture does not show raw credential values in outgoing request payloads, so credential transmission is not established.",
    ],
    recommendedActions: [
      "Ask the maintainer to explain the new installation hook and why it needs network and environment access.",
      "Review the added source files and transport dependency before approving an update.",
      "For a real investigation, reproduce the behavior in an isolated environment with synthetic credentials and inspect payloads.",
    ],
    confidence: "Limited to synthetic evidence",
  },
  riskSignals,
  limitations: [
    "Every package identity, source change, and event in this report belongs to an authored synthetic fixture; no claim is made about any published package with a similar name.",
    "No npm registry requests, archive downloads, package execution, sandbox sessions, or AI calls took place.",
    "OBSERVED and NOT OBSERVED describe the supplied demo trace only. Absence from a trace never proves a behavior cannot occur.",
    "The score is a transparent demonstration rubric, not a calibrated probability or a malware verdict.",
  ],
};

/** Always returns the same synthetic scenario; user inputs cannot relabel its findings. */
export function createDemoReport(): AnalysisReport {
  return structuredClone(DEMO_REPORT);
}
