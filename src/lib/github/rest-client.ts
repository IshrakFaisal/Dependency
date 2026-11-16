import { z } from "zod";
import {
  commentLocationSchema,
  type CommentClient,
  type CommentLocation,
} from "./upsert-comment";

const idSchema = z.object({ id: z.number().int().positive() });
const commentsSchema = z.array(
  idSchema.extend({
    body: z.string().nullable(),
    user: z.object({ login: z.string(), type: z.string() }).nullable(),
  }),
);
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

/** Public GitHub REST only; fetch is injectable so unit tests never use HTTP. */
export function createGitHubClient(
  token: string,
  fetcher: typeof fetch = fetch,
): CommentClient {
  if (!token.trim())
    throw new Error("GITHUB_TOKEN is required for PR comments.");
  const repoPath = (input: CommentLocation) => {
    const { owner, repo } = commentLocationSchema.parse(input);
    return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  };
  async function request(method: string, path: string, body?: string) {
    const response = await fetcher(`https://api.github.com${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2026-03-10",
        "User-Agent": "DependencyGuard",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify({ body }) }),
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(
        `GitHub comment request failed (HTTP ${response.status}).`,
      );
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("GitHub comment response has no body.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          throw new Error("GitHub comment response exceeded its size limit.");
        }
        chunks.push(chunk.value);
      }
    } finally {
      reader.releaseLock();
    }
    const data: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return { data, link: response.headers.get("link") ?? "" };
  }
  return {
    async listComments(input) {
      const page = z.number().int().positive().parse(input.page);
      const perPage = z.number().int().min(1).max(100).parse(input.perPage);
      const { data, link } = await request(
        "GET",
        `${repoPath(input)}/issues/${input.issueNumber}/comments?per_page=${perPage}&page=${page}`,
      );
      const comments = commentsSchema.parse(data);
      return {
        // A human can paste the marker. Never overwrite their comment.
        comments: comments
          .filter(
            (comment) =>
              comment.user?.type === "Bot" &&
              comment.user.login === "github-actions[bot]",
          )
          .map(({ id, body }) => ({ id, body })),
        // Follow page numbers on our fixed origin, never a response-supplied URL.
        hasNextPage:
          /(?:^|,)\s*<[^>]+>;\s*rel="next"(?:\s*;[^,]*)?(?:,|$)/.test(link),
      };
    },
    async createComment(input) {
      const { data } = await request(
        "POST",
        `${repoPath(input)}/issues/${input.issueNumber}/comments`,
        input.body,
      );
      return idSchema.parse(data);
    },
    async updateComment(input) {
      const id = z.number().int().positive().parse(input.commentId);
      const { data } = await request(
        "PATCH",
        `${repoPath(input)}/issues/comments/${id}`,
        input.body,
      );
      return idSchema.parse(data);
    },
  };
}
