# Audit — oracle-block-comment-miss

## Files changed

- `test/fixtures.ts` — modified
- `test/oracle.test.ts` — modified
- `feature-research/oracle-block-comment-miss/audit.md` — new (this file)

Nothing else was created or modified. `tablesInDdlText` itself is untouched —
`git diff` shows only comment-prose changes in `fixtures.ts` and only added
tests/assertions plus comment changes in `oracle.test.ts`.

## What changed per file

### test/fixtures.ts

- The known-misses bullet list (now `:54-64`) is seven bullets:
  - Old bullet 5 was **split into two bullets** (see Deviations): one for the
    shared-line comment-marker guard (`//`, `/*`, `--` anywhere earlier on the
    line), one for the leading-`*` JSDoc-continuation guard. This also delivers
    plan step 5's wording fix: the word "leading" is gone, and the broader rule
    is stated with the `count--; CREATE TABLE foo` example.
  - A **seventh bullet** documents the block-comment slip-through: a
    `CREATE TABLE` on an unmarked line inside a multi-line `/* ... */` block is
    captured as a ghost (plan step 4).
- The block header (`:52`) now reads "Known misses" — "silent" was dropped
  because the trailing paragraph says most of them redden (review item 3).
- A trailing paragraph (`:66-75`) states how each miss surfaces at the corpus
  assertion: bullets 2-6 redden the `toEqual` outright; bullet 1
  (virtual table) is the one that can pass quietly, because the extractor's
  own DDL gate is also the literal words `CREATE TABLE`
  (`packages/extract/src/node/ddl.ts:18`), so both sides omit the table; and
  bullet 7 reddens but **misattributes** — the diff reads as "psq missed a
  table" and sends the reader into the extractor when the invented name came
  from the oracle. The "do not fix the regex" instruction is preserved.
- A second trailing paragraph (`:77-79`) states the 1:1 bullet↔test invariant,
  including that every test names its bullet by ordinal.
- The body comment at the guard site (now `:94-101`) was left in place, as the
  plan requires. The "never point the oracle at this file" warning is intact
  and its premise unchanged (the new prose adds `CREATE TABLE` tokens only in
  the comment block the warning already covers).

### test/oracle.test.ts

- New characterization test "skips a real declaration on a JSDoc continuation
  line" (`:111`) — pins the sixth-bullet **miss**: a real declaration on a
  leading-`*` line is lost. (The guard itself was already exercised by the
  pre-existing "ignores a JSDoc continuation line" test at `:58`; what was
  unpinned was the loss of a real table, which is what this test asserts.)
  Its comment distinguishes it from `:58`, where the ghost deserves to be
  ignored (plan step 2).
- New characterization test "captures a ghost from an unmarked line inside a
  multi-line block comment" (`:121`) — asserts the ghost **is** returned
  (`["ghost", "real"]`), pinning the misattributing miss (plan step 1). Its
  comment names the two correctly-ignoring tests it is the opposite of, by
  title, and states the misattribution consequence.
- Both new tests carry the "update the bullet and this test together, do not
  delete it" comment style the existing pinned tests use (plan step 3).
- The fifth-bullet test (`:103`) gained a second assertion pinning the
  `count--; CREATE TABLE foo` same-line example from the reworded bullet
  (review item 5 — an assertion, not a test, so counts are unchanged).
- The four inherited pinned tests (`:79`, `:85`, `:91`, `:97`) now name their
  bullet by ordinal (first through fourth), making the reverse walk of the
  1:1 invariant mechanical (review blocking 2).
- All seven pinned-test comments reference the block as the "known-misses
  block", matching the renamed header; no "silent-misses" reference survives
  (`grep -rn silent test/` finds nothing).

## Deviations from the plan

1. **Coordinator correction 1 applied**: the plan's line range for the bullet-5
   wording fix (`:59-62`) was wrong — bullet 5 and the word "leading" started
   at line 58. I edited from the file's actual bytes and confirmed via
   `git diff -- test/fixtures.ts` that "leading" is removed from the bullet
   list. The only remaining "leading" in the file is in the guard-site body
   comment the plan explicitly keeps.
2. **Coordinator correction 2 applied — chose option (b)**: the plan's
   "six bullets, six pinned misses" arithmetic was impossible once bullet 5's
   second half got its own test. I split bullet 5 into two bullets, one per
   suppression path, restoring strict 1:1 at **7 bullets / 7 tests**. Chosen
   over option (a) because the two paths are enforced by two separate guards
   in the code (`before.includes(...)` vs `/^\s*\*/`), so they are genuinely
   different rules; it preserves the stricter invariant the previous phase
   established; and it made the "leading" wording fix cleaner. Per correction
   2's option-(a) suggestion I additionally wrote the invariant next to the
   bullet list — stated in its strict 1:1 form, since (b) makes that true.
3. Plan step 6 honored: the previous phase's `audit.md` aside was not touched.

## Review-round fixes (all verified against the tree afterward)

- **Blocking 1** — my first draft claimed the ghost "reddens nothing". False:
  both consumers (`packages/extract/test/node.test.ts:19` and `:87`) are
  `expect(names).toEqual(tablesDeclaredIn(...))`, and a ghost fails that as
  loudly as an omission. Reframed in both files as **misattribution**: the
  failure reddens but reads as an extractor bug, not an oracle bug.
- **Blocking 2** — my first draft's invariant said "every such test names its
  bullet" when only three did. Fixed by adding ordinals to the four inherited
  tests, making the sentence true rather than weakening it.
- Item 3 — header renamed "Known misses"; all seven test-comment anchors
  updated to "known-misses block".
- Item 4 — the inherited "unlike the four above, fails loudly" framing was
  wrong for bullets 2-4 (a wrong captured name also reddens). The new
  paragraph groups bullets 2-6 as reddening outright and singles out bullet 1
  as the quiet one — verified against the extractor's gate regex at
  `packages/extract/src/node/ddl.ts:18`, which `CREATE VIRTUAL TABLE` also
  evades.
- Item 5 — `count--;` same-line example now pinned by a second assertion in
  the fifth-bullet test.
- Item 6 — the ambiguous "two block-comment tests above" now names the two
  tests by title.
- Audit corrections: the "previously unpinned guard" claim replaced with the
  accurate "previously unpinned miss" statement (the guard was already
  covered by `:58`); stale line citations recomputed from the current tree.

## 1:1 mapping check

Verified explicitly against the working tree after the review-round fixes
(`grep -c '^//   - ' test/fixtures.ts` → 7; `grep -n 'known-misses block'
test/oracle.test.ts` → 7 tests, each with an ordinal):

| # | fixtures.ts bullet | oracle.test.ts test |
|---|---|---|
| 1 | `CREATE VIRTUAL TABLE` → no match | "misses a CREATE VIRTUAL TABLE entirely" (:79) |
| 2 | `main.foo` → captures `main` | "captures the schema qualifier instead of the table name" (:85) |
| 3 | `"my table"` → captures `my` | "truncates a quoted name at its first space" (:91) |
| 4 | non-ASCII truncation | "truncates a non-ASCII identifier at the first non-word character" (:97) |
| 5 | comment marker earlier on the line | "skips a real declaration that shares a line with a comment opener" (:103) |
| 6 | first non-space character is `*` | "skips a real declaration on a JSDoc continuation line" (:111) |
| 7 | ghost in multi-line block comment | "captures a ghost from an unmarked line inside a multi-line block comment" (:121) |

**Result: 7 bullets, 7 pinned tests, strict 1:1 in both directions, every
test naming its bullet by ordinal, no orphan either way.** Every documented
miss occurs in neither corpus file today. (This is 7/7, not the plan's
original 6/6 — see deviation 2.)

## Test results

Run with the repo's own toolchain (`pnpm` via a local node install).

| gate | before | after (incl. review fixes) |
|---|---|---|
| `pnpm typecheck` | — | pass (all four tsc projects) |
| `pnpm test` | 198 passed (13 files) | **200 passed** (13 files) |
| `PSQ_NO_CORPUS=1 pnpm test` | 143 passed / 55 skipped | **145 passed** / 55 skipped |

Before-counts were measured on the untouched tree at the start of this task
and match the plan's stated 198 / 143. Both new tests run under
`PSQ_NO_CORPUS=1` (they are hermetic, +2 in both columns). The review round
added an assertion, not a test, and both counts were re-run and confirmed
unchanged at 200 / 145.

## Open risks

- The test comments reference bullets by ordinal. Reordering the bullet list
  would silently misalign all seven references; the invariant paragraph in
  `fixtures.ts` tells a future editor to update bullet and test together,
  which mitigates but does not mechanically enforce this.
- The "bullet 1 can pass quietly" claim depends on the extractor's gate
  staying `/\bCREATE\s+TABLE\b/i`; if the extractor ever learns virtual
  tables, that sentence (not any test) goes stale.
- `plan.md` still contains the two statements the coordinator corrected
  mid-task; it was not edited because it is not in the files-touched list.
- Nothing committed — work left in the tree for review, per instructions.
