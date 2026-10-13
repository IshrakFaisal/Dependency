import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  fetchRelease,
  fetchRegistryBytes,
  REGISTRY_LIMITS,
  validateRegistryUrl,
} from "@/lib/analysis/registry";
import { fetchSnapshot } from "@/lib/analysis/archive";
import type { RegistryRelease } from "@/lib/types/static-analysis";

const metadata = {
  name: "dg-test-fixture",
  version: "1.0.0",
  description: "Synthetic metadata for network transport tests",
  license: "MIT",
  scripts: { test: "synthetic script text only" },
  dependencies: { "dg-fixture-dep": "2.0.0" },
  dist: {
    tarball:
      "https://registry.npmjs.org/dg-test-fixture/-/dg-test-fixture-1.0.0.tgz",
    integrity: `sha512-${Buffer.alloc(64).toString("base64")}`,
  },
};

function response(value: unknown = metadata) {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("npm registry transport", () => {
  it("uses a bounded, server-side no-store GET with redirects disabled", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response());
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchRelease("dg-test-fixture", "1.0.0");
    expect(result.name).toBe("dg-test-fixture");
    expect(result.scripts).toEqual(metadata.scripts);
    expect(result.peerDependencies).toEqual({});
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://registry.npmjs.org/dg-test-fixture/1.0.0"),
      expect.objectContaining({
        method: "GET",
        cache: "no-store",
        redirect: "error",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("encodes scoped names and exact prerelease/build versions as URL segments", async () => {
    const scoped = {
      ...metadata,
      name: "@dg-fixture/pkg",
      version: "1.0.0-rc.1+build.2",
    };
    const fetchMock = vi.fn().mockResolvedValue(response(scoped));
    vi.stubGlobal("fetch", fetchMock);
    await fetchRelease(scoped.name, scoped.version);
    expect(fetchMock.mock.calls[0][0].href).toBe(
      "https://registry.npmjs.org/%40dg-fixture%2Fpkg/1.0.0-rc.1%2Bbuild.2",
    );
  });

  it.each([
    ["../escape", "1.0.0"],
    ["https://example.invalid", "1.0.0"],
    ["pkg", "latest"],
    ["pkg", "^1.0.0"],
    ["pkg", "1.0.0/../../"],
    [" pkg", "1.0.0"],
    ["pkg", "1.0.0 "],
  ])(
    "rejects invalid identifiers before making a request: %s %s",
    async (name, version) => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      await expect(fetchRelease(name, version)).rejects.toThrow(
        /valid npm package name/,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    "http://registry.npmjs.org/package.tgz",
    "https://evil.invalid/package.tgz",
    "https://registry.npmjs.org.evil.invalid/package.tgz",
    "https://127.0.0.1/package.tgz",
    "https://[::1]/package.tgz",
    "https://registry.npmjs.org:443/package.tgz",
    "https://registry.npmjs.org:8443/package.tgz",
    "https://user:secret@registry.npmjs.org/package.tgz",
    "https://registry.npmjs.org@evil.invalid/package.tgz",
    "https://registry.npmjs.org/package.tgz?redirect=elsewhere",
    "https://registry.npmjs.org/package.tgz#fragment",
    "file:///etc/passwd",
    "https://registry.npmjs.org\\@evil.invalid/package.tgz",
    " https://registry.npmjs.org/package.tgz",
    "//registry.npmjs.org/package.tgz",
  ])("rejects unsafe tarball targets: %s", async (tarball) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          response({ ...metadata, dist: { ...metadata.dist, tarball } }),
        ),
    );
    await expect(fetchRelease(metadata.name, metadata.version)).rejects.toThrow(
      /Only HTTPS/,
    );
    expect(() => validateRegistryUrl(tarball)).toThrow();
  });

  it("rejects a tarball URL independently at the archive download boundary", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const forged = {
      tarballUrl: "https://127.0.0.1/secret",
    } as RegistryRelease;
    await expect(fetchSnapshot(forged)).rejects.toThrow(/Only HTTPS/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([301, 302, 307, 308])(
    "fails closed on redirect status %s",
    async (status) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(
          new Response(null, {
            status,
            headers: { Location: "https://private.invalid" },
          }),
        );
      vi.stubGlobal("fetch", fetchMock);
      await expect(
        fetchRelease(metadata.name, metadata.version),
      ).rejects.toThrow(/could not provide/);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("rejects an unexpectedly redirected response even from the allowed origin", async () => {
    const redirected = response();
    Object.defineProperty(redirected, "redirected", { value: true });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(redirected));
    await expect(fetchRelease(metadata.name, metadata.version)).rejects.toThrow(
      /Redirected/,
    );
  });

  it.each([
    [404, /not found/],
    [429, /rate limit/],
    [500, /could not provide/],
  ] as const)("returns a safe error for status %s", async (status, message) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("upstream internal secret", { status }),
        ),
    );
    await expect(fetchRelease(metadata.name, metadata.version)).rejects.toThrow(
      message,
    );
  });

  it("does not disclose raw connection errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("internal proxy user:secret")),
    );
    await expect(fetchRelease(metadata.name, metadata.version)).rejects.toThrow(
      "The npm registry request failed. Check connectivity and try again later.",
    );
  });

  it("aborts a stalled request with a safe timeout error", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener(
              "abort",
              () => reject(new Error("aborted")),
              { once: true },
            );
          }),
      ),
    );
    const pending = expect(
      fetchRelease(metadata.name, metadata.version),
    ).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(REGISTRY_LIMITS.timeoutMs);
    await pending;
  });

  it("bounds advertised size before reading the body", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("{}", {
            headers: {
              "content-length": String(REGISTRY_LIMITS.metadataBytes + 1),
            },
          }),
        ),
    );
    await expect(fetchRelease(metadata.name, metadata.version)).rejects.toThrow(
      /download size/,
    );
  });

  it("counts streamed bytes even without or with a dishonest content-length", async () => {
    for (const headers of [{}, { "content-length": "1" }]) {
      let canceled = false;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(4));
          controller.enqueue(new Uint8Array(5));
        },
        cancel() {
          canceled = true;
        },
      });
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response(stream, { headers })),
      );
      await expect(
        fetchRegistryBytes("https://registry.npmjs.org/fixture", 8, "archive"),
      ).rejects.toThrow(/download size/);
      expect(canceled).toBe(true);
    }
  });

  it("accepts a stream exactly at its byte cap", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("12345678")));
    expect(
      (
        await fetchRegistryBytes(
          "https://registry.npmjs.org/fixture",
          8,
          "archive",
        )
      ).toString(),
    ).toBe("12345678");
  });

  it("rejects invalid JSON, invalid UTF-8 and malformed registry fields", async () => {
    for (const value of [
      new Response("{"),
      new Response(new Uint8Array([255])),
      response({ ...metadata, scripts: { test: 42 } }),
    ]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(value));
      await expect(
        fetchRelease(metadata.name, metadata.version),
      ).rejects.toThrow(/release metadata/);
    }
  });

  it("requires the returned package and version to match exactly", async () => {
    for (const other of [
      { ...metadata, name: "another-fixture" },
      { ...metadata, version: "2.0.0" },
    ]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(other)));
      await expect(
        fetchRelease(metadata.name, metadata.version),
      ).rejects.toThrow(/identity does not match/);
    }
  });

  it("requires integrity metadata and permits SHA-1 for old releases", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          response({ ...metadata, dist: { tarball: metadata.dist.tarball } }),
        ),
    );
    await expect(fetchRelease(metadata.name, metadata.version)).rejects.toThrow(
      /no archive integrity/,
    );
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          response({
            ...metadata,
            dist: { tarball: metadata.dist.tarball, shasum: "0".repeat(40) },
          }),
        ),
    );
    expect(
      (await fetchRelease(metadata.name, metadata.version)).integrity,
    ).toBeNull();
  });
});
