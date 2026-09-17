# Phase H-b2 — the `refsFor` selector and `GET /api/repos/:id/refs`

**Status: PLAN, rev 3. Not approved.**

Rev 1 went to plan review and came back **Fix first** on three blocking
findings; rev 2 fixed them. **Rev 3 re-cuts the phase to James's call: D-Hb-10
is pulled and deferred to H-e**, which will do the parser fix and the
call-vs-mention narrowing together so the measured noise never lands. See
"Deferred to H-e" — that work is fully designed and measured, and must not be
re-derived.

Predecessor: `feature-research/h-entity-refs-csharp/progress.md` (H-b1,
SHIPPED and accepted 2026-09-16). Tree at `5143fe2`, `master`, clean, 41 ahead
of origin — not pushed, per James's standing call since phase E.

Measured live before writing this plan, not inherited:

- `pnpm test` → **446 passed (446)**, 34 files. Matches H-b1's closing number,
  so the gitignored corpus config is present and intact.
- node **v24.19.0**, ICU **78.3**.
  `"_Stale/Student.cs".localeCompare("Stale/Student.cs")` → `-1`; code-unit →
  `+1`. **G17's precondition holds today.**

---

## Scope

Two deliverables:

1. **`refsFor`** — a selector in `packages/graph`.
2. **`GET /api/repos/:id/refs`** — the route.

Plus one optional hardening, cheap and separable, offered because James flagged
it at the phase start: the **ICU tripwire** (G37). Cut it in one line if you
would rather not touch `entity-refs.test.ts` this phase.

**Out, and why:**

- **D-Hb-10** — pulled to H-e by decision. Nothing in this phase touches
  `structure.ts`.
- **`EXTRACTOR_VERSION`.** Rev 2 bumped 2 → 3 *because* D-Hb-10 changed
  extractor output. With D-Hb-10 gone **nothing about extraction changes**, so
  stored envelopes remain valid, there is nothing to re-extract, and a bump
  would force a pointless full re-extraction of every stored repo on next boot.
  **No bump. `rehydrate.test.ts` is not touched.**
- `apps/cli` and `apps/web` surfaces (H-a2 — and note
  `apps/web/src/lib/api.ts:126`'s hand-written `EntityGraph` is four fields
  behind and will not see `entityRefs`). The TS side (H-c). The `.NET` route
  blind spot (H-d). `apps/server/package.json`'s undeclared `zod` — examined
  and left for the seventh time.

### What this scope buys, in one line

`entityRefs` currently exists but is reachable only by pulling the entire graph
through `GET /api/repos/:id/graph` and filtering client-side — 20 refs on the
fixture, **241 on repoA**. This phase makes it addressable.

---

## The two gates that fail silent — status under this scope

James flagged both at the phase start. **Under rev 3 neither is disturbed.**

The danger in rev 2 was that D-Hb-10 changed extractor output, which forced the
pinned 20-row array in `entity-refs.test.ts` to be rewritten — and both gates
ride on that pin. **This phase changes no extractor output, touches no fixture,
and rewrites no pin.** `refsFor` and the route are read-only consumers.

- **G17 (ICU)** — untouched. Still carried only by where the `_Stale/Student.cs`
  rows sit in the pinned array, still with no direct assertion of the collation
  fact. **G37 below closes that at near-zero cost**, and is the only reason this
  phase opens `entity-refs.test.ts` at all.
- **The `Dup` line-55 tie** — untouched. No fixture file is edited.

---

## Design decisions

**D-Hb2-2 — `refsFor(graph, entity, opts?)` returns `EntityRef[]`.**

```ts
export function refsFor(
  graph: EntityGraph,
  entity: string,
  opts?: { via?: RefVia },
): EntityRef[];
```

Exact, case-sensitive match on `ref.entity`. Unknown entity → `[]`, matching
`relationsOf`'s precedent (`packages/graph/src/index.ts:65`). Order is inherited
from `graph.entityRefs`, which the walker already sorted on six keys — `refsFor`
filters and never re-sorts, so one ordering decision lives in one place.
`opts.via` absent means **both** vias, not neither. New file
`packages/graph/src/refs.ts`, re-exported from `index.ts` beside the
`searchEntities` line, mirroring how `search.ts` is organised. Type-only import
from `@psq/schema`; no new runtime dependency.

**Recorded, not gated:** `refsFor` returns a fresh array because
`Array.prototype.filter` always allocates one. No mutant makes it return the
live array without also breaking G24, so a "returns a copy" gate would be a
claim with no reachable mutant — recorded in the same spirit as H-b1's
`prev.kind === "punct"` dead conjunct.

**D-Hb2-3 — exact match, not fuzzy.** `/api/repos/:id/search` already exists for
fuzzy entity lookup with its own ranked-hit contract. A selector that silently
fuzzy-matched would make `refs` and `search` two answers to the same question
that disagree. Exact, with `known` (below) telling the caller when a name missed.

**D-Hb2-4 — the route reports `known` separately from `refs`.** Response:

```
200 { entity: string, via: RefVia | null, known: boolean, refs: EntityRef[] }
```

`known` is `graph.entities.some(e => e.name === entity)`. It exists because
`refs: []` is otherwise ambiguous between "this entity is referenced nowhere"
and "you typed a name this repo has never heard of" — and H-b1's measured
name-keying imprecision (D-Hb-13/14) makes that a live product concern, not a
hypothetical. An unknown entity is **200 with `known: false`**, never 404; 404
on this route means the *repo* is not open, and one status code must mean one
thing.

**D-Hb2-5 — the request shape, the guard order, and array-valued params.**
Rev 1 left all three unstated; `app.ts:180-196` shows this codebase has already
paid for each of them on `/search`, in comments.

- **URL shape.** `entity` and `via` are **query parameters**:
  `GET /api/repos/:id/refs?entity=Student&via=dbSetName`. The entity does not go
  in the path — entity names are not URL-safe in general, and `:id/refs` keeps
  the collection addressable for a later "all refs" form.
- **Guard order: the repo lookup runs FIRST, then validation. 404 beats 400.**
  This copies `/search`'s explicit, commented decision so the two endpoints
  cannot disagree about which failure a caller sees when both are wrong.
- **Neither parameter is coerced.** With express's `simple` query parser,
  `?entity=a&entity=b` arrives as `["a","b"]`. `String(...)` would silently look
  up `"a,b"` and return a confidently wrong empty answer. A non-string `entity`
  or `via` is a **400**, exactly as `/search` treats `q`.
- 404 body is `{ error: "That repo is not open." }` — the same string every other
  `:id` route uses, via `fail()` (`app.ts:39-41`). 400 for missing/blank `entity`
  and for a `via` outside the allowed set. Responses are key-wrapped objects,
  never bare arrays.
- **`via` is validated with the schema, not a hand-written pair.** `RefVia` is a
  zod *value* at `packages/schema/src/index.ts:304`, and `app.ts:8` already
  imports from `@psq/schema` for exactly this purpose. Use
  `RefVia.safeParse(via)` so the allowed set exists once.

**D-Hb2-6 — `via: "dbSetName"` is still a mention, not an access kind.** The
route's field names and any comment on them must not imply "went through the
DbContext". H-b1 measured 7 of repoA's 16 DbSet names and **8 of repoB's 9**
colliding with navigation-property names. Surfacing refs on their own endpoint
makes it *more* likely a later reader over-reads `via`, so the response keeps the
schema's own vocabulary and the caveat is recorded here.

---

## Tasks

### Task 1 — `refsFor`

New `packages/graph/src/refs.ts`, re-export from `src/index.ts`, new
`packages/graph/test/refs.test.ts`. Tests build their graph via
`extractDotnet(MINI_EFCORE_REFS)`, following the convention `search.test.ts:7-10`
documents deliberately — **not** hand-written `EntityGraph` literals, because a
literal encodes what the author believed and then agrees with itself.

| Gate | Asserts | Mutant |
|---|---|---|
| **G24** | filters to the named entity | M24: drop the `r.entity === entity` predicate |
| **G25** | exact and case-sensitive: `"student"` → `[]`, `"Student"` → non-empty | M25: lowercase both sides |
| **G26** | an entity name absent from the graph → `[]` | **none distinct** — G25's negative half already proves the unknown-name path. Documentation, **not** a gated claim |
| **G27** | output order equals the graph's order — no re-sort | M27: `.reverse()` the result |
| **G28** | `opts.via` filters | M28: ignore `opts.via` |
| **G29** | `via` omitted returns **both** vias, not neither | M29: apply the filter unconditionally (`r.via === opts?.via`), so an omitted `via` compares against `undefined` and returns `[]`. Reddens G29 and **not** G28 |

**Reachability — measured against the unmodified tree, not reasoned (rule 5):**

| Claim | Measured on `mini-efcore-refs` as it stands today |
|---|---|
| an entity carries **both** vias (G28/G29) | **Yes.** `Course` 11 refs, `Student` 9 refs, both vias each |
| a filtered list is ≥2 rows and differs from its reverse (G27) | **Yes**, for both entities — `.reverse()` reddens |
| total refs | **20**, unchanged by this phase |

**M29 is named deliberately.** Rev 1 wrote this gate's mutant column as
"(positive control)" — i.e. a gate with no mutant, which is the exact artefact
this project keeps shipping. It has one; run it.

### Task 2 — the route

`apps/server/src/app.ts`, beside the other `:id`-scoped GETs (~:160-267), in the
`handler()` wrapper. Gates in `apps/server/test/api.test.ts` via supertest
against `createApp()`. The refs fixture is opened inline with
`request(app).post("/api/repos").send({ path: MINI_EFCORE_REFS })` — the pattern
`MINI_NODE` (:317) and `MINI_FULLSTACK_REACT` (:410) already use; `openMini()`
opens `MINI_EFCORE`, which has no refs. Add `MINI_EFCORE_REFS` to the existing
import at `:11`.

| Gate | Asserts | Mutant |
|---|---|---|
| **G30** | 200 `{entity, via, known: true, refs}` for a known entity with refs | M30: return `{refs}` alone |
| **G31** | unknown repo id → 404, body exactly `{error:"That repo is not open."}` | M31: drop the `!repo` guard |
| **G32** | missing `entity` → 400; blank/whitespace `entity` → 400 | M32: drop the validation |
| **G33** | a **known** entity with **zero** refs → 200, `known: true`, `refs: []` | M33: compute `known` as `refs.length > 0` |
| **G34** | `?via=bogus` → 400, not a silent empty result | M34: drop the via validation |
| **G35** | **guard order**: a request wrong in **both** ways — unknown repo id *and* missing `entity` — returns **404**, not 400 | M35: validate before the repo lookup |
| **G36** | **array-valued params**: `?entity=a&entity=b` → 400, not a lookup of `"a,b"`; same for `?via=x&via=y` | M36: `String(entity)` instead of a type check |

**G33's reachability, resolved in the plan rather than discovered in review:**
`mini-efcore-refs` has exactly two entities and **both carry refs**, so against
that fixture M33 is unreachable — `known` and `refs.length > 0` never disagree.
The case is reachable against **`MINI_EFCORE`**, measured: **5 real entities**
(Advisor, Course, Department, Enrollment, Student) and `entityRefs` **`[]`**. So
G33 opens `MINI_EFCORE` and asks for `Student` → `known: true`, `refs: []`. The
`known: false` half asks either repo for a name no entity has.

**G35 and G36 exist because rev 1's gates could not tell.** G31 would send a
valid `entity`, G32 a valid repo — so nothing in rev 1 observed the guard order,
and nothing observed coercion. Both are the specific traps `/search` carries
comments about.

**An auth gate is deliberately absent.** Rev 1 had one; review measured it dead.
`auth.test.ts:90-96` already asserts the `/api` mount gates *routes it has never
heard of* (`GET /api/does-not-exist` → 401), so mounting this route outside
`/api` would **still** return 401 and the gate would pass green on its own
mutant. The claim is already gated once, generically; a second copy costs
sensitivity and adds no coverage.

### Task 3 — the ICU tripwire (optional, separable)

The one reason this phase opens `entity-refs.test.ts`. **Cut this task and the
phase still stands.**

| Gate | Asserts | Mutant |
|---|---|---|
| **G37** | take `refs.filter(r => r.entity === "Course").map(r => r.file)`, sort one copy by code unit and one by `localeCompare`, and assert the two orderings **differ** | none — it asserts a property of the fixture + platform together. Control: the two orderings were measured to differ today (node v24.19.0, ICU 78.3) |

**Why derived rather than hardcoded.** An assertion on the literal pair
`"_Stale/Student.cs"` vs `"Stale/Student.cs"` fires if ICU changes but stays
**green if a future edit removes the `_Stale/` rows from the fixture** — which
disarms G17 just as completely. Deriving both orderings from the live ref set
catches both failure modes for the same line count.

**This is not a redundant guard on G17.** It asserts the environmental
precondition that makes G17 *discriminating*, not G17's behavioural claim, so it
does not desensitise G17 the way a second copy of the same assertion would.

**Adds one `it()` and no fixture change.** If it fails on arrival, stop — that
means G17 is already disarmed today, which would be a finding in its own right.

### Task 4 — close

`pnpm test`, `PSQ_NO_CORPUS=1 pnpm test`, `pnpm typecheck` (four projects).
Baselines: **446 passed (446)**; `PSQ_NO_CORPUS=1` → **388 passed / 58 skipped**.
**Skipped must hold at exactly 58** — a lower number means the private corpus
vanished; stop, do not "fix". `pnpm test:e2e` is **not** run — H-b1 did not run
it either, and it is recorded elsewhere that it empties the served `dist`
mid-build.

Because this phase changes no extractor output, the expected result is
**446 + the new tests, with every pre-existing test unmoved**. Any movement in an
existing test is a finding, not a number to update.

Audit to `feature-research/h-b2-refs-selector-route/audit.md`, in H-b1's format:
the mutant table with columns `Gate | Mutant | Applied (code diff) | Failing
assertion observed (exact vitest message/diff) | Reverted (clean check)`; every
mutant hand-applied, suite run, message captured **verbatim**, reverted,
`git status --porcelain` confirmed clean.

**Rule 8 is binding: run `--reporter=default` alongside `--reporter=json`.** The
JSON reporter drops the vitest diff, so a whole-array `toEqual` records only
"expected [...] to deeply equal [...]" and the audit never learns which field
drifted.

**Rule 7 is binding: record the whole failure SET of each mutant**, not its first
assertion. M28 and M29 in particular will overlap; the point is which assertions
differ.

---

## Gate inventory — the complete set, so none can hide

14 gates, 1 accounted-for absence. The audit must show a row for every line
below; a gate present here and absent from the audit is a dropped claim.

| Gate | Where | Mutant |
|---|---|---|
| G24 | `refs.test.ts` | M24 drop the entity predicate |
| G25 | `refs.test.ts` | M25 case-fold both sides |
| G26 | `refs.test.ts` | **none distinct** — documentation, not a gated claim |
| G27 | `refs.test.ts` | M27 `.reverse()` |
| G28 | `refs.test.ts` | M28 ignore `opts.via` |
| G29 | `refs.test.ts` | M29 filter unconditionally |
| G30 | `api.test.ts` | M30 return `{refs}` alone |
| G31 | `api.test.ts` | M31 drop the `!repo` guard |
| G32 | `api.test.ts` | M32 drop `entity` validation |
| G33 | `api.test.ts` | M33 `known = refs.length > 0` |
| G34 | `api.test.ts` | M34 drop `via` validation |
| G35 | `api.test.ts` | M35 validate before the repo lookup |
| G36 | `api.test.ts` | M36 `String(entity)` coercion |
| G37 | `entity-refs.test.ts` | none — derived ICU/fixture tripwire (optional task) |

**Absence, deliberate:** the auth gate — dead, already covered generically by
`auth.test.ts:90-96`. Recorded rather than silently omitted.

### Renumbering map — rev 2 → rev 3

Rev 2 numbered from G24 assuming the parser work led. With D-Hb-10 pulled, the
surviving gates are renumbered compactly so the table has no unexplained holes.
**This table is the control against a claim being lost in the renumbering.**

| rev 2 | rev 3 | |
|---|---|---|
| G24, G25, G26, G27, G45, G48 | — | **deferred to H-e** (parser) |
| G28, G29 | — | **deferred to H-e** (walker end-to-end for expression bodies) |
| G23-amended / G30 | — | **dropped** — no `EXTRACTOR_VERSION` bump without D-Hb-10 |
| G31 | **G24** | entity filter |
| G32 | **G25** | case-sensitive |
| G33 | **G26** | unknown → `[]` (documentation) |
| G34 | **G27** | order preserved |
| G35 | — | retired in rev 2 — "returns a copy", no reachable mutant |
| G36 | **G28** | `via` filters |
| G37 | **G29** | `via` omitted = both |
| G38 | **G30** | 200 shape |
| G39 | **G31** | 404 unknown repo |
| G40 | **G32** | 400 missing/blank entity |
| G41 | **G33** | known entity, zero refs |
| G42 | **G34** | 400 invalid via |
| G43 | — | withdrawn in rev 2 — dead auth gate |
| G44 | **G37** | ICU tripwire |
| G46 | **G35** | guard order |
| G47 | **G36** | array-valued params |
| C1, C2 | — | **not needed** — no pin is rewritten, so neither fragile gate is disturbed |

---

## Files touched

| File | Change |
|---|---|
| `packages/graph/src/refs.ts` | **new** — `refsFor` |
| `packages/graph/src/index.ts` | re-export `refsFor` only. **No `RefVia` passthrough** — `app.ts:8` already imports from `@psq/schema`, so the one caller needs nothing new |
| `packages/graph/test/refs.test.ts` | **new** — G24-G29 |
| `apps/server/src/app.ts` | the route |
| `apps/server/test/api.test.ts` | G30-G36; `MINI_EFCORE_REFS` import at `:11` |
| `packages/extract/test/entity-refs.test.ts` | G37 only — one added `it()`, **optional task** |
| `feature-research/h-b2-refs-selector-route/{plan,audit,progress}.md` | phase record |

**Not touched:** `structure.ts`, `detect.ts` (no version bump), any fixture file,
the pinned 20-row array, `rehydrate.test.ts`, `dotnet.ts`, `merge.ts`,
`apps/web/src/lib/api.ts`, `apps/server/package.json`.

---

## Deferred to H-e — D-Hb-10, fully designed and measured

**Do not re-derive this.** It cost a scout pass, five scratch-copy measurements
and a review round. Carry this section into `progress.md` verbatim at phase
close.

**Why deferred.** Measured against the *shipped* walker, D-Hb-10 yields **+6
refs on repoA** (241 → 247), of which **2 are genuine and 4 are false
positives**; repoB does not move at all. The false positives are all
`private Guid GetUserId() => Guid.Parse(User.FindFirstValue(...));` — ASP.NET's
inherited `ControllerBase.User`, a `ClaimsPrincipal`, colliding with repoA's
`User` entity (`Models/Domain/User.cs`, the Identity-derived one). They move the
controller-yield statistic 6/10 → 8/10 on **pure noise**. H-e narrows
call-vs-mention, so shipping the fix there means the noise never lands.

This also **refutes the H-b1 record's demotion figure** of "+2 refs and zero
controllers", which came from a pre-build simulation against a baseline whose own
split summed to 234, not the 232 it claimed. The record's reason — "`GetUserId`
helpers referencing no entity" — was right in substance and wrong in letter, and
the letter is what the walker sees.

**The fix.** `structure.ts:336-341`'s scan is undepth-tracked and correct today
only because its result is discarded. Replace it with the depth-tracked pattern
already in the same file at `:356-367`, capturing `tokens.slice(start, k)` where
`start = k + 1` at the `=>`.

**The regression it must not ship.** `i = k + 1` does **not** preserve the resume
position — the expression is unchanged, `k` is not. Measured on
`class C { public int A() => F(1; public int B { get; set; } public void Z() {...} }`:
today an unbalanced `(` costs one method's body; after a naive fix it swallows
the rest of the class and **a property and a method vanish with no warning**.
The fix must carry a terminator-not-found branch: warn in the form
`structure.ts:323` already uses, fall back to `body: []`, and resume by the old
naive scan. Gate it — mutants: drop the fallback, drop the warning.

**The only construct that gates the depth tracking.** Measured: the two scans
agree on `_db.Students.Count()`, `a < b ? 1 : 2`, `$"a;b"`, `new[] { 1, 2 }`,
`Make(new Foo { A = 1 })`. They diverge on **exactly one** shape — a nested
block lambda carrying its own `;` with the entity mention after it:

```csharp
public void Nested() => Run(() => { Ping(); }, typeof(Course));
```

Naive stops at token 15 and loses `Course`; depth-tracked runs to token 23 and
keeps it. **This is the only possible gate for the trap.**

**The fixture block**, validated end to end (20 → 22 refs, line 55 anchor intact,
`StudentsController`'s two hardcoded `6`s unmoved, entities/relations/shapes/
warnings unmoved), appended to `Services/EnrollmentService.cs` at line 56+ —
that file ends at line 55, so the `Dup` anchor cannot move:

```csharp
public class Terse
{
    private readonly RefsDbContext _db = null!;
    public int Plain() => _db.Students.Count();
    public void Nested() => Run(() => { Ping(); }, typeof(Course));
    private static void Run(System.Action a, object b) { a(); _ = b; }
    private static void Ping() { }
}
```

Predicted rows (identity is the prediction; line numbers follow from the exact
block): `Student | Terse.Plain | dbSetName` and `Course | Terse.Nested |
entityName`, both in `Services/EnrollmentService.cs`.

**Other facts H-e inherits:**

- **`EXTRACTOR_VERSION` must bump** when the fix lands — stored envelopes
  re-extract only on a version difference (`workspace.ts:265`). Cheapest form:
  amend G23 (`rehydrate.test.ts:552-585`) in place, two literals, rather than a
  second near-identical flow. Never fold into the six-case test at `:305-307`.
- **A new ungated capability**: after the fix an expression-bodied
  `OnModelCreating` feeds `entityConfigs` (`dotnet.ts:193`) where it fed `[]`.
  No corpus repo has one, so nothing observes it — one inline `fluent.test.ts`
  case gates it.
- **Corpus blast radius, measured**: 0 type-signature differences across repoA's
  101 and repoB's 39 files; 19 methods on repoA and 1 on repoB gain a non-empty
  body; entities, relations and warnings unmoved. Only repoA pins `warnings: []`
  (`dotnet.test.ts:114-116`) — repoB and repoC do not, so measure theirs by hand.
- **Members that never reach `structure.ts:336`**: expression-bodied
  constructors and operators/conversions (caught at `:288` and the field branch
  at `:411`); explicit interface implementations (field branch, no method at
  all); generic methods with a `where` constraint (skipped by `:317-319`, whose
  scan runs past the `=>`); indexers (field branch). All pre-existing holes.

---

## What would make this plan wrong

1. **`known` is judged scope creep.** One boolean and one `.some()`, and the only
   thing separating "no refs" from "no such entity" on an endpoint whose
   imprecision is measured. I think it earns its place; it is the cheapest thing
   here to cut.
2. **The ICU tripwire is judged out of scope.** Task 3 is deliberately separable
   for this reason — it is the only thing opening `entity-refs.test.ts`.
3. **`GET .../refs` should also serve the whole ref table** when `entity` is
   omitted, rather than 400. I chose the lookup shape because it pairs with
   `refsFor` and keeps one response shape; a later "all refs" form can be added
   without breaking it. If you want it now, say so — it is a small change to
   D-Hb2-5 and one more gate.
