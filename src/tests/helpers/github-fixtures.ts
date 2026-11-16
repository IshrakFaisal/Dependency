import { vi } from "vitest";
import { TRIAGE_DISCLAIMER, type Triage } from "@/lib/analysis/triage";
import {
  summarizeReport,
  type CliDocument,
  type CliResult,
} from "@/lib/cli/output";
import type { PullRequestContext } from "@/lib/github/context";
import type {
  CommentClient,
  ExistingComment,
} from "@/lib/github/upsert-comment";
import { triageReport } from "./triage-fixtures";

export const prContext: PullRequestContext = {
  owner: "example-owner",
  repo: "example-repo",
  issueNumber: 7,
  baseSha: "a".repeat(40),
  headSha: "b".repeat(40),
  isFork: false,
};
export function githubResult(
  name = "example-a",
  tier: Triage["tier"] = "needs-review",
): Extract<CliResult, { outcome: "completed" }> {
  const target = {
    name,
    from: "1.0.0",
    to: "1.1.0",
    path: `node_modules/${name}`,
    dev: false,
  };
  const result = summarizeReport(target, triageReport(target));
  if (result.outcome !== "completed")
    throw new Error("Expected a completed fixture.");
  return {
    ...result,
    triage: {
      tier,
      disclaimer: TRIAGE_DISCLAIMER,
      reasons:
        tier === "no-notable-changes"
          ? []
          : [
              {
                id: "example-signal",
                source: "metadata",
                title: "Publisher changed",
                detail:
                  "The candidate publisher differs from the trusted publisher.",
                evidenceRef: "maintainer-changed",
              },
            ],
    },
  };
}
export function githubDocument(
  results: CliResult[] = [],
  skipped: CliDocument["skipped"] = [],
): CliDocument {
  const triageSummary = {
    "needs-review": 0,
    "no-notable-changes": 0,
    incomplete: 0,
  };
  for (const result of results)
    if (result.outcome === "completed") triageSummary[result.triage.tier]++;
  const completed = results.filter(
    (result) => result.outcome === "completed",
  ).length;
  return {
    command: "lockfile",
    status: "INCONCLUSIVE",
    results,
    skipped,
    summary: {
      completed,
      failed: results.length - completed,
      skipped: skipped.length,
    },
    triageSummary,
  };
}
export function fakeCommentClient(
  initial: ExistingComment[] = [],
  pageSize = 100,
) {
  const comments = initial.map((comment) => ({ ...comment }));
  const client = {
    listComments: vi.fn<CommentClient["listComments"]>(async ({ page }) => ({
      comments: comments.slice((page - 1) * pageSize, page * pageSize),
      hasNextPage: page * pageSize < comments.length,
    })),
    createComment: vi.fn<CommentClient["createComment"]>(async ({ body }) => {
      const id = Math.max(0, ...comments.map((comment) => comment.id)) + 1;
      comments.push({ id, body });
      return { id };
    }),
    updateComment: vi.fn<CommentClient["updateComment"]>(
      async ({ commentId, body }) => {
        const found = comments.find((comment) => comment.id === commentId);
        if (!found) throw new Error("Missing fake comment.");
        found.body = body;
        return { id: commentId };
      },
    ),
  } satisfies CommentClient;
  return { client, comments };
}
export function githubLockfile(packages: Record<string, unknown> = {}) {
  return JSON.stringify({
    lockfileVersion: 3,
    packages: { "": { name: "example-root" }, ...packages },
  });
}
export const registryEntry = (version: string, dev = false) => ({
  version,
  dev,
  resolved: `https://registry.npmjs.org/example-package/-/example-package-${version}.tgz`,
});
