import "server-only";

import { z } from "zod";
import { AnalysisInputError } from "@/lib/analysis/errors";
import type { RegistryRelease } from "@/lib/types/static-analysis";
import { comparisonInputSchema } from "@/lib/validation";

export const REGISTRY_LIMITS = {
  metadataBytes: 2 * 1024 * 1024,
  timeoutMs: 15_000,
} as const;

export const manifestFieldsSchema = z.object({
  name: z.string().min(1).max(214),
  version: z.string().min(1).max(128),
  scripts: z.record(z.string(), z.string()).default({}),
  dependencies: z.record(z.string(), z.string()).default({}),
  optionalDependencies: z.record(z.string(), z.string()).default({}),
  peerDependencies: z.record(z.string(), z.string()).default({}),
});

const registryReleaseSchema = manifestFieldsSchema.extend({
  description: z.string().max(10_000).nullish(),
  license: z.unknown().optional(),
  deprecated: z.string().max(10_000).nullish(),
  dist: z.object({
    tarball: z.string().max(4096),
    integrity: z.string().max(8192).nullish(),
    shasum: z.string().max(128).nullish(),
  }),
});

/** Deliberately accepts a single public registry origin, with no redirects. */
export function validateRegistryUrl(value: string): URL {
  // Check the original authority too: URL normalizes an explicitly supplied :443.
  if (
    !/^https:\/\/registry\.npmjs\.org\//.test(value) ||
    /[\\\s]/.test(value)
  ) {
    throw new AnalysisInputError(
      "Only HTTPS downloads from registry.npmjs.org are supported.",
    );
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AnalysisInputError(
      "The npm registry returned an invalid download URL.",
    );
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "registry.npmjs.org" ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new AnalysisInputError(
      "Only HTTPS downloads from registry.npmjs.org are supported.",
    );
  }
  return url;
}

/** Shared bounded transport; neither registry metadata nor archives reach disk. */
export async function fetchRegistryBytes(
  value: string,
  maxBytes: number,
  kind: "metadata" | "archive",
): Promise<Buffer> {
  const url = validateRegistryUrl(value);
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    REGISTRY_LIMITS.timeoutMs,
  );
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
      cache: "no-store",
      headers: {
        Accept:
          kind === "metadata" ? "application/json" : "application/octet-stream",
      },
    });
    if (
      response.redirected ||
      (response.url && validateRegistryUrl(response.url).href !== url.href)
    ) {
      throw new AnalysisInputError(
        "Redirected npm registry responses are not supported.",
      );
    }
    if (response.status === 404) {
      throw new AnalysisInputError(
        "The npm release was not found. Check the package name and exact versions.",
      );
    }
    if (response.status === 429) {
      throw new AnalysisInputError(
        "The npm registry rate limit was reached. Try again later.",
      );
    }
    if (!response.ok || !response.body) {
      throw new AnalysisInputError(
        "The npm registry could not provide the requested release. Try again later.",
      );
    }
    const length = response.headers.get("content-length");
    if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
      throw new AnalysisInputError(
        `The npm ${kind} exceeds the supported download size.`,
      );
    }
    reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let bytes = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) {
        throw new AnalysisInputError(
          `The npm ${kind} exceeds the supported download size.`,
        );
      }
      chunks.push(Buffer.from(chunk.value));
    }
    return Buffer.concat(chunks, bytes);
  } catch (error) {
    if (error instanceof AnalysisInputError) throw error;
    throw new AnalysisInputError(
      controller.signal.aborted
        ? "The npm registry request timed out. Try again later."
        : "The npm registry request failed. Check connectivity and try again later.",
    );
  } finally {
    clearTimeout(timeout);
    if (reader) {
      void reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    controller.abort();
  }
}

export async function fetchRelease(
  packageName: string,
  version: string,
): Promise<RegistryRelease> {
  const nameResult =
    comparisonInputSchema.shape.packageName.safeParse(packageName);
  const versionResult =
    comparisonInputSchema.shape.trustedVersion.safeParse(version);
  if (
    !nameResult.success ||
    !versionResult.success ||
    nameResult.data !== packageName ||
    versionResult.data !== version
  ) {
    throw new AnalysisInputError(
      "Enter a valid npm package name and an exact release version.",
    );
  }
  const url = `https://registry.npmjs.org/${encodeURIComponent(packageName)}/${encodeURIComponent(version)}`;
  const bytes = await fetchRegistryBytes(
    url,
    REGISTRY_LIMITS.metadataBytes,
    "metadata",
  );
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new AnalysisInputError(
      "The npm registry returned invalid release metadata.",
    );
  }
  const result = registryReleaseSchema.safeParse(value);
  if (!result.success) {
    throw new AnalysisInputError(
      "The npm registry returned unsupported release metadata.",
    );
  }
  const metadata = result.data;
  if (metadata.name !== packageName || metadata.version !== version) {
    throw new AnalysisInputError(
      "The npm registry release identity does not match the requested package and version.",
    );
  }
  const tarballUrl = validateRegistryUrl(metadata.dist.tarball).href;
  if (!metadata.dist.integrity?.trim() && !metadata.dist.shasum?.trim()) {
    throw new AnalysisInputError(
      "The npm release has no archive integrity information.",
    );
  }
  return {
    name: metadata.name,
    version: metadata.version,
    description: metadata.description ?? "",
    license:
      typeof metadata.license === "string"
        ? metadata.license.slice(0, 512)
        : "Unspecified",
    scripts: metadata.scripts,
    dependencies: metadata.dependencies,
    optionalDependencies: metadata.optionalDependencies,
    peerDependencies: metadata.peerDependencies,
    deprecated: metadata.deprecated ?? null,
    tarballUrl,
    integrity: metadata.dist.integrity ?? null,
    shasum: metadata.dist.shasum ?? null,
  };
}
