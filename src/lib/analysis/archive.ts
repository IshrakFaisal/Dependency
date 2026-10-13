import "server-only";

import { createHash } from "node:crypto";
import { gunzip } from "node:zlib";
import { AnalysisInputError } from "@/lib/analysis/errors";
import {
  fetchRegistryBytes,
  manifestFieldsSchema,
} from "@/lib/analysis/registry";
import type {
  ArchiveFile,
  PackageSnapshot,
  RegistryRelease,
} from "@/lib/types/static-analysis";

export const ARCHIVE_LIMITS = {
  compressedBytes: 10 * 1024 * 1024,
  unpackedBytes: 50 * 1024 * 1024,
  entries: 2000,
  textFileBytes: 2 * 1024 * 1024,
  pathBytes: 4096,
  paxBytes: 16 * 1024,
} as const;

const BLOCK = 512;
const digestBytes = { sha512: 64, sha384: 48, sha256: 32 } as const;
type StrongAlgorithm = keyof typeof digestBytes;
const utf8 = new TextDecoder("utf-8", { fatal: true });

function verifyIntegrity(
  buffer: Buffer,
  release: RegistryRelease,
): PackageSnapshot["integrityVerified"] {
  if (release.integrity?.trim()) {
    const tokens = release.integrity.trim().split(/\s+/);
    // SRI uses the strongest advertised supported algorithm. A weaker match must
    // never hide a mismatch (or malformed digest) for that strongest algorithm.
    for (const algorithm of ["sha512", "sha384", "sha256"] as const) {
      const candidates = tokens.filter((token) =>
        token.startsWith(`${algorithm}-`),
      );
      if (!candidates.length) continue;
      const digests = candidates.map((token) => {
        const encoded = token.slice(algorithm.length + 1);
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
          throw new AnalysisInputError(
            "The npm release has malformed archive integrity metadata.",
          );
        }
        const digest = Buffer.from(encoded, "base64");
        if (
          digest.length !== digestBytes[algorithm] ||
          digest.toString("base64") !== encoded
        ) {
          throw new AnalysisInputError(
            "The npm release has malformed archive integrity metadata.",
          );
        }
        return digest;
      });
      const actual = createHash(algorithm).update(buffer).digest();
      if (!digests.some((digest) => digest.equals(actual))) {
        throw new AnalysisInputError(
          "Archive integrity verification failed. The downloaded bytes do not match the registry digest.",
        );
      }
      return algorithm as StrongAlgorithm;
    }
    throw new AnalysisInputError(
      "The npm release uses an unsupported archive integrity format.",
    );
  }
  if (!release.shasum || !/^[a-fA-F0-9]{40}$/.test(release.shasum)) {
    throw new AnalysisInputError(
      "The npm release has no valid archive integrity information.",
    );
  }
  if (
    createHash("sha1").update(buffer).digest("hex") !==
    release.shasum.toLowerCase()
  ) {
    throw new AnalysisInputError(
      "Archive integrity verification failed. The downloaded bytes do not match the registry digest.",
    );
  }
  return "sha1";
}

function decompress(buffer: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    gunzip(
      buffer,
      { maxOutputLength: ARCHIVE_LIMITS.unpackedBytes },
      (error, result) => {
        if (error) {
          reject(
            new AnalysisInputError(
              (error as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE"
                ? "The archive expands beyond the 50 MiB inspection limit."
                : "The npm archive is not a complete, supported gzip archive.",
            ),
          );
        } else {
          resolve(result);
        }
      },
    );
  });
}

function decodeText(bytes: Buffer): string {
  try {
    return utf8.decode(bytes);
  } catch {
    throw new AnalysisInputError(
      "The archive contains a filename or header that is not valid UTF-8.",
    );
  }
}

function headerString(header: Buffer, start: number, length: number): string {
  const bytes = header.subarray(start, start + length);
  const end = bytes.indexOf(0);
  if (end < 0) return decodeText(bytes);
  if (bytes.subarray(end).some((byte) => byte !== 0)) {
    throw new AnalysisInputError(
      "The archive contains an ambiguous tar header.",
    );
  }
  return decodeText(bytes.subarray(0, end));
}

function octal(header: Buffer, start: number, length: number): number {
  const value = header.subarray(start, start + length).toString("ascii");
  if (
    !/^ *[0-7]+[\0 ]*$/.test(value) ||
    header.subarray(start, start + length).some((byte) => byte >= 128)
  ) {
    throw new AnalysisInputError(
      "The archive contains an unsupported tar numeric field.",
    );
  }
  const digits = value.replace(/[\0 ]/g, "");
  const result = digits ? Number.parseInt(digits, 8) : 0;
  if (!Number.isSafeInteger(result)) {
    throw new AnalysisInputError(
      "The archive contains an unsupported tar entry size.",
    );
  }
  return result;
}

function safePath(raw: string, requirePackageRoot: boolean): string {
  if (
    !raw ||
    Buffer.byteLength(raw) > ARCHIVE_LIMITS.pathBytes ||
    raw.startsWith("/") ||
    /[\\:\x00-\x1f\x7f]/.test(raw)
  ) {
    throw new AnalysisInputError("The archive contains an unsafe entry path.");
  }
  const segments = raw.split("/");
  if (segments.includes("..")) {
    throw new AnalysisInputError("The archive contains an unsafe entry path.");
  }
  const normalized = segments.filter((part) => part !== "" && part !== ".");
  if (
    !normalized.length ||
    (requirePackageRoot && normalized[0] !== "package")
  ) {
    throw new AnalysisInputError(
      "The archive must contain entries inside the npm package directory.",
    );
  }
  return (requirePackageRoot ? normalized.slice(1) : normalized).join("/");
}

// PAX only overrides paths. Size overrides must agree with the bounded USTAR
// entry, and harmless ownership/timestamp metadata is ignored. Sparse, links,
// global headers, GNU long-name records, and vendor extensions fail closed.
function readPax(bytes: Buffer): Map<string, string> {
  if (bytes.length > ARCHIVE_LIMITS.paxBytes) {
    throw new AnalysisInputError(
      "The archive contains an oversized PAX header.",
    );
  }
  const allowed = new Set([
    "path",
    "size",
    "mtime",
    "atime",
    "ctime",
    "uid",
    "gid",
    "uname",
    "gname",
  ]);
  const fields = new Map<string, string>();
  let offset = 0;
  while (offset < bytes.length) {
    const space = bytes.indexOf(32, offset);
    const lengthText = bytes
      .subarray(offset, space < 0 ? offset : space)
      .toString("ascii");
    if (space < 0 || !/^[1-9]\d{0,5}$/.test(lengthText)) {
      throw new AnalysisInputError(
        "The archive contains an invalid PAX record.",
      );
    }
    const size = Number(lengthText);
    const end = offset + size;
    if (end > bytes.length || end <= space + 2 || bytes[end - 1] !== 10) {
      throw new AnalysisInputError(
        "The archive contains an invalid PAX record.",
      );
    }
    const value = decodeText(bytes.subarray(space + 1, end - 1));
    const equals = value.indexOf("=");
    const key = value.slice(0, equals);
    if (equals <= 0 || !allowed.has(key) || fields.has(key)) {
      throw new AnalysisInputError(
        "The archive contains an unsupported or duplicate PAX field.",
      );
    }
    fields.set(key, value.slice(equals + 1));
    offset = end;
  }
  return fields;
}

function contentText(bytes: Buffer): string | null {
  if (bytes.length > ARCHIVE_LIMITS.textFileBytes || bytes.includes(0))
    return null;
  try {
    const text = utf8.decode(bytes);
    return /[\x01-\x08\x0b\x0e-\x1f]/.test(text) ? null : text;
  } catch {
    return null;
  }
}

function readTar(buffer: Buffer): ArchiveFile[] {
  if (buffer.length < BLOCK * 2 || buffer.length % BLOCK !== 0) {
    throw new AnalysisInputError(
      "The npm archive contains a truncated tar stream.",
    );
  }
  const files: ArchiveFile[] = [];
  const paths = new Map<string, "file" | "directory">();
  let offset = 0;
  let entries = 0;
  let pendingPax: Map<string, string> | null = null;
  let foundEnd = false;
  while (offset + BLOCK <= buffer.length) {
    const header = buffer.subarray(offset, offset + BLOCK);
    offset += BLOCK;
    if (header.every((byte) => byte === 0)) {
      if (
        pendingPax ||
        offset + BLOCK > buffer.length ||
        buffer.subarray(offset).some((byte) => byte !== 0)
      ) {
        throw new AnalysisInputError(
          "The npm archive has an incomplete or ambiguous tar end marker.",
        );
      }
      foundEnd = true;
      break;
    }
    entries += 1;
    if (entries > ARCHIVE_LIMITS.entries) {
      throw new AnalysisInputError(
        "The archive exceeds the 2,000-entry inspection limit.",
      );
    }
    const checksum = header.reduce(
      (sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte),
      0,
    );
    if (checksum !== octal(header, 148, 8)) {
      throw new AnalysisInputError(
        "The archive contains a tar header with an invalid checksum.",
      );
    }
    if (
      headerString(header, 257, 6) !== "ustar" ||
      header.subarray(263, 265).toString("ascii") !== "00"
    ) {
      throw new AnalysisInputError(
        "Only standard USTAR archives and supported local PAX headers can be inspected.",
      );
    }
    const type = header[156];
    if (![0, 48, 53, 120].includes(type)) {
      throw new AnalysisInputError(
        "The archive contains a link, special entry, or unsupported tar extension.",
      );
    }
    if (headerString(header, 157, 100)) {
      throw new AnalysisInputError("Archive links are not supported.");
    }
    const size = octal(header, 124, 12);
    const nextOffset = offset + Math.ceil(size / BLOCK) * BLOCK;
    if (nextOffset > buffer.length || size > ARCHIVE_LIMITS.unpackedBytes) {
      throw new AnalysisInputError(
        "The archive contains a truncated or oversized entry.",
      );
    }
    const body = buffer.subarray(offset, offset + size);
    offset = nextOffset;
    const prefix = headerString(header, 345, 155);
    const name = headerString(header, 0, 100);
    const rawPath = prefix ? `${prefix}/${name}` : name;
    safePath(rawPath, false);
    if (type === 120) {
      if (pendingPax) {
        throw new AnalysisInputError(
          "The archive contains stacked PAX headers.",
        );
      }
      pendingPax = readPax(body);
      continue;
    }
    const paxSize = pendingPax?.get("size");
    if (
      paxSize !== undefined &&
      (!/^\d+$/.test(paxSize) || Number(paxSize) !== size)
    ) {
      throw new AnalysisInputError(
        "The archive contains an unsupported PAX size override.",
      );
    }
    const effectivePath = pendingPax?.get("path") ?? rawPath;
    const path = safePath(effectivePath, true);
    pendingPax = null;
    const directory = type === 53;
    if (
      (directory && size !== 0) ||
      (!directory && (!path || effectivePath.endsWith("/")))
    ) {
      throw new AnalysisInputError(
        "The archive contains an invalid file or directory entry.",
      );
    }
    if (paths.has(path)) {
      throw new AnalysisInputError(
        "The archive contains duplicate normalized entry paths.",
      );
    }
    const parts = path.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      if (paths.get(parts.slice(0, index).join("/")) === "file") {
        throw new AnalysisInputError(
          "The archive contains conflicting file and directory paths.",
        );
      }
    }
    if (
      !directory &&
      [...paths.keys()].some((other) => other.startsWith(`${path}/`))
    ) {
      throw new AnalysisInputError(
        "The archive contains conflicting file and directory paths.",
      );
    }
    paths.set(path, directory ? "directory" : "file");
    if (!directory) {
      files.push({
        path,
        size,
        sha256: createHash("sha256").update(body).digest("hex"),
        text: contentText(body),
      });
    }
  }
  if (!foundEnd) {
    throw new AnalysisInputError(
      "The npm archive is missing a complete tar end marker.",
    );
  }
  return files.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
}

export async function inspectArchive(
  buffer: Buffer,
  release: RegistryRelease,
): Promise<PackageSnapshot> {
  if (buffer.length > ARCHIVE_LIMITS.compressedBytes) {
    throw new AnalysisInputError(
      "The npm archive exceeds the 10 MiB download limit.",
    );
  }
  const integrityVerified = verifyIntegrity(buffer, release);
  const tar = await decompress(buffer);
  const files = readTar(tar);
  const packageJson = files.find((file) => file.path === "package.json");
  if (!packageJson?.text) {
    throw new AnalysisInputError(
      "The archive must contain a readable package.json smaller than 2 MiB.",
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(packageJson.text);
  } catch {
    throw new AnalysisInputError(
      "The archive contains invalid package.json data.",
    );
  }
  const result = manifestFieldsSchema.safeParse(value);
  if (!result.success) {
    throw new AnalysisInputError(
      "The archive contains unsupported package.json metadata.",
    );
  }
  const manifest = result.data;
  if (manifest.name !== release.name || manifest.version !== release.version) {
    throw new AnalysisInputError(
      "The archive package name or version does not match the requested npm release.",
    );
  }
  const warnings: string[] = [];
  if (integrityVerified === "sha1") {
    warnings.push(
      "Only the legacy SHA-1 registry checksum was available. Integrity assurance is weaker than SHA-256/384/512.",
    );
  }
  const skipped = files.filter((file) => file.text === null).length;
  if (skipped) {
    warnings.push(
      `${skipped} file(s) are binary, not valid UTF-8, or larger than 2 MiB; their bytes were hashed but their contents were not statically scanned.`,
    );
  }
  if (
    [
      "scripts",
      "dependencies",
      "optionalDependencies",
      "peerDependencies",
    ].some((key) => {
      const field = key as
        | "scripts"
        | "dependencies"
        | "optionalDependencies"
        | "peerDependencies";
      const actual = manifest[field];
      const expected = release[field];
      return (
        Object.keys(actual).length !== Object.keys(expected).length ||
        Object.entries(actual).some(
          ([name, version]) => expected[name] !== version,
        )
      );
    })
  ) {
    warnings.push(
      "Registry scripts or dependency metadata differ from the archive package.json. Static comparison uses the archive manifest.",
    );
  }
  return {
    release,
    manifest,
    files,
    archiveSha256: createHash("sha256").update(buffer).digest("hex"),
    integrityVerified,
    compressedBytes: buffer.length,
    unpackedBytes: files.reduce((total, file) => total + file.size, 0),
    warnings,
  };
}

export async function fetchSnapshot(
  release: RegistryRelease,
): Promise<PackageSnapshot> {
  const buffer = await fetchRegistryBytes(
    release.tarballUrl,
    ARCHIVE_LIMITS.compressedBytes,
    "archive",
  );
  return inspectArchive(buffer, release);
}
