import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeTriage,
  TRIAGE_DISCLAIMER,
  triageSchema,
} from "@/lib/analysis/triage";
import type { MetadataSignal } from "@/lib/analysis/metadata-signals";
import type { StaticAnalysisReport } from "@/lib/types/static-analysis";
import {
  expectReferencedTriage,
  triageCategories,
  triageFinding,
  triageReport,
  triageSignal,
  withAddedFinding,
} from "./helpers/triage-fixtures";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Network is disabled in triage tests.");
    }),
  );
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function checked(report: StaticAnalysisReport) {
  const original = structuredClone(report);
  const triage = computeTriage(report);
  expectReferencedTriage(triage, report);
  expect(report).toEqual(original);
  expect(report.riskScore).toBeNull();
  expect(report.status).toBe("INCONCLUSIVE");
  return triage;
}
const reviewSignals = [
  "install-script-added",
  "maintainer-changed",
  "provenance-dropped",
  "dependency-added",
] as const;

describe("deterministic triage rules", () => {
  it.each(reviewSignals)(
    "requests review for the %s metadata signal alone",
    (id) => {
      const report = triageReport();
      report.metadataSignals = [triageSignal(id)];
      const result = checked(report);
      expect(result.tier).toBe("needs-review");
      expect(result.reasons).toHaveLength(1);
      expect(result.reasons[0]).toMatchObject({
        id,
        source: "metadata",
        evidenceRef: id,
      });
    },
  );

  it.each(reviewSignals)("does not escalate an info-only %s signal", (id) => {
    const report = triageReport();
    report.metadataSignals = [{ ...triageSignal(id), severity: "info" }];
    expect(checked(report)).toMatchObject({
      tier: "no-notable-changes",
      reasons: [],
    });
  });

  it.each(triageCategories)(
    "requests review for a %s category increase alone",
    (category) => {
      const report = triageReport();
      report.signalCounts = [{ category, oldCount: 1, newCount: 2 }];
      report.findings = [triageFinding(category)];
      const result = checked(report);
      expect(result.tier).toBe("needs-review");
      expect(result.reasons).toHaveLength(1);
      expect(result.reasons[0]).toMatchObject({
        id: `${category}-matches-increased`,
        source: "static",
        evidenceRef: "#/signalCounts/0",
      });
      expect(result.reasons[0].detail).toContain("from 1 to 2");
    },
  );

  it("references the existing count row when no finding ID was retained", () => {
    const report = triageReport();
    report.signalCounts[0].newCount = 2;
    expect(checked(report).reasons[0]).toMatchObject({
      evidenceRef: "#/signalCounts/0",
    });
  });

  it("requests review for a finding in an added file even when aggregate counts are unchanged", () => {
    const report = withAddedFinding(triageReport());
    report.signalCounts[0] = { category: "network", oldCount: 1, newCount: 1 };
    const result = checked(report);
    expect(result.tier).toBe("needs-review");
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toMatchObject({
      id: "new-file:STATIC-001",
      evidenceRef: "STATIC-001",
    });
  });

  it.each(["modified", "removed"] as const)(
    "does not treat a %s file as an added file",
    (change) => {
      const report = withAddedFinding(triageReport());
      report.fileChanges[0].change = change;
      expect(checked(report).tier).toBe("no-notable-changes");
    },
  );

  it("does not infer an added-file finding from a missing evidence link", () => {
    const report = withAddedFinding(triageReport());
    report.evidence = [];
    expect(checked(report).tier).toBe("no-notable-changes");
  });

  it("does not infer an added-file finding from trusted-only evidence", () => {
    const report = withAddedFinding(triageReport());
    report.evidence[0].newLine = null;
    expect(checked(report).tier).toBe("no-notable-changes");
  });

  it("retains recent-release as an info reason without requesting review", () => {
    const report = triageReport();
    report.metadataSignals = [triageSignal("recent-release")];
    const result = checked(report);
    expect(result.tier).toBe("no-notable-changes");
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toMatchObject({
      id: "recent-release",
      evidenceRef: "recent-release",
    });
    expect(result.reasons[0].title).toContain("information only");
  });

  it("does not escalate recency even if a supplied recency signal has review severity", () => {
    const report = triageReport();
    report.metadataSignals = [
      { ...triageSignal("recent-release"), severity: "review" },
    ];
    expect(checked(report).tier).toBe("no-notable-changes");
  });

  it("returns no-notable-changes for a complete scan with no matching rules", () => {
    const report = triageReport();
    expect(checked(report)).toEqual({
      tier: "no-notable-changes",
      reasons: [],
      disclaimer: TRIAGE_DISCLAIMER,
    });
  });

  it.each([
    { field: "skippedFiles" as const, value: 2, id: "scan-skipped-files" },
    { field: "truncated" as const, value: true, id: "scan-truncated" },
  ])(
    "returns incomplete for the $field limitation alone",
    ({ field, value, id }) => {
      const report = triageReport();
      report.coverage = { ...report.coverage, [field]: value };
      const result = checked(report);
      expect(result.tier).toBe("incomplete");
      expect(result.reasons).toHaveLength(1);
      expect(result.reasons[0]).toMatchObject({
        id,
        source: "scan-limitation",
        evidenceRef: `#/coverage/${field}`,
      });
    },
  );

  it("records one reason for each structured limitation", () => {
    const report = triageReport();
    report.coverage.skippedFiles = 3;
    report.coverage.truncated = true;
    expect(checked(report).reasons.map(({ id }) => id)).toEqual([
      "scan-skipped-files",
      "scan-truncated",
    ]);
  });

  it.each(["metadata", "static"])(
    "keeps limitation reasons when a %s reason requests review",
    (source) => {
      const report = triageReport();
      report.coverage.skippedFiles = 1;
      report.coverage.truncated = true;
      if (source === "metadata")
        report.metadataSignals = [triageSignal("dependency-added")];
      else report.signalCounts[0].newCount = 1;
      const result = checked(report);
      expect(result.tier).toBe("needs-review");
      expect(result.reasons).toHaveLength(3);
      expect(
        result.reasons.filter((reason) => reason.source === "scan-limitation"),
      ).toHaveLength(2);
    },
  );

  it("keeps a limited scan incomplete when its only metadata reason is recency", () => {
    const report = triageReport();
    report.coverage.truncated = true;
    report.metadataSignals = [triageSignal("recent-release")];
    expect(checked(report).tier).toBe("incomplete");
  });

  it("does not treat generic notes and standing limitations as coverage loss", () => {
    const report = triageReport();
    report.limitations.push("Runtime behavior is untested.");
    report.coverage.notes.push(
      "All selected files were inspected; checksum information is available.",
    );
    expect(checked(report).tier).toBe("no-notable-changes");
  });

  it.each([0, 1])(
    "does not escalate a non-increasing category with newCount=%s",
    (newCount) => {
      const report = triageReport();
      report.signalCounts[0] = { category: "network", oldCount: 1, newCount };
      report.findings = [triageFinding("network")];
      expect(checked(report).tier).toBe("no-notable-changes");
    },
  );

  it("does not add extra rules for sensitive-name changes at equal category totals", () => {
    const report = triageReport();
    report.signalCounts = [
      { category: "environment", oldCount: 1, newCount: 1 },
    ];
    report.findings = [
      {
        ...triageFinding("environment"),
        title: "New sensitive environment name in index.js",
      },
    ];
    expect(checked(report).tier).toBe("no-notable-changes");
  });

  it.each(["metadata", "lifecycle"] as const)(
    "does not apply static category rules to %s",
    (category) => {
      const report = withAddedFinding(triageReport(), category);
      report.signalCounts = [{ category, oldCount: 0, newCount: 2 }];
      expect(checked(report).tier).toBe("no-notable-changes");
    },
  );

  it("is deterministic without reading the clock and sorts reasons by source then id", () => {
    const report = withAddedFinding(triageReport());
    report.metadataSignals = reviewSignals.map(triageSignal).reverse();
    report.signalCounts[0].newCount = 1;
    report.coverage.skippedFiles = 2;
    report.coverage.truncated = true;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => {
      throw new Error("Clock access is forbidden.");
    });
    const first = checked(report);
    expect(checked(report)).toEqual(first);
    report.metadataSignals.reverse();
    expect(checked(report)).toEqual(first);
    expect(clock).not.toHaveBeenCalled();
  });

  it("references aggregate totals independently of same-category finding order", () => {
    const report = triageReport();
    report.signalCounts[0].newCount = 1;
    report.findings = [
      triageFinding("network", "STATIC-002"),
      triageFinding("network", "STATIC-001"),
    ];
    const first = checked(report);
    report.findings.reverse();
    expect(checked(report)).toEqual(first);
    expect(first.reasons[0].evidenceRef).toBe("#/signalCounts/0");
  });

  it("uses authored reason text instead of copying prohibited wording from evidence prose", () => {
    const report = withAddedFinding(triageReport());
    const text = "safe unsafe malicious clean verified";
    report.metadataSignals = [
      {
        ...triageSignal("provenance-dropped"),
        title: text,
        detail: text,
      } as MetadataSignal,
    ];
    report.findings[0].title = text;
    report.findings[0].description = text;
    report.evidence[0].newExcerpt = text;
    report.coverage.notes = [text];
    report.coverage.skippedFiles = 1;
    expect(checked(report).tier).toBe("needs-review");
  });

  it("ignores runtime and investigation supplements", () => {
    const report = triageReport();
    const result = checked(report);
    expect(
      checked(
        Object.assign(report, {
          runtime: { riskScore: 99 },
          investigation: { recommendation: "review" },
        }),
      ),
    ).toEqual(result);
  });

  it("requires a non-empty evidence reference and the exact disclaimer in the output schema", () => {
    const result = checked(triageReport());
    expect(
      triageSchema.safeParse({ ...result, disclaimer: "Different text" })
        .success,
    ).toBe(false);
    expect(
      triageSchema.safeParse({
        ...result,
        reasons: [
          {
            id: "example",
            source: "static",
            title: "Example",
            detail: "Example",
            evidenceRef: "",
          },
        ],
      }).success,
    ).toBe(false);
  });
});
