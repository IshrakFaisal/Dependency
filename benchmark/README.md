# DependencyGuard benchmark

This operator-run harness measures triage noise and known gaps. The corpus contains 60 historical package version pairs labeled `benign-update`: the original 30 records remain unchanged, followed by 30 additional pairs for manual audit. That label means only **no known incident for the selected pair in this seed corpus**: a curation assumption, not a comprehensive incident review or a package recommendation. It does not exclude vulnerabilities. Labels apply to exact pairs, not every release of a package.

The corpus includes direct native-binary packages (`@esbuild/linux-x64`, `@img/sharp-linux-x64`), install declarations and native bindings (`esbuild`, `sharp`, `@swc/core`, `better-sqlite3`, `bcrypt`), many-file libraries (`core-js`, `lodash`), bundled tools (`typescript`, `prettier`, `webpack`, `vite`), and libraries with ordinary network/environment references. Source version metadata is available at `https://registry.npmjs.org/<encoded-name>/<version>`. The original 60 version selections were found there during initial preparation; all 60 version selections for the added pairs were also checked, including install hooks in both releases of each of the six install-cohort pairs. Scripts are read as metadata, and no package code is installed or executed by the analyzer.

The new selection groups are eight minor updates, six major updates, six install-script package pairs, and ten small utility package pairs. These are selection groups, not disjoint update types: the install group adds six more minor updates; the small-utility group adds two minor and eight patch updates. Small utilities were chosen for narrow package scope, not a measured popularity ranking. The install group is `esbuild`, `sharp`, `@swc/core`, `better-sqlite3`, `bcrypt`, and `puppeteer`; the small-utility group is `tiny-invariant`, `klona`, `mitt`, `picocolors`, `ufo`, `ohash`, `pathe`, `defu`, `destr`, and `dlv`.

| Cohort   | Patch | Minor | Major | Total |
| -------- | ----: | ----: | ----: | ----: |
| Original |    26 |     4 |     0 |    30 |
| Added    |     8 |    16 |     6 |    30 |
| All      |    34 |    20 |     6 |    60 |

## Run

From the repository root, use the existing Node/tsx convention. `.node-version` pins 24.19.0; `engines.node` also permits the supported Node 22/24+ ranges. Dependencies must already be installed.

```sh
node --conditions=react-server --import tsx scripts/benchmark.ts --help
node --conditions=react-server --import tsx scripts/benchmark.ts
node --conditions=react-server --import tsx scripts/benchmark.ts --corpus benchmark/corpus.json --out-dir benchmark/results
node --conditions=react-server --import tsx scripts/benchmark.ts --replay benchmark/results/<timestamp>.json
node --conditions=react-server --import tsx scripts/benchmark.ts --audit benchmark/results/<timestamp>.json
```

Corpus mode uses the CLI's existing `staticAnalyzer`, awaits each pair in name/from/to order, and continues after individual acquisition or analysis failures. It requires public npm registry access. Replay requires only the saved results file; it does not load the real analyzer, contact a registry, read the corpus, retry failures, or rescan source. No runtime probe or AI provider is invoked. Vitest never starts the operator command; tests import `benchmarkMain` with fake analyzers and file I/O.

Exit codes for corpus/replay: **0** all selected entries completed; **1** arguments, validation, input or output failure; **2** one or more package analyses failed. Audit returns **0** when its Markdown was written, even when the saved run contains failed acquisitions; those are counted as omitted and have no review entry. Audit returns **1** for argument, validation or file errors. Tiers never determine the exit code. Synthetic-labeled corpora are accepted by the injected `measureCorpus`/`benchmarkMain` API; the default operator analyzer rejects them before any registry request. Use the fixture tests or a saved synthetic results file for offline synthetic runs.

Each corpus/replay run writes a new UTC timestamp-named `.json` and `.md` pair to ignored `benchmark/results/`, or `--out-dir`. Existing files are never overwritten; choose another directory if an injected clock repeats a timestamp. A Markdown write failure can leave the JSON file available for replay. Input files are limited to 128 MiB and corpora to 1,000 distinct pairs. The shipped corpus has 60 entries.

## Read the output

The JSON envelope has `schemaVersion: 1`, `toolVersion`, mode, start/end timestamps, duration in milliseconds, `entries`, and `aggregates`. Every completed entry contains its corpus metadata, validated static `report`, and freshly computed full `triage` (tier, reasons, evidence references, disclaimer). Failed entries have an error and no tier. Report fields retain `INCONCLUSIVE` and `riskScore: null`. Original report JSON values, source/evidence text, and any older triage are preserved exactly as data for replay; generated summary, triage and progress wording follows the existing presentation guard. Older stored triage is ignored when computing the separate current result. The real static analyzer does not request runtime/investigation supplements.

- `tierCounts`: completed pairs in each of the three tiers.
- `tierPercentages`: count divided by **completed pairs**, multiplied by 100 and rounded to two decimal places. Failures are excluded; if there are no completed pairs, all percentages are zero. Rounded percentages can sum to 99.99 or 100.01.
- `reasonFrequency`: number of completed pairs emitting each reason ID, counted once per ID per pair. Sorted by descending count, then ID for ties.
- `topReasons`: the first five records from that frequency table. Some finding IDs are positional within a report, so identical IDs across packages need not describe the same source change.
- `analysisFailures`: unsuccessful acquisitions/comparisons, reported separately from incomplete coverage in a completed report.

The short Markdown output includes the tier table, five leading reason IDs, failures and disclaimer. The complete reason frequency table and individual reasons are in JSON. No accuracy or detection-rate estimate is computed. When discussing a completed real corpus run, describe the review-tier percentage as a **flag rate on benign updates**, and state its completed-pair denominator and failures.

Replay validates saved reports and corpus identities, ignores stored aggregates/derived tiers, and calls current `computeTriage` rules. The same saved reports and rules yield deep-equal measurement entries and aggregates; run timestamps/durations are audit metadata and can differ. Saved metadata signals, including recency, remain fixed to the original observation. Changes to scanning or acquisition cannot be evaluated by replay. Keep the source revision with results when comparing rule changes; `toolVersion` alone may not distinguish working-tree edits.

New reports include `coverage.skipBreakdown`, separating non-source exclusions from unavailable, oversized, or budget-excluded source files. Replay uses those counts to emit informational `scan-skipped-nonsource` without triggering `incomplete`. Source exclusions and truncation remain incomplete-triggering. Older saved reports with nonzero skipped totals and no consistent breakdown retain conservative legacy triage: JSON `replayLimitations` and a Markdown section list each pair requiring reacquisition. Replay does not guess file kinds from prose or retry those pairs. Reports with zero skipped files need no additional classification. Ordinary reason IDs appear as readable Markdown code spans; unexpected punctuation uses the existing escaped renderer.

## Offline audit and manual labels

`--audit <results.json>` reads the full saved benchmark result and writes `benchmark/results/<input-basename>-audit.md`, or the same name beneath `--out-dir`. It emits the Markdown on stdout and the destination on stderr. `--audit`, `--replay`, and `--corpus` are mutually exclusive. Existing audit files are never overwritten; choose another output directory to regenerate one. Audit does not import an analyzer, access the network, rescan source, write new report JSON, or change the input file. Its filename and content do not depend on a clock.

The audit includes exactly completed pairs with saved tier `needs-review` or `incomplete`, ordered by name/from/to. It preserves the saved tier and reasons rather than reclassifying them. To audit current rules on older results, run `--replay` first and then audit that new results file. Full reports and valid saved triage are required; a triage-only summary lacks the evidence needed for this mode.

Each reason includes its ID and evidence reference. Direct static finding reasons show linked file paths, old/new line numbers, and old/new excerpts, limited to 200 characters including a truncation marker before escaping. Aggregate reasons show category totals and every retained evidence entry linked through findings in that category, with **Source location: not attributable to a single finding**. Category evidence is context and does not prove which location caused a count increase. Missing lines, excerpts and linked records are stated explicitly. Coverage and metadata reasons retain their explanations and references without inventing source locations.

Path hints mark test, docs, example, and build-output locations using path spelling only. They never affect tiers and can misclassify paths. Every untrusted name, ID, explanation, path and excerpt uses the existing escaped text renderer, including mention/link suppression and the presentation wording guard. Original evidence remains intact in the input JSON. Reports continue to contain `INCONCLUSIVE` and `riskScore: null`.

Every entry ends with an unfilled `Reviewer label: ____`. A human should review the cited change and record one of:

- **true signal**: the evidence supports a security-relevant change worth investigating; this does not establish intent or execution.
- **noise**: the flag has an ordinary explanation or is not supported as a relevant change by the retained evidence.
- **unclear**: coverage, attribution, or context is insufficient to decide.

Add a short rationale and the reason/evidence IDs beside the label. Mixed reasons can receive individual notes; use `unclear` when a single pair-level label would hide disagreement. Keep incomplete-coverage reviews separate from review-tier flag judgments, retain unclear counts, and report the labeled denominator. Human labels can measure **precision of flags on this corpus only**, not detection. The tool assigns no labels and calculates no precision estimate. Keep acquisitions that failed visible in the benchmark summary, and compare the original and added cohorts separately.

## Inert fixtures and known gap

Eight hand-authored JSON fixtures live in `src/tests/fixtures/synthetic/`. They model added postinstall declarations, network references, environment references, dynamic-code references, publisher changes, dropped attestations, added dependencies, and an indirect call. They contain report-level records and, where relevant, source **comments only**. Tests never evaluate those strings or invoke their declarations. The source-shape tests exercise the existing lexical scanner on comments; that scanner can match comments and does not establish execution.

The indirect-call fixture is a **documented known miss**: computed member lookup plus alias invocation yields zero network matches, no reasons, and `no-notable-changes` in the isolated source-only fixture. Its test records current behavior, not successful detection. The fixture has no excluded files so coverage does not obscure the gap. Non-source exclusions are informational; source exclusions or truncation can independently produce `incomplete`.

Run the offline checks:

```sh
npx vitest run src/tests/benchmark.test.ts src/tests/benchmark-synthetic.test.ts src/tests/benchmark-audit.test.ts
```

This small selected corpus is not representative ground truth for actual attacks. Install declarations, native binaries, bundled files, metadata variation, regex matches in comments and acquisition limits can all affect results. Metadata comparison uses per-version manifests with a hard 2 MiB response cap. The full packument is optional and used only for publication time under that same cap; unavailable time emits informational `recent-release` with detail `metadata unavailable`. Genuine release/archive acquisition failures remain failures, including the unchanged 2,000-entry archive limit encountered by `core-js` in this corpus. Results from only completed pairs have selection bias; keep failures and coverage reasons visible. There is no ground-truth attack corpus, no execution evidence, and no detection-rate claim.

This tier reflects only the checks listed, can miss obfuscated or indirect behavior, and is not a safety determination.
