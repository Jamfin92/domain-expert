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

Review round 1 (see §7) modified three of these again:
`packages/graph/test/search.test.ts`, `apps/server/test/api.test.ts`, and this
file. No source file changed in that round. Review round 2 (see §8) modified
two: `packages/graph/test/search.test.ts` and this file. No source file changed
in that round either. Review round 3 returned **Ship** and modified **one**:
this file. It is audit bookkeeping only — four corrected numbers/citations and
one recorded decision, listed in §9 — and no source or test file changed, which
the unchanged gate numbers in §9 confirm.

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
H4, H6, H7 (+H7b), H9a (+H9d), H9b, H9c, H11, plus one asserting `MATCH_FIELDS`
itself. H7b and H9d are assertions added to the existing H7 and H9a tests in
review round 1, so the file's test COUNT is unchanged at 11. Every
graph is **extracted** (`extractDotnet(MINI_EFCORE)`,
`extractDotnet(MINI_EFCORE_EMPTY_CONTEXT)`); there is no hand-written
`EntityGraph` literal anywhere in the file. The H9c twins are built by
`structuredClone`-ing an extracted entity and changing only `name` and
`tableName`, so every other field still comes from extraction. Nothing walks
`Models/` (fact 12).

**`apps/server/test/api.test.ts`** — `search` added to the existing
parameterised 404 loop (the test now at `:120-127`, its `for` at `:124-126`),
with a comment saying why it sends
no query string; plus a new `describe("entity search")` holding four tests
(H14, H12, H12b, H12c). Review round 1 added the `path` label as vitest's
message argument on that loop's `expect`, so a failure names which path 404'd
wrongly — without it the G-b2 `graph endpoints` flake would be uncapturable
again when it next fires from this loop.

## 1. Mutant table — every mutant was applied, run, and reverted

Harness: `scratchpad/mutants.py` — patch one source file, run
`PSQ_NO_CORPUS=1 vitest run packages/graph/test/search.test.ts
apps/server/test/api.test.ts --reporter=json`, collect failing test names,
restore the file byte-for-byte from the pre-run snapshot. All 15 ran.

| # | Mutant applied | Result | Test(s) reddened |
|---|---|---|---|
| H1 | `"propertyName"` removed from `MATCH_FIELDS` | **reddened** | "finds an entity through a property name" (+8 others) |
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
| H9d | `compareHits` ranks by the LAST reason (maximum rank) instead of `reasons[0]` (minimum) | **reddened** | "orders hits independently of the order entities are listed in" (only) |
| H7b | `const q = query.trim();` → `const q = query;` | **reddened** | "returns nothing for an empty or whitespace query" (only) |
| H1b | `search.ts:147` `tableName: entity.tableName` → `tableName: ""` | **reddened** | "finds an entity through a property name" (only) |
| H1c | `search.ts:148` `namespace: entity.namespace` → `namespace: null` | **reddened** | "finds an entity through a property name" (only) |
| H1d | `search.ts:149` `file: entity.file` → `file: ""` | **reddened** | "finds an entity through a property name" (only) |

**20 of 20 reddened. None stayed green.** (H9d and H7b were added in review
round 1 — see §7; H1b/H1c/H1d in review round 2 — see §8; the first 15 are the
original sweep.)

**The "+N others" counts are as-of the original sweep and are not maintained:**
every later round adds assertions to existing tests, so the same mutant reddens
more of them over time — re-measured against the committed tree (`c946079`), H1
reddens **11**, H2 **6** and H6 **3**, against the 9/5/2 measured at the sweep.
Every mutant still reddens and the named test is still among its failures, so
this is table drift, not a gate defect.

**Correction (review round 3): H1's row said "+6 others", and was wrong when it
was written.** Re-running the H1 mutant with `search.test.ts` and `api.test.ts`
restored to `e3c44c7` — the pre-round-1 state the original sweep measured —
fails **9** tests, not 7. Corrected in the table above to "+8 others". The other
four rows re-measured at that same commit hold exactly: H2 **5**, H3 **3**,
H4 **5**, H6 **2**. The error is isolated to H1, and its headline ("reddened")
was never in doubt — which is §8's lesson landing for a third round: what fails
review in this phase is never the conclusion, always the number or the
because-clause written beside it.

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
  assertions, so the gate cannot pass by being handed an empty graph. That
  precondition does **not** make the whitespace half failable; see H7b.
- **H9d** — asserts the actual min-rank ORDER of `searchEntities(g, "ent")`,
  `[Department, Enrollment, Student, Advisor, Course]`, not merely that forward
  and backward agree. Under the max-rank mutant the output becomes
  `[Department, Advisor, Course, Enrollment, Student]` and the assertion fails
  with `expected [ 'Department', 'Advisor', …(3) ] to deeply equal
  [ 'Department', 'Enrollment', …(3) ]`. Confirmed red, then restored.
- **H7b** — a positive control beside the `"   "` assertion:
  `searchEntities(g, "  email  ")` must still return `["Student"]`. Under the
  `query.trim()` → `query` mutant it fails with `expected [] to deeply equal
  [ 'Student' ]`. Confirmed red, then restored.
- **H1b / H1c / H1d** — the three payload fields the hit carries straight
  through from the entity. Each mutation was applied **individually**, run
  against the full hermetic suite, and reverted before the next. Each produced
  the identical result: `PSQ_NO_CORPUS=1 pnpm test` →
  `Tests 1 failed | 362 passed | 58 skipped (421)`,
  `Test Files 1 failed | 29 passed | 3 skipped (33)`, the single failure being
  `packages/graph/test/search.test.ts > searchEntities — matching > finds an
  entity through a property name`. Before the fix all three were **green**:
  `EntitySearchResult.safeParse` in H14 cannot catch them, because `tableName`
  and `file` are `z.string()` (so `""` parses) and `namespace` is `.nullable()`
  (so `null` parses). `file` is the field H-b's entity → file/line/method
  navigation is built on, so `file: ""` would have shipped silently. After the
  three runs `git diff` over `packages/graph/src/search.ts` is empty.

  **How the three are told apart, and why they stay one assertion (review round
  3).** H1b, H1c and H1d all ride on the single whole-object `toEqual` at
  `packages/graph/test/search.test.ts:36-42`, so all three mutants redden the
  same one test, `finds an entity through a property name`, with the same test
  name in the report. They are distinguished **only by the assertion diff** —
  vitest prints the drifted field and its expected/actual values — never by the
  failing test's name. Two consequences, recorded because they are easy to lose:
  a sweep harness that collects failing test *names* alone cannot tell H1b from
  H1c from H1d, so it must capture `failureMessages` (which is exactly the
  capture gap §5 item 1 records against the G-b2 flake, arriving here for a
  second reason); and the three are not three independent gates in the counting
  sense, they are one gate with three observable modes.

  **Decision: keep the single `toEqual`, do not split it into three `it`s.**
  Reviewed in round 3 and kept deliberately. A whole-object equality is the
  assertion that stays correct when the hit gains a fourth field — three
  field-by-field assertions would go green on a payload key nobody wrote an
  assertion for, which is the exact hole round 2 opened this thread to close.
  The §4 item 1 argument for splitting H12/H12b does not apply: those are two
  *different* inputs where the first failing `expect` would abort before the
  second was ever observed, whereas here one `expect` covers all three fields at
  once and cannot mask any of them. The cost is the one recorded above — the
  harness must read diffs, not names.
- **H13** — one new entry (`"search"`) in the existing loop at
  `api.test.ts:124-126` (the test runs `:120-127`), no query string. Its mutant
  reddens only that test.

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
swept: 0 entities, 0 hits, and **20 email-ish shape fields across 15 distinct
shapes**. **Correction (review round 3):** this paragraph read "15 email-ish
shape fields" — a *shape* count wearing a *field* label, and it broke its own
arithmetic. The plan's `[B3]` explains rev 2's wrong "24" as repoA plus
repoAClient, and 4 + 20 = 24 while 4 + 15 = 19. Both sides were re-measured by
dumping the fields, not by reasoning: repoA has **4 email-ish fields across 4
distinct shapes** (`LoginRequest.Email`, `RegisterRequest.Email`,
`UserProfileDto.Email`, `WaitlistSignupRequest.Email` — one field each, so its
"4" is right under either label), and repoAClient has **20 fields across 15
shapes** (several `*FormData` shapes carry two, e.g.
`PutnamHomeImprovementFormData.email` and `.businessEmail`). 4 + 20 = 24
reproduces rev 2's number exactly, so `[B3]`'s account of where it came from is
confirmed rather than merely asserted.

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
   matches the table name too. **Correction (review round 1):** `"ent"` matches
   **two** such entities, not one — `Student`, with **three** reasons
   (`entityName:Student, tableName:Students, propertyName:Enrollments`), and
   `Enrollment`, with **four**
   (`entityName:Enrollment, tableName:Enrollments, propertyName:Student,
   propertyName:StudentId`). Earlier wording in this audit said "an entity",
   singular, which was wrong; the round-1 replacement for it was **also**
   wrong — it claimed `Enrollment` matched via an `EnrollmentId` property and
   carried three reasons. No `EnrollmentId` property exists:
   `test/fixtures/mini-efcore/Models/Entities/Enrollment.cs` declares
   `StudentId, Student, CourseId, Course, LetterGrade, RegisteredAt`, and the
   two property reasons are `Student`/`StudentId` (both contain "ent", as in
   "Stud-ent"). This wording was verified by dumping the real
   `searchEntities(g, "ent")` output, not by reading the code — and it agrees
   with §5 item 3, which the round-1 text contradicted. See §8 item 3. The gate
   asserts on `Student` only, plus a whole-result uniqueness check; the
   four-reason entity is simply not named by it. The substance — one
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
- **`compareHits`'s `namespace` and `file` tiebreaks are individually ungated**
  (`search.ts:84-86`). Collapsing the comparator to rank + name leaves the whole
  suite green. Recorded, **not fixed**: by D-Ha-5.5's own reasoning the `file`
  key at `:86` is unreachable — two entities sharing name AND namespace are the
  same entity in any graph psq emits today — which is the same category of
  unreachable code the plan explicitly refused to write gates for (the null
  guards on `tableName`/`property.name`). A gate here would have to hand-build
  an `EntityGraph` the extractor cannot produce, which the test file forbids.
  The inconsistency between "no gate for unreachable null guards" and "a gate
  for an unreachable tiebreak" is the plan's to resolve, not something to close
  blind; H9c already gates the `name` key, and H9a gates "some tiebreak beyond
  rank exists".
- **D-Ha-8's "derived, not hardcoded" is not independently gated** (review
  round 2, recorded not fixed). Replacing `searched: [...MATCH_FIELDS]` at
  `apps/server/src/app.ts:193` with a hardcoded literal of the same three
  fields leaves the whole suite green. The reviewer then ran the drift scenario
  the decision exists for — adding a 4th match field: with the derived spread,
  **both** route-level `searched` assertions redden; with the hardcoded
  literal, one goes green. So drift is caught **incidentally**, not by design.
  A real gate needs a second match-field set to exist, which today's schema has
  no room for. Known gap, carried forward.
- **The schema's "as received, before trimming" claim is ungated** (review
  round 2, recorded not fixed). `packages/schema/src/index.ts:363` — the
  comment; the `query` field it documents is at `:364` — says the
  echoed `query` is the raw string as received; changing `query: q` to
  `query: q.trim()` at `apps/server/src/app.ts:193` leaves the suite green,
  because the route tests only ever send `"email"` and `""`, neither of which
  has surrounding whitespace. A because-clause with no control — the same
  category as H7's pre-H7b whitespace assertion.

## 7. Review round 1 — two ungated plan behaviours

A fresh reviewer independently re-ran all 15 mutants above and confirmed the
table is accurate. The finding was **not** a correctness defect: the shipped
behaviour was right in both cases. The defect was that two plan-specified
behaviours shipped with **no gate that could fail**, found by mutating things
the plan never named a mutant for.

1. **D-Ha-5.1's minimum-rank rule** (`search.ts:80`). Reading rank off the LAST
   reason instead of `reasons[0]` left the suite green while visibly reordering
   output. H9a only asserted `forward === backward`, which both rules satisfy,
   and H4's hits carry one reason each so min == max there. Fixed by pinning the
   actual order in H9a → gate **H9d**.
2. **`query.trim()`** (`search.ts:136`). Deleting the trim left the suite green,
   because `searchEntities(g, "   ")` returns `[]` either way — no declared
   string in `MINI_EFCORE` contains three consecutive spaces. H7's whitespace
   assertion was therefore a negative gate with no positive control: it passed
   by finding nothing, exactly the failure mode the standing rule names. Fixed
   with `searchEntities(g, "  email  ")` → `["Student"]` beside it → gate
   **H7b**.

Both new mutants were applied, observed red (§1), and the source restored
byte-for-byte; `git diff` over `packages/graph/src/search.ts` is empty.

**The lesson, stated plainly:** the plan's gate list was a list of gates to
write, never a coverage claim. Every mutant it named reddened, and the mutant
table said "15 of 15" — which is true and was never evidence that the
implementation was fully gated. Two behaviours the plan itself specified had no
mutant named against them, so nothing in the sweep could have caught it. A
mutant sweep measures the mutants you thought of.

Round 1 also corrected two audit statements (§4 item 2's `"ent"` wording) and
recorded one gap without fixing it (§6, the `namespace`/`file` tiebreaks).

### Gate numbers after round 1

| Gate | Baseline | After round 1 |
|---|---|---|
| `pnpm test` | 421 passed (421) | **421 passed (421)**, 33 files |
| `PSQ_NO_CORPUS=1 pnpm test` | 363 passed \| 58 skipped (421) | **363 passed \| 58 skipped (421)** |
| `pnpm typecheck` | exit 0 | **exit 0** |

Counts are unchanged on purpose: H9d, H7b and the `path` label are assertions
added to existing tests, not new `it` blocks. Skipped held at **58**, so the
private corpus config is intact. `pnpm test:e2e` was **not** run.

## 8. Review round 2 — three ungated payload fields, and a correction that was itself wrong

A second fresh reviewer re-verified round 1's two new gates (H9d, H7b): both
close their holes, land on the new assertion lines specifically, and do not
shadow the originals. Scope and baselines were clean. It then found two blocking
items and two non-blocking gaps.

1. **Three `EntitySearchHit` payload fields were ungated** (`search.ts:146-151`).
   The plan shapes the hit as `{ name, tableName, namespace, file, reasons }`
   (plan.md:184-185), but only `name` and `reasons` were ever asserted.
   Mutating `tableName` → `""`, `namespace` → `null` and `file` → `""`
   individually each left the full hermetic suite **green** at 363 passed.
   H14's `EntitySearchResult.safeParse` is structurally unable to catch them:
   `tableName`/`file` are `z.string()` so `""` parses, and `namespace` is
   `.nullable()` so `null` parses. `file` is the field H-b is built on, so a
   silently empty `file` would have shipped and only surfaced as broken
   navigation. Fixed by asserting the **whole hit object** in H1
   (`packages/graph/test/search.test.ts`), with values read out of the
   extracted fixture rather than written by hand → gates **H1b** (tableName),
   **H1c** (namespace), **H1d** (file). All three mutants applied one at a time,
   observed red (§1), source restored byte-for-byte.
2. **Two gaps recorded, not fixed** — D-Ha-8's derived `searched` and the
   schema's "before trimming" claim. Both are in §6 with the reviewer's own
   drift-scenario evidence.
3. **The round-1 audit correction was itself factually wrong.** §4 item 2's
   round-1 replacement text said `"ent"` matched `Enrollment` via an
   **`EnrollmentId`** property, with three reasons. No such property exists —
   `Enrollment.cs` declares `StudentId, Student, CourseId, Course, LetterGrade,
   RegisteredAt` — and the real output is **four** reasons on
   `Student`/`StudentId`. §5 item 3 of this same audit had it right all along,
   so the audit contradicted itself for a round. Corrected in §4, this time by
   dumping `searchEntities(g, "ent")` and pasting the output, then deleting the
   temporary dump.

**The lesson, stated plainly — and this is the phase's most transferable
finding:** this is the **second correction in a row whose replacement text
introduced a new false claim**. Round 1 corrected "an entity" (singular) to a
statement about `EnrollmentId` that was invented; round 2 corrected that. It is
the same pattern G-b2 recorded — *the conclusion right every time, the
because-clause wrong twice*. The headline claim ("one hit per entity, not one
per reason") survived every round untouched and correct. What kept breaking was
the supporting detail written from memory of the code instead of from the
program's output. The rule that follows: **a correction is a new claim and
carries the same evidence burden as the original** — do not let "I am fixing an
error" license writing the replacement from reasoning. Dump the real value, and
check whether the same document already states the fact elsewhere before
writing a new version of it.

### Gate numbers after round 2

| Gate | Baseline | After round 2 |
|---|---|---|
| `pnpm test` | 421 passed (421) | **421 passed (421)**, 33 files |
| `PSQ_NO_CORPUS=1 pnpm test` | 363 passed \| 58 skipped (421) | **363 passed \| 58 skipped (421)** |
| `pnpm typecheck` | exit 0 | **exit 0** |

Counts are unchanged on purpose: H1b/H1c/H1d are assertions folded into the
existing H1 test — H1's `reasons` assertion was widened into a whole-object
`toEqual` on `hits[0]`, alongside the unchanged names-list assertion — not new
`it` blocks. Skipped held at **58**, so the
private corpus config is intact. `pnpm test:e2e` was **not** run.

## 9. Review round 3 — Ship, with the audit's own numbers corrected

A third fresh reviewer returned **Ship**: no blocking issues, every gate
re-verified, scope clean. What follows is non-blocking bookkeeping, and it is
written up rather than quietly patched because **this phase's transferable
finding is that corrections carry new false claims**, and two of these were
fresh errors sitting inside sections rounds 1 and 2 had already declared
verified. Every number below was re-measured here before it was written; none
was copied from the review report.

1. **The H1 mutant row undercounted, and was wrong when written** (§1). It said
   `(+6 others)` = 7 reddened. Re-run with both test files restored to
   `e3c44c7`, the H1 mutant fails **9**. Corrected to `(+8 others)`. H2/H3/H4/H6
   re-measured at that same commit hold at 5/3/5/2, so the error is isolated to
   H1.
2. **§1's counts no longer describe the committed tree** — a caveat, not a fix.
   Rounds 1 and 2 added assertions to existing tests, so against `c946079` the
   same mutants redden H1 **11**, H2 **6**, H6 **3**. Every mutant still
   reddens; the table was never re-based and now says so.
3. **repoAClient's count was wrong and broke its own arithmetic** (§2). "15
   email-ish shape fields" was a shape count with a field label: the true
   figures are **20 fields across 15 shapes**, which makes the plan's `[B3]`
   account of rev 2's "24" (repoA 4 + repoAClient 20) add up, where 4 + 15 did
   not.
4. **Two line citations had drifted** — the 404 loop is at `api.test.ts:120-127`
   with its `for` at `:124-126`, not `:118-123` (cited twice, both fixed). The
   third flagged citation, `schema/src/index.ts:363`, was **checked and is
   correct** — the comment is on `:363`, the `query` field it documents on
   `:364`; the review report's proposed `:362` would have introduced a fifth
   error, which is the same trap this section exists to record. Every other
   `path:line` in this audit was checked against the files at `c946079` and
   holds: `search.ts:80`, `:84-86`, `:86`, `:136`, `:146-151`, `:147`, `:148`,
   `:149`, and `app.ts:193`.
5. **H1b/H1c/H1d's distinguishability recorded, and the single assertion kept**
   — see §1's note under the H1b/H1c/H1d bullet.

**The lesson, and it is the same one a third time:** round 1's correction was
wrong, round 2's correction of it was right but left four uncorrected numbers
standing beneath it, and this round found two of those numbers had been wrong
since the day they were written — in a table two reviewers had signed off. A
verified *section* is not a verified *number*. Sign-off does not propagate
downward into the figures a section contains, and "two rounds looked at this
already" is the reason to re-measure, not the reason to skip it.

### Gate numbers after round 3

| Gate | Baseline | After round 3 |
|---|---|---|
| `PSQ_NO_CORPUS=1 pnpm test` | 363 passed \| 58 skipped (421) | **363 passed \| 58 skipped (421)** |
| `pnpm typecheck` | exit 0 | **exit 0** |

Unchanged by construction: round 3 edited **this file only**, no source and no
test. The run is a no-op control confirming exactly that — and skipped held at
**58**, so the private corpus config is still intact and §2's sweep numbers
remain trustworthy. `pnpm test:e2e` was **not** run.

Every mutant applied during this round's re-measurement (H1/H2/H3/H4/H6, against
both the `e3c44c7` and `c946079` test files) was reverted from a byte-for-byte
snapshot taken before the first run; `git status` is clean apart from this file,
and the md5 of `packages/graph/src/search.ts`, `packages/graph/test/search.test.ts`
and `apps/server/test/api.test.ts` each matches its pre-round value.
