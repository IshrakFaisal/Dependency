import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ARCHIVE_LIMITS, inspectArchive } from "@/lib/analysis/archive";
import type { RegistryRelease } from "@/lib/types/static-analysis";

interface Entry {
  name: string;
  body?: string | Buffer;
  type?: string;
  prefix?: string;
  linkname?: string;
  alter?: (header: Buffer) => void;
}

const manifest = JSON.stringify({ name: "dg-test-fixture", version: "1.0.0" });
const manifestEntry: Entry = { name: "package/package.json", body: manifest };

function checksum(header: Buffer) {
  header.fill(32, 148, 156);
  const sum = header.reduce((total, byte) => total + byte, 0);
  header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
}

function tar(entries: Entry[], ending: Buffer = Buffer.alloc(1024)): Buffer {
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    const body = Buffer.from(entry.body ?? "");
    const header = Buffer.alloc(512);
    header.write(entry.name, 0, 100, "utf8");
    header.write("0000644\0", 100, 8, "ascii");
    header.write("0000000\0", 108, 8, "ascii");
    header.write("0000000\0", 116, 8, "ascii");
    header.write(
      `${body.length.toString(8).padStart(11, "0")}\0`,
      124,
      12,
      "ascii",
    );
    header.write("00000000000\0", 136, 12, "ascii");
    header.write(entry.type ?? "0", 156, 1, "ascii");
    if (entry.linkname) header.write(entry.linkname, 157, 100, "utf8");
    header.write("ustar\0", 257, 6, "ascii");
    header.write("00", 263, 2, "ascii");
    if (entry.prefix) header.write(entry.prefix, 345, 155, "utf8");
    entry.alter?.(header);
    checksum(header);
    chunks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  return Buffer.concat([...chunks, ending]);
}

function release(buffer: Buffer, algorithm = "sha512"): RegistryRelease {
  return {
    name: "dg-test-fixture",
    version: "1.0.0",
    description: "Synthetic archive fixture",
    license: "MIT",
    tarballUrl:
      "https://registry.npmjs.org/dg-test-fixture/-/dg-test-fixture-1.0.0.tgz",
    integrity: `${algorithm}-${createHash(algorithm).update(buffer).digest("base64")}`,
    shasum: createHash("sha1").update(buffer).digest("hex"),
    scripts: {},
    dependencies: {},
    optionalDependencies: {},
    peerDependencies: {},
    deprecated: null,
  };
}

function inspect(entries: Entry[], ending?: Buffer) {
  const buffer = gzipSync(tar(entries, ending));
  return inspectArchive(buffer, release(buffer));
}

function pax(key: string, value: string): string {
  const data = ` ${key}=${value}\n`;
  let size = Buffer.byteLength(data) + 1;
  while (size !== Buffer.byteLength(data) + String(size).length) {
    size = Buffer.byteLength(data) + String(size).length;
  }
  return `${size}${data}`;
}

describe("safe, in-memory npm archive inspection", () => {
  it("reads USTAR files, directories and prefixes without changing source bytes", async () => {
    const buffer = gzipSync(
      tar([
        { name: "package/", type: "5" },
        manifestEntry,
        {
          name: "index.js",
          prefix: "package/lib",
          body: "export const value = 1;",
        },
      ]),
    );
    const before = Buffer.from(buffer);
    const result = await inspectArchive(buffer, release(buffer));
    expect(buffer).toEqual(before);
    expect(result.files.map((file) => file.path)).toEqual([
      "lib/index.js",
      "package.json",
    ]);
    expect(result.files[0].text).toBe("export const value = 1;");
    expect(result.manifest.name).toBe("dg-test-fixture");
    expect(result.archiveSha256).toBe(
      createHash("sha256").update(buffer).digest("hex"),
    );
    expect(result.integrityVerified).toBe("sha512");
    expect(result.warnings).toEqual([]);
  });

  it.each(["sha512", "sha384", "sha256"])(
    "verifies %s integrity",
    async (algorithm) => {
      const buffer = gzipSync(tar([manifestEntry]));
      const result = await inspectArchive(buffer, release(buffer, algorithm));
      expect(result.integrityVerified).toBe(algorithm);
    },
  );

  it("warns when only legacy SHA-1 is available", async () => {
    const buffer = gzipSync(tar([manifestEntry]));
    const metadata = { ...release(buffer), integrity: null };
    const result = await inspectArchive(buffer, metadata);
    expect(result.integrityVerified).toBe("sha1");
    expect(result.warnings.join(" ")).toMatch(/SHA-1.*weaker/);
  });

  it("does not downgrade to a matching weaker hash on strong mismatch", async () => {
    const buffer = gzipSync(tar([manifestEntry]));
    const metadata = release(buffer, "sha256");
    metadata.integrity += ` sha512-${Buffer.alloc(64).toString("base64")}`;
    await expect(inspectArchive(buffer, metadata)).rejects.toThrow(
      /integrity verification failed/,
    );
  });

  it("accepts any matching digest among the strongest SRI candidates", async () => {
    const buffer = gzipSync(tar([manifestEntry]));
    const metadata = release(buffer);
    metadata.integrity = `sha512-${Buffer.alloc(64).toString("base64")} ${metadata.integrity}`;
    expect((await inspectArchive(buffer, metadata)).integrityVerified).toBe(
      "sha512",
    );
  });

  it.each(["sha512-not-a-valid-hash", "md5-aaaaaaaa", "sha512-AAAA"])(
    "rejects unsupported/malformed integrity %s without SHA-1 fallback",
    async (integrity) => {
      const buffer = gzipSync(tar([manifestEntry]));
      await expect(
        inspectArchive(buffer, { ...release(buffer), integrity }),
      ).rejects.toThrow(/integrity/);
    },
  );

  it("fails on missing checksums and a mismatched legacy checksum", async () => {
    const buffer = gzipSync(tar([manifestEntry]));
    await expect(
      inspectArchive(buffer, {
        ...release(buffer),
        integrity: null,
        shasum: null,
      }),
    ).rejects.toThrow(/integrity information/);
    await expect(
      inspectArchive(buffer, {
        ...release(buffer),
        integrity: null,
        shasum: "0".repeat(40),
      }),
    ).rejects.toThrow(/verification failed/);
  });

  it.each([
    "package/../escape.js",
    "/package/absolute.js",
    "C:/escape.js",
    "package\\escape.js",
    "package/sub/../../escape.js",
    "package/file:stream",
    "outside/index.js",
    "package/line\nname.js",
  ])("rejects unsafe paths: %s", async (name) => {
    await expect(inspect([manifestEntry, { name }])).rejects.toThrow(
      /unsafe entry path|inside the npm package directory/,
    );
  });

  it("rejects unsafe paths in the USTAR prefix", async () => {
    await expect(
      inspect([manifestEntry, { name: "x.js", prefix: "package/.." }]),
    ).rejects.toThrow(/unsafe entry path/);
  });

  it("rejects duplicate normalized file and directory paths", async () => {
    await expect(
      inspect([
        manifestEntry,
        { name: "./package/./package.json", body: manifest },
      ]),
    ).rejects.toThrow(/duplicate normalized/);
    await expect(
      inspect([
        manifestEntry,
        { name: "package/lib/", type: "5" },
        { name: "package/lib", type: "5" },
      ]),
    ).rejects.toThrow(/duplicate normalized/);
  });

  it.each([true, false])(
    "rejects colliding file/parent paths (parent first: %s)",
    async (parentFirst) => {
      const entries = [
        { name: "package/lib" },
        { name: "package/lib/index.js" },
      ];
      await expect(
        inspect([
          manifestEntry,
          ...(parentFirst ? entries : entries.reverse()),
        ]),
      ).rejects.toThrow(/conflicting file and directory/);
    },
  );

  it.each(["1", "2", "3", "4", "6", "7", "L", "K", "S", "g"])(
    "rejects links, specials and unsupported extensions: %s",
    async (type) => {
      await expect(
        inspect([manifestEntry, { name: "package/item", type }]),
      ).rejects.toThrow(/link, special entry, or unsupported tar extension/);
    },
  );

  it("rejects link targets even on a regular entry", async () => {
    await expect(
      inspect([
        manifestEntry,
        { name: "package/item", linkname: "package/package.json" },
      ]),
    ).rejects.toThrow(/links are not supported/);
  });

  it("rejects checksum corruption before inspecting content", async () => {
    const raw = tar([manifestEntry]);
    raw[0] ^= 1;
    const buffer = gzipSync(raw);
    await expect(inspectArchive(buffer, release(buffer))).rejects.toThrow(
      /invalid checksum/,
    );
  });

  it("rejects a truncated body, tar header and missing end markers", async () => {
    const raw = tar([manifestEntry]);
    for (const truncated of [
      raw.subarray(0, 10),
      raw.subarray(0, 512),
      raw.subarray(0, 1024),
    ]) {
      const buffer = gzipSync(truncated);
      await expect(inspectArchive(buffer, release(buffer))).rejects.toThrow(
        /truncated|end marker/,
      );
    }
  });

  it("rejects non-zero trailing data and a one-block end marker", async () => {
    await expect(
      inspect(
        [manifestEntry],
        Buffer.concat([Buffer.alloc(1024), Buffer.alloc(512, 1)]),
      ),
    ).rejects.toThrow(/end marker/);
    await expect(inspect([manifestEntry], Buffer.alloc(512))).rejects.toThrow(
      /end marker/,
    );
  });

  it("rejects incomplete or invalid gzip streams", async () => {
    const valid = gzipSync(tar([manifestEntry]));
    for (const buffer of [
      valid.subarray(0, valid.length - 4),
      Buffer.from("not gzip"),
    ]) {
      await expect(inspectArchive(buffer, release(buffer))).rejects.toThrow(
        /gzip archive/,
      );
    }
  });

  it("rejects non-USTAR archives and binary numeric fields", async () => {
    await expect(
      inspect([
        { ...manifestEntry, alter: (header) => header.fill(0, 257, 265) },
      ]),
    ).rejects.toThrow(/standard USTAR/);
    await expect(
      inspect([
        {
          ...manifestEntry,
          alter: (header) => {
            header[124] = 128;
          },
        },
      ]),
    ).rejects.toThrow(/numeric field/);
  });

  it("rejects filenames with hidden suffixes after a NUL", async () => {
    await expect(
      inspect([
        {
          ...manifestEntry,
          alter: (header) => {
            header[90] = 65;
          },
        },
      ]),
    ).rejects.toThrow(/ambiguous tar header/);
  });

  it("supports a safe local PAX long path", async () => {
    const longPath = `package/${"nested/".repeat(20)}index.js`;
    const result = await inspect([
      manifestEntry,
      {
        name: "PaxHeader/file",
        type: "x",
        body: pax("path", longPath) + pax("mtime", "0.123"),
      },
      { name: "package/placeholder", body: "export default 1" },
    ]);
    expect(result.files.some((file) => file.path === longPath.slice(8))).toBe(
      true,
    );
  });

  it("applies path safety and duplicate detection to PAX overrides", async () => {
    await expect(
      inspect([
        manifestEntry,
        {
          name: "PaxHeader/file",
          type: "x",
          body: pax("path", "package/../escape"),
        },
        { name: "package/placeholder" },
      ]),
    ).rejects.toThrow(/unsafe entry path/);
    await expect(
      inspect([
        manifestEntry,
        {
          name: "PaxHeader/file",
          type: "x",
          body: pax("path", "package/package.json"),
        },
        { name: "package/placeholder" },
      ]),
    ).rejects.toThrow(/duplicate normalized/);
  });

  it.each([
    pax("GNU.sparse.map", "0,20"),
    pax("linkpath", "outside"),
    pax("path", "package/a") + pax("path", "package/b"),
    "999 path=package/a\n",
  ])("rejects unsafe, duplicate and malformed PAX records", async (body) => {
    await expect(
      inspect([
        manifestEntry,
        { name: "PaxHeader/file", type: "x", body },
        { name: "package/item" },
      ]),
    ).rejects.toThrow(/PAX/);
  });

  it("rejects differing PAX sizes, pending PAX and stacked headers", async () => {
    const header = {
      name: "PaxHeader/file",
      type: "x",
      body: pax("size", "1024"),
    };
    await expect(
      inspect([manifestEntry, header, { name: "package/item" }]),
    ).rejects.toThrow(/PAX size/);
    await expect(inspect([manifestEntry, header])).rejects.toThrow(
      /end marker/,
    );
    await expect(inspect([manifestEntry, header, header])).rejects.toThrow(
      /stacked PAX/,
    );
  });

  it("rejects an absent, invalid or mismatched package manifest", async () => {
    await expect(inspect([{ name: "package/index.js" }])).rejects.toThrow(
      /package.json/,
    );
    await expect(inspect([{ ...manifestEntry, body: "{" }])).rejects.toThrow(
      /invalid package.json/,
    );
    await expect(
      inspect([
        {
          ...manifestEntry,
          body: JSON.stringify({ name: "other-name", version: "1.0.0" }),
        },
      ]),
    ).rejects.toThrow(/does not match/);
    await expect(
      inspect([
        {
          ...manifestEntry,
          body: JSON.stringify({ name: "dg-test-fixture", version: "2.0.0" }),
        },
      ]),
    ).rejects.toThrow(/does not match/);
    await expect(
      inspect([
        {
          ...manifestEntry,
          body: JSON.stringify({
            name: "dg-test-fixture",
            version: "1.0.0",
            scripts: { postinstall: 12 },
          }),
        },
      ]),
    ).rejects.toThrow(/unsupported package.json/);
  });

  it("hashes but does not scan binary, invalid UTF-8 or oversized text", async () => {
    const result = await inspect([
      manifestEntry,
      { name: "package/binary", body: Buffer.from([0, 255]) },
      { name: "package/invalid", body: Buffer.from([255]) },
      {
        name: "package/large.js",
        body: Buffer.alloc(ARCHIVE_LIMITS.textFileBytes + 1, 65),
      },
    ]);
    expect(result.files.filter((file) => file.text === null)).toHaveLength(3);
    expect(result.warnings.join(" ")).toMatch(/3 file.*not statically scanned/);
    expect(
      result.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256)),
    ).toBe(true);
  });

  it("warns when registry and archive metadata disagree", async () => {
    const result = await inspect([
      {
        ...manifestEntry,
        body: JSON.stringify({
          name: "dg-test-fixture",
          version: "1.0.0",
          scripts: { postinstall: "synthetic signal only" },
        }),
      },
    ]);
    expect(result.manifest.scripts.postinstall).toBe("synthetic signal only");
    expect(result.warnings.join(" ")).toMatch(/Registry scripts.*differ/);
  });

  it("enforces compressed, decompressed and entry-count caps", async () => {
    const compressed = Buffer.alloc(ARCHIVE_LIMITS.compressedBytes + 1);
    await expect(
      inspectArchive(compressed, release(compressed)),
    ).rejects.toThrow(/10 MiB/);
    const bomb = gzipSync(Buffer.alloc(ARCHIVE_LIMITS.unpackedBytes + 1));
    await expect(inspectArchive(bomb, release(bomb))).rejects.toThrow(/50 MiB/);
    await expect(
      inspect([
        manifestEntry,
        ...Array.from({ length: ARCHIVE_LIMITS.entries }, (_, index) => ({
          name: `package/f${index}`,
        })),
      ]),
    ).rejects.toThrow(/2,000-entry/);
  });
});
