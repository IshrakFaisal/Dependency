import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeTriage } from "@/lib/analysis/triage";
import { computeMetadataSignals } from "@/lib/analysis/metadata-signals";
import { compareSnapshots } from "@/lib/analysis/compare";
import type { PackageSnapshot } from "@/lib/types/static-analysis";
import {
  fixtureEntry,
  syntheticFixtures,
  syntheticReport,
} from "./helpers/benchmark-fixtures";
import { expectReferencedTriage } from "./helpers/triage-fixtures";
import { corpusSchema } from "@/lib/benchmark/schema";

vi.mock("server-only", () => ({}));
beforeEach(() =>
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Network prohibited in synthetic fixture tests.");
    }),
  ),
);
afterEach(() => vi.unstubAllGlobals());

describe("inert synthetic report fixtures", () => {
  it("contains all eight distinct authored cases", () => {
    expect(syntheticFixtures).toHaveLength(8);
    expect(
      corpusSchema.parse(syntheticFixtures.map(fixtureEntry)),
    ).toHaveLength(8);
  });
  it.each(syntheticFixtures)(
    "$name: matches its documented tier and reason IDs",
    (fixture) => {
      const report = syntheticReport(fixture);
      const result = computeTriage(report);
      expect(result.tier).toBe(fixture.expected.tier);
      expect(result.reasons.map(({ id }) => id)).toEqual(
        fixture.expected.reasonIds,
      );
      expectReferencedTriage(result, report);
      expect(report.status).toBe("INCONCLUSIVE");
      expect(report.riskScore).toBeNull();
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it.each(syntheticFixtures.filter((fixture) => fixture.metadata))(
    "$name: metadata fixture agrees with the existing signal module",
    (fixture) => {
      const signals = computeMetadataSignals(
        fixture.metadata!.old,
        fixture.metadata!.new,
        "2026-11-16T00:00:00.000Z",
      );
      expect(signals.map(({ id }) => id)).toEqual(
        fixture.report.metadataSignals?.map(({ id }) => id),
      );
      expect(
        computeTriage({
          ...fixture.report,
          metadataSignals: signals,
        }).reasons.map(({ id }) => id),
      ).toEqual(fixture.expected.reasonIds);
    },
  );
});

function sourceReport(fixture: (typeof syntheticFixtures)[number]) {
  const template = syntheticReport(fixture);
  const snapshot = (
    role: "trusted" | "candidate",
    text: string,
  ): PackageSnapshot => {
    const release = template.releases[role];
    return {
      ...release,
      manifest: {
        name: release.release.name,
        version: release.release.version,
        scripts: {},
        dependencies: {},
        optionalDependencies: {},
        peerDependencies: {},
      },
      files: [
        {
          path: "index.js",
          text,
          size: Buffer.byteLength(text),
          sha256: createHash("sha256").update(text).digest("hex"),
        },
      ],
    };
  };
  return compareSnapshots(
    "synthetic-source-shape",
    template.input,
    snapshot("trusted", fixture.scanner!.oldText),
    snapshot("candidate", fixture.scanner!.newText),
  );
}

describe("existing lexical scanner on comment-only fixture source", () => {
  it.each(
    syntheticFixtures.filter(
      (fixture) => fixture.scanner && !fixture.knownLimitation,
    ),
  )(
    "$name: direct textual reference produces the expected triage reason",
    (fixture) => {
      for (const text of [fixture.scanner!.oldText, fixture.scanner!.newText])
        expect(
          text
            .split("\n")
            .filter(Boolean)
            .every((line) => line.startsWith("//")),
        ).toBe(true);
      const report = sourceReport(fixture);
      expect(
        report.signalCounts.find(
          ({ category }) => category === fixture.scanner!.category,
        ),
      ).toEqual(fixture.report.signalCounts[0]);
      expect(computeTriage(report).reasons.map(({ id }) => id)).toEqual(
        fixture.expected.reasonIds,
      );
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it("KNOWN MISS: computed property plus alias remains outside current lexical checks", () => {
    // Known limitation, NOT a detection success: the regex scanner does not
    // resolve globalThis["fe" + "tch"] or follow the send alias. Comments keep
    // the example inert; zero excluded files isolates this semantic gap.
    const fixture = syntheticFixtures.find((item) => item.knownLimitation)!;
    expect(fixture.notes).toContain("KNOWN MISS");
    expect(
      fixture
        .scanner!.newText.split("\n")
        .filter(Boolean)
        .every((line) => line.startsWith("//")),
    ).toBe(true);
    const report = sourceReport(fixture);
    expect(
      report.signalCounts.find(({ category }) => category === "network"),
    ).toEqual({ category: "network", oldCount: 0, newCount: 0 });
    expect(report.findings).toEqual([]);
    expect(computeTriage(report)).toMatchObject({
      tier: "no-notable-changes",
      reasons: [],
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
