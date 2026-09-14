# Phase H-a — partial entity search — PROGRESS

**Status: SHIPPED. Three review rounds — rounds 1 and 2 "Fix first", round 3
"Ship" with zero blocking. James accepted 2026-09-14.**

This is the first phase of **H — entity references**. It delivers the *search*
half of the requirement:

> search by entity partial match; select an entity; find the related methods
> and the lines that call it.

The reference half — methods and lines — is **not built**. That is H-b/H-c.
See "The ladder" below; the exploration that scoped it is banked here and is
the most valuable thing in this file for the next phase.

Six commits on `master`, `d45907a` → `227313f`:

```
2e8d62b  H-a: searchEntities in @psq/graph, with its wire types in @psq/schema
f0c805d  H-a: GET /api/repos/:id/search
e3c44c7  docs: H-a plan (rev 3) and the implementation audit
bd94c2c  H-a review round 1: gate min-rank order (H9d) and query.trim (H7b)
c946079  H-a review round 2: gate the hit payload (H1b/H1c/H1d)
227313f  H-a review round 3: correct the audit's own numbers
```

**Not pushed** — `master` is **30 ahead** of `origin/master`. James's standing
call since phase E.

Plan: `plan.md` (rev 3, approved verbatim; revs 1 and 2 were both rejected by
plan review before any code was written). Audit: `audit.md` — the mutant table,
the corpus sweep and the cost numbers live there, not here.

---

## What shipped

| Part | Where | What |
|---|---|---|
| The wire types | `packages/schema/src/index.ts` | `EntityMatchField`, `EntityMatchReason`, `EntitySearchHit`, `EntitySearchResult`. **`EntityGraph` untouched** |
| The search | `packages/graph/src/search.ts` | **new** — `searchEntities()`, `MATCH_FIELDS`, `compareHits`, `compareReasons` |
| Export | `packages/graph/src/index.ts` | re-export |
| The route | `apps/server/src/app.ts` | `GET /api/repos/:id/search?q=` |
| Gates | `packages/graph/test/search.test.ts` | **new** |
| Gates | `apps/server/test/api.test.ts` | route gates; `search` added to the parameterised 404 loop, which also gained a `path` label |

**Final gates:** `pnpm test` **421 passed (421)**, 33 files, exit 0.
`PSQ_NO_CORPUS=1 pnpm test` **363 passed | 58 skipped (421)**. `pnpm typecheck`
exit 0 across all four projects. Baseline was 406 / 348+58.
**Skipped held at 58** at every step. `pnpm test:e2e` was never run.

**17 gates**, every one with a mutant demonstrated red — and in round 3 an
independent reviewer re-ran them rather than accepting the audit's table.

## The finding this phase turns on

**A gate list is not a coverage claim — and this time the plan was the defect,
not the build.**

G-b2 established "a gate no mutant reddens is not a gate". H-a's plan complied:
15 gates, each with a named mutant, all 15 demonstrably red. **All 15 were
honest, and the phase still shipped five ungated behaviours**, because the
table was a list of mutants someone *thought of*, not a measure of what the
code does.

- **Round 1** found two: D-Ha-5.1's minimum-rank rule (`search.ts:80` — swap
  min for max rank, suite stays green, while results visibly reorder) and
  `query.trim()` (`search.ts:136`). The `"   "` assertion was a **negative gate
  with no positive control**: it returns `[]` with or without trim, because no
  string in MINI_EFCORE holds three consecutive spaces.
- **Round 2** found three more: `tableName`, `namespace` and `file` in the hit
  payload (`search.ts:147-149`). Each could be replaced with `""`/`null` with
  the full suite green. `EntitySearchResult.safeParse` cannot catch them —
  `z.string()` accepts `""` and `namespace` is `.nullable()`. **`file` is the
  field H-b is built on.**
- **Round 3** probed 16 mutants hunting a sixth and found none.

**Every one of the five fixes was test-only. No production code was ever
wrong.** The implementation was correct at `2e8d62b` and never changed after
`f0c805d`. Three review rounds bought gates, not corrections.

**The second pattern, which cost four rounds and is the more transferable
one: a correction is a new claim, carrying the original's full evidence
burden.**

- Rev 1 of the plan asserted `tableName`/`column` were nullable (they are
  `z.string()`) and built gate H8 on it.
- Rev 2 **fixed that** and introduced H10 on `isFramework`, with a false
  because-clause — `isFramework` is the literal `false` at both and only
  construction sites, so no graph psq can emit has it `true`. The gate was
  unbuildable by the identical measurement used to delete H8, applied one
  measurement short.
- Round 1's audit correction invented a fixture property (`Enrollment
  .EnrollmentId`) that does not exist — inside the text review round 1 demanded.
- Round 3 then found two further false supporting-details in audit §1 and §2,
  **the two sections rounds 1 and 2 had each declared verified**.
- Finally, the orchestrator's own round-3 fix list proposed "correct
  `schema/src/index.ts:363` to `:362`" — **the audit was right and the
  orchestrator was wrong**, caught only because the implementer was told to
  measure rather than transcribe.

**Rules earned, for every phase after this one:**
1. **Every plan-specified behaviour needs a named mutant**, not every gate.
   Write the gate table by walking the spec, not by listing test ideas.
2. **A correction carries the original's full evidence burden.** Before
   writing a new version of a claim, check whether the document already states
   the fact correctly somewhere else — twice here it did, and the two
   statements contradicted each other.
3. **Never dictate a correction from a summary.** Measure, then write.
4. **Assert whole objects, not field-by-field.** A whole-object `toEqual`
   still fails when a payload gains an unexpected field; three field
   assertions do not.

## Decisions

- **D-Ha-1 — search lives in `packages/graph`**, a pure function over an
  already-extracted `EntityGraph`. No cycle; `apps/server` already depended on
  `@psq/graph`, and `packages/graph` already devDepends on `@psq/extract`,
  which is what makes the "extract, never hand-write" fixture rule possible.
- **D-Ha-2/4 — case-insensitive substring over THREE fields**: `entityName`,
  `tableName`, `propertyName`, on raw declared strings, never on
  `conceptKey`/`fieldKey`. `columnName` was designed in and **deleted**:
  `property.column` is always `property.name` in both readers
  (`dotnet.ts:398`, `node/ddl.ts:182`, no `[Column]`/`HasColumnName` handling
  anywhere), so it could never be a distinct reason.
- **D-Ha-3 — a hit is always an ENTITY**, carrying the reasons it matched. A
  property match returns the owning entity. This is the whole reason the
  feature answers the motivating question at all (see below).
- **D-Ha-5 — a deterministic, explicitly not-total order.** Hits: min-rank →
  name → namespace → file. Reasons: rank → matched string. **Code-unit
  comparisons only, never `localeCompare`**, which is ICU-dependent and
  returns 0 for distinct strings (NFC vs NFD) — gate H9c pins this and
  self-invalidates if node's ICU changes. The plan deliberately does not claim
  "total": name+namespace+file can tie in principle.
- **D-Ha-8 — the response reports what was searched** (`searched: [...]`), so
  the shapes cut is visible at the API surface rather than only in this file.
  Derived from `MATCH_FIELDS`, not hardcoded.
- **D-Ha-9 — derived names are NOT labelled**, deliberately. A `tableName` is
  usually psq convention (`dotnet.ts:417`, `dbSetName ?? name`), but `Entity`
  carries no `FactSource`, so psq cannot distinguish an explicit `ToTable`
  from a convention and any label would be a guess — which rule 3 forbids.
  Ungated by design; the asymmetry with D-Ha-8 is recorded rather than hidden.
- **D-Ha-10 — the repo lookup runs BEFORE `q` validation.** 404 beats 400.
  This let H13 be one entry in the existing parameterised loop.

## The motivating question, answered

"Find all related operations on an object with **Email** in the name" was the
request that opened this phase. Measured against all five corpus repos:

- **No entity, table, shape or component in the corpus is named `*Email*`.**
  Zero, case-insensitive. "Email" exists only as a leaf property or shape
  field. **A search over entity names alone would have returned nothing** —
  which is why D-Ha-3 returns the owning entity for a property match.
- Searching `email` now returns `User` and `WaitlistEntry` on repoA, `User` on
  repoB, nothing on repoC/D/E. Reproduced by the corpus sweep in `audit.md`.
- **"related operations" does not exist in the data model.** See below.

## Known gaps, recorded deliberately — do not treat these as covered

- **Shapes are not searchable.** repoA has 4 email-ish shape fields alongside
  its 4 entity properties — a *tie*, not a minority. A user searching `email`
  gets 2 entities and will not see `LoginRequest.email`. Surfaced by
  `searched`, not silent.
- **Three behaviours are recorded-not-gated**, each confirmed by round 3 to be
  ungateable without hand-writing an `EntityGraph` the extractor cannot
  produce (which the fixture rule forbids):
  `app.ts:193`'s `query: q` echo ("as received, before trimming" — no
  control); `searched: [...MATCH_FIELDS]` vs a hardcoded literal (drift is
  caught *incidentally*, not by design — a real gate needs a fourth match
  field to exist); and `compareHits`'s `namespace`/`file` tiebreaks
  (`search.ts:84-86`), where by D-Ha-5.5's own reasoning the `file` key is
  **unreachable code** — the same category the plan refused to write null
  guards for. That inconsistency is the plan's, not the implementation's.
- **`isFramework` is dead in practice** — the literal `false` at both
  construction sites (`dotnet.ts:436`, `node/ddl.ts:199`). "We include
  framework entities" is currently a no-op, not a safeguard.
- **H1b/H1c/H1d ride on one `toEqual`** and redden the same test name; only
  the vitest diff names the drifted field. A sweep harness must capture
  `failureMessages`, not test names. Kept deliberately — see rule 4 above.
- **`audit.md` §1's table carries two count regimes** — sweep-era values in
  the rows, current values in a caveat. A future round reading a row against
  the current tree will see a mismatch; the caveat is the only thing
  preventing that being logged as another false claim.
- **`apps/server/package.json` still does not declare `zod`.** Examined and
  accepted in G-b1, G-b2 and again here. The route imports from `@psq/schema`
  only. Still owed.

## Flakes

- **The G-b2 `graph endpoints` flake fired once**, during an H12 mutant run —
  a test that mutant cannot touch. It did not recur in 13 further runs, nor in
  the reviewer's 15. **The assertion text was NOT captured**: the sweep harness
  recorded failing test *names* only, which is precisely what G-b2's record
  said not to do. The harness was fixed afterwards and the 404 loop gained a
  `path` label (`api.test.ts:125`) so the next occurrence from that loop is
  capturable. **Cause still unestablished. Do not fold it into the 401 flake.**
- **The 401 cross-connect flake did not fire at all** this phase.
- Note this phase **modified the very test that flaked** (`api.test.ts`'s 404
  loop gained a 7th iteration), so "the mutant cannot affect it" exonerates the
  mutant, not the diff.

## What the next phase needs to know — the reference half

This is the exploration that H-b/H-c rest on. It was measured this phase and
should not be re-derived.

- **There is NO entity→operation edge in the graph.** An `Entity` record has no
  field pointing at a route, call or component. `Route` is `{method, path,
  file, line}` and cannot point anywhere. `routes`/`clientCalls`/`components`
  are an island joined only to each other, and those joins are near-empty:
  `clientCalls[].matches` is non-null **0 / 50** in repoA (the only graph with
  any calls), and **no corpus graph has both `routes > 0` and
  `clientCalls > 0`**, so the call→route edge is **never realized once**.
  Cross-check: zero string values in any route/call/component record equal any
  entity name.
- **Nothing anywhere walks a handler body.** `readRoutes` is express-only,
  syntactic, and stops at the path argument. `ddl.ts` only ever inspects
  `CREATE TABLE` literals, never a `SELECT`/`INSERT` in a handler.
- **C# is the higher-yield half, despite the cruder technique.** The entity
  name *is* the class name and `dbSetName` *is* the DbContext property
  (`dotnet.ts:172-177`) — a direct identity, no bridge. `walk(repoRoot,
  [".cs"])` already globs **every** `.cs` file, so repoA's **10
  `*Controller.cs` files are already parsed today and sit unused**.
  `MethodDecl.body` is a raw bracket-matched **token slice**
  (`csharp/structure.ts:330`), and `csharp/fluent.ts` is in-house precedent for
  scanning one. **Blind spot: expression-bodied methods get `body: []`**
  (`structure.ts:338`) — `=> _context.Users.Find(id)` is discarded at parse
  time, which is exactly the shape of a terse controller action.
- **TypeScript has the better machinery pointed at a 4% bridge.** On the Node
  side an entity is a **SQLite table-name string**, not a TS symbol, so there
  is nothing to start a checker-based search from. The only bridge is
  `pairShapes` (`pair.ts:26-57`), name-based `conceptKey` + field overlap,
  producing `shape.mirrors = "<entityName>"` — non-null **9/231, 6/166,
  3/40**. Meanwhile `refs.ts` holds a genuine symbol-level reference finder
  (`collectDefs` + `collectEdges`, `getSymbolAtLocation`/`getAliasedSymbol`,
  keyed by declaration *node* with an explicit comment warning that name-keying
  invents false edges). There is **no `LanguageService`** anywhere — a
  `ts.Program` alone has no `findReferences`, so `refs.ts` IS the machinery.
- **A schema change must bump `EXTRACTOR_VERSION`** (`detect.ts:60`, compared
  at `workspace.ts:265`). `digestOf` hashes **only the target repo's source
  files**, never the extractor's own code, so nothing else will notice.
  Adding an **optional** field to `EntityGraph` is safe for stored envelopes
  (zod strips unknown keys, `schema/src/index.ts:294` is a bare `z.object`);
  a **required** one breaks every stored envelope at `readEnvelope`.
- **The .NET route blind spot, unfixed:** psq extracts **0 routes** from both
  .NET repos and emits **no warning**, while `paper-profile` has 10
  `*Controller.cs` files. The silence reads as "no routes here" rather than "I
  do not look for these".
- Unchanged and still true: **never run `pnpm test:e2e` casually** — it runs
  `build:web`, which empties the `apps/web/dist` the live server serves from
  disk. `node`/`pnpm` are not on the default PATH; use `zsh -lc`. The private
  corpus config (`test/corpus.local.json`, gitignored) is the only copy of the
  ground truth, and a skipped count below 58 means it vanished.
  `test/fixtures/mini-efcore/Models/Student.cs` is a deliberate stale
  duplicate — do not walk `Models/`; extraction yields 5 entities.

## The ladder

- **H-a2 — surfaces.** `psq search --repo <path> --query <term>` (whole-word
  flag, matching `--repo`/`--out`/`--seed`/`--rows`/`--section`) and the web
  search box + entity selection. Cut from H-a deliberately: `apps/cli` has no
  test harness at all today, and `apps/web` carries the `build:web`/`dist`
  hazard. **When it lands, note the trap found here:** a CLI gate for "missing
  `--query`" must pass a valid `--repo`, or `repoArg()`
  (`apps/cli/src/index.ts:33-39`) exits 2 first and the gate passes for the
  wrong reason.
- **H-b — `EntityRef` (entity → file/line/method), C# side.** Highest yield,
  direct identity, controllers already parsed. Needs the `EXTRACTOR_VERSION`
  bump. Go in knowing about `body: []`.
- **H-c — the TS side**, chaining `pair.ts`'s bridge into `refs.ts`'s symbol
  graph. Precision good; **coverage capped by the ~4% `mirrors` bridge**, to
  be reported as a measured number, not a claim.
- **H-d (optional) — the .NET route blind spot.** At minimum it should warn.

## Starting the next phase

Read this file, then write a **new** plan. H-a is closed; there is nothing to
resume in it.

Two items are owed and deliberately not done here: `apps/server/package.json`
does not declare `zod` (examined and accepted three times now), and `master` is
**30 ahead of `origin/master` and unpushed**, James's standing call since phase
E. Neither is a loose end to tidy without asking.

**Write the gate table by walking the spec, not by listing test ideas.** That
is the one process change this phase paid for, five findings and three review
rounds deep.
