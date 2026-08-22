# drift-oracle-followups — implementer audit

## Files changed

- `test/fixtures.ts`
- `test/oracle.test.ts`
- `feature-research/drift-oracle-followups/audit.md` (this file)

`feature-research/corpus-drift-oracle/progress.md` was NOT modified — see the
14-vs-15 resolution below.

## test/fixtures.ts (lines 58-67 inserted)

Fifth bullet appended to the silent-misses block (lines 58-62), matching the
existing `//`-at-column-0 style and two-space bullet indent:

```
//   - a real declaration sharing a line with a leading `//`, `/*` or `--`,
//     or on a line whose first non-space character is `*`, is skipped
//     (`/* v2 */ CREATE TABLE foo`) -> no match; unlike the four above,
//     this direction fails loudly (the table goes missing and the corpus
//     assertion reddens) rather than hiding a regression -- do not "fix" it
```

Self-contamination warning (lines 63-67, item 4's "one comment, not a rewrite"):

```
//
// This file's own prose contains `CREATE TABLE` tokens (the bullets above,
// plus one unsuppressed token in an error message below that matches nothing
// only because a backtick follows `TABLE` directly -- an accident, not a
// guarantee). Never point the oracle at this file.
```

Every `CREATE TABLE` token introduced is on a `//` line, so the existing
comment-skip rule suppresses it. Verified indirectly: the oracle suite still
passes and `tablesDeclaredIn`'s temp-file tests are unaffected.

## test/oracle.test.ts (lines 79-103 inserted)

Five characterization tests appended to `describe("tablesInDdlText", ...)`,
after the "sorts the result" test. Each carries a one-line (or, for the fifth,
two-line) comment marking it as pinning documented-known-wrong behaviour so
the fix is bullet+test together, never test deletion. All verified against the
real regex before writing (a node one-liner reproduced each expected value):

1. `misses a CREATE VIRTUAL TABLE entirely` — `CREATE VIRTUAL TABLE fts USING fts5(content)` -> `[]` (bullet 1).
2. `captures the schema qualifier instead of the table name` — `CREATE TABLE main.foo (id)` -> `["main"]` (bullet 2).
3. `truncates a quoted name at its first space` — `CREATE TABLE "my table" (id)` -> `["my"]` (bullet 3).
4. `truncates a non-ASCII identifier at the first non-word character` — `CREATE TABLE café (id)` (written as the escape `caf\u00e9` in source) -> `["caf"]` (bullet 4).
5. `skips a real declaration that shares a line with a comment opener` — `/* v2 */ CREATE TABLE foo (id)` -> `[]` (the new fifth bullet; comment names the loud-failure direction explicitly).

## Item 3 (count floor)

Decision only, per plan. No code change made; the `arrayContaining` + length
floor stays as-is.

## Test results (real runs, node v24.19.0 via fnm)

| Run | Before | After |
|---|---|---|
| `npx vitest run` | 193 passed (13 files) | 198 passed (13 files) |
| `PSQ_NO_CORPUS=1 npx vitest run` | 138 passed, 55 skipped | 143 passed, 55 skipped |
| `pnpm typecheck` | — | exit 0 (root tsc, e2e tsc, @psq/web, @psq/desktop all clean) |

Both counts match the plan's expectations exactly (193 -> 198, 138 -> 143).

## 14 vs 15 resolution

The pre-change `test/oracle.test.ts` contains **15** `it(` blocks: 13 in
`describe("tablesInDdlText")` and 2 in `describe("tablesDeclaredIn")`
(verified by grep listing every occurrence). progress.md's claim of 15 is
correct; the scout's count of 14 was wrong. Per the plan ("If it is 14,
correct progress.md"), no correction was needed and
`feature-research/corpus-drift-oracle/progress.md` was left untouched.

## Deviations from the plan

- The fifth bullet extends the plan's quoted three-line text with two extra
  lines stating the loud-failure property. The plan requires this ("the
  bullet must say so, so a future reader does not 'fix' it") but its quoted
  snippet omitted it; the prose requirement won.
- Arrow alignment: the new bullet's `-> no match` sits mid-sentence rather
  than column-aligned with the first three bullets, because the fifth bullet
  is multi-line prose (as bullet 4 already is) and padding it to the shared
  column was not possible without breaking the sentence.
- Em-dash style: used `--` in the new comments to stay ASCII, matching the
  arrows' plain-ASCII style; existing file uses no em-dashes to compare
  against.
- Non-ASCII test writes the identifier as the escape `caf\u00e9` in the string literal
  rather than a raw `é`, so the file itself stays ASCII while the runtime
  input is genuinely non-ASCII. Same behaviour, verified passing.

## Open risks

None known. Change is test-only; no source files, no `packages/extract/`
files touched. Not committed — left in the working tree for review.
