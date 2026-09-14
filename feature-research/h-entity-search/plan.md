# Phase H-a — partial entity search — PLAN (rev 3)

Rev 1 → "Fix first" (7 blocking). Rev 2 → "Fix first" (6 blocking), from a
**fresh reviewer** that re-verified rev 1's findings rather than trusting them.
Rev 3 fixes all 6, marked `[B1]`…`[B6]` and `[nb]` inline.

**Rev 2's own new text repeated this phase's signature failure twice**: H10
carried a false because-clause *and* was unbuildable by the very measurement
used to delete H5/H8, and H9c — written to prove the ordering was rigorous —
passed under its own mutant on half the fixtures an implementer would write.
Both are fixed below. Deleted gate numbers are never reused.

## Where this sits

Phase G (the store) is closed. First phase of **H — entity references**:

> search by entity partial match; select an entity; find the related methods
> and the lines that call it.

H-a delivers the **search half**, as a library + server route. Surfaces (CLI,
web) are H-a2; references are H-b/H-c. Ladder at the bottom.

## Measured facts

Measured at `d45907a`. Facts 2–9 were **independently re-verified by the round-2
reviewer against source and the live corpus**; the implementer need not
re-derive them.

1. **No entity, table, shape or component in the corpus is named `*Email*`** —
   zero, case-insensitive, all five graphs. "Email" exists only as a leaf
   property or shape field. `[B3]` **Corrected counts** (rev 2's were wrong):

   | | entity properties | shape fields |
   |---|---|---|
   | repoA | 4 (`User.Email`, `User.NormalizedEmail`, `User.EmailConfirmed`, `WaitlistEntry.Email`) | **4** (`LoginRequest`, `RegisterRequest`, `UserProfileDto`, `WaitlistSignupRequest`) |
   | repoB | 1 | **5** |
   | repoC/D/E | 0 | 0 |

   Rev 2 said 24 and 12. **24 was repoA + repoAClient** — a separate corpus
   entry producing a separate graph; 12 was not reproducible. In repoA it is a
   **4-vs-4 tie**, not "most of the email text".
   **Consequence, unchanged: search restricted to entity names answers the
   motivating example with an empty list.** Property matching is mandatory.
2. **No substring matching exists anywhere**; no route reads `req.query`.
3. Original names survive normalisation (`names.ts:50`, `:38`).
4. **`EntityGraph` is a bare `z.object`** (`schema/src/index.ts:294`) — zod
   strips unknown keys. No stored envelope is at risk; this phase adds no
   graph field.
5. **`tableName` and `column` are `z.string()`, NOT nullable**
   (`schema/src/index.ts:99`, `:64`); only `namespace`/`dbSetName` are
   nullable. → H8 deleted. Re-verified.
6. **`property.column` is always `property.name`** — `dotnet.ts:398`,
   `node/ddl.ts:182`; **zero `[Column]` or `HasColumnName` handling anywhere**.
   → H5 deleted. Re-verified.
7. **Node-side `tableName` duplicates `name`** (`node/ddl.ts:186-191`); .NET
   side genuinely differs (`dotnet.ts:417-431`, `dbSetName ?? name`,
   `ToTable(...)`).
8. **`isFramework` is the literal `false` at both and only construction sites**
   — `dotnet.ts:436`, `node/ddl.ts:199`, no assignment anywhere in `packages/`
   or `apps/`. **No graph psq can emit has `isFramework: true`**; all 17 of
   repoA's entities, Identity-derived included, are `false`. `[B1]` *(New
   fact. Rev 2 claimed the opposite and built gate H10 on it.)*
9. Entity counts 17/9/0/13/5. `workspace.ts:402` throws "No entities found"
   before a 0-entity repo can open → the empty-graph case is **unit-level
   only**. `MINI_EFCORE` has `Student.Email`
   (`Models/Entities/Student.cs:14`); `api.test.ts` is hermetic (no corpus);
   `vitest.config.ts` includes `apps/*/test/**`.
10. **MINI_EFCORE `tableName`s are all `dbSetName`-derived**, no `ToTable`:
    `Student/Students`, `Course/Courses`, `Department/Departments`,
    `Advisor/Advisors`, `Enrollment/Enrollments`. `[nb]`
11. **express 5.2.1, `query parser` = `"simple"`**: `?q=a&q=b` → `["a","b"]`,
    `?q=` → `""`, missing → `undefined`.
12. `test/fixtures/mini-efcore/Models/Student.cs` is a **deliberate stale
    duplicate**; extraction yields 5 entities with exactly one `Student` (from
    `Models/Entities/`). Any fixture walking `Models/` would see two. `[nb]`

## Goal

One pure, deterministic `searchEntities(graph, query)` in `packages/graph`,
exposed as `GET /api/repos/:id/search?q=`.

## Non-goals

- No reference/call-site data; no graph field; no `EXTRACTOR_VERSION` bump.
- **No CLI and no web UI** `[nb]` — both move to H-a2. Rev 2 kept the CLI with
  a "drop it if the phase overruns" escape hatch; the reviewer's advice was to
  split it up front rather than under pressure, which also removes an entirely
  new `apps/cli/test/` harness from this phase.
- No fuzzy matching. No shape searching (reported via `searched`, D-Ha-8).
- Not fixing the .NET 0-routes blind spot or the expression-bodied-method gap.

## Design decisions

- **D-Ha-1 — search lives in `packages/graph`.** It depends on `@psq/schema`
  and **devDepends on `@psq/extract`** `[nb]` — the latter is what makes the
  "extract, never hand-write" fixture rule below possible. `apps/server` and
  the root already depend on `@psq/graph`; no cycle, no new edge.
  `packages/graph/src/index.ts` already holds `invariants`/`degrees`/`mermaid`
  inline and re-exports `layout`/`layout3d`, so `search.ts` + a re-export
  matches the existing shape.
- **D-Ha-2 — case-insensitive substring**, on the **raw declared strings**,
  never on `conceptKey`/`fieldKey`.
- **D-Ha-3 — a hit is always an ENTITY**, carrying the reasons it matched. One
  entity appears at most once.
- **D-Ha-4 — THREE match fields: `entityName`, `tableName`, `propertyName`.**
  `columnName` deleted (fact 6). Shapes excluded — a shape is not an entity and
  `mirrors` is ~4% populated. Per fact 7 a Node-side entity matching on its
  name also carries a `tableName` reason; **that is real output, not a bug**,
  and the type comment says so.
  **`isFramework` is NOT filtered** — but per fact 8 that is currently a
  **no-op**, not a safeguard, and the comment must say so rather than implying
  it protects a reachable case. `[B1]`
- **D-Ha-5 — the ordering.** `[B2]` `[nb]`
  1. A hit's rank is the **minimum** rank of its reasons: `entityName` 0,
     `tableName` 1, `propertyName` 2.
  2. **Hits** sort by rank asc → `entity.name` asc → `entity.namespace` asc
     (null → `""`) → `entity.file` asc.
  3. **The `reasons` array** sorts by rank asc → matched-string asc. It must
     NOT fall out of `properties[]` order.
  4. Every comparison is **code-unit `<`/`>`, never `localeCompare`**, which
     is locale/ICU-dependent and **returns 0 for distinct strings** (verified
     on this repo's node: `"é".localeCompare("é") === 0`). The
     `degrees`/`adjacency` precedent in `packages/graph/src/index.ts` uses
     `localeCompare`; this file deliberately does not, and says why.
  5. **This is a deterministic order, not a provably total one** `[nb]`: two
     entities sharing name, namespace and file would tie. That is unreachable
     today (same name + namespace = same entity), and the plan does not claim
     "total" — rev 2 did, while leaving that hole.
  **Rule-7 (determinism) surface.**
- **D-Ha-6 — empty/whitespace query returns no hits**, not everything.
  `"".includes()` is true for every string; that is the trap.
- **D-Ha-7 — the four wire types live ONCE, in `packages/schema`**, imported
  by `packages/graph`. Reason: the H-a2 web client must parse the response and
  `schema` is where shared wire types live. *(Rev 1's reason — "so the route
  validates its own output like the others" — was false and stays withdrawn:
  `app.ts` has one `safeParse`, at `:254`, on input. This phase adds no output
  validation.)*
- **D-Ha-8 — the response reports what was searched**, so the shapes cut is
  visible at the API surface rather than only in a record the user never reads.
  `[nb]` **`searched` is derived, not hardcoded**: `search.ts` exports
  `MATCH_FIELDS` as the single array the matcher iterates, and the route spreads
  it into the response. A hardcoded literal could not drift-fail when a fourth
  field is added.
- **D-Ha-9 — derived names get a comment, and the plan states why that is
  weaker than D-Ha-8.** `[nb]` A `tableName` reason is usually psq convention
  (`dotnet.ts:417`, `dbSetName ?? name`); all 5 MINI_EFCORE and all 17 repoA
  `tableName`s are convention-derived. It is **not** labelled in the response,
  because **`Entity` carries no `FactSource`** (`schema/src/index.ts:93-107` —
  only `Index` and `Relation` do), so psq cannot tell an explicit `ToTable`
  from a convention and any label would be a guess — which rule 3 forbids.
  D-Ha-8 surfaces a fact psq knows; this one psq does not know. **Ungated and
  deliberately so**; recording the asymmetry rather than pretending the two
  cases got the same treatment.
- **D-Ha-10 — guard order: the repo lookup runs FIRST, then `q` validation.**
  `[B4]` *(New. Rev 2 left this unspecified while giving two contradictory
  instructions — "extend the existing 404 loop", which sends no query string,
  and "H13 must send a valid `q`".)* An unknown repo is unknown regardless of
  query validity, and this lets H13 be one entry in the existing parameterised
  loop at `api.test.ts:120-121`. 404 beats 400.

## Matching semantics

1. `q = query.trim()`; if `q === ""` → no hits.
2. `needle = q.toLowerCase()`.
3. Per entity: `name` → `entityName`; `tableName` → `tableName`; each
   `property.name` → `propertyName`. All via
   `haystack.toLowerCase().includes(needle)`.
4. An entity with ≥1 reason yields one hit, reasons ordered per D-Ha-5.3.
5. Hits sorted per D-Ha-5.2.

**No null guards** (fact 5) — unreachable code whose gate would be inert.

## The wire types `[B5]`

*(Rev 2 named these four and never shaped them, and contradicted itself on the
response body — "200s with `[]`" vs "an object carrying `searched`".)*
**`searchEntities` returns `EntitySearchHit[]`; the ROUTE wraps it in an
`EntitySearchResult`.** The body is never a bare array.

```
EntityMatchField  = "entityName" | "tableName" | "propertyName"   (z.enum)
EntityMatchReason = { field: EntityMatchField, matched: string,
                      property: string | null }   // property set iff propertyName
EntitySearchHit   = { name, tableName, namespace: string | null,
                      file, reasons: EntityMatchReason[] }
EntitySearchResult= { query: string, searched: EntityMatchField[],
                      hits: EntitySearchHit[] }
```

`matched` is the **raw declared string** that matched, never lowercased — it is
what a UI renders. An empty query yields `hits: []` with `searched` populated.

## Files touched

| File | Change |
|---|---|
| `packages/schema/src/index.ts` | **ADD** the four schemas above + inferred types. **No change to `EntityGraph`.** |
| `packages/graph/src/search.ts` | **NEW** — `searchEntities()`, `MATCH_FIELDS`, the comparators. Imports types from `@psq/schema`; defines none. |
| `packages/graph/src/index.ts` | re-export `searchEntities`, `MATCH_FIELDS` |
| `apps/server/src/app.ts` | **ADD** `GET /api/repos/:id/search?q=`. Import from `@psq/schema` only — **no bare `import { z } from "zod"`**; `apps/server/package.json` still does not declare `zod` (carried debt, restated not fixed). |
| `packages/graph/test/search.test.ts` | **NEW** — unit gates |
| `apps/server/test/api.test.ts` | **ADD** route gates; extend the parameterised 404 loop at `:120-121` with `search` |

Nothing else. No `apps/cli`, no `apps/web`, no `packages/extract`, no
`workspace.ts`, no `store.ts`, no `EXTRACTOR_VERSION`.

## The route

- **404** unknown repo id — checked **first** (D-Ha-10).
- **400** unless `typeof req.query.q === "string"`. Per fact 11, `?q=a&q=b`
  yields an **array**; `String(x)` would silently search `"a,b"`, and `.trim()`
  on a non-string throws into `handler` (`app.ts:43-51`).
- **200 with `hits: []`** for `?q=` (present, empty). **Missing `q` is 400;
  present-but-empty is 200** — a deliberate asymmetry, written down.

## Gates, each with the mutant that must redden it

**A gate no mutant reddens is not a gate.** Every mutant must be run and its
result reported in the audit. **A mutant that fails to redden is a finding.**

All fixtures are **hermetic** (`MINI_*`), so gates run under `PSQ_NO_CORPUS=1`.

| # | Gate | Mutant that must redden it |
|---|---|---|
| H1 | `email` on an extracted `MINI_EFCORE` graph returns `Student` via a `propertyName` reason | drop `propertyName` from `MATCH_FIELDS` |
| H2 | case-insensitive both ways (`EMAIL`, `EmAiL`) | remove `.toLowerCase()` on the haystack |
| H3 | substring, not prefix | `includes` → `startsWith` |
| H4 | `students` on `MINI_EFCORE` yields a **`tableName`-only** reason on `Student` — hermetic, since `tableName` is `Students` and `"student"` does not contain `"students"` (facts 10) `[nb]` | drop `tableName` from `MATCH_FIELDS` |
| H6 | one entity matching on both name and a property yields **one** hit with 2 reasons | push a hit per reason instead of grouping |
| H7 | `""` and `"   "` yield no hits. **Precondition: fixture has ≥1 entity** | remove the empty-query guard |
| H9a | hit order independent of `entities[]` order — shuffle, output byte-identical | delete the secondary/tertiary hit sort keys |
| H9b | **reason order** independent of `properties[]` order — shuffle, output byte-identical | delete the reason comparator |
| H9c | two entities whose names differ only by NFC/NFD both appear in a fixed order. **The fixture MUST be built NFC-first** `[B2]` | replace code-unit comparison with `localeCompare`. *(Verified: V8's sort is stable, so a comparator returning 0 preserves input order. NFD-first input makes both comparators agree and the gate stays GREEN. Input order is the gate.)* |
| H11 | `MINI_EFCORE_EMPTY_CONTEXT` (a real 0-entity extraction) yields no hits and does not throw `[nb]` | **hoisted above the sort** `[nb]`, seed the comparator from `graph.entities[0]!.name`. *(Inside a comparator body it never executes on an empty array and the mutant stays green.)* |
| H12 | 400 when `q` is absent, on a **valid** repo id | missing-`q` branch falls through to 200 |
| H12b | 400 when `q` is repeated (`?q=a&q=b`) | `typeof === "string"` → `String(q)` |
| H12c | 200 with `hits: []` when `q` is present but empty | make the empty-`q` branch 400 |
| H13 | 404 for an unknown repo id — **one new entry in the existing loop**, no query string, per D-Ha-10 | remove the repo lookup guard |
| H14 | response parses as `EntitySearchResult`, `searched` included | change a field name in the response |

`[B1]` **Rev 2's H10 (`isFramework` entities included) is DELETED** — fact 8
makes it unbuildable from any extracted graph, and its because-clause was
false. The *behaviour* (no filter) stands; there is simply nothing to gate.
Recorded under Known gaps.
Rev 1's **H5** and **H8** stay deleted (facts 6, 5) — both deletions
independently confirmed correct by the round-2 reviewer.
`[nb]` Rev 2's **H15/H16 (CLI) move to H-a2**. H16 was also inert as written:
`repoArg()` (`apps/cli/src/index.ts:33-39`) exits 2 on a missing `--repo`
regardless of the search command, so the gate passed for the wrong reason —
the same hazard the plan caught for H13 one row above. H-a2 must give it a
valid `--repo`.

**Fixture discipline:** H1/H4/H11 graphs come from **extracting** the `MINI_*`
fixtures, never from hand-written `EntityGraph` literals. A literal is exactly
how rev 1's nullability error would have reached the test file — encoding the
same wrong belief in the fixture as in the code. Note fact 12: do not walk
`Models/`.

## Verification beyond the unit gates

- Corpus sweep via a **scratchpad script, not a committed test**: run against
  all five graphs, record hit counts for `email`, `user`, and a term matching
  nothing. Must reproduce fact 1: **repoA 4 `propertyName` reasons across
  `User` + `WaitlistEntry`; repoB 1 across 1; repoC/D/E zero.** Re-verified by
  the round-2 reviewer as the correct prediction.
- `pnpm typecheck` exit 0 across all four projects.
- `pnpm test` baseline **406 passed (406)**, 32 files.
  `PSQ_NO_CORPUS=1 pnpm test` baseline **348 | 58 skipped (406)**.
  **Skipped must stay 58** — below 58 means the private corpus config vanished.
- **Do not run `pnpm test:e2e`** — it runs `build:web` and empties the
  `apps/web/dist` the live server serves from disk.
- `node`/`pnpm` are not on the default PATH; use `zsh -lc`.

## Known gaps to record, not to fix

- **Shapes are not searchable.** repoA: 4 shape fields alongside 4 entity
  properties — a tie (fact 1, corrected). Surfaced by `searched`, not silent.
- **`isFramework` is dead in practice** (fact 8) — always `false`, so "we
  include framework entities" is currently a no-op. If a reader ever sets it
  true, H10 should return as a real gate.
- **`columnName` can never be a distinct reason** while both readers set
  `column = name` (fact 6).
- **D-Ha-9 is ungated** by design — `Entity` has no `FactSource`, so a
  derived-vs-authored `tableName` label would be a guess.
- **The empty-graph path is unit-level only** (fact 9); the audit must not
  imply the route was exercised on it.
- **Carried debt, restated:** `apps/server/package.json` does not declare `zod`.
- The `api.test.ts` **401 cross-connect flake** and the **unreproduced `graph
  endpoints` flake** from G-b2. If either fires, capture the assertion text and
  the response body **before anything else** — the second's cause is not
  established and must not be tidied into the first.

## The ladder after this phase

- **H-a2** — surfaces: `psq search --repo <path> --query <term>` (whole-word
  flag, matching `--repo`/`--out`/`--seed`/`--rows`/`--section`; H15/H16 with a
  valid `--repo`) and the web search box + entity selection. Separate for the
  `build:web`/`dist` hazard and the new `apps/cli/test/` harness.
- **H-b** — `EntityRef` (entity → file/line/method), **C# side**. Highest
  yield: entity name *is* the class name, `dbSetName` *is* the DbContext
  property, all `.cs` files including repoA's 10 controllers are already
  parsed, and `csharp/fluent.ts` is precedent for scanning a `MethodDecl.body`
  token slice. Needs an `EXTRACTOR_VERSION` bump (`detect.ts:60`, compared at
  `workspace.ts:265`) — `digestOf` hashes only the target repo's files.
  Blind spot: **expression-bodied methods have `body: []`**
  (`csharp/structure.ts:338`), so `=> _context.Users.Find(id)` is invisible.
- **H-c** — TS side: `pair.ts`'s name bridge into `refs.ts`'s symbol graph.
  Precision good; **coverage capped by the ~4% `mirrors` bridge**, to be
  reported as a measured number.
- **H-d** (optional) — the .NET route blind spot: 0 routes from both .NET
  repos, no warning, while `paper-profile` has 10 `*Controller.cs` files.
