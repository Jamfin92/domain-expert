# Phase H-b1 — entity references, C# side, extraction half — PROGRESS

**Status: BUILT, review round 1 fixes applied, gates green, awaiting
re-review.** Plan `plan.md` (rev 2, approved after rev 1 was rejected at plan
review) plus **Amendment 1**, which records the one design change review round
1 forced. Audit with the full mutant table and every measured number:
`audit.md`; round 1 is its §6.

On `master` from `8de5fce`:

```
bc9a893  H-b1: EntityRef in @psq/schema, and the C# walker that fills it
335fac1  H-b1: the mini-efcore-refs fixture and gates G1-G23
b544419  H-b1: make G17's sort keys actually observable, not merely tied
ef7b436  docs: H-b1 plan (rev 2), the implementation audit and the phase record
5bd02ab  docs: note the untracked plan files the docs commit picked up
         + review round 1 fixes (see git log)
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

**Final:** `pnpm test` **444 passed (444)**. `PSQ_NO_CORPUS=1 pnpm test`
**386 passed / 58 skipped (444)**. `pnpm typecheck` exit 0, four projects.
Baseline was 421 / 363+58. **Skipped held at 58 through every run** — 31 mutant
runs before review, 40 after. `pnpm test:e2e` was never run.

**26 gates, 34 named mutants, 33 demonstrated red.** The one that does not is
D-Hb-6's `file` dedupe component, recorded not gated — see below.

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
6. **Probe every component of a composite, not the composite.** Review round
   1 found `type` was in the emitted tuple and in the dedupe key and in no
   comparator key — while the comparator's own comment called itself total.
   Deleting each of the six dedupe components in turn then found **three**
   dead, not one. A key made of six fields is six claims, and rev 2 tested it
   as one.
7. **The JSON reporter drops the vitest diff.** `failureMessages` carries only
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
  → **type** → method`, code-unit only. **Six keys, amended from five in review
  round 1** (Amendment 1): `type` was emitted and deduped on but never
  compared, while the comment claimed the order was total over the tuple. All
  six comparator keys have a deletion mutant that reddens, and so do five of
  the six dedupe components.
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
- **`mini-efcore-refs`**: 2 entities, 0 shapes, 1 relation, 0 warnings, **18
  refs** — all six pinned. (13 refs before review round 1 added three
  reachability constructs; and `relations` was claimed pinned in the audit
  while asserted nowhere, which round 1 caught.)

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
- **D-Hb-6's `file` dedupe component is ungated**, measured: deleting
  `ref.file` from the key leaves the suite green. Collapsing on it needs two
  files declaring same-named types with same-named methods mentioning the same
  entity at the same line number, which needs a new fixture file. Recorded in
  the gate file and in Amendment 1.
- **G17's `localeCompare` gate is ICU-dependent by construction.** It rests on
  node collating `_` before letters while code units put it after
  (`"_Stale/Student.cs".localeCompare("Stale/Student.cs") === -1`, node
  v24.19.0). If node's ICU ever changes that, the gate stops distinguishing the
  two comparators and goes quietly green — it does not fail loudly. Same
  property as H-a's H9c, which was accepted on the same terms. **This is not a
  flake; do not log it as one.**
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
thing it gates and watch the suite go red — and if the thing is composite,
delete each component separately.** That is the process change this phase paid
for twice: three dead comparator keys found before review, three dead dedupe
components found by it, in a plan rejection and a build both written
specifically to catch exactly that.
