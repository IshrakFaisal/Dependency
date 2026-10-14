# DependencyGuard

**Know what changed before you trust the update.**

Compare two npm releases, inspect new signals, and review evidence before deciding whether to trust an update. The web workflow performs real registry/archive comparison without executing package code. Phase 3 adds an optional, separate container worker for experimental import probes and a runtime evidence supplement.

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

## Phase 3: isolated import probes

The worker runs each release in a fresh container under the same immutable image and fixed `node-import-v1` profile. It imports the package entry point once, observes for 750 ms after import, and stops the child at five seconds. It captures instrumented network attempts, environment-name access, child-process attempts, and filesystem mutation calls. It never installs dependencies, runs lifecycle scripts, or invokes exported functions. ESM and CommonJS entry points resolved through Node's directory/main resolution are supported; exports-only entry configurations may not be.

The app has **no endpoint that launches containers or accepts execution commands**. An operator invokes the worker by the UUID of an already completed static analysis. The worker refetches and verifies both archive hashes before probing them. Only packages reproducible byte-for-byte as UTF-8 files, with at most 256 files / 4 MiB total content, are accepted. Unsupported files are rejected rather than silently omitted.

The container policy fixes: no external network, no host mounts or Docker socket, no inherited host environment, a read-only root filesystem, non-root user, dropped capabilities, no-new-privileges, private process/network namespaces, 32-process limit, 256 MiB memory, half a CPU, bounded temporary storage, and no automatic image pulls. The operator must use a **dedicated disposable Linux Docker host/VM without sensitive data**. Containers share a kernel with their host; this experimental runner is not a certified boundary for hostile malware. Do not substitute Node's permission model or a host process for container isolation.

Docker/Podman was not installed on the development host. The Docker adapter, schemas, comparison, persistence, and UI were tested with synthetic data and mocked Docker responses; **actual container execution remains unverified here**. Run the included container self-test before enabling real probes on a worker host.

### Worker setup

Use Node 24 and a Linux Docker engine. Select an official Node 24 Debian slim image pinned by its verified registry digest, then build the small collector image. Replace placeholders; they are deliberately not mutable image defaults.

```sh
docker build --build-arg NODE_IMAGE=node:24-bookworm-slim@sha256:<verified-digest> -t dependencyguard-probe:local sandbox
docker image inspect --format '{{.Id}}' dependencyguard-probe:local
```

Set the following in the worker's `.env.local` (or environment); the npm worker scripts read `.env.local` automatically. Use the exact local image ID returned above:

```dotenv
RUNTIME_PROBE_ENABLED=true
SANDBOX_IMAGE_ID=sha256:<64-hex-character-local-image-id>
```

```sh
npm run runtime:check
npm run runtime:selftest
npm run runtime:probe -- <completed-static-analysis-uuid>
```

The self-test uses only authored synthetic package contents inside containers. It checks normal import, four hook categories, redaction, timeouts, and cleanup. It does not fetch or execute any real npm package. A worker run is sequential and guarded by `.dependencyguard/runtime/worker.lock`. Cleanup is attempted on success, failure, timeout, and cancellation. Failed cleanup retains the lock; a hard worker crash can also leave a lock/container. Inspect `docker ps -a --filter name=dependencyguard-`, remove leftover probe containers, and only then remove the stale lock. There is no crash-proof external reaper yet.

Runtime evidence is saved atomically to `.dependencyguard/runtime/<id>.runtime.json`, capped at 512 KiB and 256 events per release. Reload `/report/<id>` to view it. `GET /api/analyses/<id>/runtime` is read-only and returns `not_run`, `invalid`, or `available`; the existing analysis feature gate applies. Report JSON exports include an attached runtime supplement. The web process does not need Docker access. On a separate worker machine, transfer the matching static job/report files to the worker and return the runtime sidecar to the app's data directory through your trusted deployment process; no remote transport is implemented.

### What the evidence means

- Runtime events are **UNVERIFIED RISK** signals from JavaScript hooks in package-controlled processes. They are not trusted kernel traces; the package can bypass, modify, or forge instrumentation.
- Intercepted network/process calls are blocked. Filesystem hooks record attempts, not confirmed writes. URL credentials, paths/query strings, command arguments, environment values, and package stdout/stderr are not exported by the collector hooks. The environment contains only synthetic canaries and minimal runtime settings.
- Comparisons group category, operation, target, and outcome; evidence IDs link each row to captured events. Differences are withheld when either run fails, times out, is unavailable/unsupported/truncated, or uses another image/profile.
- No captured events is not evidence of no behavior. Single import probes do not cover lifecycle installation, dependency code that could not load, future timers, exported functions, native binaries, or deliberate evasion.
- Stored evidence is tied to exact versions/archive hashes and validated on read. It is local, unauthenticated evidence, not cryptographic attestation. Reports remain **INCONCLUSIVE** with no numeric risk score and no AI verdict.

Isolation references: [Docker container controls](https://docs.docker.com/engine/containers/run/), [Docker engine security](https://docs.docker.com/engine/security/), and [Node permission-model limitations](https://nodejs.org/download/release/v24.19.0/docs/api/permissions.html).

## Static comparison workflow

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

Real reports use **INCONCLUSIVE**, with `riskScore: null`. Static findings are **STATIC SIGNAL**: matching source text does not establish that a code path ran. The optional runtime supplement is separate from static findings; without attached evidence it says **Not run**. AI investigation is **Not connected**. No real package is labeled malicious based on these patterns.

The scanner is deliberately limited text matching, not AST, data-flow, or reachability analysis. It can match comments or dead code and miss aliases, obfuscation, computed properties, native binaries, and indirect calls. Category findings normally use increases within a file; equal-count argument changes can be missed. Newly introduced named sensitive environment accesses are checked separately. It does not resolve transitive dependency trees or validate registry signatures/provenance. Matching a registry checksum establishes consistency with supplied metadata, not publisher trust.

Only supported JavaScript/TypeScript files are scanned, up to 256 KiB per file and 8 MiB per release. Displayed file changes, findings, and evidence are bounded; truncation and skipped content are disclosed in report coverage. An empty finding list is not a safety verdict.

## Demo mode and configuration

```dotenv
DEMO_MODE=true
STATIC_ANALYSIS_ENABLED=true
```

These two web flags default to true when absent and accept only the literal `true` to enable when set. They are independent server-only flags; restart after changing them. The separate `RUNTIME_PROBE_ENABLED` worker flag defaults to false and never enables web-triggered execution.

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
    runtime/              Probe contracts, container policy/adapter, comparison, storage
    types/                Demo/domain types and separate static report contracts
    demo/                 Deterministic synthetic fixture
    risk/                 Evidence-linked demo scoring
    config.ts             Server-only feature flags
    validation.ts         Shared Zod input schema
  tests/                  Domain, archive, registry, jobs, API, route, and UI tests
scripts/runtime-probe.ts   Operator-only TypeScript worker
sandbox/                  Pinned-image build recipe, collector/hooks, container self-test
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

Runtime unit tests mock Docker and cover fixed policy, image/configuration gates, exact-byte payloads, cleanup, malformed evidence, incomplete baselines, artifact binding, size caps, exclusive worker locks, API access, and inert rendering/export. `runtime:selftest` is a separate Docker integration check, not part of `npm test`.

The Phase 3 dependency audit led to compatible Vite/Vitest and transitive updates. Five high-severity audit entries remain in the development-only `eslint-config-next` → `braces` chain; npm's proposed automatic fix downgrades the ESLint configuration to Next 14 and was not applied. Recheck with `npm audit` as upstream fixes become available.

## Remaining work

Validate the container self-test on a Docker-enabled dedicated host before real probes. Remaining work includes hardened VM/microVM isolation, independent operating-system telemetry, signed worker evidence, a crash-proof reaper, repeatable multi-run experiments, dependency/lifecycle coverage, NVIDIA/Nemotron through Nebius, and calibrated risk scoring. AST/data-flow analysis, publisher provenance, authenticated access, a shared database/worker queue, retention controls, and deployment hardening also remain. Phase 3 does not include live AI integration or production-grade hostile-code detonation.

Protocol references: [npm registry metadata](https://github.com/npm/registry/blob/main/docs/responses/package-metadata.md), [npm registry signatures](https://docs.npmjs.com/about-registry-signatures/), and [Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting).
