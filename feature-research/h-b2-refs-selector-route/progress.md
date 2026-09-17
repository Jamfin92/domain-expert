# Phase H-b2 — `refsFor` and `GET /api/repos/:id/refs` — PROGRESS

> **STATUS: BUILT AND SELF-VERIFIED. NOT REVIEWED. NOT ACCEPTED.**
>
> The `reviewer` pass was **still running** when this file was written, at
> James's request so he could `/clear`. **Its verdict is not in this file and
> nobody has read it.** Do not treat this phase as closed.
>
> **First action for the next session:** get that review. It reviewed
> `git diff 5143fe2..HEAD` against `plan.md` (rev 3) and `audit.md`, and was
> asked for Blocking / Non-blocking / Verdict. If its result cannot be
> recovered, **re-run it** — the prompt is reproduced at the bottom of this
> file. Until then, every "shipped" claim below means *built and passing its
> own gates*, not *accepted*.

Predecessor: `feature-research/h-entity-refs-csharp/progress.md` (H-b1, shipped
and accepted 2026-09-16). This phase began at `5143fe2`.

On `master` from `5143fe2`:

```
08d77d2  feat(graph): refsFor — address entityRefs without pulling the whole graph
b4a7ca4  feat(server): GET /api/repos/:id/refs
ef5a683  test(extract): G37 — tripwire on the ICU precondition G17 rides on
1ae82b6  docs: H-b2 phase record — plan rev 3 and audit
```

`git log --oneline 5143fe2..HEAD` is the authority. **Not pushed** — master is
45 ahead of origin, James's standing call since phase E.

## The scope decision that defines this phase

**D-Hb-10 was pulled before any work started.** The plan reached rev 2 carrying
it; James chose to defer it to H-e. The reason is a measurement, recorded in
full under "Deferred to H-e" below — **do not re-derive it, and do not treat
the H-b1 record's `+2 refs / zero controllers` figure as current, because it is
refuted.**

Pulling it also removed the `EXTRACTOR_VERSION` bump (nothing about extraction
changes, so stored envelopes stay valid and a bump would force a pointless
re-extraction of every stored repo) and the whole re-arming task — **no pin is
rewritten, so neither fragile gate was disturbed.** That was verified, not
assumed: `entity-refs.test.ts` is `+29/-0`, and `DUP_LINE = 55` (:24),
`toBe(20)` (:300) and both `toBe(6)` (:246, :285) are byte-identical at their
original line numbers.

## What shipped

| Part | Where |
|---|---|
| Selector | `packages/graph/src/refs.ts` — **new**. `refsFor(graph, entity, opts?: {via?})` |
| Export | `packages/graph/src/index.ts` — one line, beside `searchEntities` |
| Route | `apps/server/src/app.ts` — `GET /api/repos/:id/refs` |
| Gates | `packages/graph/test/refs.test.ts` (**new**, G24-G29), `apps/server/test/api.test.ts` (G30-G36), `packages/extract/test/entity-refs.test.ts` (G37, one appended `describe`) |

The selector core is one line:

```ts
graph.entityRefs.filter((r) => r.entity === entity && (via === undefined || r.via === via))
```

**Measured live, not taken from the implementer's report:**
`pnpm test` **460 passed (460)**, 35 files — baseline was 446/34, so **+14 and
no pre-existing test moved**. `PSQ_NO_CORPUS=1 pnpm test` **402 passed / 58
skipped (460)** — **skipped held at exactly 58**, so the gitignored corpus is
intact. `pnpm typecheck` exit 0, four projects. `pnpm test:e2e` not run.
`mini-efcore-refs` still extracts to exactly **20 refs**.

**14 gates, 12 mutants, all 12 reddened.** G26 and G37 have no mutant by
design and carry explicit audit rows saying why. Full table with verbatim
vitest output: `audit.md`.

## Decisions, as built

- **D-Hb2-2** — `refsFor(graph, entity, opts?)`. Exact, **case-sensitive**
  match; unknown entity → `[]` (`relationsOf`'s precedent). Order **inherited**
  from `graph.entityRefs`, never re-sorted — the one ordering decision stays in
  the walker. `opts.via` absent means **both** vias, not a filter on
  `undefined`.
- **D-Hb2-3** — exact, not fuzzy. `/api/repos/:id/search` is the fuzzy lookup
  and owns that contract; two endpoints answering the same question differently
  is the failure being avoided.
- **D-Hb2-4** — the route reports **`known`** separately from `refs`, because
  `refs: []` is otherwise ambiguous between "referenced nowhere" and "you typed
  a name this repo never heard of" — live, given H-b1's measured name-keying
  imprecision. An unknown entity is **200 with `known: false`, never 404**; 404
  means the *repo* is not open.
- **D-Hb2-5** — **404 beats 400** (repo lookup runs before validation, copying
  `/search`'s commented precedent); `entity` and `via` are **query params and
  are not coerced** (`?entity=a&entity=b` arrives as an array and is a 400, not
  a lookup of `"a,b"`); `via` validated with **`RefVia.safeParse`**, not a
  hand-written pair.
- **D-Hb2-6** — `via: "dbSetName"` is a **mention** rule, not an access kind,
  and the route must never be documented as though it were. Recorded in
  `refs.ts`'s doc comment so the next reader meets it there.
- **Recorded, not gated:** `refsFor` returns a fresh array because `filter`
  always allocates. No mutant makes it return the live array without also
  breaking the entity filter, so it is a claim with no reachable mutant —
  recorded, in the `prev.kind === "punct"` tradition, rather than shipped as a
  gate that cannot fail alone.

## The one divergence from the plan

The plan **predicted** M29 would redden G29 and *not* G28. **It reddens both.**

Cause: the built G28 carries a partition control —
`entityName.length + dbSetName.length === refsFor(g, "Course").length` — whose
third call passes no `via`, so M29 empties it (`expected 11 to be +0`).

The implementer **kept the control** rather than deleting it to make the
prediction come true, which is the right call: dropping a positive control to
satisfy a predicted failure set is weakening a gate to protect a document. The
claim the prediction existed to establish still holds and is measured — the two
mutants have **different** failure sets, and **G29 reddens under M29 while
staying green under M28**.

**This is unreviewed.** It is the single most likely thing for the pending
review to push back on: the open question is whether G28 has quietly become a
gate that cannot fail alone. Read the review before accepting it.

## Known gaps, recorded deliberately

- **G37 is a tripwire, not a behavioural gate.** It asserts that sorting the
  `Course` ref files by code unit and by `localeCompare` yields **different**
  orderings — the environmental fact that makes G17 discriminating. It passed
  on arrival (node v24.19.0, ICU 78.3), so **G17 is not disarmed today**. Its
  control was measured separately: filtering the `_Stale` rows out of the
  derivation reddens it. It is deliberately *derived* rather than asserting the
  literal `_Stale/Student.cs` pair, so it also fires if a future edit removes
  those rows — which would disarm G17 just as completely as an ICU change.
  **It does not duplicate G17's behavioural claim and must not be "simplified"
  into one.**
- **G26 (`unknown entity → []`) has no distinct mutant** and is documentation,
  not a gated claim — G25's negative half already proves that path.
- **The auth gate was withdrawn at plan review as dead.**
  `auth.test.ts:90-96` already asserts the `/api` mount gates *routes it has
  never heard of*, so mounting this route outside `/api` would still return 401
  and the gate would pass green on its own mutant. **Do not "restore" it.**
- **`apps/web/src/lib/api.ts:126`** is now **five** fields behind the schema
  (`kind`, `shapes`, `routes`, `entityRefs`, and it will not see this route
  either). H-a2 owns it.
- **`apps/server/package.json` still does not declare `zod`.** Examined and
  accepted for the seventh time.
- The route serves a **lookup**, not the whole ref table — `entity` is
  required, missing is a 400. A later "all refs" form can be added without
  breaking the shape. James was offered the alternative and did not take it.

## Deferred to H-e — D-Hb-10, fully designed and measured

**Do not re-derive this.** It cost a scout pass, five scratch-copy measurements
and a plan-review round. Carried verbatim from `plan.md`.

**Why deferred.** Measured against the *shipped* walker, D-Hb-10 yields **+6
refs on repoA** (241 → 247), of which **2 are genuine and 4 are false
positives**; repoB does not move at all. The false positives are all
`private Guid GetUserId() => Guid.Parse(User.FindFirstValue(...));` — ASP.NET's
inherited `ControllerBase.User`, a `ClaimsPrincipal`, colliding with repoA's
`User` entity (`Models/Domain/User.cs`, the Identity-derived one). They move
the controller-yield statistic 6/10 → 8/10 on **pure noise**. H-e narrows
call-vs-mention, so shipping the fix there means the noise never lands.

**This refutes the H-b1 record's demotion figure** of "+2 refs and zero
controllers", which came from a pre-build simulation against a baseline whose
own split summed to 234, not the 232 it claimed. The record's reason —
"`GetUserId` helpers referencing no entity" — was right in substance and wrong
in letter, and the letter is what the walker sees.

**The fix.** `structure.ts:336-341`'s scan is undepth-tracked and correct today
only because its result is discarded. Replace it with the depth-tracked pattern
already in the same file at `:356-367`, capturing `tokens.slice(start, k)` where
`start = k + 1` at the `=>`.

**The regression it must not ship.** `i = k + 1` does **not** preserve the
resume position — the expression is unchanged, `k` is not. Measured on
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

**The fixture block**, validated end to end (20 → 22 refs, line 55 anchor
intact, `StudentsController`'s two hardcoded `6`s unmoved, entities / relations
/ shapes / warnings unmoved), appended to `Services/EnrollmentService.cs` at
line 56+ — that file ends at line 55, so the `Dup` anchor cannot move:

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
block): `Student | Terse.Plain | dbSetName` and
`Course | Terse.Nested | entityName`, both in `Services/EnrollmentService.cs`.

**Other facts H-e inherits:**

- **`EXTRACTOR_VERSION` must bump** when the fix lands — stored envelopes
  re-extract only on a version difference (`workspace.ts:265`). Cheapest form:
  amend G23 (`rehydrate.test.ts:552-585`) in place, two literals, rather than a
  second near-identical flow. **Never fold into the six-case test at `:305-307`**,
  which is pinned to `{loaded:3, failed:3, missing:1}`.
- **A new ungated capability**: after the fix an expression-bodied
  `OnModelCreating` feeds `entityConfigs` (`dotnet.ts:193`) where it fed `[]`.
  No corpus repo has one, so nothing observes it — one inline `fluent.test.ts`
  case gates it.
- **Corpus blast radius, measured**: 0 type-signature differences across
  repoA's 101 and repoB's 39 files; 19 methods on repoA and 1 on repoB gain a
  non-empty body; entities, relations and warnings unmoved. Only repoA pins
  `warnings: []` (`dotnet.test.ts:114-116`) — repoB and repoC do not, so
  measure theirs by hand.
- **Members that never reach `structure.ts:336`**: expression-bodied
  constructors and operators/conversions (caught at `:288` and the field branch
  at `:411`); explicit interface implementations (field branch, no method at
  all); generic methods with a `where` constraint (skipped by `:317-319`, whose
  scan runs past the `=>`); indexers (field branch). All pre-existing holes.

## The ladder from here

- **H-e — call-vs-mention narrowing + D-Hb-10**, per the section above. Now has
  a measured case (4 false positives on repoA) rather than an impression.
- **H-c — the TS side.** Coverage capped by the ~4% `mirrors` bridge.
- **H-a2 — surfaces.** CLI + web. `apps/web/src/lib/api.ts:126` is five fields
  behind.
- **H-d — the .NET route blind spot.** Needs its own third fixture.

## Starting the next phase

1. **Recover the pending review first** (see the banner at the top). Nothing
   below matters until the phase is actually accepted.
2. Then read `plan.md` (rev 3) and `audit.md`, and write a **new** plan.

Process rules carried forward — H-a's 1-4 and H-b1's 5-8 still stand. H-b2 adds
nothing new to them, which is itself the result: **this is the first phase in
four where the plan was not the defect.** What it did differently was measure
every reachability claim *before* approval rather than reasoning about it —
G26's trap construct, both vias on one entity, the non-palindromic filtered
list, and `MINI_EFCORE`'s real-entities-zero-refs case were each run in a
scratch copy before a gate was written against them. Two dead gates were caught
at plan review as a result, one of them in a plan that had already been
rewritten once to avoid exactly that.

### The pending review's prompt, if it must be re-run

Review `git diff 5143fe2..HEAD` against `plan.md` (rev 3) and `audit.md`.
Priorities: (A) are the gates actually live — spot-check by applying M33, M35,
M36 and confirming G26/G37's mutant-less status is honest; (B) the M29/G28
divergence above — has G28 become a gate that cannot fail alone; (C) route
correctness against D-Hb2-5 and the neighbouring `/search` precedent;
(D) scope discipline; (E) audit quality — verbatim messages, a row per gate,
whole failure sets; (F) the code itself. Report Blocking / Non-blocking /
Verdict.
