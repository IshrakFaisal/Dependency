import { z } from "zod";

const personSchema = z.object({
  name: z.string().trim().min(1).optional(),
  email: z.string().trim().min(1).optional(),
});
const strings = z.record(z.string(), z.string());

/** One version's fields, plus its timestamp from the full packument's time map.
 * Missing publisher, maintainer, or time fields are unknown, not changes.
 * Omitted scripts/dependencies are empty npm declarations. Maintainers must
 * come from version metadata, not today's package-level ownership list.
 */
export const versionMetadataSchema = z.object({
  name: z.string().optional(),
  version: z.string().optional(),
  scripts: strings.optional().catch(undefined),
  dependencies: strings.optional().catch(undefined),
  _npmUser: personSchema.nullish().catch(undefined),
  maintainers: z.array(personSchema).nullish().catch(undefined),
  dist: z
    .object({
      attestations: z
        .record(z.string(), z.unknown())
        .nullish()
        .catch(undefined),
    })
    .nullish()
    .catch(undefined),
  time: strings.nullish().catch(undefined),
});
export type VersionMetadata = z.infer<typeof versionMetadataSchema>;

const scriptNameSchema = z.enum([
  "preinstall",
  "install",
  "postinstall",
  "prepare",
]);
const common = {
  severity: z.enum(["info", "review"]),
  title: z.string().min(1),
  detail: z.string().min(1),
};
export const metadataSignalSchema = z.discriminatedUnion("id", [
  z.strictObject({
    ...common,
    id: z.literal("install-script-added"),
    evidence: z.strictObject({
      changes: z
        .array(
          z.strictObject({
            script: scriptNameSchema,
            oldCommand: z.string().nullable(),
            newCommand: z.string(),
          }),
        )
        .min(1),
    }),
  }),
  z.strictObject({
    ...common,
    id: z.literal("maintainer-changed"),
    evidence: z.strictObject({
      oldPublisher: z.string().nullable(),
      newPublisher: z.string().nullable(),
      addedMaintainers: z.array(z.string()),
      removedMaintainers: z.array(z.string()),
    }),
  }),
  z.strictObject({
    ...common,
    id: z.literal("provenance-dropped"),
    evidence: z.strictObject({
      oldAttestations: z.record(z.string(), z.unknown()),
      newAttestations: z.null(),
    }),
  }),
  z.strictObject({
    ...common,
    id: z.literal("dependency-added"),
    evidence: z.strictObject({
      names: z.array(z.string()).min(1),
    }),
  }),
  z.strictObject({
    ...common,
    id: z.literal("recent-release"),
    evidence: z.strictObject({
      version: z.string(),
      publishedAt: z.string().datetime(),
      comparedAt: z.string().datetime(),
      ageMs: z
        .number()
        .nonnegative()
        .lt(7 * 24 * 60 * 60 * 1000),
    }),
  }),
]);
export type MetadataSignal = z.infer<typeof metadataSignalSchema>;

function identity(person: z.infer<typeof personSchema> | null | undefined) {
  // Compare account names when available. Email-only entries retain a distinct
  // namespace; an email edit alone is not a new member with the same account.
  return person?.name
    ? `name:${person.name}`
    : person?.email
      ? `email:${person.email.toLowerCase()}`
      : null;
}

function members(people: VersionMetadata["maintainers"]) {
  if (!people) return null;
  const ids = people.map(identity);
  return ids.some((id) => id === null) ? null : new Set(ids as string[]);
}

const timestampSchema = z.string().datetime({ offset: true });
function timestamp(value: unknown): number {
  return timestampSchema.safeParse(value).success
    ? Date.parse(value as string)
    : NaN;
}

/** Pure: never fetches, reads files, executes scripts, or reads the current clock.
 * Stable signal order and sorted sets make output independent of object order.
 * These metadata differences are review context, never a safety verdict.
 */
export function computeMetadataSignals(
  oldMeta: unknown,
  newMeta: unknown,
  now: Date | number | string,
): MetadataSignal[] {
  const oldData = versionMetadataSchema.safeParse(oldMeta).data ?? {};
  const newData = versionMetadataSchema.safeParse(newMeta).data ?? {};
  const signals: MetadataSignal[] = [];
  const changes: Extract<
    MetadataSignal,
    { id: "install-script-added" }
  >["evidence"]["changes"] = [];
  for (const script of scriptNameSchema.options) {
    const before = Object.hasOwn(oldData.scripts ?? {}, script)
      ? oldData.scripts![script]
      : null;
    const after = Object.hasOwn(newData.scripts ?? {}, script)
      ? newData.scripts![script]
      : null;
    if (after !== null && after !== before)
      changes.push({ script, oldCommand: before, newCommand: after });
  }
  if (changes.length)
    signals.push({
      id: "install-script-added",
      severity: "review",
      title: "Install-related scripts added or changed",
      detail:
        "Registry script declarations changed. Commands are evidence text only; no execution or intent is established.",
      evidence: { changes },
    });

  const oldPublisher = identity(oldData._npmUser);
  const newPublisher = identity(newData._npmUser);
  const beforeMembers = members(oldData.maintainers);
  const afterMembers = members(newData.maintainers);
  const addedMaintainers =
    beforeMembers && afterMembers
      ? [...afterMembers].filter((id) => !beforeMembers.has(id)).sort()
      : [];
  const removedMaintainers =
    beforeMembers && afterMembers
      ? [...beforeMembers].filter((id) => !afterMembers.has(id)).sort()
      : [];
  if (
    (oldPublisher && newPublisher && oldPublisher !== newPublisher) ||
    addedMaintainers.length ||
    removedMaintainers.length
  )
    signals.push({
      id: "maintainer-changed",
      severity: "review",
      title: "Publisher or maintainer membership changed",
      detail:
        "Version metadata identifies different publisher accounts or maintainer members. This does not establish an ownership compromise.",
      evidence: {
        oldPublisher,
        newPublisher,
        addedMaintainers,
        removedMaintainers,
      },
    });

  if (oldData.dist?.attestations && !newData.dist?.attestations)
    signals.push({
      id: "provenance-dropped",
      severity: "review",
      title: "Attestation metadata is absent in the candidate",
      detail:
        "The trusted version advertises dist.attestations and the candidate does not. Attestations were not downloaded or verified; metadata absence does not prove a provenance failure.",
      evidence: {
        oldAttestations: oldData.dist.attestations,
        newAttestations: null,
      },
    });

  const names = Object.keys(newData.dependencies ?? {})
    .filter((name) => !Object.hasOwn(oldData.dependencies ?? {}, name))
    .sort();
  if (names.length)
    signals.push({
      id: "dependency-added",
      severity: "review",
      title: "Direct dependencies added",
      detail:
        "The candidate declares additional direct dependencies. Version-range edits, optional-only, peer and development dependencies are not included.",
      evidence: { names },
    });

  const published =
    newData.version && Object.hasOwn(newData.time ?? {}, newData.version)
      ? timestamp(newData.time![newData.version])
      : NaN;
  const compared =
    now instanceof Date
      ? now.getTime()
      : typeof now === "number"
        ? now
        : timestamp(now);
  const ageMs = compared - published;
  if (
    Number.isFinite(compared) &&
    Number.isFinite(published) &&
    ageMs >= 0 &&
    ageMs < 7 * 24 * 60 * 60 * 1000
  )
    signals.push({
      id: "recent-release",
      severity: "info",
      title: "Candidate published less than seven days ago",
      detail:
        "The packument time entry places this release within the seven-day window. Recency alone is not evidence of a security issue.",
      evidence: {
        version: newData.version!,
        publishedAt: new Date(published).toISOString(),
        comparedAt: new Date(compared).toISOString(),
        ageMs,
      },
    });
  return z.array(metadataSignalSchema).parse(signals);
}
