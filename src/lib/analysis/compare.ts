import "server-only";
import type {
  ArchiveFile,
  FileChange,
  ManifestChange,
  PackageSnapshot,
  ReleaseFinding,
  StaticAnalysisReport,
  StaticEvidence,
} from "@/lib/types/static-analysis";
import type { ComparisonInput } from "@/lib/validation";

const MAX_ITEMS = 200;
const MAX_SOURCE_BYTES = 256 * 1024;
const MAX_TOTAL_SOURCE_BYTES = 8 * 1024 * 1024;
const MAX_SOURCE_FILES = 2_000;
const MAX_EXCERPT = 600;
const sourceExtension = /\.(?:[cm]?[jt]sx?)$/i;
const lifecycleNames = new Set([
  "preinstall",
  "install",
  "postinstall",
  "prepublish",
  "prepublishOnly",
  "preprepare",
  "prepare",
  "postprepare",
  "prepack",
  "postpack",
  "publish",
  "postpublish",
]);

type Category = ReleaseFinding["category"];
type Rule = {
  category: Category;
  label: string;
  pattern: RegExp;
};

// These patterns inspect text only. No package module is imported or evaluated.
const rules: Rule[] = [
  {
    category: "network",
    label: "network API or module reference",
    pattern:
      /\b(?:fetch|WebSocket|XMLHttpRequest)\s*\(|\b(?:https?|net|tls)\s*\.\s*(?:request|get|connect|createConnection)\s*\(|(?:\brequire\s*\(\s*|\bfrom\s*|\bimport\s*\(?\s*)["'](?:node:)?(?:https?|net|tls|dgram|undici)["']/g,
  },
  {
    category: "environment",
    label: "environment-variable reference",
    pattern: /\bprocess\s*(?:\.\s*env\b|\[\s*["']env["']\s*\])/g,
  },
  {
    category: "process",
    label: "child-process API or module reference",
    pattern:
      /(?:\brequire\s*\(\s*|\bfrom\s*|\bimport\s*\(?\s*)["'](?:node:)?child_process["']|\b(?:exec(?:File)?(?:Sync)?|spawn(?:Sync)?|fork)\s*\(/g,
  },
  {
    category: "filesystem",
    label: "filesystem mutation API reference",
    pattern:
      /\b(?:writeFile(?:Sync)?|appendFile(?:Sync)?|createWriteStream|mkdir(?:Sync)?|rm(?:Sync)?|unlink(?:Sync)?|rename(?:Sync)?|copyFile(?:Sync)?)\s*\(/g,
  },
  {
    category: "dynamic-code",
    label: "dynamic code API reference",
    pattern: /\b(?:eval|Function)\s*\(/g,
  },
];

type Match = {
  index: number;
  line: number;
  excerpt: string;
  signature: string;
};
type RuleScan = { count: number; matches: Match[] };
type Scan = {
  files: Map<string, RuleScan[]>;
  skipped: number;
  limited: boolean;
  notes: string[];
};

function excerpt(value: string): string {
  return value.length > MAX_EXCERPT
    ? `${value.slice(0, MAX_EXCERPT)}… [excerpt truncated]`
    : value;
}

function sensitiveReferences(text: string): Map<string, Match> {
  const references = new Map<string, Match>();
  const pattern =
    /\bprocess\s*(?:\.\s*env\b|\[\s*["']env["']\s*\])\s*(?:\.\s*([A-Za-z_$][\w$]*)|\[\s*["']([A-Za-z_$][\w$]*)["']\s*\])/g;
  let match: RegExpExecArray | null;
  let line = 1;
  let nextNewline = text.indexOf("\n");
  // Source length is bounded by scanSnapshot before this helper is called.
  while ((match = pattern.exec(text))) {
    while (nextNewline !== -1 && nextNewline < match.index) {
      line++;
      nextNewline = text.indexOf("\n", nextNewline + 1);
    }
    const name = match[1] ?? match[2];
    if (
      !/(?:TOKEN|SECRET|PASSWORD|CREDENTIAL|(?:^|_)KEY(?:_|$))/i.test(name) ||
      references.has(name)
    )
      continue;
    references.set(name, {
      index: match.index,
      line,
      excerpt: excerpt(
        text.slice(
          Math.max(0, match.index - 80),
          match.index + MAX_EXCERPT - 80,
        ),
      ),
      signature: name,
    });
  }
  return references;
}

function scanSnapshot(snapshot: PackageSnapshot, role: string): Scan {
  const files = new Map<string, RuleScan[]>();
  let skipped = 0;
  let bytes = 0;
  let limited = false;
  const reasons = { nonSource: 0, unavailable: 0, oversized: 0, budget: 0 };

  for (const file of [...snapshot.files].sort((a, b) =>
    a.path.localeCompare(b.path),
  )) {
    if (!sourceExtension.test(file.path)) {
      skipped++;
      reasons.nonSource++;
      continue;
    }
    if (file.text === null || file.text.includes("\0")) {
      skipped++;
      reasons.unavailable++;
      continue;
    }
    if (file.size > MAX_SOURCE_BYTES || file.text.length > MAX_SOURCE_BYTES) {
      skipped++;
      reasons.oversized++;
      limited = true;
      continue;
    }
    if (
      files.size >= MAX_SOURCE_FILES ||
      bytes + file.size > MAX_TOTAL_SOURCE_BYTES
    ) {
      skipped++;
      reasons.budget++;
      limited = true;
      continue;
    }
    bytes += file.size;
    const text = file.text;
    const lineStarts = [0];
    for (let index = 0; index < text.length; index++) {
      if (text[index] === "\n") lineStarts.push(index + 1);
    }
    const scans = rules.map((rule) => {
      const pattern = new RegExp(rule.pattern.source, "g");
      const matches: Match[] = [];
      let count = 0;
      let lineIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text)) !== null) {
        count++;
        if (matches.length >= MAX_ITEMS + 1) continue;
        while (
          lineIndex + 1 < lineStarts.length &&
          lineStarts[lineIndex + 1] <= match.index
        )
          lineIndex++;
        const lineEnd = text.indexOf("\n", match.index);
        const line = text.slice(
          lineStarts[lineIndex],
          lineEnd === -1 ? text.length : lineEnd,
        );
        // Center bounded evidence on the actual match even for minified lines.
        const start = Math.max(lineStarts[lineIndex], match.index - 100);
        matches.push({
          index: match.index,
          line: lineIndex + 1,
          excerpt: excerpt(text.slice(start, start + MAX_EXCERPT + 1)),
          signature: line.trim().slice(0, MAX_EXCERPT),
        });
      }
      return { count, matches };
    });
    files.set(file.path, scans);
  }

  const notes = [
    `${role}: scanned ${files.size} JavaScript/TypeScript source files; skipped ${reasons.nonSource} non-source files, ${reasons.unavailable} binary or unavailable texts, ${reasons.oversized} source files over 256 KiB, and ${reasons.budget} files beyond the 2,000-file / 8 MiB source budget. package.json fields are compared separately.`,
  ];
  if (snapshot.warnings.length) {
    notes.push(
      ...snapshot.warnings
        .slice(0, 20)
        .map((warning) => `${role} archive: ${excerpt(warning)}`),
    );
    if (snapshot.warnings.length > 20)
      notes.push(
        `${role}: further archive warnings omitted from coverage notes.`,
      );
  }
  return { files, skipped, limited, notes };
}

function manifestFile(snapshot: PackageSnapshot): ArchiveFile | undefined {
  return snapshot.files.find((file) => file.path === "package.json");
}

function manifestLine(
  file: ArchiveFile | undefined,
  key: string,
): number | null {
  if (!file?.text) return null;
  const index = file.text.indexOf(`${JSON.stringify(key)}:`);
  if (index === -1) return null;
  return file.text.slice(0, index).split("\n").length;
}

function canonical(value: string | Record<string, string>): string {
  return typeof value === "string"
    ? JSON.stringify(value)
    : JSON.stringify(
        Object.fromEntries(
          Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
        ),
      );
}

function releaseSummary(snapshot: PackageSnapshot) {
  return {
    release: structuredClone(snapshot.release),
    archiveSha256: snapshot.archiveSha256,
    integrityVerified: snapshot.integrityVerified,
    compressedBytes: snapshot.compressedBytes,
    unpackedBytes: snapshot.unpackedBytes,
    warnings: [...snapshot.warnings],
    fileCount: snapshot.files.length,
  };
}

/** Pure, bounded text comparison. It never runs lifecycle scripts or package code. */
export function compareSnapshots(
  id: string,
  input: ComparisonInput,
  trusted: PackageSnapshot,
  candidate: PackageSnapshot,
): StaticAnalysisReport {
  const oldFiles = new Map(trusted.files.map((file) => [file.path, file]));
  const newFiles = new Map(candidate.files.map((file) => [file.path, file]));
  const fileChanges: FileChange[] = [];
  const manifestChanges: ManifestChange[] = [];
  const findings: ReleaseFinding[] = [];
  const evidence: StaticEvidence[] = [];
  let outputTruncated = false;
  let changedFileCount = 0;
  let changedManifestCount = 0;
  let newSourceOccurrences = 0;
  let unknownBaselines = 0;

  function addEvidence(item: Omit<StaticEvidence, "id">): string | null {
    if (evidence.length >= MAX_ITEMS) {
      outputTruncated = true;
      return null;
    }
    const evidenceId = `STATIC-EVD-${String(evidence.length + 1).padStart(3, "0")}`;
    evidence.push({ id: evidenceId, ...item });
    return evidenceId;
  }

  function addFinding(item: Omit<ReleaseFinding, "id" | "status">) {
    if (findings.length >= MAX_ITEMS) {
      outputTruncated = true;
      return;
    }
    findings.push({
      id: `STATIC-${String(findings.length + 1).padStart(3, "0")}`,
      status: "STATIC SIGNAL",
      ...item,
    });
  }

  for (const path of [
    ...new Set([...oldFiles.keys(), ...newFiles.keys()]),
  ].sort()) {
    const oldFile = oldFiles.get(path);
    const newFile = newFiles.get(path);
    if (oldFile && newFile && oldFile.sha256 === newFile.sha256) continue;
    changedFileCount++;
    if (fileChanges.length >= MAX_ITEMS) {
      outputTruncated = true;
      continue;
    }
    fileChanges.push({
      path,
      change: !oldFile ? "added" : !newFile ? "removed" : "modified",
      oldSize: oldFile?.size ?? null,
      newSize: newFile?.size ?? null,
      oldSha256: oldFile?.sha256 ?? null,
      newSha256: newFile?.sha256 ?? null,
    });
  }

  const oldScan = scanSnapshot(trusted, "Trusted");
  const newScan = scanSnapshot(candidate, "Candidate");
  const signalCounts = rules.map((rule, index) => ({
    category: rule.category,
    oldCount: [...oldScan.files.values()].reduce(
      (total, scans) => total + scans[index].count,
      0,
    ),
    newCount: [...newScan.files.values()].reduce(
      (total, scans) => total + scans[index].count,
      0,
    ),
  }));

  const oldManifestFile = manifestFile(trusted);
  const newManifestFile = manifestFile(candidate);
  const manifestFields = [
    ["scripts", "script"],
    ["dependencies", "dependency"],
    ["optionalDependencies", "optionalDependency"],
    ["peerDependencies", "peerDependency"],
  ] as const;
  const metadataCounts = { oldCount: 0, newCount: 0 };

  // Registry metadata and the actual archived manifest are separate evidence.
  for (const [role, snapshot] of [
    ["trusted", trusted],
    ["candidate", candidate],
  ] as const) {
    const archivedManifest = manifestFile(snapshot);
    for (const field of [
      "name",
      "version",
      ...manifestFields.map(([name]) => name),
    ] as const) {
      const registryValue = canonical(snapshot.release[field]);
      const archivedValue = canonical(snapshot.manifest[field]);
      if (registryValue === archivedValue) continue;
      metadataCounts[role === "trusted" ? "oldCount" : "newCount"]++;
      if (evidence.length + 2 > MAX_ITEMS) {
        outputTruncated = true;
        continue;
      }
      const archiveId = addEvidence({
        source: "npm-archive",
        file: "package.json",
        oldLine:
          role === "trusted" ? manifestLine(archivedManifest, field) : null,
        newLine:
          role === "candidate" ? manifestLine(archivedManifest, field) : null,
        oldExcerpt:
          role === "trusted" ? excerpt(`${field}: ${archivedValue}`) : null,
        newExcerpt:
          role === "candidate" ? excerpt(`${field}: ${archivedValue}`) : null,
        oldSha256:
          role === "trusted" ? (archivedManifest?.sha256 ?? null) : null,
        newSha256:
          role === "candidate" ? (archivedManifest?.sha256 ?? null) : null,
      });
      const registryId = addEvidence({
        source: "npm-registry",
        file: `${snapshot.release.name}@${snapshot.release.version} registry metadata`,
        oldLine: null,
        newLine: null,
        oldExcerpt:
          role === "trusted" ? excerpt(`${field}: ${registryValue}`) : null,
        newExcerpt:
          role === "candidate" ? excerpt(`${field}: ${registryValue}`) : null,
        oldSha256: null,
        newSha256: null,
      });
      if (archiveId && registryId)
        addFinding({
          category: "metadata",
          title: `${role === "trusted" ? "Trusted" : "Candidate"} ${field} differ between registry and archive`,
          description: `The ${role} release's npm registry ${field} do not match its archived package.json. The archive is used for release comparison. This discrepancy needs review and does not establish intent or runtime behavior.`,
          severity: "medium",
          evidenceIds: [archiveId, registryId],
        });
    }
  }

  for (const [path, candidateRules] of newScan.files) {
    const oldFile = oldFiles.get(path);
    const newFile = newFiles.get(path)!;
    const trustedRules = oldScan.files.get(path);
    if (oldFile && !trustedRules) {
      unknownBaselines++;
      continue;
    }
    for (const [index, rule] of rules.entries()) {
      const baseline = trustedRules?.[index];
      const current = candidateRules[index];
      const increase = current.count - (baseline?.count ?? 0);
      if (increase <= 0) continue;
      newSourceOccurrences += increase;
      // Prefer candidate lines absent from the baseline, without treating a
      // line move or an unrelated edit as a newly introduced capability.
      const signatures = new Map<string, number>();
      for (const match of baseline?.matches ?? [])
        signatures.set(
          match.signature,
          (signatures.get(match.signature) ?? 0) + 1,
        );
      const addedMatches = current.matches.filter((match) => {
        const remaining = signatures.get(match.signature) ?? 0;
        if (remaining === 0) return true;
        signatures.set(match.signature, remaining - 1);
        return false;
      });
      const sample = addedMatches[0] ?? current.matches[0];
      const previous = baseline?.matches[0];
      const evidenceId = addEvidence({
        source: "npm-archive",
        file: path,
        oldLine: previous?.line ?? null,
        newLine: sample.line,
        oldExcerpt: previous?.excerpt ?? null,
        newExcerpt: sample.excerpt,
        oldSha256: oldFile?.sha256 ?? null,
        newSha256: newFile.sha256,
      });
      if (!evidenceId) continue;
      addFinding({
        category: rule.category,
        title: `Additional ${rule.label} in ${path}`,
        description: `Lexical matches increased from ${baseline?.count ?? 0} to ${current.count} in this file (${increase} additional reference${increase === 1 ? "" : "s"}). Evidence shows a representative occurrence, not execution. Comments, strings, and similarly named functions can match; references do not prove a security impact.`,
        severity:
          rule.category === "process" || rule.category === "dynamic-code"
            ? "medium"
            : "low",
        evidenceIds: [evidenceId],
      });
    }
  }

  // A benign variable replaced with a sensitive name merits review even when
  // the total number of environment references stays constant.
  for (const [path] of newScan.files) {
    const oldFile = oldFiles.get(path);
    if (oldFile && !oldScan.files.has(path)) continue;
    const newFile = newFiles.get(path)!;
    const before = sensitiveReferences(oldFile?.text ?? "");
    const after = sensitiveReferences(newFile.text!);
    for (const [name, match] of after) {
      if (before.has(name)) continue;
      const evidenceId = addEvidence({
        source: "npm-archive",
        file: path,
        oldLine: null,
        newLine: match.line,
        oldExcerpt: null,
        newExcerpt: match.excerpt,
        oldSha256: oldFile?.sha256 ?? null,
        newSha256: newFile.sha256,
      });
      if (!evidenceId) break;
      addFinding({
        category: "environment",
        title: `New sensitive environment name ${name} in ${path}`,
        description:
          "A named environment reference associated with credentials appears in candidate source but not its scanned trusted counterpart. This may be a read, write, comment, or unreachable code; no environment access was observed.",
        severity: "medium",
        evidenceIds: [evidenceId],
      });
    }
  }

  for (const [field, kind] of manifestFields) {
    const oldValues = trusted.manifest[field];
    const newValues = candidate.manifest[field];
    for (const name of [
      ...new Set([...Object.keys(oldValues), ...Object.keys(newValues)]),
    ].sort()) {
      const oldValue = Object.hasOwn(oldValues, name) ? oldValues[name] : null;
      const newValue = Object.hasOwn(newValues, name) ? newValues[name] : null;
      if (oldValue === newValue) continue;
      changedManifestCount++;
      const evidenceId = addEvidence({
        source: "npm-archive",
        file: "package.json",
        oldLine: oldValue === null ? null : manifestLine(oldManifestFile, name),
        newLine: newValue === null ? null : manifestLine(newManifestFile, name),
        oldExcerpt:
          oldValue === null
            ? null
            : excerpt(`${field}.${name}: ${JSON.stringify(oldValue)}`),
        newExcerpt:
          newValue === null
            ? null
            : excerpt(`${field}.${name}: ${JSON.stringify(newValue)}`),
        oldSha256: oldManifestFile?.sha256 ?? null,
        newSha256: newManifestFile?.sha256 ?? null,
      });
      if (!evidenceId) continue;
      manifestChanges.push({ name, kind, oldValue, newValue, evidenceId });
      if (kind === "script" && lifecycleNames.has(name) && newValue !== null)
        addFinding({
          category: "lifecycle",
          title: `${oldValue === null ? "Added" : "Changed"} ${name} lifecycle script`,
          description: `The archived candidate manifest ${oldValue === null ? "introduces" : "changes"} the ${name} script. Lifecycle scripts can run under package-manager-defined conditions. The command is shown only as text and has not been executed.`,
          severity: "medium",
          evidenceIds: [evidenceId],
        });
    }
  }

  signalCounts.push(
    {
      category: "lifecycle",
      oldCount: Object.keys(trusted.manifest.scripts).filter((name) =>
        lifecycleNames.has(name),
      ).length,
      newCount: Object.keys(candidate.manifest.scripts).filter((name) =>
        lifecycleNames.has(name),
      ).length,
    },
    { category: "metadata", ...metadataCounts },
  );

  const notes = [...oldScan.notes, ...newScan.notes];
  if (unknownBaselines)
    notes.push(
      `${unknownBaselines} candidate source files have an unscanned trusted counterpart; new-signal findings are suppressed for those files because the baseline is unknown.`,
    );
  if (outputTruncated)
    notes.push(
      `Output is capped at ${MAX_ITEMS} file changes, findings, and evidence records. Some records were omitted. Aggregate scanned-source counts and total change counts in the summary are retained.`,
    );

  return {
    id,
    mode: "static",
    input: { ...input },
    generatedAt: new Date().toISOString(),
    status: "INCONCLUSIVE",
    riskScore: null,
    summary: `Archive comparison found ${changedFileCount} changed files and ${changedManifestCount} script/dependency changes. Scanned source contains ${newSourceOccurrences} additional lexical references compared with available per-file baselines. ${metadataCounts.oldCount + metadataCounts.newCount} registry/archive metadata discrepancies were identified. This deterministic static summary cannot establish runtime behavior, safety, or malicious intent; runtime analysis and AI investigation were not performed.`,
    releases: {
      trusted: releaseSummary(trusted),
      candidate: releaseSummary(candidate),
    },
    fileChanges,
    manifestChanges,
    findings,
    evidence,
    signalCounts,
    coverage: {
      trustedFilesScanned: oldScan.files.size,
      candidateFilesScanned: newScan.files.size,
      skippedFiles: oldScan.skipped + newScan.skipped,
      truncated: outputTruncated || oldScan.limited || newScan.limited,
      notes,
    },
    limitations: [
      "Static analysis only: no package code, lifecycle script, sandbox, network behavior, filesystem behavior, or child process was executed or observed. Runtime behavior is untested, not zero.",
      "Lexical source patterns can match comments, strings, and unrelated function names. Environment references may be writes rather than reads. Aliases, computed properties, obfuscation, native binaries, and other languages can hide capabilities.",
      "Counts are textual references, not runtime events. Findings identify increases per file and rule and newly introduced named sensitive environment references. Other changed arguments with unchanged counts are not detected as new capabilities. File renames are treated as removal and addition.",
      "Only JavaScript/TypeScript files up to 256 KiB, within a 2,000-file / 8 MiB budget per release, are scanned. Binary, unavailable, oversized, and non-source content is excluded from source rules. Each source finding has representative, bounded evidence rather than every occurrence.",
      "Dependency and script comparisons use archived package.json fields. Dependencies are not resolved, downloaded, or analyzed transitively. Registry/archive mismatches are independently reported for both releases.",
      "Artifact digests verify downloaded bytes against registry-provided integrity, not the publisher's trustworthiness. No CVE lookup, AI model, or numerical risk assessment is performed; the result remains INCONCLUSIVE.",
    ],
  };
}
