import { describe, expect, it } from "vitest";
import { TRIAGE_DISCLAIMER } from "@/lib/analysis/triage";
import { escapeCommentText } from "@/lib/github/escape";
import {
  COMMENT_LIMIT,
  COMMENT_MARKER,
  renderTriageComment,
} from "@/lib/github/render-comment";
import { githubDocument, githubResult } from "./helpers/github-fixtures";

describe("renderTriageComment", () => {
  it("starts with the hidden marker on its own first line", () => {
    expect(renderTriageComment(githubDocument()).split("\n")[0]).toBe(
      COMMENT_MARKER,
    );
  });
  it("renders review rows with versions, reasons and evidence references", () => {
    const body = renderTriageComment(githubDocument([githubResult()]));
    expect(body).toContain("### Packages needing review");
    expect(body).toContain("| Versions | Tier | Short reasons |");
    expect(body).toContain(
      `${escapeCommentText("1.0.0")} → ${escapeCommentText("1.1.0")}`,
    );
    expect(body).toContain(escapeCommentText("maintainer-changed"));
  });
  it.each(["no-notable-changes", "incomplete"] as const)(
    "collapses the %s tier",
    (tier) => {
      const body = renderTriageComment(
        githubDocument([githubResult("example-other", tier)]),
      );
      expect(body).toMatch(
        /<details>[\s\S]*<summary>no-notable-changes and incomplete packages<\/summary>[\s\S]*<\/details>/,
      );
      expect(body).toContain(`| ${tier} |`);
    },
  );
  it("summarizes all tiers and failures independently", () => {
    const body = renderTriageComment(
      githubDocument([
        githubResult(),
        githubResult("example-b", "no-notable-changes"),
        githubResult("example-c", "incomplete"),
        {
          ...githubResult("example-d"),
          outcome: "failed",
          error: "Archive unavailable.",
        },
      ]),
    );
    expect(body).toContain(
      "needs-review: 1 · no-notable-changes: 1 · incomplete: 1 · failed: 1",
    );
    expect(body).toContain("### Analysis failures");
  });
  it("renders a brief no-change result without invented analysis rows", () => {
    const body = renderTriageComment(githubDocument(), {
      notice: "no-dependency-changes",
    });
    expect(body).toContain("No dependency changes");
    expect(body).toContain(
      "needs-review: 0 · no-notable-changes: 0 · incomplete: 0",
    );
    expect(body).not.toContain("| Package");
  });
  it("caps detailed rows at maxPackages and states the omitted count", () => {
    const body = renderTriageComment(
      githubDocument([
        githubResult("example-a"),
        githubResult("example-b"),
        githubResult("example-c"),
      ]),
      { maxPackages: 1 },
    );
    expect(body).toContain(escapeCommentText("example-a"));
    expect(body).not.toContain(escapeCommentText("example-b"));
    expect(body).toContain("2 more not shown");
  });
  it("defaults to 25 detailed rows", () => {
    const body = renderTriageComment(
      githubDocument(
        Array.from({ length: 26 }, (_, index) =>
          githubResult(`example-${String(index).padStart(2, "0")}`),
        ),
      ),
    );
    expect(body.match(/\| needs-review \|/g)).toHaveLength(25);
    expect(body).toContain("1 more not shown");
  });
  it("allows zero detailed rows while preserving counts and disclaimer", () => {
    const body = renderTriageComment(githubDocument([githubResult()]), {
      maxPackages: 0,
    });
    expect(body).toContain("needs-review: 1");
    expect(body).toContain("1 more not shown");
    expect(body).toContain(TRIAGE_DISCLAIMER);
    expect(body).not.toContain("| Package");
  });
  it("caps total length, closes details, and preserves the footer", () => {
    const results = Array.from({ length: 100 }, (_, index) => {
      const item = githubResult(`example-${index}`, "incomplete");
      item.triage.reasons = Array.from({ length: 3 }, () => ({
        ...item.triage.reasons[0],
        title: "<".repeat(120),
        detail: "&".repeat(240),
        evidenceRef: "@".repeat(160),
      }));
      return item;
    });
    const body = renderTriageComment(githubDocument(results), {
      maxPackages: 100,
    });
    expect(body.length).toBeLessThan(COMMENT_LIMIT);
    expect(body).toContain(
      "Comment truncated to stay under 60,000 characters.",
    );
    expect(body).toContain("</details>");
    expect(body).toContain(TRIAGE_DISCLAIMER);
    expect(body).toContain("DependencyGuard version:");
  });
  it("includes skipped paths and reasons", () => {
    const body = renderTriageComment(
      githubDocument(
        [],
        [
          {
            name: null,
            path: "node_modules/example-git",
            reason: "non-registry resolved URL",
          },
        ],
      ),
    );
    expect(body).toContain("### Skipped entries");
    expect(body).toContain(escapeCommentText("node_modules/example-git"));
    expect(body).toContain(escapeCommentText("non-registry resolved URL"));
  });
  it("prints the fixed disclaimer exactly once even if untrusted text repeats it", () => {
    const item = githubResult();
    item.triage.reasons[0].detail = TRIAGE_DISCLAIMER;
    const body = renderTriageComment(
      githubDocument([item, githubResult("example-b")]),
    );
    expect(body.split(TRIAGE_DISCLAIMER)).toHaveLength(2);
  });
  it("includes an escaped tool version", () => {
    expect(
      renderTriageComment(githubDocument(), { toolVersion: "0.4.0+@test" }),
    ).toContain(`DependencyGuard version: ${escapeCommentText("0.4.0+@test")}`);
  });
  it("rejects invalid CLI JSON and inconsistent counts through Zod", () => {
    expect(() => renderTriageComment(null)).toThrow();
    expect(() =>
      renderTriageComment({
        ...githubDocument(),
        summary: { completed: 1, failed: 0, skipped: 0 },
      }),
    ).toThrow();
    expect(() =>
      renderTriageComment({
        ...githubDocument(),
        triageSummary: {
          "needs-review": 1,
          "no-notable-changes": 0,
          incomplete: 0,
        },
      }),
    ).toThrow();
  });
  it("escapes every untrusted display field and excludes verdict words and numeric scores", () => {
    const attack =
      'safe unsafe malicious clean verified @user [link](https://example.invalid) <img> `x` |\n"riskScore": 82';
    const item = githubResult(attack);
    item.from = attack;
    item.to = attack;
    item.path = attack;
    item.triage.reasons[0] = {
      ...item.triage.reasons[0],
      title: attack,
      detail: attack,
      evidenceRef: attack,
    };
    const body = renderTriageComment(
      {
        ...githubDocument(
          [item, { ...item, outcome: "failed", error: attack }],
          [{ name: attack, path: attack, reason: attack }],
        ),
        riskScore: 82,
      },
      { toolVersion: "safe@user", notAnalyzed: [item] },
    );
    const guarded = body.replace(TRIAGE_DISCLAIMER, "");
    expect(guarded).not.toMatch(
      /\b(?:safe|unsafe|malicious|clean|verified)\b/i,
    );
    expect(guarded).not.toContain("riskScore");
    expect(guarded).not.toContain("82");
    expect(body).not.toContain("@user");
    expect(body).not.toContain("<img>");
    expect(body).not.toContain("[link](");
    expect(body).toContain("&#64;user");
  });
  it("lists unanalyzed identities even when the detailed-row cap is full", () => {
    const body = renderTriageComment(githubDocument([githubResult()]), {
      maxPackages: 1,
      notAnalyzed: [githubResult("example-overflow")],
    });
    expect(body).toContain("not analyzed: 1");
    expect(body).toContain("### Not analyzed");
    expect(body).toContain(escapeCommentText("example-overflow"));
    expect(body.match(/\| needs-review \|/g)).toHaveLength(1);
  });
  it("bounds the compact unanalyzed list with an explicit omitted count", () => {
    const body = renderTriageComment(githubDocument(), {
      notAnalyzed: Array.from({ length: 1000 }, () =>
        githubResult("@".repeat(180)),
      ),
    });
    expect(body.length).toBeLessThan(COMMENT_LIMIT);
    expect(body).toContain("more not shown in the not-analyzed list.");
    expect(body).toContain("Comment truncated");
  });
  it("does not mutate inputs and orders rows deterministically", () => {
    const a = githubResult("example-a");
    const b = githubResult("example-b");
    const input = githubDocument([b, a]);
    const copy = structuredClone(input);
    const first = renderTriageComment(input);
    expect(first).toBe(renderTriageComment(githubDocument([a, b])));
    expect(input).toEqual(copy);
  });
});
