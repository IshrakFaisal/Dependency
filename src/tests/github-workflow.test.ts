import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { z } from "zod";

// ESLint already installs js-yaml. Use its real parser only in this test;
// the workflow and production code introduce no new package dependency.
const { load } = createRequire(import.meta.url)("js-yaml") as {
  load(source: string): unknown;
};
const source = readFileSync(
  new URL("../../.github/workflows/dependencyguard.yml", import.meta.url),
  "utf8",
);
const workflow = z
  .object({
    on: z.record(z.string(), z.unknown()),
    permissions: z.record(z.string(), z.string()),
    concurrency: z.object({
      group: z.string(),
      "cancel-in-progress": z.boolean(),
    }),
    jobs: z.object({
      triage: z.object({
        env: z.record(z.string(), z.string()),
        steps: z.array(
          z.object({
            name: z.string(),
            uses: z.string().optional(),
            if: z.string().optional(),
            with: z.record(z.string(), z.unknown()).optional(),
            env: z.record(z.string(), z.string()).optional(),
            run: z.string().optional(),
          }),
        ),
      }),
    }),
  })
  .parse(load(source));

describe("DependencyGuard workflow YAML structure", () => {
  it("triggers only on lockfile pull requests", () => {
    expect(workflow.on).toEqual({
      pull_request: { paths: ["package-lock.json"] },
    });
    expect(source).not.toContain("pull_request_target");
  });
  it("has exactly the requested token permissions", () => {
    expect(workflow.permissions).toEqual({
      contents: "read",
      "pull-requests": "write",
    });
  });
  it("uses the existing Node pin and full-history checkouts", () => {
    const setup = workflow.jobs.triage.steps.find((step) =>
      step.uses?.startsWith("actions/setup-node@"),
    );
    expect(setup?.with?.["node-version-file"]).toBe(".node-version");
    expect(
      readFileSync(
        new URL("../../.node-version", import.meta.url),
        "utf8",
      ).trim(),
    ).toBe("24.19.0");
    const checkouts = workflow.jobs.triage.steps.filter((step) =>
      step.uses?.startsWith("actions/checkout@"),
    );
    expect(checkouts).toHaveLength(2);
    expect(
      checkouts.every(
        (step) =>
          step.with?.["fetch-depth"] === 0 &&
          step.with?.["persist-credentials"] === false,
      ),
    ).toBe(true);
    expect(checkouts[0].with?.ref).toBe(
      "${{ github.event.pull_request.base.sha }}",
    );
    expect(checkouts[1].with?.path).toBe(".dependencyguard/pr");
    const install = workflow.jobs.triage.steps.find(
      (step) => step.name === "Install base revision tools",
    );
    expect(install?.run).toContain("npm ci --ignore-scripts");
  });
  it("has an explicit fork summary step without a comment token", () => {
    const fork = workflow.jobs.triage.steps.find(
      (step) => step.name === "Analyze fork pull request (summary only)",
    );
    expect(fork?.if).toBe(
      "github.event.pull_request.head.repo.full_name != github.repository",
    );
    expect(fork?.env).toEqual({ DG_SUMMARY_ONLY: "true" });
    const comment = workflow.jobs.triage.steps.find(
      (step) => step.name === "Analyze pull request and update comment",
    );
    expect(comment?.if).toBe(
      "github.event.pull_request.head.repo.full_name == github.repository",
    );
    expect(comment?.env).toEqual({ GITHUB_TOKEN: "${{ github.token }}" });
    expect(fork?.run).toBe(comment?.run);
  });
  it("serializes each PR and leaves the fail-on threshold off by default", () => {
    expect(workflow.concurrency).toEqual({
      group: "dependencyguard-${{ github.event.pull_request.number }}",
      "cancel-in-progress": true,
    });
    expect(workflow.jobs.triage.env.DG_FAIL_ON).toBe(
      "${{ vars.DEPENDENCYGUARD_FAIL_ON || '' }}",
    );
    expect(workflow.jobs.triage.env.DG_MAX_PACKAGES).toBe(
      "${{ vars.DEPENDENCYGUARD_MAX_PACKAGES || '25' }}",
    );
  });
});
