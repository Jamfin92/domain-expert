# Phase H-a — partial entity search — IMPLEMENTATION AUDIT

Plan: `feature-research/h-entity-search/plan.md` (rev 3), followed verbatim.
Baseline commit: `d45907a`.

## Files changed

| File | New / Modified |
|---|---|
| `packages/schema/src/index.ts` | modified |
| `packages/graph/src/search.ts` | **new** |
| `packages/graph/src/index.ts` | modified |
| `apps/server/src/app.ts` | modified |
| `packages/graph/test/search.test.ts` | **new** |
| `apps/server/test/api.test.ts` | modified |
| `feature-research/h-entity-search/plan.md` | **new** (the approved plan, committed with the phase) |
| `feature-research/h-entity-search/audit.md` | **new** (this file) |

Nothing else. No `apps/cli`, no `apps/web`, no `packages/extract`, no
`workspace.ts`, no `store.ts`, no `EXTRACTOR_VERSION`, no `package.json`.
`git status` after the work lists exactly these paths.

## What changed, per file

**`packages/schema/src/index.ts`** — one new section between `EntityGraph` and
the Questions section: `EntityMatchField` (`z.enum`), `EntityMatchReason`,
`EntitySearchHit`, `EntitySearchResult`, each with its inferred type.
`EntityGraph` is untouched, so no stored envelope is affected. The comments
record why there are three match fields and not four, and why `matched` is the
raw declared string.

**`packages/graph/src/search.ts`** (new) — `MATCH_FIELDS`, `searchEntities`,
and three private comparators (`byCodeUnit`, `compareReasons`, `compareHits`).
Imports its types from `@psq/schema`; defines none. No null guards on
`tableName`/`property.name` (fact 5 — both are `z.string()`), no `isFramework`
filter, and the comment says that this is a no-op today rather than a
safeguard (fact 8). `byCodeUnit` carries the reason it is not `localeCompare`.
`compareHits` reads rank off `reasons[0]` — valid because the reasons array is
sorted before the hit is pushed, which makes `reasons[0]` the minimum rank.

**`packages/graph/src/index.ts`** — one line: `export { searchEntities,
MATCH_FIELDS } from "./search.js";`.

**`apps/server/src/app.ts`** — `GET /api/repos/:id/search`, placed after
`/graph`. Repo lookup first (404), then `typeof q !== "string"` (400), then a
200 whose body is `{ query, searched: [...MATCH_FIELDS], hits }`. Imports
`searchEntities`/`MATCH_FIELDS` from `@psq/graph`. **No `import { z } from
"zod"` was added** — `apps/server/package.json` still does not declare zod, and
that carried debt is restated, not fixed.

**`packages/graph/test/search.test.ts`** (new) — 11 tests covering H1, H2, H3,
H4, H6, H7, H9a, H9b, H9c, H11, plus one asserting `MATCH_FIELDS` itself. Every
graph is **extracted** (`extractDotnet(MINI_EFCORE)`,
`extractDotnet(MINI_EFCORE_EMPTY_CONTEXT)`); there is no hand-written
`EntityGraph` literal anywhere in the file. The H9c twins are built by
`structuredClone`-ing an extracted entity and changing only `name` and
`tableName`, so every other field still comes from extraction. Nothing walks
`Models/` (fact 12).

**`apps/server/test/api.test.ts`** — `search` added to the existing
parameterised 404 loop (now at `:118-123`), with a comment saying why it sends
no query string; plus a new `describe("entity search")` holding four tests
(H14, H12, H12b, H12c).

## 1. Mutant table — every mutant was applied, run, and reverted

Harness: `scratchpad/mutants.py` — patch one source file, run
`PSQ_NO_CORPUS=1 vitest run packages/graph/test/search.test.ts
apps/server/test/api.test.ts --reporter=json`, collect failing test names,
restore the file byte-for-byte from the pre-run snapshot. All 15 ran.

| # | Mutant applied | Result | Test(s) reddened |
|---|---|---|---|
| H1 | `"propertyName"` removed from `MATCH_FIELDS` | **reddened** | "finds an entity through a property name" (+6 others) |
| H2 | `property.name.toLowerCase().includes(...)` → `property.name.includes(...)` | **reddened** | "is case-insensitive in both directions" (+4) |
| H3 | all three `.includes(needle)` → `.startsWith(needle)` | **reddened** | "matches a substring, not just a prefix" (+2) |
| H4 | `"tableName"` removed from `MATCH_FIELDS` | **reddened** | "finds an entity through its table name alone" (+4) |
| H6 | one `hits.push` per reason instead of one grouped hit | **reddened** | "yields one hit per entity, carrying every reason" (+1) |
| H7 | `if (q === "") return [];` deleted | **reddened** | "returns nothing for an empty or whitespace query" (+1) |
| H9a | secondary/tertiary keys in `compareHits` replaced with `return 0` | **reddened** | "orders hits independently of the order entities are listed in" (+1) |
| H9b | `reasons.sort(compareReasons);` deleted | **reddened** | "orders reasons independently of the order properties are listed in" (only) |
| H9c | `byCodeUnit` body → `return a.localeCompare(b);` | **reddened** | "orders names by code unit, so NFC and NFD spellings cannot tie" (only) |
| H11 | `const seed = graph.entities[0]!.name;` **hoisted immediately above `hits.sort`** | **reddened** | "handles a graph with no entities at all" (only) |
| H12 | guard replaced by `const q = typeof req.query["q"] === "string" ? ... : "";` (falls through to 200) | **reddened** | "400s when q is missing" (+ "…when q is repeated") |
| H12b | guard replaced by `const q = String(req.query["q"]);` | **reddened** | "400s when q is repeated" (+ "…when q is missing") |
| H12c | guard → `if (typeof q !== "string" \|\| q === "")` | **reddened** | "200s with no hits when q is present but empty" (only) |
| H13 | repo-lookup guard deleted (`workspace.get(...)!`) | **reddened** | "404s for a repo that is not open" (only) |
| H14 | response key `searched:` → `fields:` | **reddened** | "returns a parseable result that names the fields it searched" (+1) |

**15 of 15 reddened. None stayed green.**

Notes on the ones the plan flagged as easy to get wrong:

- **H9c** — the fixture is NFC-first, asserted in the test itself
  (`expect(twins.entities.map(e => e.name)).toEqual([NFC, NFD])`). The test also
  asserts `NFC.localeCompare(NFD) === 0` on this node, so the trap is recorded
  in the file rather than only in the plan. Under code-unit comparison the
  output is `[NFD, NFC]` — the reverse of the input; under the `localeCompare`
  mutant the comparator returns 0 at every level (the twins share namespace,
  file and table name on purpose, so nothing downstream can break the tie),
  V8's stable sort holds the input order, and the assertion fails. Confirmed
  red.
- **H11** — the seed is hoisted to the statement immediately before
  `hits.sort(compareHits)`, not into a comparator body. It throws on the
  0-entity extraction. Confirmed red.
- **H7** — the test asserts `g.entities.length > 0` before the two empty-query
  assertions, so the gate cannot pass by being handed an empty graph.
- **H13** — one new entry (`"search"`) in the existing loop at
  `api.test.ts:118-123`, no query string. Its mutant reddens only that test.

## 2. Corpus sweep

Scratchpad script `scratchpad/sweep.ts` (never a committed test), run against
all six corpus entries via `extract()`.

| repo | entities | `q="email"` hits | `propertyName` reasons | entities carrying them | `q="user"` hits | `q="zzzznotathing"` |
|---|---|---|---|---|---|---|
| repoA | 17 | 2 | **4** | **User, WaitlistEntry** | 11 | 0 |
| repoB | 9 | 1 | **1** | **User** | 7 | 0 |
| repoC | 0 | 0 | 0 | — | 0 | 0 |
| repoD | 13 | 0 | 0 | — | 0 | 0 |
| repoE | 5 | 0 | 0 | — | 0 | 0 |

**Fact 1 reproduced exactly**: repoA 4 `propertyName` reasons across `User` +
`WaitlistEntry`; repoB 1 across 1; repoC/D/E zero. Entity counts 17/9/0/13/5
also match fact 9. The shape-field side of the corrected table reproduced too
(repoA **4**: `LoginRequest`, `RegisterRequest`, `UserProfileDto`,
`WaitlistSignupRequest`; repoB **5**) — a genuine 4-vs-4 tie in repoA,
confirming that restricting search to entity names would answer the motivating
example with an empty list.

`repoAClient` (the separate corpus entry rev 2 conflated with repoA) was also
swept: 0 entities, 0 hits, and 15 email-ish shape fields. It is the source of
rev 2's wrong "24", exactly as the plan's `[B3]` says.

For `q="user"` on repoA the reason breakdown is
`{entityName: 3, tableName: 3, propertyName: 25}` — every `entityName` match is
accompanied by a `tableName` match, which is the D-Ha-4 behaviour ("that is
real output, not a bug") showing up on real data.

## 3. Final gate numbers

| Gate | Baseline | After |
|---|---|---|
| `pnpm test` | 406 passed (406), 32 files | **421 passed (421), 33 files** |
| `PSQ_NO_CORPUS=1 pnpm test` | 348 passed \| 58 skipped (406) | **363 passed \| 58 skipped (421)** |
| `pnpm typecheck` | exit 0 | **exit 0** (all four projects) |

Skipped stayed at **58**, so the private corpus config is intact and the sweep
numbers above are trustworthy. +15 tests: 11 unit + 4 route (the 404 loop gained
an iteration, not a test). `pnpm test:e2e` was **not** run.

## 4. Deviations from the plan

1. **H12 and H12b are two `it`s, not one.** The plan names them as two gates;
   the first draft put both assertions in a single test. With both in one
   block the first failing `expect` aborts the test, so the repeated-`q`
   assertion could never be *observed* reddening — the gate would have been
   inert in exactly the way this phase's standing rule forbids. Split, then
   both mutants re-run: each now reddens both tests independently. No
   behaviour change; only the test file is affected.
2. **H6's fixture yields three reasons, not two.** The plan says "one entity
   matching on both name and a property yields one hit with 2 reasons". In
   `MINI_EFCORE` a 2-reason `entityName`+`propertyName` case does not exist: a
   `tableName` is always the entity name pluralised, so any query matching the
   name also matches the table. Brute-forcing every ≥3-char substring of every
   name in the fixture returns exactly one query, `"ent"`, that matches an
   entity on both its name and one of its properties — and it necessarily
   matches the table name too. The gate therefore asserts one hit with three
   reasons (`entityName`, `tableName`, `propertyName`). The substance — one
   hit per entity, not one per reason — is unchanged, and its mutant reddens.
   This was a fixture choice the plan left open, resolved against the fixture
   rather than by hand-writing a graph.

No other deviation. The plan's decisions were not re-litigated.

## 5. Things the plan did not anticipate

1. **The G-b2 "graph endpoints" flake fired once.** During the first full
   mutant sweep, the H12 mutant's run also reported
   `graph endpoints > 404s for a repo that is not open` as failed — a test the
   H12 mutant cannot affect (the repo guard is untouched and runs before the
   `q` guard). It did not recur in **13** further runs under the identical
   mutant: 5 runs of `api.test.ts` alone (in which only the two intended
   `entity search` tests failed, both with
   `AssertionError: expected 200 to be 400` at `api.test.ts:163` and `:176`)
   and 8 runs of the exact two-file invocation that produced it. **Capture gap,
   stated plainly:** the sweep harness recorded failing test *names* only, so
   the flake's assertion text and response body were **not** captured at the
   moment it fired, which is what the plan asked for. The harness was fixed
   afterwards to capture `failureMessages`, but the event did not recur. This
   remains the unreproduced G-b2 flake, cause unestablished — it must not be
   tidied into the 401 cross-connect flake. The 401 flake did not fire at all.
2. **`packages/graph/package.json` already devDepends on `@psq/extract`.**
   D-Ha-1 reads as if the edge were being added; it exists at `d45907a`, so no
   `package.json` change was needed — consistent with "Files touched" not
   listing one.
3. **Two fixture facts worth recording for H-a2.** `Advisor` has a `Students`
   navigation property, so `?q=students` on `MINI_EFCORE` returns **two** hits
   (`Student` on `tableName` rank 1, then `Advisor` on `propertyName` rank 2),
   not one. And `Enrollment` carries both `Student` and `StudentId`, which is
   what makes H9b's two-property reason ordering observable at all. A UI will
   need to render multi-reason and multi-entity results from day one.
4. **`compareHits` depends on `reasons` being sorted first.** Reading the
   minimum rank off `reasons[0]` is only correct because `reasons.sort` runs
   before the hit is pushed. That coupling is real: the H9b mutant (deleting
   `reasons.sort`) also perturbs hit ranks. It is noted here rather than
   defended with a redundant `Math.min`, which would cost the gate its
   sensitivity.

## 6. Known gaps, carried forward unchanged

- Shapes are not searchable; repoA is a measured 4-vs-4 tie. Surfaced by
  `searched` in the response, not silent.
- `isFramework` is dead in practice (always `false`), so "we include framework
  entities" is a no-op. H10 stays deleted; it should return as a real gate if a
  reader ever sets it true.
- `columnName` can never be a distinct reason while both readers set
  `column = name`.
- D-Ha-9 is ungated by design: `Entity` carries no `FactSource`, so a
  derived-vs-authored `tableName` label would be a guess.
- The empty-graph path is **unit-level only** (H11). `workspace.open` throws
  "No entities found" first, so the route was never exercised on a 0-entity
  graph and this audit does not claim it was.
- Carried debt, restated: `apps/server/package.json` does not declare `zod`.
