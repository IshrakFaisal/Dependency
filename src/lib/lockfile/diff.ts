import { z } from "zod";

const registryHost = "registry.npmjs.org";
const packageEntrySchema = z
  .object({
    version: z.string().optional(),
    resolved: z.string().optional(),
    dev: z.boolean().optional(),
    link: z.boolean().optional(),
  })
  .passthrough();
const lockfileSchema = z
  .object({
    lockfileVersion: z.number().int(),
    packages: z.unknown().optional(),
  })
  .passthrough();

const addedEntrySchema = z.strictObject({
  name: z.string().min(1),
  version: z.string().min(1),
  path: z.string().min(1),
  dev: z.boolean(),
});
const changedEntrySchema = z.strictObject({
  name: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  path: z.string().min(1),
  dev: z.boolean(),
  direction: z.enum(["upgrade", "downgrade", "other"]),
});
const skippedEntrySchema = z.strictObject({
  path: z.string(),
  reason: z.string().min(1),
});

const successSchema = z.strictObject({
  kind: z.literal("success"),
  added: z.array(addedEntrySchema),
  removed: z.array(addedEntrySchema),
  changed: z.array(changedEntrySchema),
  skipped: z.array(skippedEntrySchema),
});
const errorSchema = z.strictObject({
  kind: z.literal("error"),
  error: z.strictObject({
    code: z.enum(["invalid-lockfile", "unsupported-lockfile-version"]),
    message: z.string().min(1),
  }),
  added: z.array(addedEntrySchema).length(0),
  removed: z.array(addedEntrySchema).length(0),
  changed: z.array(changedEntrySchema).length(0),
  skipped: z.array(skippedEntrySchema).length(0),
});

export const lockfileDiffSchema = z.union([successSchema, errorSchema]);
export type LockfileDiff = z.infer<typeof lockfileDiffSchema>;
export type AnalyzableLockfileChange = {
  name: string;
  from: string | null;
  to: string;
};

type AnalyzableEntry = z.infer<typeof addedEntrySchema>;
type ParsedPackages = {
  entries: Map<string, AnalyzableEntry>;
  skipped: z.infer<typeof skippedEntrySchema>[];
  blockedPaths: Set<string>;
  invalid: boolean;
};

function error(
  code: z.infer<typeof errorSchema>["error"]["code"],
  message: string,
): LockfileDiff {
  return errorSchema.parse({
    kind: "error",
    error: { code, message },
    added: [],
    removed: [],
    changed: [],
    skipped: [],
  });
}

function packageName(path: string): string | null {
  const marker = "node_modules/";
  const index = path.lastIndexOf(marker);
  if (index < 0) return null;
  const suffix = path.slice(index + marker.length);
  if (!suffix || suffix.includes("/node_modules/")) return null;
  const parts = suffix.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) return null;
  if (parts[0].startsWith("@"))
    return parts.length === 2 && !parts[1].startsWith("@")
      ? `${parts[0]}/${parts[1]}`
      : null;
  return parts.length === 1 ? parts[0] : null;
}

function isRegistryResolved(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === registryHost &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function skip(
  path: string,
  reason: string,
): z.infer<typeof skippedEntrySchema> {
  return { path, reason };
}

function parsePackages(packages: Record<string, unknown>): ParsedPackages {
  const entries = new Map<string, AnalyzableEntry>();
  const skipped: z.infer<typeof skippedEntrySchema>[] = [];
  const blockedPaths = new Set<string>();
  let invalid = false;
  for (const path of Object.keys(packages).sort()) {
    const entry = packageEntrySchema.safeParse(packages[path]);
    if (path === "") {
      skipped.push(skip(path, "root package entry"));
      blockedPaths.add(path);
      continue;
    }
    if (!entry.success) {
      invalid = true;
      break;
    }
    if (entry.data.link) {
      skipped.push(skip(path, "workspace or link entry"));
      blockedPaths.add(path);
      continue;
    }
    const name = packageName(path);
    if (!name) {
      skipped.push(skip(path, "path does not identify a node_modules package"));
      blockedPaths.add(path);
      continue;
    }
    if (!entry.data.resolved) {
      skipped.push(skip(path, "missing registry resolved URL"));
      blockedPaths.add(path);
      continue;
    }
    if (!isRegistryResolved(entry.data.resolved)) {
      skipped.push(skip(path, "non-registry resolved URL"));
      blockedPaths.add(path);
      continue;
    }
    if (!entry.data.version) {
      skipped.push(skip(path, "missing package version"));
      blockedPaths.add(path);
      continue;
    }
    entries.set(path, {
      name,
      version: entry.data.version,
      path,
      dev: entry.data.dev ?? false,
    });
  }
  return { entries, skipped, blockedPaths, invalid };
}

function isPackagesMap(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type ExactVersion = {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[] | null;
};
const exactVersion =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/** Minimal exact SemVer comparator. It compares valid numeric major/minor/patch
 * releases and SemVer prereleases; build metadata is ignored. Ranges, tags,
 * non-SemVer versions, and textual-but-SemVer-equal changes are "other".
 */
function parseExactVersion(value: string): ExactVersion | null {
  const match = exactVersion.exec(value);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]?.split(".") ?? null,
  };
}

function compareExactVersions(left: ExactVersion, right: ExactVersion): number {
  for (const key of ["major", "minor", "patch"] as const) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  }
  if (left.prerelease === null && right.prerelease === null) return 0;
  if (left.prerelease === null) return 1;
  if (right.prerelease === null) return -1;
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const a = left.prerelease[index];
    const b = right.prerelease[index];
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    if (a === b) continue;
    const aNumeric = /^\d+$/.test(a);
    const bNumeric = /^\d+$/.test(b);
    if (aNumeric && bNumeric) return Number(a) < Number(b) ? -1 : 1;
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    return a < b ? -1 : 1;
  }
  return 0;
}

function direction(
  from: string,
  to: string,
): z.infer<typeof changedEntrySchema>["direction"] {
  const before = parseExactVersion(from);
  const after = parseExactVersion(to);
  if (!before || !after) return "other";
  const compared = compareExactVersions(before, after);
  return compared < 0 ? "upgrade" : compared > 0 ? "downgrade" : "other";
}

function byNameThenPath<T extends { name: string; path: string }>(a: T, b: T) {
  return a.name.localeCompare(b.name) || a.path.localeCompare(b.path);
}

function sortSkipped(entries: z.infer<typeof skippedEntrySchema>[]) {
  return entries.sort(
    (a, b) => a.path.localeCompare(b.path) || a.reason.localeCompare(b.reason),
  );
}

/** Pure lockfile v2/v3 package-map comparison. It performs no I/O or clock access. */
export function diffLockfiles(
  oldLock: unknown,
  newLock: unknown,
): LockfileDiff {
  const oldResult = lockfileSchema.safeParse(oldLock);
  const newResult = lockfileSchema.safeParse(newLock);
  if (!oldResult.success || !newResult.success)
    return error(
      "invalid-lockfile",
      "Both inputs must be lockfiles with an integer lockfileVersion and packages map.",
    );
  const versions = [
    oldResult.data.lockfileVersion,
    newResult.data.lockfileVersion,
  ];
  if (versions.some((version) => version !== 2 && version !== 3))
    return error(
      "unsupported-lockfile-version",
      "Only npm lockfileVersion 2 and 3 package maps are supported.",
    );
  if (
    !isPackagesMap(oldResult.data.packages) ||
    !isPackagesMap(newResult.data.packages)
  )
    return error(
      "invalid-lockfile",
      "Both inputs must be lockfiles with an integer lockfileVersion and packages map.",
    );

  const oldPackages = parsePackages(oldResult.data.packages);
  const newPackages = parsePackages(newResult.data.packages);
  if (oldPackages.invalid || newPackages.invalid)
    return error(
      "invalid-lockfile",
      "Each package entry must be an object when present.",
    );
  const added: AnalyzableEntry[] = [];
  const removed: AnalyzableEntry[] = [];
  const changed: z.infer<typeof changedEntrySchema>[] = [];
  const paths = new Set([
    ...oldPackages.entries.keys(),
    ...newPackages.entries.keys(),
    ...oldPackages.blockedPaths,
    ...newPackages.blockedPaths,
  ]);
  for (const path of [...paths].sort()) {
    if (
      oldPackages.blockedPaths.has(path) ||
      newPackages.blockedPaths.has(path)
    )
      continue;
    const before = oldPackages.entries.get(path);
    const after = newPackages.entries.get(path);
    if (!before && after) added.push(after);
    else if (before && !after) removed.push(before);
    else if (before && after && before.version !== after.version)
      changed.push({
        name: after.name,
        from: before.version,
        to: after.version,
        path,
        dev: after.dev,
        direction: direction(before.version, after.version),
      });
  }
  const skipped = new Map<string, z.infer<typeof skippedEntrySchema>>();
  for (const entry of [...oldPackages.skipped, ...newPackages.skipped])
    skipped.set(`${entry.path}\u0000${entry.reason}`, entry);
  return successSchema.parse({
    kind: "success",
    added: added.sort(byNameThenPath),
    removed: removed.sort(byNameThenPath),
    changed: changed.sort(byNameThenPath),
    skipped: sortSkipped([...skipped.values()]),
  });
}

/** Select only entries with a concrete registry-package version transition. */
export function selectAnalyzable(
  diff: LockfileDiff,
): AnalyzableLockfileChange[] {
  if (diff.kind === "error") return [];
  return [
    ...diff.changed.map(({ name, from, to }) => ({ name, from, to })),
    ...diff.added.map(({ name, version }) => ({
      name,
      from: null,
      to: version,
    })),
  ].sort(
    (a, b) =>
      a.name.localeCompare(b.name) ||
      a.to.localeCompare(b.to) ||
      (a.from ?? "").localeCompare(b.from ?? ""),
  );
}
