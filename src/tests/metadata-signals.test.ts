import { describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/metadata-packument.json";
import {
  computeMetadataSignals,
  metadataSignalSchema,
  versionMetadataSchema,
  type VersionMetadata,
} from "@/lib/analysis/metadata-signals";

const now = "2026-11-15T00:00:00.000Z";
function metadata(version: keyof typeof fixture.versions): VersionMetadata {
  return versionMetadataSchema.parse({
    ...fixture.versions[version],
    time: fixture.time,
  });
}
const trusted = () => metadata("1.0.0");
const candidate = () => metadata("1.1.0");
const unchanged = () => metadata("1.0.1");
const find = (
  id: string,
  old = trusted(),
  next = candidate(),
  clock: Date | string | number = now,
) =>
  computeMetadataSignals(old, next, clock).find((signal) => signal.id === id);

describe("metadata signals from synthetic packument JSON", () => {
  it("install-script-added: detects exactly four install-related hooks, including changed content", () => {
    expect(find("install-script-added")).toMatchObject({
      severity: "review",
      evidence: {
        changes: [
          {
            script: "preinstall",
            oldCommand: null,
            newCommand: "node pre-fixture.js",
          },
          {
            script: "install",
            oldCommand: "node old-fixture.js",
            newCommand: "node changed-fixture.js",
          },
          {
            script: "postinstall",
            oldCommand: null,
            newCommand: "node post-fixture.js",
          },
          {
            script: "prepare",
            oldCommand: null,
            newCommand: "node prepare-fixture.js",
          },
        ],
      },
    });
  });
  it("install-script-added: ignores unchanged hooks and unrelated script edits", () => {
    expect(
      find("install-script-added", trusted(), unchanged()),
    ).toBeUndefined();
  });
  it("install-script-added: ignores removed hooks and preserves empty-string content changes", () => {
    expect(
      find("install-script-added", trusted(), { ...unchanged(), scripts: {} }),
    ).toBeUndefined();
    expect(
      find("install-script-added", trusted(), {
        ...unchanged(),
        scripts: { install: "" },
      }),
    ).toMatchObject({
      evidence: { changes: [{ script: "install", newCommand: "" }] },
    });
  });
  it("maintainer-changed: detects publisher and gained/lost members with evidence", () => {
    expect(find("maintainer-changed")).toMatchObject({
      evidence: {
        oldPublisher: "name:fixture-alice",
        newPublisher: "name:fixture-carol",
        addedMaintainers: ["name:fixture-carol"],
        removedMaintainers: ["name:fixture-bob"],
      },
    });
  });
  it("maintainer-changed: ignores list ordering, duplicates and unchanged publisher accounts", () => {
    const next = unchanged();
    next.maintainers!.push({ name: "fixture-alice" });
    next._npmUser!.email = "changed-contact@example.invalid";
    expect(find("maintainer-changed", trusted(), next)).toBeUndefined();
  });
  it("maintainer-changed: detects publisher changes even without maintainer lists", () => {
    const before = trusted();
    const after = candidate();
    delete before.maintainers;
    delete after.maintainers;
    expect(find("maintainer-changed", before, after)).toMatchObject({
      evidence: { addedMaintainers: [], removedMaintainers: [] },
    });
  });
  it("maintainer-changed: detects membership changes even without publishers", () => {
    const before = trusted();
    const after = candidate();
    delete before._npmUser;
    delete after._npmUser;
    expect(find("maintainer-changed", before, after)).toMatchObject({
      evidence: {
        oldPublisher: null,
        newPublisher: null,
        removedMaintainers: ["name:fixture-bob"],
      },
    });
  });
  it("maintainer-changed: skips unavailable identities instead of claiming a takeover", () => {
    expect(
      find("maintainer-changed", trusted(), {
        ...candidate(),
        _npmUser: undefined,
        maintainers: undefined,
      }),
    ).toBeUndefined();
    expect(
      find("maintainer-changed", trusted(), {
        ...candidate(),
        _npmUser: {},
        maintainers: [{}],
      }),
    ).toBeUndefined();
  });
  it("maintainer-changed: compares email-only people with case-insensitive addresses", () => {
    const before = {
      ...trusted(),
      _npmUser: { email: "ALICE@example.invalid" },
      maintainers: [],
    };
    const same = {
      ...unchanged(),
      _npmUser: { email: "alice@example.invalid" },
      maintainers: [],
    };
    expect(find("maintainer-changed", before, same)).toBeUndefined();
    expect(
      find("maintainer-changed", before, {
        ...same,
        _npmUser: { email: "bob@example.invalid" },
      }),
    ).toBeDefined();
  });
  it("provenance-dropped: detects formerly advertised attestations missing in the candidate", () => {
    expect(find("provenance-dropped")).toMatchObject({
      severity: "review",
      evidence: {
        oldAttestations: fixture.versions["1.0.0"].dist.attestations,
        newAttestations: null,
      },
    });
  });
  it("provenance-dropped: ignores retained attestations even when the attestation URL changes", () => {
    expect(find("provenance-dropped", trusted(), unchanged())).toBeUndefined();
  });
  it("provenance-dropped: skips an unknown old baseline and handles missing dist safely", () => {
    expect(
      find(
        "provenance-dropped",
        { ...trusted(), dist: undefined },
        candidate(),
      ),
    ).toBeUndefined();
    expect(
      find("provenance-dropped", trusted(), {
        ...candidate(),
        dist: undefined,
      }),
    ).toBeDefined();
  });
  it("dependency-added: lists only newly declared direct dependency names in stable order", () => {
    expect(find("dependency-added")).toMatchObject({
      evidence: { names: ["dg-new-a", "dg-new-z"] },
    });
  });
  it("dependency-added: ignores range changes, removals and optional/dev/peer-only additions", () => {
    expect(
      computeMetadataSignals(
        trusted(),
        { ...fixture.versions["1.0.1"], time: fixture.time },
        now,
      ).some((signal) => signal.id === "dependency-added"),
    ).toBe(false);
    expect(
      find("dependency-added", trusted(), { ...unchanged(), dependencies: {} }),
    ).toBeUndefined();
  });
  it("dependency-added: handles omitted maps and own properties rather than prototypes", () => {
    const next = {
      ...candidate(),
      dependencies: JSON.parse('{"toString":"1.0.0"}'),
    };
    expect(
      find("dependency-added", { ...trusted(), dependencies: undefined }, next),
    ).toMatchObject({ evidence: { names: ["toString"] } });
  });
  it("recent-release: uses the exact candidate time entry and returns informational evidence", () => {
    expect(find("recent-release")).toMatchObject({
      severity: "info",
      evidence: {
        version: "1.1.0",
        publishedAt: "2026-11-14T00:00:00.000Z",
        comparedAt: now,
        ageMs: 86_400_000,
      },
    });
  });
  it("recent-release: ignores older releases even when packument modified is recent", () => {
    expect(find("recent-release", trusted(), unchanged())).toBeUndefined();
  });
  it.each([
    ["2026-11-08T00:00:00.000Z", false],
    ["2026-11-08T00:00:00.001Z", true],
    ["2026-11-15T00:00:00.000Z", true],
    ["2026-11-15T00:00:00.001Z", false],
    ["2026-11-14T06:00:00+06:00", true],
    ["2026-11-14T00:00:00", false],
    ["invalid-date", false],
  ])(
    "recent-release: handles timestamp boundary %s",
    (publishedAt, expected) => {
      expect(
        !!find("recent-release", trusted(), {
          ...candidate(),
          time: { "1.1.0": publishedAt },
        }),
      ).toBe(expected);
    },
  );
  it("missing fields never throw and yield no invented differences", () => {
    expect(
      computeMetadataSignals(
        fixture.versions["2.0.0"],
        fixture.versions["2.0.0"],
        now,
      ),
    ).toEqual([]);
    expect(computeMetadataSignals({}, {}, now)).toEqual([]);
    expect(computeMetadataSignals(null, undefined, now)).toEqual([]);
    expect(
      find("recent-release", trusted(), { ...candidate(), time: undefined }),
    ).toBeUndefined();
    expect(
      find("recent-release", trusted(), candidate(), new Date(NaN)),
    ).toBeUndefined();
  });
  it("is deterministic, does not mutate fixtures, and never reads Date.now or fetch", () => {
    const before = trusted();
    const after = candidate();
    const copy = structuredClone({ before, after });
    const clock = vi.spyOn(Date, "now").mockImplementation(() => {
      throw new Error("Clock access forbidden");
    });
    const network = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("Network forbidden");
    });
    try {
      const signals = computeMetadataSignals(before, after, now);
      expect(computeMetadataSignals(before, after, new Date(now))).toEqual(
        signals,
      );
      expect(computeMetadataSignals(before, after, Date.parse(now))).toEqual(
        signals,
      );
      expect({ before, after }).toEqual(copy);
      expect(signals.map((signal) => signal.id)).toEqual([
        "install-script-added",
        "maintainer-changed",
        "provenance-dropped",
        "dependency-added",
        "recent-release",
      ]);
      expect(
        signals.every(
          (signal) => metadataSignalSchema.safeParse(signal).success,
        ),
      ).toBe(true);
      expect(clock).not.toHaveBeenCalled();
      expect(network).not.toHaveBeenCalled();
    } finally {
      clock.mockRestore();
      network.mockRestore();
    }
  });
  it("validates signal evidence and rejects unsupported signals, severities and verdict fields", () => {
    const signal = find("dependency-added")!;
    for (const invalid of [
      { ...signal, id: "typosquat" },
      { ...signal, severity: "high" },
      { ...signal, riskScore: 82 },
      { ...signal, evidence: { names: [] } },
    ])
      expect(metadataSignalSchema.safeParse(invalid).success).toBe(false);
  });
});
