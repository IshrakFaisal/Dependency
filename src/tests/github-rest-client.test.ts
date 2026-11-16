import { describe, expect, it, vi } from "vitest";
import { createGitHubClient } from "@/lib/github/rest-client";
import { COMMENT_MARKER } from "@/lib/github/render-comment";
import { prContext } from "./helpers/github-fixtures";

const bot = { login: "github-actions[bot]", type: "Bot" };
const listing = { ...prContext, page: 1, perPage: 100 };
describe("GitHub REST client with fake fetch (no HTTP)", () => {
  it("uses the fixed REST origin, token, API version and pagination parameters", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify([{ id: 3, body: COMMENT_MARKER, user: bot }]),
          {
            headers: {
              link: '<https://api.github.com/example?page=2>; rel="next", <https://api.github.com/example?page=2>; rel="last"',
            },
          },
        ),
      );
    const result = await createGitHubClient("test-token", fetcher).listComments(
      listing,
    );
    expect(result).toEqual({
      comments: [{ id: 3, body: COMMENT_MARKER }],
      hasNextPage: true,
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.github.com/repos/example-owner/example-repo/issues/7/comments?per_page=100&page=1",
      expect.objectContaining({
        method: "GET",
        redirect: "error",
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
          "X-GitHub-Api-Version": "2026-03-10",
        }),
      }),
    );
  });
  it("ignores human and other-bot marker comments", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            id: 1,
            body: COMMENT_MARKER,
            user: { login: "person", type: "User" },
          },
          {
            id: 2,
            body: COMMENT_MARKER,
            user: { login: "another-bot", type: "Bot" },
          },
          { id: 3, body: COMMENT_MARKER, user: null },
          { id: 4, body: COMMENT_MARKER, user: bot },
        ]),
      ),
    );
    expect(
      await createGitHubClient("test-token", fetcher).listComments(listing),
    ).toEqual({
      comments: [{ id: 4, body: COMMENT_MARKER }],
      hasNextPage: false,
    });
  });
  it("creates an issue comment with a JSON body", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('{"id":10}', { status: 201 }));
    expect(
      await createGitHubClient("test-token", fetcher).createComment({
        ...prContext,
        body: COMMENT_MARKER,
      }),
    ).toEqual({ id: 10 });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.github.com/repos/example-owner/example-repo/issues/7/comments",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ body: COMMENT_MARKER }),
      }),
    );
  });
  it("updates a comment using PATCH", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('{"id":10}'));
    await createGitHubClient("test-token", fetcher).updateComment({
      ...prContext,
      commentId: 10,
      body: COMMENT_MARKER,
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.github.com/repos/example-owner/example-repo/issues/comments/10",
      expect.objectContaining({ method: "PATCH" }),
    );
  });
  it("fails once without retries and does not expose response bodies or tokens", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response("private response test-token", { status: 403 }),
      );
    await expect(
      createGitHubClient("test-token", fetcher).listComments(listing),
    ).rejects.toThrow("GitHub comment request failed (HTTP 403).");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("validates response shapes and rejects an empty token", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('{"not":"a-list"}'));
    await expect(
      createGitHubClient("test-token", fetcher).listComments(listing),
    ).rejects.toThrow();
    expect(() => createGitHubClient(" ", fetcher)).toThrow("GITHUB_TOKEN");
  });
  it("rejects excessive response bodies", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("x".repeat(8 * 1024 * 1024 + 1)));
    await expect(
      createGitHubClient("test-token", fetcher).listComments(listing),
    ).rejects.toThrow("size limit");
  });
});
