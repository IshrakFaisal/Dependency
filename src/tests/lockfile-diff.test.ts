import { describe, expect, it, vi } from "vitest";
import oldLockfile from "./fixtures/lockfile-v2-old.json";
import newLockfile from "./fixtures/lockfile-v3-new.json";
import {
  diffLockfiles,
  lockfileDiffSchema,
  selectAnalyzable,
} from "@/lib/lockfile/diff";

function result() {
  const value = diffLockfiles(
    structuredClone(oldLockfile),
    structuredClone(newLockfile),
  );
  if (value.kind === "error") throw new Error(value.error.message);
  return value;
}

describe("npm package-lock package-map diff", () => {
  it("adds registry packages and retains their path, version, and default dev flag", () => {
    expect(result().added).toEqual([
      {
        name: "added",
        version: "1.0.0",
        path: "node_modules/added",
        dev: false,
      },
    ]);
  });

  it("removes registry packages without collapsing their path identity", () => {
    expect(result().removed).toEqual([
      {
        name: "removed",
        version: "1.0.0",
        path: "node_modules/removed",
        dev: false,
      },
    ]);
  });

  it("classifies exact SemVer upgrades and preserves the candidate dev flag", () => {
    expect(result().changed).toContainEqual({
      name: "upgrade",
      from: "1.2.3",
      to: "2.0.0",
      path: "node_modules/upgrade",
      dev: false,
      direction: "upgrade",
    });
    expect(result().changed).toContainEqual({
      name: "dev-only",
      from: "1.0.0",
      to: "1.0.1",
      path: "node_modules/dev-only",
      dev: true,
      direction: "upgrade",
    });
  });

  it("classifies exact SemVer downgrades", () => {
    expect(result().changed).toContainEqual({
      name: "downgrade",
      from: "3.0.0",
      to: "2.0.0",
      path: "node_modules/downgrade",
      dev: false,
      direction: "downgrade",
    });
  });

  it("omits unchanged package versions", () => {
    expect(result().added.map((entry) => entry.name)).not.toContain(
      "unchanged",
    );
    expect(result().removed.map((entry) => entry.name)).not.toContain(
      "unchanged",
    );
    expect(result().changed.map((entry) => entry.name)).not.toContain(
      "unchanged",
    );
  });

  it("derives a scoped package name from the last node_modules segment", () => {
    expect(result().changed).toContainEqual(
      expect.objectContaining({
        name: "@scope/tool",
        path: "node_modules/@scope/tool",
        direction: "upgrade",
      }),
    );
  });

  it("derives a nested package name from the last node_modules segment", () => {
    expect(result().changed).toContainEqual(
      expect.objectContaining({
        name: "nested",
        path: "node_modules/parent/node_modules/nested",
        direction: "upgrade",
      }),
    );
  });

  it("reports duplicate names at separate paths without collapsing them", () => {
    const repeated = result().changed.filter(
      (entry) => entry.name === "repeated",
    );
    expect(repeated).toEqual([
      expect.objectContaining({
        path: "node_modules/one/node_modules/repeated",
        from: "1.0.0",
        to: "1.1.0",
        direction: "upgrade",
      }),
      expect.objectContaining({
        path: "node_modules/two/node_modules/repeated",
        from: "2.0.0",
        to: "1.0.0",
        direction: "downgrade",
      }),
    ]);
  });

  it("records git, file, link, and root entries as skipped", () => {
    expect(result().skipped).toEqual([
      { path: "", reason: "root package entry" },
      {
        path: "node_modules/file-dependency",
        reason: "non-registry resolved URL",
      },
      {
        path: "node_modules/git-dependency",
        reason: "non-registry resolved URL",
      },
      {
        path: "node_modules/link-dependency",
        reason: "workspace or link entry",
      },
    ]);
  });

  it("does not misreport a package as added or removed when the same path is skipped in either lockfile", () => {
    const oldValue = {
      lockfileVersion: 3,
      packages: {
        "node_modules/switching-source": {
          version: "1.0.0",
          resolved:
            "https://registry.npmjs.org/switching-source/-/switching-source-1.0.0.tgz",
        },
      },
    };
    const newValue = {
      lockfileVersion: 3,
      packages: {
        "node_modules/switching-source": {
          version: "1.1.0",
          resolved: "git+https://github.com/example/switching-source.git#abc",
        },
      },
    };
    const diff = diffLockfiles(oldValue, newValue);
    expect(diff).toMatchObject({
      kind: "success",
      added: [],
      removed: [],
      changed: [],
    });
    expect(diff.skipped).toEqual([
      {
        path: "node_modules/switching-source",
        reason: "non-registry resolved URL",
      },
    ]);
  });

  it("returns a typed unsupported-version error for v1 and unknown versions", () => {
    for (const version of [1, 4, 0]) {
      expect(
        diffLockfiles({ lockfileVersion: version, packages: {} }, newLockfile),
      ).toEqual({
        kind: "error",
        error: {
          code: "unsupported-lockfile-version",
          message:
            "Only npm lockfileVersion 2 and 3 package maps are supported.",
        },
        added: [],
        removed: [],
        changed: [],
        skipped: [],
      });
    }
    expect(
      diffLockfiles({ lockfileVersion: 1, dependencies: {} }, newLockfile),
    ).toMatchObject({
      kind: "error",
      error: { code: "unsupported-lockfile-version" },
    });
  });

  it.each([
    null,
    undefined,
    {},
    { lockfileVersion: 3 },
    { lockfileVersion: "3", packages: {} },
    { lockfileVersion: 3, packages: [] },
    { lockfileVersion: 3, packages: { "node_modules/bad": 42 } },
  ])("returns a typed invalid-lockfile error for malformed input", (value) => {
    expect(() => diffLockfiles(value, newLockfile)).not.toThrow();
    expect(diffLockfiles(value, newLockfile)).toMatchObject({
      kind: "error",
      error: { code: "invalid-lockfile" },
      added: [],
      removed: [],
      changed: [],
      skipped: [],
    });
  });

  it("returns a typed invalid-lockfile error when a package entry has the wrong type", () => {
    const malformed = structuredClone(oldLockfile) as {
      lockfileVersion: number;
      packages: Record<string, unknown>;
    };
    malformed.packages["node_modules/upgrade"] = 42;
    const diff = diffLockfiles(malformed, newLockfile);
    expect(diff).toMatchObject({
      kind: "error",
      error: { code: "invalid-lockfile" },
      added: [],
      removed: [],
      changed: [],
      skipped: [],
    });
  });

  it("sorts output deterministically even when package map keys are shuffled", () => {
    const shuffled = (value: {
      lockfileVersion: number;
      packages: Record<string, unknown>;
    }) => ({
      ...value,
      packages: Object.fromEntries(
        Object.entries(value.packages)
          .reverse()
          .map(([key, entry]) => [key, structuredClone(entry)]),
      ),
    });
    expect(diffLockfiles(oldLockfile, newLockfile)).toEqual(
      diffLockfiles(shuffled(oldLockfile), shuffled(newLockfile)),
    );
  });

  it("uses a minimal comparator for exact SemVer prereleases and marks unsupported ranges as other", () => {
    const lock = (version: string) => ({
      lockfileVersion: 3,
      packages: {
        "node_modules/example": {
          version,
          resolved: `https://registry.npmjs.org/example/-/example-${version}.tgz`,
        },
      },
    });
    expect(diffLockfiles(lock("1.0.0-beta.2"), lock("1.0.0"))).toMatchObject({
      kind: "success",
      changed: [expect.objectContaining({ direction: "upgrade" })],
    });
    expect(diffLockfiles(lock("^1.0.0"), lock("2.0.0"))).toMatchObject({
      kind: "success",
      changed: [expect.objectContaining({ direction: "other" })],
    });
  });

  it("selects changed and added entries only, using null as the added baseline", () => {
    const selection = selectAnalyzable(result());
    expect(selection).toContainEqual({
      name: "added",
      from: null,
      to: "1.0.0",
    });
    expect(selection).toContainEqual({
      name: "upgrade",
      from: "1.2.3",
      to: "2.0.0",
    });
    expect(selection.map((entry) => entry.name)).not.toContain("removed");
    expect(selectAnalyzable(diffLockfiles(null, newLockfile))).toEqual([]);
  });

  it("is pure: it never reads Date.now, calls fetch, or mutates input fixtures", () => {
    const before = structuredClone(oldLockfile);
    const after = structuredClone(newLockfile);
    const dateNow = vi.spyOn(Date, "now").mockImplementation(() => {
      throw new Error("Clock access is forbidden");
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("Network access is forbidden");
    });
    try {
      const diff = diffLockfiles(before, after);
      expect(lockfileDiffSchema.safeParse(diff).success).toBe(true);
      expect(before).toEqual(oldLockfile);
      expect(after).toEqual(newLockfile);
      expect(dateNow).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      dateNow.mockRestore();
      fetchMock.mockRestore();
    }
  });
});
