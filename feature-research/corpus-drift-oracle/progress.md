# corpus-drift-oracle — progress

Status: **shipped**, reviewed twice, both verdicts Ship.
Commits: `c2f3efb` (oracle), `d0ff8f8` (comment-rule hardening).

## What shipped

The corpus-repo-d and corpus-repo-e `CREATE TABLE` assertions in
`packages/extract/test/node.test.ts` no longer hardcode table lists. They now
compare two independent readings of the same pinned schema file: a text regex
(`tablesInDdlText` in `test/fixtures.ts`) against what the extractor reads back
out of SQLite. The corpus can add a tenth table without reddening the suite.

Guards against a vacuous pass: a hand-verified stable core, a count floor, and
`tablesDeclaredIn` throwing when the pinned file is missing or declares nothing.
`test/oracle.test.ts` covers the helpers hermetically (15 tests, runs under
`PSQ_NO_CORPUS=1`).

Test counts moved 147 -> 193 full, 92 -> 138 under `PSQ_NO_CORPUS=1`.

## Decisions worth not relitigating

- **The pin is deliberate.** `CORPUS_DDL` names one DDL file per repo rather
  than scanning the repo. A repo-wide regex would have to reimplement
  `isTestFile` and the substituted-template refusal — that is reimplementing
  the extractor, which makes the oracle circular instead of independent.
- **The floor is the original eight, not nine.** A table corpus-repo-d might later
  drop should not be encoded as a permanent requirement.
- **Comment handling is per-match, never global.** A global `--` strip eats TS
  decrements (`count--;`).
- **Test names lost their literal counts** ("all nine" / "five"). A hardcoded
  count in a test name goes stale the same way the assertions did. Deviated
  from the plan; reviewer judged it serves the plan's intent better.

## Open, deliberately not done

From the second review, all non-blocking:

1. The `//` / `/*` skip introduced a false-negative direction: a real
   `CREATE TABLE` on a line with a leading block comment (`/* v2 */ CREATE
   TABLE foo`) is now skipped. Implausible in the two pinned files today, and
   it fails loudly rather than hiding a regression. Wants a fifth bullet in the
   silent-misses list at `test/fixtures.ts:50-57`.
2. The documented silent misses are documented, not tested. Three `expect`
   lines would pin `CREATE VIRTUAL TABLE` -> none, `main.foo` -> `main`,
   `"my table"` -> `my` so the behaviour fails if the regex is ever "fixed"
   without updating the comment.
3. The count floor is logically implied by the `arrayContaining` of distinct
   names. Two legs, not three. Harmless.
4. `test/fixtures.ts` still holds four `CREATE TABLE` tokens in its own
   documentation, three suppressed by the new comment rule. Inert — nothing
   scans that file — but re-pointing a test at it would pass by luck again.

Everything under the plan's "Out of scope" heading is still hardcoded and still
drift-prone: corpus-repo-d's `tasks.properties` length 15, the relation lists, the
.NET corpus assertions, and the corpus use in `graph`/`quiz` tests.

## Unrelated finds, for whoever picks this up

- **M5, M6 and M7 are all not started**, despite `README.md:34-36`. M5's only
  groundwork is `packages/extract/src/node/routes.ts` (complete, tested); no
  React reader, no component entity kind, no cross-layer edge exists. M6: the
  only "STE" in the repo is the README row itself. M7: `apps/cli/src/index.ts`
  has five cases and `export` is not one.
- **The 3D city is shipped and tracked nowhere.** `packages/graph/src/layout3d.ts`
  plus the `scene3d`/`webgl`/`EntityCity` renderer, done through phase 2a;
  `apps/web/src/lib/scene3d.ts:12` flags hardcoded colours awaiting 2b.
- **`CLAUDE.md` rule 8 references `psq export` as if it exists.** It does not.
  `README.md:17` likewise promises a domain brief with no implementation.
