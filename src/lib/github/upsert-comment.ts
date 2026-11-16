import { z } from "zod";
import { COMMENT_LIMIT, COMMENT_MARKER } from "./render-comment";

export const commentLocationSchema = z.object({
  owner: z.string().regex(/^[A-Za-z0-9-]+$/),
  repo: z
    .string()
    .regex(/^[A-Za-z0-9_.-]+$/)
    .refine((value) => value !== "." && value !== ".."),
  issueNumber: z.number().int().positive(),
});
export type CommentLocation = z.infer<typeof commentLocationSchema>;
export type ExistingComment = { id: number; body: string | null };
export interface CommentClient {
  /** Return eligible bot comments, not comments authored by people. */
  listComments(
    input: CommentLocation & { page: number; perPage: number },
  ): Promise<{
    comments: ExistingComment[];
    hasNextPage: boolean;
  }>;
  createComment(
    input: CommentLocation & { body: string },
  ): Promise<{ id: number }>;
  updateComment(
    input: CommentLocation & { commentId: number; body: string },
  ): Promise<{ id: number }>;
}
export type UpsertResult = {
  action: "created" | "updated" | "unchanged";
  id: number;
};
const queues = new Map<string, Promise<unknown>>();

/** Paginate before creating. Serialize writers to one PR within this process.
 * GitHub has no atomic find-or-create endpoint; the workflow also serializes
 * runs per PR. Separate external writers must honor the same coordination.
 */
export async function upsertComment(
  client: CommentClient,
  input: CommentLocation & { body: string },
): Promise<UpsertResult> {
  const location = commentLocationSchema.parse(input);
  const body = z
    .string()
    .startsWith(COMMENT_MARKER)
    .max(COMMENT_LIMIT - 1)
    .parse(input.body);
  const key = JSON.stringify([
    location.owner.toLowerCase(),
    location.repo.toLowerCase(),
    location.issueNumber,
  ]);
  const previous = queues.get(key) ?? Promise.resolve();
  const task = previous
    .catch(() => undefined)
    .then(async (): Promise<UpsertResult> => {
      let existing: ExistingComment | undefined;
      for (let page = 1; ; page++) {
        const result = await client.listComments({
          ...location,
          page,
          perPage: 100,
        });
        for (const comment of result.comments) {
          if (
            comment.body?.includes(COMMENT_MARKER) &&
            (!existing || comment.id < existing.id)
          )
            existing = comment;
        }
        if (!result.hasNextPage) break;
        // A broken client must not loop forever or fall through to a create.
        if (page >= 1000) throw new Error("Comment pagination limit exceeded.");
      }
      if (existing) {
        if (existing.body === body)
          return { action: "unchanged", id: existing.id };
        const result = await client.updateComment({
          ...location,
          commentId: existing.id,
          body,
        });
        return { action: "updated", id: result.id };
      }
      const result = await client.createComment({ ...location, body });
      return { action: "created", id: result.id };
    });
  queues.set(key, task);
  try {
    return await task;
  } finally {
    if (queues.get(key) === task) queues.delete(key);
  }
}
