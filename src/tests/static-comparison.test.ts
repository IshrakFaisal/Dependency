import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { compareSnapshots } from "@/lib/analysis/compare";
import type {
  ArchiveFile,
  PackageSnapshot,
  StaticAnalysisReport,
} from "@/lib/types/static-analysis";

const input = {
  packageName: "synthetic-comparison-fixture",
  trustedVersion: "1.0.0",
  candidateVersion: "1.0.1",
};

function file(path: string, text: string | null): ArchiveFile {
  return {
    path,
    text,
    size: Buffer.byteLength(text ?? "synthetic-binary"),
    sha256: createHash("sha256")
      .update(text ?? "synthetic-binary")
      .digest("hex"),
  };
}

function snapshot(
  files: ArchiveFile[] = [],
  manifestOverrides: Partial<PackageSnapshot["manifest"]> = {},
): PackageSnapshot {
  const manifest = {
    name: input.packageName,
    version: "1.0.0",
    scripts: {},
    dependencies: {},
    optionalDependencies: {},
    peerDependencies: {},
    ...manifestOverrides,
  };
  return {
    release: {
      ...structuredClone(manifest),
      description: "Synthetic fixture for source comparison tests.",
      license: "MIT",
      tarballUrl:
        "https://registry.npmjs.org/synthetic-comparison-fixture/-/synthetic-comparison-fixture-1.0.0.tgz",
      integrity: "sha512-synthetic-test-value",
      shasum: null,
      deprecated: null,
    },
    manifest,
    files: [file("package.json", JSON.stringify(manifest, null, 2)), ...files],
    archiveSha256: "a".repeat(64),
    integrityVerified: "sha512",
    compressedBytes: 300,
    unpackedBytes: 1000,
    warnings: [],
  };
}

function compare(trusted: PackageSnapshot, candidate: PackageSnapshot) {
  return compareSnapshots("synthetic-analysis", input, trusted, candidate);
}

function count(report: StaticAnalysisReport, category: string) {
  return report.signalCounts.find((row) => row.category === category);
}

describe("static source differential comparison", () => {
  it("finds an added capability with source hashes and a real evidence reference", () => {
    const trusted = snapshot([file("index.js", "export const value = 1;\n")]);
    const candidate = snapshot([
      file(
        "index.js",
        'export const value = 1;\nfetch("https://fixture.invalid");\n',
      ),
    ]);
    const report = compare(trusted, candidate);
    expect(count(report, "network")).toMatchObject({
      oldCount: 0,
      newCount: 1,
    });
    expect(report.findings).toHaveLength(1);
    const finding = report.findings[0];
    expect(finding).toMatchObject({
      category: "network",
      status: "STATIC SIGNAL",
    });
    const evidence = report.evidence.find(
      (item) => item.id === finding.evidenceIds[0],
    );
    expect(evidence).toMatchObject({
      file: "index.js",
      source: "npm-archive",
      oldLine: null,
      newLine: 2,
      oldSha256: trusted.files[1].sha256,
      newSha256: candidate.files[1].sha256,
    });
    expect(evidence?.newExcerpt).toContain("fixture.invalid");
    expect(report.fileChanges).toContainEqual({
      path: "index.js",
      change: "modified",
      oldSize: trusted.files[1].size,
      newSize: candidate.files[1].size,
      oldSha256: trusted.files[1].sha256,
      newSha256: candidate.files[1].sha256,
    });
  });

  it("does not call unchanged, moved, or removed capability references new findings", () => {
    const trusted = snapshot([
      file("index.js", 'fetch("https://fixture.invalid");\n'),
      file("old.js", "process.env.FIXTURE;\n"),
    ]);
    const candidate = snapshot([
      file(
        "index.js",
        '// unrelated source edit\n\nfetch("https://fixture.invalid");\n',
      ),
    ]);
    const report = compare(trusted, candidate);
    expect(report.findings).toEqual([]);
    expect(count(report, "network")).toMatchObject({
      oldCount: 1,
      newCount: 1,
    });
    expect(count(report, "environment")).toMatchObject({
      oldCount: 1,
      newCount: 0,
    });
    expect(report.fileChanges).toContainEqual(
      expect.objectContaining({ path: "old.js", change: "removed" }),
    );
  });

  it("uses per-file counts so a removed reference elsewhere cannot cancel an addition", () => {
    const trusted = snapshot([file("old.js", "process.env.FIXTURE;")]);
    const candidate = snapshot([file("new.js", "process.env.FIXTURE;")]);
    const report = compare(trusted, candidate);
    expect(count(report, "environment")).toMatchObject({
      oldCount: 1,
      newCount: 1,
    });
    expect(report.findings).toHaveLength(1);
    expect(report.evidence[0]).toMatchObject({
      file: "new.js",
      oldSha256: null,
    });
  });

  it("selects the added occurrence rather than an existing moved line", () => {
    const trusted = snapshot([file("index.js", "process.env.EXISTING;\n")]);
    const candidate = snapshot([
      file("index.js", "\nprocess.env.EXISTING;\nprocess.env.ADDED;\n"),
    ]);
    const report = compare(trusted, candidate);
    expect(report.evidence[0]).toMatchObject({ oldLine: 1, newLine: 3 });
    expect(report.evidence[0].newExcerpt).toContain("ADDED");
  });

  it.each([
    ["network", 'import https from "node:https";'],
    ["network", 'fetch("https://fixture.invalid");'],
    ["environment", 'process["env"].SYNTHETIC_TOKEN;'],
    ["process", 'import childProcess from "node:child_process";'],
    ["process", 'spawn("fixture", []);'],
    ["filesystem", 'fs.writeFileSync("fixture", "text");'],
    ["dynamic-code", 'eval("synthetic text");'],
    ["dynamic-code", 'new Function("return 1");'],
  ])(
    "detects a %s reference without executing its source",
    (category, text) => {
      const report = compare(snapshot(), snapshot([file("index.ts", text)]));
      expect(report.findings).toContainEqual(
        expect.objectContaining({ category, status: "STATIC SIGNAL" }),
      );
      expect(count(report, category)).toMatchObject({
        oldCount: 0,
        newCount: 1,
      });
    },
  );

  it("never executes supplied source and keeps comments explicitly heuristic", () => {
    const text =
      'throw new Error("must never execute");\n// fetch("https://fixture.invalid");';
    const report = compare(snapshot(), snapshot([file("index.js", text)]));
    expect(report.findings[0].description).toContain("Comments, strings");
    expect(report.status).toBe("INCONCLUSIVE");
    expect(report.riskScore).toBeNull();
    expect(report.summary).toContain("deterministic static summary");
    expect(report.limitations.join(" ")).toContain("untested, not zero");
    expect(report).not.toHaveProperty("networkEvents");
  });

  it("retains same-count argument changes in the file diff and discloses the heuristic gap", () => {
    const trusted = snapshot([
      file("index.js", 'fetch("https://first.invalid");'),
    ]);
    const candidate = snapshot([
      file("index.js", 'fetch("https://second.invalid");'),
    ]);
    const report = compare(trusted, candidate);
    expect(report.findings).toEqual([]);
    expect(report.fileChanges).toHaveLength(1);
    expect(report.limitations.join(" ")).toContain(
      "changed arguments with unchanged counts",
    );
  });
});

describe("archive inventory and scan coverage", () => {
  it("uses file hashes for binary changes, additions, and removals without source claims", () => {
    const trusted = snapshot([
      file("image.bin", null),
      file("removed.txt", "old"),
    ]);
    const candidate = snapshot([
      { ...file("image.bin", null), sha256: "b".repeat(64) },
      file("added.txt", "new"),
    ]);
    const report = compare(trusted, candidate);
    expect(
      report.fileChanges.map(({ path, change }) => [path, change]),
    ).toEqual([
      ["added.txt", "added"],
      ["image.bin", "modified"],
      ["removed.txt", "removed"],
    ]);
    expect(report.findings).toEqual([]);
    expect(report.coverage).toMatchObject({
      trustedFilesScanned: 0,
      candidateFilesScanned: 0,
      skippedFiles: 6,
    });
  });

  it("skips binary, oversized, and non-source inputs with explicit coverage notes", () => {
    const candidate = snapshot([
      file("binary.js", null),
      file("nul.js", "fetch(\0"),
      file("oversized.js", " ".repeat(256 * 1024 + 1) + "fetch();"),
      file("README.md", "fetch();"),
      file("small.js", "fetch();"),
    ]);
    const report = compare(snapshot(), candidate);
    expect(report.coverage).toMatchObject({
      candidateFilesScanned: 1,
      skippedFiles: 6,
      truncated: true,
    });
    expect(count(report, "network")?.newCount).toBe(1);
    expect(report.coverage.notes.join(" ")).toContain(
      "2 binary or unavailable",
    );
    expect(report.coverage.notes.join(" ")).toContain(
      "1 source files over 256 KiB",
    );
  });

  it("does not turn an unscanned old source baseline into a false absence", () => {
    const trusted = snapshot([file("index.js", null)]);
    const candidate = snapshot([file("index.js", "fetch();")]);
    const report = compare(trusted, candidate);
    expect(report.findings).toEqual([]);
    expect(report.coverage.notes.join(" ")).toContain("baseline is unknown");
  });

  it("caps findings, file changes, and evidence while retaining aggregate counts", () => {
    const candidate = snapshot(
      Array.from({ length: 205 }, (_, index) =>
        file(`source-${index}.js`, "fetch();"),
      ),
    );
    const report = compare(snapshot(), candidate);
    expect(report.findings).toHaveLength(200);
    expect(report.evidence).toHaveLength(200);
    expect(report.fileChanges).toHaveLength(200);
    expect(count(report, "network")?.newCount).toBe(205);
    expect(report.coverage.truncated).toBe(true);
    expect(report.summary).toContain("205 changed files");
    expect(report.coverage.notes.join(" ")).toContain(
      "Some records were omitted",
    );
    const ids = new Set(report.evidence.map((item) => item.id));
    expect(ids.size).toBe(200);
    for (const finding of report.findings)
      for (const id of finding.evidenceIds) expect(ids.has(id)).toBe(true);
  });

  it("enforces the source file count budget", () => {
    const candidate = snapshot(
      Array.from({ length: 2001 }, (_, index) =>
        file(`source-${index}.js`, "export {};"),
      ),
    );
    const report = compare(snapshot(), candidate);
    expect(report.coverage.candidateFilesScanned).toBe(2000);
    expect(report.coverage.truncated).toBe(true);
    expect(report.coverage.notes.join(" ")).toContain("1 files beyond");
  });

  it("enforces the per-release source byte budget", () => {
    const candidate = snapshot(
      Array.from({ length: 33 }, (_, index) =>
        file(`source-${index}.js`, " ".repeat(256 * 1024)),
      ),
    );
    const report = compare(snapshot(), candidate);
    expect(report.coverage.candidateFilesScanned).toBe(32);
    expect(report.coverage.truncated).toBe(true);
    expect(report.coverage.notes.join(" ")).toContain("1 files beyond");
  });

  it("bounds minified excerpts around the match and retains archive warnings", () => {
    const candidate = snapshot([
      file(
        "min.js",
        " ".repeat(5000) + "process.env.FIXTURE;" + " ".repeat(5000),
      ),
    ]);
    candidate.warnings = ["Synthetic archive warning"];
    const report = compare(snapshot(), candidate);
    expect(report.evidence[0].newExcerpt).toContain("process.env.FIXTURE");
    expect(report.evidence[0].newExcerpt!.length).toBeLessThan(650);
    expect(report.coverage.notes.join(" ")).toContain(
      "Synthetic archive warning",
    );
    expect(report.releases.candidate).toMatchObject({
      archiveSha256: "a".repeat(64),
      integrityVerified: "sha512",
      fileCount: 2,
    });
    expect(report.releases.candidate).not.toHaveProperty("files");
  });
});

describe("archived manifests and registry discrepancies", () => {
  it("compares scripts and every requested dependency group with archive evidence", () => {
    const trusted = snapshot([], {
      scripts: { test: "old test" },
      dependencies: { "synthetic-old": "1.0.0" },
      peerDependencies: { "synthetic-peer": "^1.0.0" },
    });
    const candidate = snapshot([], {
      scripts: { test: "new test", postinstall: "node fixture.js" },
      optionalDependencies: { "synthetic-optional": "2.0.0" },
      peerDependencies: { "synthetic-peer": "^2.0.0" },
    });
    const report = compare(trusted, candidate);
    expect(report.manifestChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "test",
          kind: "script",
          oldValue: "old test",
          newValue: "new test",
        }),
        expect.objectContaining({
          name: "postinstall",
          kind: "script",
          oldValue: null,
          newValue: "node fixture.js",
        }),
        expect.objectContaining({
          name: "synthetic-old",
          kind: "dependency",
          oldValue: "1.0.0",
          newValue: null,
        }),
        expect.objectContaining({
          name: "synthetic-optional",
          kind: "optionalDependency",
          oldValue: null,
          newValue: "2.0.0",
        }),
        expect.objectContaining({
          name: "synthetic-peer",
          kind: "peerDependency",
          oldValue: "^1.0.0",
          newValue: "^2.0.0",
        }),
      ]),
    );
    expect(report.findings).toContainEqual(
      expect.objectContaining({
        category: "lifecycle",
        title: "Added postinstall lifecycle script",
      }),
    );
    expect(count(report, "lifecycle")).toMatchObject({
      oldCount: 0,
      newCount: 1,
    });
    for (const change of report.manifestChanges) {
      const evidence = report.evidence.find(
        (item) => item.id === change.evidenceId,
      );
      expect(evidence).toMatchObject({
        source: "npm-archive",
        file: "package.json",
        oldSha256: trusted.files[0].sha256,
        newSha256: candidate.files[0].sha256,
      });
    }
  });

  it("detects registry/archive differences in both releases and trusts archived fields for diffs", () => {
    const trusted = snapshot([], {
      dependencies: { "synthetic-archive": "1.0.0" },
    });
    const candidate = snapshot([], {
      scripts: { postinstall: "node archived-fixture.js" },
    });
    trusted.release.dependencies = {};
    candidate.release.scripts = { test: "registry-only" };
    const report = compare(trusted, candidate);
    const discrepancies = report.findings.filter(
      (finding) => finding.category === "metadata",
    );
    expect(discrepancies.map((finding) => finding.title)).toEqual([
      "Trusted dependencies differ between registry and archive",
      "Candidate scripts differ between registry and archive",
    ]);
    expect(count(report, "metadata")).toMatchObject({
      oldCount: 1,
      newCount: 1,
    });
    for (const discrepancy of discrepancies) {
      const linked = report.evidence.filter((item) =>
        discrepancy.evidenceIds.includes(item.id),
      );
      expect(linked.map((item) => item.source)).toEqual([
        "npm-archive",
        "npm-registry",
      ]);
      expect(linked[1]).toMatchObject({ oldSha256: null, newSha256: null });
    }
    expect(
      report.manifestChanges.some((change) => change.name === "test"),
    ).toBe(false);
    expect(report.manifestChanges).toContainEqual(
      expect.objectContaining({
        name: "postinstall",
        newValue: "node archived-fixture.js",
      }),
    );
  });

  it("ignores object property order while checking metadata", () => {
    const candidate = snapshot([], {
      dependencies: { "synthetic-a": "1", "synthetic-b": "2" },
    });
    candidate.release.dependencies = { "synthetic-b": "2", "synthetic-a": "1" };
    const report = compare(snapshot(), candidate);
    expect(
      report.findings.filter((finding) => finding.category === "metadata"),
    ).toEqual([]);
  });

  it("does not mistake inherited properties for dependency declarations", () => {
    const candidate = snapshot([], {
      dependencies: JSON.parse('{"toString":"1.0.0","__proto__":"2.0.0"}'),
    });
    const report = compare(snapshot(), candidate);
    expect(report.manifestChanges).toContainEqual(
      expect.objectContaining({
        name: "toString",
        oldValue: null,
        newValue: "1.0.0",
      }),
    );
    expect(report.manifestChanges).toContainEqual(
      expect.objectContaining({
        name: "__proto__",
        oldValue: null,
        newValue: "2.0.0",
      }),
    );
  });

  it("keeps results independent from input mutations", () => {
    const trusted = snapshot();
    const candidate = snapshot();
    const report = compare(trusted, candidate);
    candidate.release.scripts.changed = "new value";
    candidate.warnings.push("new warning");
    expect(report.releases.candidate.release.scripts).toEqual({});
    expect(report.releases.candidate.warnings).toEqual([]);
  });
});
