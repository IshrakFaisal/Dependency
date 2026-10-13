# DependencyGuard

**Know what changed before you trust the update.**

A polished, demo-only foundation for a software supply-chain security tool. Compare a trusted npm release with a candidate release, follow a simulated analysis, and investigate an evidence-linked report.

## Run locally

Use Node.js 24 LTS (recommended; `.node-version` pins 24.19.0) or Node.js 22.13+ and npm. Odd-numbered Node 23 is outside the supported test/lint toolchain.

```sh
npm ci --ignore-scripts
```

Copy `.env.example` to `.env.local` (PowerShell: `Copy-Item .env.example .env.local`), then:

```sh
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The demo is also enabled by default if no environment file is present.

Production:

```sh
npm run build
npm start
```

## Routes and interactions

| Route                          | Purpose                                                                           |
| ------------------------------ | --------------------------------------------------------------------------------- |
| `/`                            | Package comparison, validation, workflow explanation, demo entry points           |
| `/analysis/demo-example-utils` | Ten deterministic stages, pause/resume, replay, and report navigation             |
| `/report/demo-example-utils`   | Twelve-section evidence report, section navigation, JSON export, browser printing |

The dynamic route patterns are `/analysis/[id]` and `/report/[id]`. Unrecognized IDs return a proper not-found page. Reports work on direct navigation and reload; there is no client-storage requirement.

**Analyze Update** validates a lowercase npm package name and two distinct, exact semantic versions with Zod. Version ranges, dist-tags, and commands are rejected. All valid submissions open the same explicitly labeled `example-utils` fixture. Input values are never attributed synthetic findings, submitted to a registry, stored, or executed. **Try Demo** bypasses the form and opens the same walkthrough. Progress completes deterministically after ten 900 ms stages; the user chooses when to open the report. Reloading restarts the walkthrough.

## Demo boundaries

```dotenv
DEMO_MODE=true
```

- This phase contains only a synthetic application foundation. No npm metadata is fetched, no releases are downloaded, and no package code runs.
- All package names, publishers, source snippets, traces, hashes, and findings in the fixture are fictional. Outbound destinations use reserved `.invalid` domains. Environment-variable values are invented and redacted; the user's environment is never inspected.
- The app has no shell execution endpoints, user-provided command facility, background worker, sandbox, database, or live AI integration.
- The “AI investigation summary” is authored demo text. No NVIDIA, Nemotron, Nebius, or other model is called.
- Setting `DEMO_MODE=false` disables the form and demo routes. It **does not enable real analysis**. Restart the app after changing environment variables. The environment flag is read only in a `server-only` module, and pages render dynamically to honor it at server startup.
- Dependency installation/build tools are developer tooling; they do not implement package-under-analysis execution. Installation uses `--ignore-scripts` to avoid dependency lifecycle scripts.
- “OBSERVED” means present in the **synthetic fixture**, not observed on the user's machine. A score or signal does not prove malicious intent.

## Report and scoring

The demo compares `example-utils` **1.4.1 → 1.4.2** with action **REVIEW REQUIRED** and risk classification **HIGH RISK**, score **82 / 100**. Review action is separate from risk status.

The report includes executive summary, version comparison, static changes, behavioral diff, network activity, environment-variable access, process execution, filesystem changes, dependency changes, evidence, AI investigation summary, and risk score explanation.

| Behavior            | Trusted | Candidate |
| ------------------- | ------: | --------: |
| Network requests    |       0 |         2 |
| Child processes     |       0 |         1 |
| Sensitive env reads |       0 |         3 |
| Filesystem writes   |       2 |         7 |
| New dependencies    |       0 |         1 |

Five evidence-linked demo weights contribute 25 + 22 + 18 + 9 + 8 points. This is an illustrative heuristic, **not a calibrated probability of maliciousness**. Scores are clamped to 0–100. Risk statuses are `LOW RISK` (0–24), `REVIEW RECOMMENDED` (25–59), `HIGH RISK` (60–100), and `INCONCLUSIVE` when evidence is insufficient. Finding statuses are `OBSERVED`, `NOT OBSERVED`, `STATIC SIGNAL`, and `UNVERIFIED RISK`.

## Architecture

```text
src/
  app/                    App Router pages, metadata, error states, global styles
    analysis/[id]/        Demo progress route
    report/[id]/          Evidence report route
  components/             Page UI and narrowly scoped interactive components
    ui/                   shadcn-style Button (Radix Slot + CVA)
  lib/
    config.ts             Server-only environment gate
    validation.ts         Zod comparison schema
    utils.ts              Classname composition
    types/                Strong report, event, metadata, and finding types
    demo/                 Deterministic synthetic report and stage definitions
    risk/                 Pure evidence-linked scoring
  tests/                  Vitest domain and interaction tests
```

Next.js App Router and React with strict TypeScript, Tailwind CSS v4, a shadcn-style button primitive, Zod, Lucide icons, ESLint, Prettier, and Vitest. Dependencies are pinned and an npm lockfile is included. The UI uses local system fonts with no runtime font download. Route components and reports remain server-rendered; the comparison form, progress replay, navigation state, and export/print actions are client components. The server-only environment module cannot be imported by client components.

The interface includes responsive layouts, labels and field errors, keyboard focus treatment, a skip link, semantic tables, progress announcements, reduced-motion styles, and print styles. JSON export includes demo provenance and limitations.

## Quality checks

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run format:check
```

`typecheck` generates Next.js route types before checking TypeScript. `npm run test:watch` runs Vitest interactively; `npm run format` formats source files.

Domain tests cover input validation and command rejection, risk boundaries and evidence requirements, score clamping and duplicate rejection, reserved destinations, fixture count consistency, evidence integrity, and deterministic independent fixture copies. UI tests cover form navigation and errors, disabled mode, timed progress controls, and JSON export. Route tests cover recognized and unknown IDs, disabled mode, and invalid configuration values.

## Remaining work — outside this phase

Future work requires separate design and authorization: npm registry metadata and archive acquisition, safe archive extraction and static analysis, durable analysis jobs and storage, isolated runtime observation, reliable behavioral comparison, NVIDIA/Nemotron reasoning through Nebius, and evidence-backed real-world scoring. Authentication, operational limits, deployment, and broader accessibility/browser testing would also be needed before a production launch.

**Phase 2 has not been started.**
