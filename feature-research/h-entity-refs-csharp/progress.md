# Phase H-b1 — entity references, C# side, extraction half — PROGRESS

**Status: BUILT, gates green, awaiting review.** Plan `plan.md` (rev 2,
approved after rev 1 was rejected at plan review) followed. Audit with the full
mutant table and every measured number: `audit.md`.

Three commits on `master`, `8de5fce` → `b544419`, plus the docs commit:

```
bc9a893  H-b1: EntityRef in @psq/schema, and the C# walker that fills it
335fac1  H-b1: the mini-efcore-refs fixture and gates G1-G23
b544419  H-b1: make G17's sort keys actually observable, not merely tied
```

**Not pushed.** master stays ahead of origin — James's standing call since
phase E.

## What shipped

| Part | Where |
|---|---|
| Wire types | `packages/schema/src/index.ts` — `RefVia`, `EntityRef`, and `entityRefs` on `EntityGraph` as `z.array(EntityRef).default([])` |
| The walker | `packages/extract/src/csharp/entity-refs.ts` — **new** |
| Wiring | `dotnet.ts` (both returns), `detect.ts`, `node.ts`, `merge.ts` |
| Version | `EXTRACTOR_VERSION` 1 → 2 (`detect.ts:60`) |
| Fixture | `test/fixtures/mini-efcore-refs/` — **new**, 7 `.cs` files |
| Gates | `packages/extract/test/entity-refs.test.ts` (new), `merge.test.ts`, `apps/server/test/rehydrate.test.ts` |

Visible today through the existing `GET /api/repos/:id/graph`. No new route.

**Final:** `pnpm test` **440 passed (440)**. `PSQ_NO_CORPUS=1 pnpm test`
**382 passed / 58 skipped (440)**. `pnpm typecheck` exit 0, four projects.
Baseline was 421 / 363+58. **Skipped held at 58 through all 31 mutant runs.**
`pnpm test:e2e` was never run.

**23 gates, 26 named mutants, every one demonstrated red.**

## The finding this phase turns on

**A tie is not a reachable sort key.**

The plan carried H-a's rule forward and named the trap it expected: "if the
fixture cannot produce an `entity+file+line` tie, D-Hb-7's `via`/`method` sort
keys are unreachable and must be deleted from the comparator". The fixture
produced both required ties on the first attempt — and **both keys were still
dead**, along with the `localeCompare` mutant. Three of G17's four mutants
passed green on a fixture that satisfied every condition the plan stated.

The mechanism: the walker emits in source order and `Array.prototype.sort` is
stable, so a tie whose source order already equals its sorted order is
identical with the key and without it. `_db.Students.Add(new Student())` emits
dbSetName-then-entityName, which is already sorted. `Left` before `Right` is
already sorted. And every string in the fixture was ASCII with no case or
punctuation divergence, so ICU and code-unit collation agreed on every pair.

The fix was in the fixture, never the comparator: write each tie **descending**
(`Student created = _db.Students.Add(...)`; `Zulu` before `Alpha`), and rename
`Stale/` to `_Stale/` — `_` sorts after every letter by code unit and before
every letter under ICU, which is the fixture's only path pair the two
collations order differently.

**The transferable form: a gate's precondition is not the gate.** The plan
specified the condition (a tie) that would make the key *observable in
principle* and stopped there. What makes it observable *in this
implementation* is a tie the sort has to actually move. Rev 1 of this plan
shipped three gates no mutant could redden; rev 2 fixed those and shipped three
more of the same kind, one layer deeper — and it did so **inside the very
decision record that warns about them**. That is the third consecutive phase
where the plan, not the build, was the defect.

Rules earned, added to H-a's four:

5. **A precondition for reachability is not reachability.** After building a
   gate for an ordering, a default, or a tiebreak, delete the thing it gates
   and confirm the suite reddens. Do not reason about whether it would.
6. **The JSON reporter drops the vitest diff.** `failureMessages` carries only
   "expected [...] to deeply equal [...]". A sweep harness must run
   `--reporter=default` alongside `--reporter=json` and read the `- Expected /
   + Received` block, or it records that a whole-object gate reddened without
   ever learning which field drifted. H-a's rule 4 is unusable without this.

## Decisions, as built

- **D-Hb-1/2** — a top-level `entityRefs: EntityRef[]`; `Entity` untouched.
  `{entity, file, line, type, method, via}`, `method` not nullable.
- **D-Hb-3** — two exact-text rules, `entityName` and `dbSetName` (the latter
  requiring an immediately preceding `.` punct token). No `kind` filter:
  recorded, not gated, because `KEYWORDS` is an exact lowercase set and string
  tokens carry their delimiters, so no mutant could redden a `kind` filter
  without a fixture entity literally named `record`.
- **D-Hb-4/5** — method bodies only; `OnModelCreating` on the **detected**
  context excluded, compared by object identity rather than by class name.
  Constructor bodies are invisible because `parseCSharp` captures no
  constructors — a hole, not a choice.
- **D-Hb-6/7** — dedupe on the whole tuple; sorted `entity → file → line → via
  → method`, code-unit only. All five keys have a deletion mutant that reddens.
- **D-Hb-12** — `.default([])` plus the version bump. Both halves gated (G22,
  G23) and each redundant-looking half has the other's mutant as its control.
- **D-Hb-13/14** — name-keyed, imprecision gated by G19 and **measured at 0 on
  both corpus repos**; the delivered clause is "the lines that mention it".

## Measured, and worth carrying (full numbers in `audit.md`)

- **repoA: 241 refs**, 168 `entityName` / 73 `dbSetName`, **6 of 10**
  controllers. **repoB: 56 refs**, 24 / 32, 1 of 3 controllers.
  The plan's baseline (232 / 161 / 73 / 5-of-10) is **refuted**; only
  `dbSetName` reproduced. The plan's own split also summed to 234, not the 232
  it stated. No design decision rested on it.
- **`via: "dbSetName"` does not mean "went through the DbContext".** EF gives a
  navigation collection the same name as the DbSet, and **7 of repoA's 17
  DbSet names are also nav-property names**. In a hand-checked 15-ref sample,
  **3 are nav-property accesses**: 15/15 true as *mentions*, 12/15 as *DbSet
  accesses*. Honest as a match rule; wrong if anyone later reads it as an
  access kind.
- **Name-keying costs 0 on the corpus** — neither repo declares any type name
  twice, so `resolveType` has nothing to disambiguate. The criterion cannot see
  a same-named type from a package or a `global using`, so this is "0 today",
  not "safe".
- **No measurable extraction cost.** repoA 8-11ms with the walker, 8-10ms
  without — inside run-to-run noise. The token walk rides on parsing already
  paid for.
- **`mini-efcore` did not move**: 5 entities, 4 relations, 0 shapes, 0
  warnings, `entityRefs: []`. The plan flagged any movement as a finding; there
  was none.
- **`mini-efcore-refs`**: 2 entities, 0 shapes, 1 relation, 0 warnings, **13
  refs** — all pinned.

## Known gaps, recorded deliberately

- **"Call" is not delivered, and the schema says so.** `typeof(Student)`,
  `nameof(Student)`, a declaration and an attribute argument are all refs.
  Narrowing needs receiver and argument-list analysis — possible H-e.
- **Constructor bodies are invisible.** `parseCSharp` captures no constructor
  as a method.
- **Expression-bodied methods arrive with `body: []`** (`structure.ts:338`).
  D-Hb-10, demoted to H-b2 on the measurement that it is worth +2 refs and
  **zero** controllers on repoA.
- **`#if` blocks and comments** are dropped at `lex.ts:105-108`; an
  interpolation hole is opaque inside one string token.
- **`apps/web/src/lib/api.ts:126`** — the plan called it a hand-written
  duplicate `EntityGraph` that "will drift". It is a **subset** and has
  **already** drifted: it omits `kind`, `shapes` and `routes` today, and now
  `entityRefs` as a fourth. H-a2 owns it.
- **`resolveType`'s doc comment about repoB's shadow copies is stale** — repoB
  has 0 duplicate type names across its 28 read files. Not this phase's file.
- **`apps/server/package.json` still does not declare `zod`.** Examined and
  accepted for the sixth time.
- **The version bump re-extracts every stored repo on the next boot.** One
  time, user-visible.

## Flakes

None fired. Neither the G-b2 `graph endpoints` flake nor the 401 cross-connect
flake appeared in the baseline runs, the 31 mutant runs, or the final runs.

## The ladder from here

- **H-b2 — the selector and the route.** `refsFor` in `packages/graph`, `GET
  /api/repos/:id/refs`, and **D-Hb-10** (the expression-bodied-method parser
  fix) carrying its own before/after number. Note rev 1's trap, recorded in the
  plan: do not copy `structure.ts:337`'s undepth-tracked scan to `;`.
- **H-c — the TS side.** Coverage capped by the ~4% `mirrors` bridge.
- **H-a2 — surfaces.** CLI + web. `apps/web/src/lib/api.ts:126` is now four
  fields behind the schema.
- **H-d — the .NET route blind spot.** Needs its own third fixture.
- **H-e (new) — call-vs-mention narrowing**, if the mention-level answer turns
  out to be too noisy in use.

## Starting the next phase

Read this file and `audit.md`, then write a **new** plan. H-b1 is closed.

**Before accepting any gate on an ordering, a default or a tiebreak, delete the
thing it gates and watch the suite go red.** That is the one process change
this phase paid for, and it cost three gates that had already survived a plan
rejection written specifically to catch gates like them.
