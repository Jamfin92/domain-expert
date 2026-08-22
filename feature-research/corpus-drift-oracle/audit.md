# Corpus drift oracle — implementer audit (2026-08-22)

## Files changed

- `test/fixtures.ts` — modified
- `test/oracle.test.ts` — new
- `packages/extract/test/node.test.ts` — modified
- `feature-research/corpus-drift-oracle/audit.md` — new (this file)

Nothing under `packages/extract/src/**` was touched.

## What changed per file

### `test/fixtures.ts`
- Import line now `import { existsSync, readFileSync } from "node:fs";` (added `readFileSync`).
- Appended, exactly per the plan's design section:
  - `CORPUS_DDL` — pins `corpus-repo-d` → `server/src/state/db.ts` and `corpus-repo-e` → `src/db.ts`, resolved off the unchanged `CORPUS` values.
  - `CREATE_TABLE_NAME` regex (module-private): `\bCREATE\s+(?:TEMP(?:ORARY)?\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"\[]?(\w+)[`"\]]?` with `gi`.
  - `tablesInDdlText(text)` — walks `matchAll`; for each match takes the slice from the previous `\n` to the match index and skips the match when that slice contains `--`; dedupes via `Set`, returns sorted.
  - `tablesDeclaredIn(path)` — throws `no DDL file at ${path}` when absent, `${path} declares no CREATE TABLE` when the regex finds nothing; otherwise returns the names.
- `CORPUS` and `hasCorpus` unchanged.

### `test/oracle.test.ts` (new, hermetic — no corpus needed)
10 tests covering exactly the cases the plan lists: plain `CREATE TABLE x`; `IF NOT EXISTS`; `TEMP` and `TEMPORARY`; quoted names (`"x"`, backticked, `[x]`); a `-- CREATE TABLE ghost` line ignored; a `count--;` line that must not suppress a later real declaration; duplicates deduped; output sorted; throw-on-missing-file; throw-on-empty (uses `test/fixtures.ts` itself as the real-but-DDL-free file). Path resolution uses the same `fileURLToPath`/`dirname` pattern as `fixtures.ts` rather than `import.meta.dirname`, for typecheck safety.

### `packages/extract/test/node.test.ts`
- Import line adds `CORPUS_DDL` and `tablesDeclaredIn`.
- Header comment (`:5-11`) rewritten: table lists now come from the regex oracle, with the hand-checked core as backstop.
- corpus-repo-d table test renamed to `"reads every table declared in one inline template literal"`; now asserts (1) names equal `tablesDeclaredIn(CORPUS_DDL.corpus-repo-d)`, (2) `arrayContaining` of the original eight-table stable core (deliberately excludes `model_variant_eta`, per the plan), (3) length >= 8.
- corpus-repo-e table test renamed to `"reads every table from a constant exec'd ninety lines later"`; asserts oracle equality, `arrayContaining` of the five-table core, length >= 5, and keeps `expect(g.warnings).toEqual([])`.
- `corpus-repo-c` block and every other test untouched.

## Deviations from the plan

- Test names: the plan said keep each test's name-and-premise flavour; "all nine"/"five" counts were replaced with "every table" since a hardcoded count in the name would go stale the same way the assertion did. Premise (delivery mechanism) preserved.
- The plan's Stage 3 note expected "12 files, 178+ tests". The suite actually has 13 files / 188 tests — the plan's figures evidently predate adding `oracle.test.ts` (12+1 files, 178+10 tests). No pre-existing test count differed from the plan.
- `oracle.test.ts` uses `fileURLToPath` instead of the (unspecified in the plan) path mechanism; cosmetic.

Everything else matched the plan's ground truth: line numbers `:14` and `:77`, the header comment text, the import shape, the CORPUS values.

## Verification (all via `zsh -lic`, repo root)

1. `pnpm exec tsc --noEmit` — clean, no output, exit 0.
2. `pnpm exec vitest run` —
   ```
   Test Files  13 passed (13)
        Tests  188 passed (188)
   ```
   Including `✓ test/oracle.test.ts (10 tests)` and `✓ packages/extract/test/node.test.ts (15 tests)` (corpus repos present on this machine, so the oracle equality ran live against corpus-repo-d's 9 tables and corpus-repo-e's 5).
3. `PSQ_NO_CORPUS=1 pnpm exec vitest run` —
   ```
   Test Files  9 passed | 4 skipped (13)
        Tests  133 passed | 55 skipped (188)
   ```
   `✓ test/oracle.test.ts (10 tests)` still runs; `↓ packages/extract/test/node.test.ts (15 tests | 15 skipped)`.

## Open risks

Unchanged from the plan's own Risks section: the oracle covers table names only; a schema moved out of the `CORPUS_DDL`-pinned file is caught by the throw and the stable-core floor, not by the equality itself. No new risks introduced.

## Follow-up: reviewer items 1 and 2

Files changed
- test/fixtures.ts
- test/oracle.test.ts

### test/fixtures.ts

- `tablesInDdlText` skip rule extended: the slice from the previous `\n` up to
  the match index is now also checked for `//` and `/*`, and for a first
  non-whitespace `*` (JSDoc continuation), in addition to the existing `--`.
  Structure kept as a per-match same-line-slice inspection; no global comment
  stripping. The comment on the loop names the accepted limit: a CREATE TABLE
  on its own line inside a block comment with no leading `*` still slips
  through.
- Comment added above `CREATE_TABLE_NAME` naming the assumed DDL subset and
  the known silent misses (VIRTUAL TABLE -> no match; `main.foo` -> `main`;
  `"my table"` -> `my`; non-ASCII truncation), none in the corpus today.
- `CORPUS_DDL` doc comment gained one sentence on the uncaught drift mode: a
  corpus repo adding a second DDL file makes the failure look like a psq bug
  rather than a stale pin.

### test/oracle.test.ts

- Five new `tablesInDdlText` tests: trailing `-- comment` after a real
  declaration still yields the table; `//` line, `/* */` line, JSDoc `*` line,
  and the prose case (`// the CREATE TABLE for tasks lives above`, which
  previously yielded a table named `for`) each assert the phantom is absent
  and a real declaration elsewhere is still found. The existing `count--;`
  test is unchanged and passing.
- "declares no CREATE TABLE" test no longer points at `test/fixtures.ts`
  (which passed by luck — its own doc comment contains `CREATE TABLE
  old_thing`, suppressed only by a `--` earlier on the line). It now writes a
  temp file under `mkdtempSync(join(tmpdir(), "psq-oracle-"))` containing no
  CREATE TABLE token and removes the directory in `finally`.

### Deviations from the plan

None. No file outside test/fixtures.ts and test/oracle.test.ts was touched;
packages/extract/src/** untouched.

### Verification (all via `zsh -lic`)

- `pnpm exec tsc --noEmit` — clean, no output.
- `pnpm exec vitest run` — `Test Files  13 passed (13)`,
  `Tests  193 passed (193)`. oracle.test.ts: 15 tests passed.
- `PSQ_NO_CORPUS=1 pnpm exec vitest run` —
  `Test Files  9 passed | 4 skipped (13)`,
  `Tests  138 passed | 55 skipped (193)`.
- Corpus counts unchanged under the hardened rule: corpus-repo-d resolves to its 9
  tables (approvals, audit, chat_messages, chats, model_variant_eta, packets,
  settings, spend, tasks), corpus-repo-e to its 5 (feed_items, feed_state, meta,
  quotes, tickers); the corpus tests in packages/extract/test/node.test.ts
  passed against the live repos.

### Open risks

- The accepted comment-rule limit above (bare line inside a block comment) is
  documented in the code; deliberate non-goal per the plan.
- The temp-file test writes to os.tmpdir(); if that is ever unwritable the
  test errors rather than false-passes.

Not committed; working tree left for review.

## Roadmap reorganization

Files changed:
- `README.md`
- `CLAUDE.md`
- `feature-research/corpus-drift-oracle/audit.md` (this file)

Documentation only. No `.ts` files touched. M1–M7 keep their numbers.

`README.md`:
- Status table: reworded the M5/M6/M7 planned rows, added M8 and M9. After
  review, the M8/M9 rows were corrected — the 3D city is NOT wired into the
  web UI (`EntityCity` is imported by nothing; the `layout3d` route has no UI
  consumer). M8 now reads "3D entity city, phases 1–2a (layout + renderer,
  not yet wired in) | done"; M9 reads "3D entity city phase 2b: wire the city
  into the web UI, theme-derived colours | planned".
- Added a `## Next` section after the table: running order for remaining work
  (drift-oracle follow-ups, M9, M5, M6, M7) with one-line rationale each.
- Line 7: "React clients come next" contradicted the `## Next` ordering (which
  puts drift-oracle follow-ups and M9 ahead of M5); now reads "React clients
  are planned (M5)".
- Development section: corrected stale test counts 92→138 (`PSQ_NO_CORPUS=1`)
  and 147→193 (full suite).

`CLAUDE.md`:
- Rule 8 claimed `.psq/` is written "only on an explicit `psq export`", but the
  CLI has no `export` case — that command is M7, still planned. A first fix
  said "`.psq/` is written only on an explicit `--out`", still not literally
  true: nothing in source creates `.psq/` — `--out` writes wherever pointed
  (`apps/cli/src/index.ts:117-120`, `:145-148`), is accepted only by `graph`
  and `questions`, and `.psq/` is just the README's example path. Rule 8's
  second sentence now reads: "psq writes only where you point it with `--out`
  (accepted by `graph` and `questions`); the `.psq/` directory is just the
  README's example path. `psq export` is the M7 command for a packaged export
  and does not exist yet." First sentence untouched (verified exactly true:
  `writeOut` at `apps/cli/src/index.ts:54-58` is the only write in non-test
  source).

Not changed: the "domain brief" claim at README line 17 — reported back for a
decision, per the plan.

Verification: `pnpm exec vitest run` — 13 files, 193 tests, all pass. Working
tree left uncommitted for review.
