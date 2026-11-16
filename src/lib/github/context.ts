import { z } from "zod";
import { commentLocationSchema } from "./upsert-comment";

export const commitShaSchema = z.string().regex(/^[0-9a-f]{40}$/i);
const repositorySchema = z.object({
  id: z.number().int().positive(),
  full_name: z.string(),
});
const eventSchema = z.object({
  number: z.number().int().positive(),
  repository: repositorySchema,
  pull_request: z.object({
    number: z.number().int().positive(),
    base: z.object({ sha: commitShaSchema, repo: repositorySchema }),
    head: z.object({ sha: commitShaSchema, repo: repositorySchema }),
  }),
});
export type PullRequestContext = z.infer<typeof commentLocationSchema> & {
  baseSha: string;
  headSha: string;
  isFork: boolean;
};

export function parsePullRequestContext(
  env: Record<string, string | undefined>,
  event: unknown,
): PullRequestContext {
  if (env.GITHUB_EVENT_NAME !== "pull_request")
    throw new Error("Expected a pull_request event.");
  const data = eventSchema.parse(event);
  const { base, head } = data.pull_request;
  if (
    env.GITHUB_REPOSITORY !== data.repository.full_name ||
    base.repo.full_name !== data.repository.full_name ||
    base.repo.id !== data.repository.id ||
    data.number !== data.pull_request.number
  )
    throw new Error("Pull request context does not match the repository.");
  const parts = data.repository.full_name.split("/");
  if (parts.length !== 2) throw new Error("Invalid GitHub repository name.");
  return {
    ...commentLocationSchema.parse({
      owner: parts[0],
      repo: parts[1],
      issueNumber: data.number,
    }),
    baseSha: base.sha,
    headSha: head.sha,
    isFork:
      head.repo.id !== base.repo.id ||
      head.repo.full_name !== base.repo.full_name,
  };
}
