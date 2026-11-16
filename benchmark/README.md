# DependencyGuard benchmark

This operator-run harness measures triage noise and known gaps. The seed corpus contains 30 historical package version pairs labeled `benign-update`. That label means only **no known incident for the selected pair in this seed corpus**: a curation assumption, not a comprehensive incident review or a package recommendation. It does not exclude vulnerabilities. Labels apply to exact pairs, not every release of a package.

The corpus includes direct native-binary packages (`@esbuild/linux-x64`, `@img/sharp-linux-x64`), install declarations and native bindings (`esbuild`, `sharp`, `@swc/core`, `better-sqlite3`, `bcrypt`), many-file libraries (`core-js`, `lodash`), bundled tools (`typescript`, `prettier`, `webpack`, `vite`), and libraries with ordinary network/environment references. Source version metadata is available at `https://registry.npmjs.org/<encoded-name>/<version>`; all 60 selected versions were found there during initial corpus preparation. Scripts are read as metadata, and no package code is installed or executed by the analyzer.

## Run

From the repository root, use the existing Node/tsx convention. `.node-version` pins 24.19.0; `engines.node` also permits the supported Node 22/24+ ranges. Dependencies must already be installed.

```sh
node --conditions=react-server --import tsx scripts/benchmark.ts --help
node --conditions=react-server --import tsx scripts/benchmark.ts
node --conditions=react-server --import tsx scripts/benchmark.ts --corpus benchmark/corpus.json --out-dir benchmark/results
node --conditions=react-server --import tsx scripts/benchmark.ts --replay benchmark/results/<timestamp>.json
```

Corpus mode uses the CLI's existing `staticAnalyzer`, awaits each pair in name/from/to order, and continues after individual acquisition or analysis failures. It requires public npm registry access. Replay requires only the saved results file; it does not load the real analyzer, contact a registry, read the corpus, retry failures, or rescan source. No runtime probe or AI provider is invoked. Vitest never starts the operator command; tests import `benchmarkMain` with fake analyzers and file I/O.

Exit codes: **0** all selected entries completed; **1** arguments, validation, input or output failure; **2** one or more package analyses failed. Tiers never determine the exit code. Synthetic-labeled corpora are accepted by the injected `measureCorpus`/`benchmarkMain` API; the default operator analyzer rejects them before any registry request. Use the fixture tests or a saved synthetic results file for offline synthetic runs.

Each run writes a new UTC timestamp-named `.json` and `.md` pair to ignored `benchmark/results/`, or `--out-dir`. Existing files are never overwritten; choose another directory if an injected clock repeats a timestamp. A Markdown write failure can leave the JSON file available for replay. Input files are limited to 128 MiB and corpora to 1,000 distinct pairs. The shipped corpus has 30 entries.

## Read the output

The JSON envelope has `schemaVersion: 1`, `toolVersion`, mode, start/end timestamps, duration in milliseconds, `entries`, and `aggregates`. Every completed entry contains its corpus metadata, validated static `report`, and freshly computed full `triage` (tier, reasons, evidence references, disclaimer). Failed entries have an error and no tier. Report fields retain `INCONCLUSIVE` and `riskScore: null`. Original report JSON values, source/evidence text, and any older triage are preserved exactly as data for replay; generated summary, triage and progress wording follows the existing presentation guard. Older stored triage is ignored when computing the separate current result. The real static analyzer does not request runtime/investigation supplements.

- `tierCounts`: completed pairs in each of the three tiers.
- `tierPercentages`: count divided by **completed pairs**, multiplied by 100 and rounded to two decimal places. Failures are excluded; if there are no completed pairs, all percentages are zero. Rounded percentages can sum to 99.99 or 100.01.
- `reasonFrequency`: number of completed pairs emitting each reason ID, counted once per ID per pair. Sorted by descending count, then ID for ties.
- `topReasons`: the first five records from that frequency table. Some finding IDs are positional within a report, so identical IDs across packages need not describe the same source change.
- `analysisFailures`: unsuccessful acquisitions/comparisons, reported separately from incomplete coverage in a completed report.

The short Markdown output includes the tier table, five leading reason IDs, failures and disclaimer. The complete reason frequency table and individual reasons are in JSON. No accuracy or detection-rate estimate is computed. When discussing a completed real corpus run, describe the review-tier percentage as a **flag rate on benign updates**, and state its completed-pair denominator and failures.

Replay validates saved reports and corpus identities, ignores stored aggregates/derived tiers, and calls current `computeTriage` rules. The same saved reports and rules yield deep-equal measurement entries and aggregates; run timestamps/durations are audit metadata and can differ. Saved metadata signals, including recency, remain fixed to the original observation. Changes to scanning or acquisition cannot be evaluated by replay. Keep the source revision with results when comparing rule changes; `toolVersion` alone may not distinguish working-tree edits.

## Inert fixtures and known gap

Eight hand-authored JSON fixtures live in `src/tests/fixtures/synthetic/`. They model added postinstall declarations, network references, environment references, dynamic-code references, publisher changes, dropped attestations, added dependencies, and an indirect call. They contain report-level records and, where relevant, source **comments only**. Tests never evaluate those strings or invoke their declarations. The source-shape tests exercise the existing lexical scanner on comments; that scanner can match comments and does not establish execution.

The indirect-call fixture is a **documented known miss**: computed member lookup plus alias invocation yields zero network matches, no reasons, and `no-notable-changes` in the isolated source-only fixture. Its test records current behavior, not successful detection. The fixture has no excluded files so coverage does not obscure the gap. Full npm packages often include non-source files and can instead receive `incomplete` for that separate reason.

Run the offline checks:

```sh
npx vitest run src/tests/benchmark.test.ts src/tests/benchmark-synthetic.test.ts
```

This small selected corpus is not representative ground truth for actual attacks. Install declarations, native binaries, bundled files, metadata variation, regex matches in comments and acquisition limits can all affect results. Current metadata requests have a 2 MiB packument cap, so popular packages with long histories may fail before source comparison. Results from only completed pairs have selection bias; keep failures and coverage reasons visible. There is no ground-truth attack corpus, no execution evidence, and no detection-rate claim.

This tier reflects only the checks listed, can miss obfuscated or indirect behavior, and is not a safety determination.
