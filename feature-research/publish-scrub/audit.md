# Publish scrub — implementation audit

Note on vocabulary: this audit is itself committed, so it never spells the
eight scrubbed terms. They are, indirectly: the kebab-case repo name and the
PascalCase namespace form of corpus repo A (terms 1–2), the repo names of
corpus repos D, E, C and B (terms 3–6), corpus repo B's namespace form
(term 7), and the developer's home-directory prefix (term 8). The literal
list lives only in the gitignored `test/corpus.local.json` and in the
replacement file in the session scratchpad, both outside the committed tree.

## Files changed

Created:
- `LICENSE`
- `test/corpus.local.example.json`
- `test/corpus.local.json` (gitignored — never committed)
- `feature-research/publish-scrub/audit.md` (this file)

Modified:
- `.gitignore`
- `README.md`
- `test/fixtures.ts`
- `test/fixtures/mini-node/base.ts`
- `test/fixtures/mini-node/db.ts`
- `test/fixtures/mini-node/schema.ts`
- `test/fixtures/mini-node/types.ts`
- `packages/extract/test/node.test.ts`
- `packages/extract/test/dotnet.test.ts`
- `packages/extract/test/fluent.test.ts`
- `packages/extract/test/structure.test.ts`
- `packages/graph/test/graph.test.ts`
- `packages/quiz/test/quiz.test.ts`
- `apps/server/test/api.test.ts`
- `packages/extract/src/dotnet.ts`
- `packages/extract/src/csharp/lex.ts`
- `packages/extract/src/csharp/fluent.ts`
- `packages/extract/src/csharp/shapes.ts`
- `packages/extract/src/node/ddl.ts`
- `packages/extract/src/node/routes.ts`
- `packages/extract/src/node/shapes.ts`
- `packages/schema/src/index.ts`
- `packages/graph/src/layout.ts`
- `packages/quiz/src/normalize.ts`
- `apps/server/src/index.ts`
- `pnpm-workspace.yaml`
- `feature-research/corpus-drift-oracle/plan.md`
- `feature-research/corpus-drift-oracle/audit.md`
- `feature-research/corpus-drift-oracle/progress.md`
- `feature-research/drift-oracle-followups/plan.md`
- `feature-research/drift-oracle-followups/progress.md`
- `feature-research/m5a-client-calls/plan.md`
- `feature-research/m5a-client-calls/audit.md`
- `feature-research/m5a-client-calls/progress.md`
- `feature-research/oracle-block-comment-miss/audit.md`
- `feature-research/publish-scrub/plan.md` (redacted — it listed the terms verbatim)

Plus the history rewrite, which touched every historical commit.

## What moved where

### Corpus configuration → `test/corpus.local.json` (gitignored)

`test/fixtures.ts` no longer contains any corpus path. It now exports
`corpusRepo(key)` / `corpusDdl(repo)` over a JSON file read at test time,
with typed interfaces (`CorpusRepo`, `CorpusNodeExpect`, `CorpusDotnetExpect`,
`CorpusStructureExpect`, `CorpusFluentExpect`, `CorpusGraphExpect`,
`CorpusQuizExpect`). Keys are neutral: `repoA` (C# + React, flat fluent
style), `repoB` (C#, nested fluent style), `repoC` (TS, schemaless),
`repoD` (TS, inline DDL), `repoE` (TS, constant-bound DDL) — the same
letters the redacted docs use. `corpusRepo` returns null when the config,
the entry, or the repo on disk is absent, or under `PSQ_NO_CORPUS=1`; the
old `hasCorpus`/`CORPUS`/`CORPUS_DDL` exports are gone.

Every ground-truth literal read from a private repo moved into the JSON
`expect` blocks: table names, table/property/relation counts, relation ids,
warning strings, entity/shape/field names, namespaces, repo-internal file
paths, route counts and route paths. The six corpus test files
(`node`, `dotnet`, `fluent`, `structure` in packages/extract, plus
`graph` and `quiz`) keep their exact describe/it structure and consume the
config; no committed test names anything from a private repo.
`test/corpus.local.example.json` documents the full shape with obviously
fake values (verified key-for-key identical in structure to the real file).

### Absolute path in `apps/server/test/api.test.ts`

The home-directory literal at :49 is now
`resolve(fileURLToPath(import.meta.url), "../../../../packages")`.

### Prose (src comments, README, feature-research)

Repo names replaced by "corpus repo A"…"corpus repo E" with the behaviour
that made them worth citing kept (flat vs nested fluent config, inline vs
constant-bound DDL, the WebSocket-only client, the 9-level-deep namespace,
the schemaless negative fixture). Private endpoints, service-module paths
with line numbers, table lists and shape names in the docs were replaced by
neutral descriptions ("a service module three hops from the component",
"its eight hand-verified stable table names", "a login POST", …). The
technical lessons — the 3-hop finding, the oracle's known-miss catalogue,
why no corpus repo can exercise M5a, the drift-oracle reasoning — survive
intact. The example namespace in `packages/quiz/src/normalize.ts` is now a
fictional `Acme.Api...`. The port-allocation comment in
`apps/server/src/index.ts` no longer names the neighbouring services.
`README.md` gained the corpus-config instructions in its testing section.

## Deviations from the plan

1. **Vitest executes skipped describe bodies during collection**, so
   describe-scope code in the corpus tests takes `?? {}` / `?? NOT_A_PROJECT`
   fallbacks instead of non-null assertions. Behaviourally identical to the
   old code (which relied on `extractNode`/`extractDotnet` tolerating a
   missing path); without it the no-corpus run failed at collection.
2. The plural/singular quiz test originally round-tripped `singular` on one
   hand-picked pair only; a first data-driven draft round-tripped every pair
   and failed (the corpus grammar rule is not invertible for every word).
   Restored the original semantics: `plural` over every configured pair,
   `singular` over the first.
3. `--replace-message` was added alongside `--replace-text`: one historical
   commit subject named a corpus repo, and content-level replacement alone
   does not touch commit messages. Same replacement file for both.
4. `feature-research/publish-scrub/plan.md` was itself redacted before
   committing — it spelled all eight terms verbatim, and the tree-level grep
   gate covers it.
5. LICENSE copyright holder is "James Finnerty" per the mid-task correction
   (the original instruction's surname was wrong). The wrong surname was
   never written to any file or commit — the correction arrived before
   LICENSE was created — so no intermediate commit ever carried it.
6. `git-filter-repo` came from Homebrew; `pip3 install --user` is blocked by
   PEP 668 on this machine.

## Gates

All run with Node v24.19.0 (fnm), corpus config present, before the history
rewrite and re-verified after it:

- `pnpm typecheck` — green (root, e2e, web, desktop).
- `pnpm test` — **Test Files 14 passed (14), Tests 211 passed (211)**.
  The corpus-on count matches the pre-scrub 211 exactly: the corpus tests
  still run, the ground truth moved rather than vanished.
- `PSQ_NO_CORPUS=1 pnpm test` — Tests 156 passed | 55 skipped (211).
- `pnpm test:e2e` — Tests 19 passed (19).

Skip-path check (what a stranger's clone experiences): with
`test/corpus.local.json` moved aside and no env var set —
Tests 156 passed | 55 skipped (211), zero failures. File restored, corpus-on
run re-verified at 211 passed.

## History rewrite

`git filter-repo --force --replace-text <file> --replace-message <file>`
over the single local clone (verified beforehand: private, no forks, no
stars, no PRs, no other clone). The replacement file lives in the session
scratchpad, not in the repo; its rules are case-insensitive regexes mapping
each private repo's name forms to `corpus-repo-a`…`corpus-repo-e` and the
home prefix to `~`. 26 commits rewritten; `git log --oneline` reads
sensibly (e.g. the old expectation-fix commit now says "fix stale
corpus-repo-d corpus expectation"). Exactly one ref remains
(`refs/heads/master` @ f977435), no stash, no refs/original. filter-repo
removed `origin` by design; it was re-added as
`git@github.com:Jamfin92/domain-expert.git`. **Nothing was pushed** and
repository visibility was not touched.

## Per-term grep results

Case-insensitive, run after the rewrite. "History" is over the full
`git log --all -p` output (patches and messages); "tree" is every file
outside `.git/` and `node_modules/`, excluding only the gitignored
`test/corpus.local.json`, which deliberately holds the real values and
never leaves this machine.

| term | history hits | tree hits |
|---|---|---|
| 1 — repo A kebab name | 0 | 0 |
| 2 — repo A PascalCase namespace | 0 | 0 |
| 3 — repo D name | 0 | 0 |
| 4 — repo E name | 0 | 0 |
| 5 — repo C name | 0 | 0 |
| 6 — repo B repo name | 0 | 0 |
| 7 — repo B namespace | 0 | 0 |
| 8 — home-directory prefix | 0 | 0 |

The raw command output (with the literal terms) is in the implementer's
final report to the orchestrator, not here.

## Open risks

- The gitignored `test/corpus.local.json` is the only copy of the moved
  ground truth. Losing it means re-deriving the expectations from the
  private repos (all still possible — nothing was destroyed at the source).
- The example config's fake values do not satisfy the extractor; a stranger
  filling it in must supply repos matching the documented shape, and the
  tests will fail (not skip) on a config whose expectations are wrong —
  which is the intended behaviour.
- Anyone holding the old commit hashes cannot fetch them from anywhere
  (single clone, rewritten), but the old pack is gone only locally;
  nothing was ever pushed with the old history to any host other than
  `origin`, which still holds the PRE-rewrite history until the
  orchestrator pushes. Publishing without the force-push would re-expose
  the old commits — the push (after verification) must replace the remote
  history before visibility changes.
