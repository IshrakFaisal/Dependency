import { describe, expect, it, vi } from "vitest";
import { parsePullRequestContext } from "@/lib/github/context";
import {
  readLockfileAtCommit,
  type GitReader,
} from "@/lib/github/git-lockfile";
import { prContext } from "./helpers/github-fixtures";

const env = {
  GITHUB_EVENT_NAME: "pull_request",
  GITHUB_REPOSITORY: "example-owner/example-repo",
};
function event() {
  const repository = { id: 1, full_name: env.GITHUB_REPOSITORY };
  return {
    number: 7,
    repository,
    pull_request: {
      number: 7,
      base: { sha: prContext.baseSha, repo: repository },
      head: { sha: prContext.headSha, repo: { ...repository } },
    },
  };
}
describe("GitHub event context", () => {
  it("validates same-repository PR context", () => {
    expect(parsePullRequestContext(env, event())).toEqual(prContext);
  });
  it("derives forks from repository identity", () => {
    const input = event();
    input.pull_request.head.repo = {
      id: 2,
      full_name: "example-fork/example-repo",
    };
    expect(parsePullRequestContext(env, input).isFork).toBe(true);
  });
  it("rejects non-PR, mismatched and malformed context", () => {
    expect(() =>
      parsePullRequestContext({ ...env, GITHUB_EVENT_NAME: "push" }, event()),
    ).toThrow();
    expect(() =>
      parsePullRequestContext(
        { ...env, GITHUB_REPOSITORY: "other/repo" },
        event(),
      ),
    ).toThrow();
    expect(() => parsePullRequestContext(env, null)).toThrow();
    const input = event();
    input.pull_request.head.sha = "--output=another-file";
    expect(() => parsePullRequestContext(env, input)).toThrow();
  });
});

describe("lockfile acquisition with a fake Git reader (no subprocess)", () => {
  it("reads a literal package-lock.json path via git show at an exact SHA", async () => {
    const read = vi
      .fn<GitReader>()
      .mockResolvedValueOnce(
        `100644 blob ${"c".repeat(40)}\tpackage-lock.json\n`,
      )
      .mockResolvedValueOnce('{"lockfileVersion":3}');
    expect(
      await readLockfileAtCommit("example-repository", prContext.baseSha, read),
    ).toBe('{"lockfileVersion":3}');
    expect(read.mock.calls).toEqual([
      [
        ["ls-tree", prContext.baseSha, "--", "package-lock.json"],
        "example-repository",
      ],
      [
        ["show", `${prContext.baseSha}:package-lock.json`],
        "example-repository",
      ],
    ]);
  });
  it("returns null only for an absent path", async () => {
    const read = vi.fn<GitReader>().mockResolvedValue("");
    expect(
      await readLockfileAtCommit("example-repository", prContext.baseSha, read),
    ).toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("does not mistake an unavailable commit for a missing file", async () => {
    const read = vi
      .fn<GitReader>()
      .mockRejectedValue(new Error("Missing Git object"));
    await expect(
      readLockfileAtCommit("example-repository", prContext.baseSha, read),
    ).rejects.toThrow("Missing Git object");
  });
  it("rejects links and unexpected tree entry types", async () => {
    const read = vi
      .fn<GitReader>()
      .mockResolvedValue(`120000 blob ${"c".repeat(40)}\tpackage-lock.json\n`);
    await expect(
      readLockfileAtCommit("example-repository", prContext.baseSha, read),
    ).rejects.toThrow("regular Git file");
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("rejects arbitrary revisions before calling Git", async () => {
    const read = vi.fn<GitReader>();
    await expect(
      readLockfileAtCommit("example-repository", "HEAD; echo anything", read),
    ).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
  });
});
