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
