# DependencyGuard

**Know what changed before you trust the update.**

Compare two npm releases, inspect new static signals, and review evidence before deciding whether to trust an update. Phase 2 adds real registry and archive comparison to the synthetic demo. Package code is never installed, imported, or executed by the analysis pipeline.

## Run locally

Use Node.js 24 LTS (`.node-version` pins 24.19.0), or Node.js 22.13+, and npm.

```sh
npm ci --ignore-scripts
```

Copy `.env.example` to `.env.local` (PowerShell: `Copy-Item .env.example .env.local`), then:

```sh
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). To run a production build locally:

```sh
npm run build
npm start
```

## Phase 2 workflow

Enter a public npm package name and two distinct, exact semantic versions. **Analyze Update** starts a real static analysis. For example, `is-number` versions `6.0.0` and `7.0.0` can be used to explore an ordinary release comparison; this example makes no allegation about that package.

1. Fetch and validate each exact release from `registry.npmjs.org`.
2. Download archives with bounded requests and verify the strongest supported registry integrity digest.
3. Inspect archive bytes in memory, hash files, and compare additions, removals, and modifications.
4. Compare scripts and direct dependency declarations; find textual signals for network APIs, environment access, process creation, filesystem writes, and dynamic code.
5. Save a report with linked source excerpts, line numbers, hashes, coverage, and limitations.

Progress reflects server job state. Reports and recent history survive a server restart. Failed requests show a retry action. Reports support JSON download and browser printing.

| Route                    | Purpose                                                     |
| ------------------------ | ----------------------------------------------------------- |
| `/`                      | Comparison form, recent local analyses, demo entry point    |
| `/analysis/[id]`         | Real static job progress or the synthetic walkthrough       |
| `/report/[id]`           | Stored static report or the synthetic report                |
| `POST /api/analyses`     | Validate input and create an analysis; returns `202 { id }` |
| `GET /api/analyses/[id]` | Read the current job as `{ job }`                           |

POST accepts only `{ "packageName": "is-number", "trustedVersion": "6.0.0", "candidateVersion": "7.0.0" }`. Commands, URLs, extra fields, version ranges, and dist-tags are rejected. Unknown report/job IDs return 404. Opening a report before completion returns to its progress page.

## Honest evidence and risk language

Real reports use **INCONCLUSIVE**, with `riskScore: null`. Findings are **STATIC SIGNAL**: matching source text does not establish that a code path ran. Runtime sections say **Not run**, and AI investigation is **Not connected**. No real package is labeled malicious based on these patterns.

The scanner is deliberately limited text matching, not AST, data-flow, or reachability analysis. It can match comments or dead code and miss aliases, obfuscation, computed properties, native binaries, and indirect calls. Category findings normally use increases within a file; equal-count argument changes can be missed. Newly introduced named sensitive environment accesses are checked separately. It does not resolve transitive dependency trees or validate registry signatures/provenance. Matching a registry checksum establishes consistency with supplied metadata, not publisher trust.

Only supported JavaScript/TypeScript files are scanned, up to 256 KiB per file and 8 MiB per release. Displayed file changes, findings, and evidence are bounded; truncation and skipped content are disclosed in report coverage. An empty finding list is not a safety verdict.

## Demo mode and configuration

```dotenv
DEMO_MODE=true
STATIC_ANALYSIS_ENABLED=true
```

Both flags default to true when absent and accept only the literal `true` to enable when set. They are independent server-only flags; restart after changing them.

- `STATIC_ANALYSIS_ENABLED=false` disables live submissions and access to live jobs/reports. It does not delete saved files.
- `DEMO_MODE=false` disables the demo button and synthetic routes.
- With static analysis disabled and demo enabled, the form opens the clearly labeled synthetic fixture; submitted names are never attributed its findings.
- With both disabled, submissions are unavailable.

**Try Demo** opens `/analysis/demo-example-utils`. The demo's ten deterministic stages include simulated execution; all events, source excerpts, hashes, package identities, destinations, and AI text are fictional. Destinations use `.invalid`; no environment values are read. Its twelve-section report compares `example-utils` 1.4.1 → 1.4.2 with review action **REVIEW REQUIRED**, classification **HIGH RISK**, and illustrative score **82 / 100**. Demo scores are not calibrated probabilities and never appear in real static reports.

Risk classifications are `LOW RISK`, `REVIEW RECOMMENDED`, `HIGH RISK`, and `INCONCLUSIVE`. Individual finding labels are `OBSERVED`, `NOT OBSERVED`, `STATIC SIGNAL`, and `UNVERIFIED RISK`; demo observations refer only to the fixture.

## Acquisition and operational boundaries

- HTTPS requests are restricted to the exact public `registry.npmjs.org` origin, without redirects, credentials, explicit ports, query strings, or fragments. Private/custom registries are unsupported.
- Each upstream request has a 15-second timeout. Metadata is capped at 2 MiB; archives at 10 MiB compressed, 50 MiB decompressed, and 2,000 entries.
- SHA-512/384/256 SRI is supported. A legacy SHA-1 checksum fallback is explicitly disclosed. Integrity mismatches fail the job.
- Only standard USTAR and a limited set of local PAX fields are accepted. Traversal, duplicate/conflicting paths, links, special files, ambiguous headers, and unsupported extensions are rejected. Some legitimate packages therefore cannot be analyzed yet.
- Archives remain in memory and are never extracted to the filesystem. The application has no shell execution endpoint or user-provided command facility.
- JSON submissions are bounded to 4 KiB and five seconds. Cross-origin browser submissions are rejected. Responses are not cached.
- A single server process accepts at most two active jobs and ten starts per minute. There is no waiting queue.
- Atomic JSON job/report files live in ignored `.dependencyguard/analyses/`. Each stored document is capped at 8 MiB and history at 100 analyses. Stop the server and archive older matching job/report files manually when the limit is reached. Evidence may contain public package source excerpts; no user environment is collected.

This is a **local, single-process hackathon implementation** using Next.js `after()` for work after a response. Run it on a long-lived Node server with a writable disk. Completed reports persist; interrupted jobs become failed and can be retried. Work does not automatically resume. It is not a durable distributed worker system and does not support multiple server instances, ephemeral/serverless storage, authenticated users, or tenant isolation. Use locally; add authentication and a shared queue/database before public deployment.

## Architecture

```text
src/
  app/
    api/analyses/         Create and poll static jobs
    analysis/[id]/        Mode-aware progress pages
    report/[id]/          Mode-aware evidence reports
  components/             Server report views and focused client interactions
  lib/
    analysis/             Registry transport, archive parser, comparer, jobs, storage
    types/                Demo/domain types and separate static report contracts
    demo/                 Deterministic synthetic fixture
    risk/                 Evidence-linked demo scoring
    config.ts             Server-only feature flags
    validation.ts         Shared Zod input schema
  tests/                  Domain, archive, registry, jobs, API, route, and UI tests
```

Next.js App Router, React, strict TypeScript, Tailwind CSS, a shadcn-style button primitive, Zod, Lucide icons, Vitest, ESLint, and Prettier. Registry/storage/analysis modules stay server-only. Dependencies are pinned with a lockfile; local system fonts avoid font downloads. Development and production scripts use Next.js's supported webpack mode because Turbopack's CSS worker failed on the Windows validation host.

## Quality checks

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run format:check
```

`typecheck` generates Next route types before running TypeScript. `npm run test:watch` starts interactive tests, and `npm run format` formats the project. Tests use synthetic archives and mocked registry responses; they do not depend on npm availability or run package code. Coverage includes integrity and archive attacks, request validation and resource limits, source evidence and comparison limits, persistent job transitions/restart recovery, configuration gates, and UI polling/export/error states.

## Remaining work

Isolated runtime observation, behavioral comparison, NVIDIA/Nemotron through Nebius, and calibrated real risk scoring remain unimplemented. Further work also includes AST/data-flow analysis, transitive dependencies, publisher provenance, broader archive compatibility, authenticated access, a database/worker queue, retention controls, and deployment hardening. No sandbox or live AI integration is included in Phase 2.

Protocol references: [npm registry metadata](https://github.com/npm/registry/blob/main/docs/responses/package-metadata.md), [npm registry signatures](https://docs.npmjs.com/about-registry-signatures/), and [Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting).
