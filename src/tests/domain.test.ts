import { describe, expect, it } from "vitest";

import { createDemoReport, DEMO_ANALYSIS_ID, DEMO_REPORT } from "@/lib/demo";
import { assessRisk, calculateRiskScore, getRiskStatus } from "@/lib/risk";
import type { RiskSignal, RuntimeEvent } from "@/lib/types";
import { comparisonInputSchema } from "@/lib/validation";

const validInput = {
  packageName: "example-utils",
  trustedVersion: "1.4.1",
  candidateVersion: "1.4.2",
};

function signal(overrides: Partial<RiskSignal> = {}): RiskSignal {
  return {
    id: "example-signal",
    title: "Synthetic signal",
    description: "A synthetic event that warrants review.",
    points: 25,
    status: "OBSERVED",
    evidenceIds: ["EVD-001"],
    ...overrides,
  };
}

describe("comparison input", () => {
  it("accepts an exact release comparison and trims surrounding spaces", () => {
    expect(
      comparisonInputSchema.parse({
        packageName: "  @example/utils  ",
        trustedVersion: " 1.4.1 ",
        candidateVersion: "2.0.0-beta.1+build.42",
      }),
    ).toEqual({
      packageName: "@example/utils",
      trustedVersion: "1.4.1",
      candidateVersion: "2.0.0-beta.1+build.42",
    });
  });

  it.each([
    "https://registry.example.invalid/package",
    "../example-utils",
    "example-utils; echo hello",
    "example-utils$(whoami)",
    "example-utils with spaces",
    "UPPERCASE",
    "@example/",
    "@example/utils/extra",
    "",
    "a".repeat(215),
  ])("rejects an invalid package identifier: %s", (packageName) => {
    expect(
      comparisonInputSchema.safeParse({ ...validInput, packageName }).success,
    ).toBe(false);
  });

  it.each([
    "latest",
    "^1.4.2",
    "~1.4.2",
    "1.4",
    "v1.4.2",
    "01.4.2",
    "1.4.2-01",
    "1.4.2-",
    "1.4.2+",
    "1.4.2; node script.js",
    "",
  ])(
    "rejects a non-exact or malformed candidate version: %s",
    (candidateVersion) => {
      expect(
        comparisonInputSchema.safeParse({ ...validInput, candidateVersion })
          .success,
      ).toBe(false);
    },
  );

  it("rejects equal versions with an actionable candidate-field issue", () => {
    const result = comparisonInputSchema.safeParse({
      ...validInput,
      candidateVersion: "1.4.1",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["candidateVersion"],
            message: "Choose two different versions to compare.",
          }),
        ]),
      );
    }
  });

  it("rejects undeclared command input and non-string values", () => {
    expect(
      comparisonInputSchema.safeParse({
        ...validInput,
        command: "node anything.js",
      }).success,
    ).toBe(false);
    expect(
      comparisonInputSchema.safeParse({ ...validInput, packageName: null })
        .success,
    ).toBe(false);
  });
});

describe("transparent risk assessment", () => {
  it.each([
    [0, "LOW RISK"],
    [24, "LOW RISK"],
    [25, "REVIEW RECOMMENDED"],
    [59, "REVIEW RECOMMENDED"],
    [60, "HIGH RISK"],
    [100, "HIGH RISK"],
  ] as const)("classifies a score of %i as %s", (score, status) => {
    expect(getRiskStatus(score)).toBe(status);
  });

  it("returns inconclusive when evidence is insufficient, even for a high score", () => {
    expect(assessRisk([signal({ points: 82 })], false)).toEqual({
      score: 82,
      status: "INCONCLUSIVE",
    });
  });

  it("caps independent evidence contributions at 100", () => {
    expect(
      calculateRiskScore([
        signal({ id: "a", points: 80 }),
        signal({ id: "b", points: 70 }),
      ]),
    ).toBe(100);
  });

  it("prevents duplicate signals from inflating the risk score", () => {
    expect(() => calculateRiskScore([signal(), signal()])).toThrow(
      "Duplicate risk signal",
    );
  });

  it("requires an evidence reference for every scored signal", () => {
    expect(() => calculateRiskScore([signal({ evidenceIds: [] })])).toThrow(
      "requires evidence",
    );
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 101])(
    "rejects invalid score contributions: %s",
    (points) => {
      expect(() => calculateRiskScore([signal({ points })])).toThrow(
        "finite numbers between 0 and 100",
      );
      expect(() => getRiskStatus(points)).toThrow(
        "finite number between 0 and 100",
      );
    },
  );
});

describe("synthetic report integrity", () => {
  const runtimeEvents: RuntimeEvent[] = [
    ...DEMO_REPORT.networkEvents,
    ...DEMO_REPORT.processEvents,
    ...DEMO_REPORT.environmentAccesses,
    ...DEMO_REPORT.filesystemEvents,
  ];

  it("keeps the comparison table consistent with the underlying event evidence", () => {
    const eventTypes = {
      network: "network",
      processes: "process",
      environment: "environment",
      filesystem: "filesystem",
    } as const;
    for (const [comparisonId, eventType] of Object.entries(eventTypes)) {
      const comparison = DEMO_REPORT.behaviorComparisons.find(
        (row) => row.id === comparisonId,
      );
      expect(comparison).toBeDefined();
      expect(comparison?.oldValue).toBe(
        runtimeEvents.filter(
          (event) => event.type === eventType && event.release === "trusted",
        ).length,
      );
      expect(comparison?.newValue).toBe(
        runtimeEvents.filter(
          (event) => event.type === eventType && event.release === "candidate",
        ).length,
      );
    }
    expect(
      DEMO_REPORT.behaviorComparisons.find((row) => row.id === "dependencies")
        ?.newValue,
    ).toBe(
      DEMO_REPORT.dependencyChanges.filter(
        (change) => change.change === "added",
      ).length,
    );
  });

  it("resolves every finding, event, comparison, and risk contribution to unique evidence", () => {
    const evidenceIds = new Set(DEMO_REPORT.evidence.map((item) => item.id));
    expect(evidenceIds.size).toBe(DEMO_REPORT.evidence.length);

    const records = [
      ...DEMO_REPORT.staticFindings,
      ...runtimeEvents,
      ...DEMO_REPORT.behaviorComparisons,
      ...DEMO_REPORT.dependencyChanges,
      ...DEMO_REPORT.riskSignals,
    ];
    for (const record of records) {
      expect(record.evidenceIds.length).toBeGreaterThan(0);
      for (const id of record.evidenceIds)
        expect(evidenceIds.has(id)).toBe(true);
    }
  });

  it("derives the displayed score and risk status from the listed contributions", () => {
    const result = assessRisk(DEMO_REPORT.riskSignals);
    expect(result).toEqual({ score: 82, status: "HIGH RISK" });
    expect(DEMO_REPORT.riskScore).toBe(result.score);
    expect(DEMO_REPORT.status).toBe(result.status);
    expect(
      DEMO_REPORT.riskSignals.reduce((sum, item) => sum + item.points, 0),
    ).toBe(82);
  });

  it("keeps fixture-only sources and reserved network destinations explicit", () => {
    expect(DEMO_REPORT.isDemo).toBe(true);
    expect(DEMO_REPORT.aiInvestigation.source).toBe("authored-demo");
    expect(DEMO_REPORT.metadata.trusted.source).toBe("synthetic");
    expect(DEMO_REPORT.metadata.candidate.source).toBe("synthetic");
    for (const record of [...runtimeEvents, ...DEMO_REPORT.evidence])
      expect(record.source).toBe("synthetic");
    for (const event of DEMO_REPORT.networkEvents) {
      expect(new URL(event.url).hostname.endsWith(".invalid")).toBe(true);
      expect(event.outcome).toBe("simulated");
    }
    for (const event of DEMO_REPORT.environmentAccesses) {
      expect(event.value).toBe("[SYNTHETIC VALUE REDACTED]");
    }
  });

  it("returns deterministic independent reports without relabeling the fixture", () => {
    const first = createDemoReport();
    const second = createDemoReport();
    expect(first).toEqual(second);
    expect(first.id).toBe(DEMO_ANALYSIS_ID);
    first.metadata.candidate.maintainers.push("local-test-mutation");
    expect(second.metadata.candidate.maintainers).not.toContain(
      "local-test-mutation",
    );
    expect(DEMO_REPORT.metadata.candidate.maintainers).not.toContain(
      "local-test-mutation",
    );
    expect(second.packageName).toBe("example-utils");
    expect(second.metadata.trusted.version).toBe(second.trustedVersion);
    expect(second.metadata.candidate.version).toBe(second.candidateVersion);
  });
});
