# Phase H-b2 — `refsFor` and `GET /api/repos/:id/refs` — PROGRESS

**Status: SHIPPED AND ACCEPTED. James accepted 2026-09-17.** Two review rounds —
round 1 "Fix first" (record only, code confirmed correct), round 2 "Fix first"
on one arithmetic line. Both closed.

Plan `plan.md` (rev 3, approved — rev 1 was rejected at plan review, rev 2 was
re-cut when James pulled D-Hb-10). Audit with every mutant table and measured
number: `audit.md`; round 1 is its "Review round 1" section, round 2 its
"Review round 2".

**One caveat on the last commit.** `a65a033` is record-only (audit text plus one
test *comment*) and did **not** go through a third review round — a full round
for a verified arithmetic fix was disproportionate. It was verified directly
instead: the corrected count checked against the plan's inventory table, the
suite re-run, `refs.ts` confirmed byte-identical, the four fragile anchors
confirmed unmoved, scope confirmed to two files. Every *substantive* claim in
this phase has been through review.

On `master` from `5143fe2`:

```
08d77d2  feat(graph): refsFor — address entityRefs without pulling the whole graph
b4a7ca4  feat(server): GET /api/repos/:id/refs
ef5a683  test(extract): G37 — tripwire on the ICU precondition G17 rides on
1ae82b6  docs: H-b2 phase record — plan rev 3 and audit
7856b50  docs: H-b2 phase record — built, review pending
385696f  docs(h-b2): fix the record — suite-wide mutant sets, G29 relabelled
a65a033  docs(h-b2): fix the record — gate count 11+2+1=14, G29 cite re-measured
```

`git log --oneline 5143fe2..HEAD` is the authority. **Not pushed** — master is
48 ahead of origin, James's standing call since phase E.

**Measured live at close, not taken from any agent's report:** `pnpm test`
**460 passed (460)**, 35 files — baseline 446/34, so **+14 and no pre-existing
test moved**. `PSQ_NO_CORPUS=1 pnpm test` **402 passed / 58 skipped (460)** —
**skipped held at exactly 58**, so the gitignored corpus is intact.
`pnpm typecheck` exit 0, four projects. `pnpm test:e2e` never run.
`mini-efcore-refs` still extracts to exactly **20 refs**.

## The scope decision that defines this phase

**D-Hb-10 was pulled before any work started.** The plan reached rev 2 carrying
it; James chose to defer it to H-e so the parser fix and the call-vs-mention
narrowing land together. The reason is a measurement, recorded in full under
"Deferred to H-e" — **do not re-derive it, and do not treat the H-b1 record's
"+2 refs / zero controllers" figure as current, because it is refuted.**

Pulling it also removed the `EXTRACTOR_VERSION` bump (nothing about extraction
changes, so stored envelopes stay valid and a bump would force a pointless
re-extraction of every stored repo) and the entire re-arming task — **no pin is
rewritten, so neither fragile gate was disturbed.** Verified, not assumed:
`entity-refs.test.ts` is `+35/-0` with exactly one diff hunk, inside G37, and
`DUP_LINE = 55` (`:24`), `toBe(20)` (`:300`) and both `toBe(6)` (`:246`,
`:285`) are byte-identical at their original line numbers.

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

**14 gates: 11 carry a production mutant, 2 (G26, G29) are documentation, 1
(G37) is an environmental tripwire.** All 12 mutants reddened; every one was
re-measured independently by the reviewer rather than read off the audit.

## The finding this phase turns on

**A mutant's failure set is not file-scoped, and scoping it hides the overlap
that matters.**

The audit's first draft recorded the graph-side mutants as "n of 6" — counted
within `refs.test.ts` alone. Review caught two rows wrong. Re-measuring all
five **suite-wide** found **four** wrong, including two nobody had flagged:

| Mutant | First recorded | Measured suite-wide |
|---|---|---|
| M24 drop entity predicate | 6 of 6 | **8** — adds G30, G34 |
| M25 case-fold | 1 of 6 | **1** — the only one that stays in-file |
| M27 `.reverse()` | 1 of 6 | **2** — adds G30 |
| M28 ignore `opts.via` | 1 of 6 | **3** — adds G30, G34 |
| M29 filter unconditionally | 5 of 6 | **6** — adds G30 |

The overlap this exposed is worth keeping: **`api.test.ts`'s G30 and G34
re-assert `refsFor` through HTTP**, so a selector regression is caught in two
packages, and four of five graph-side mutants cross the package boundary. That
fact was invisible while the sets were file-scoped — which is precisely what
rule 7 exists to prevent.

Rules earned, added to H-a's 1-4 and H-b1's 5-8:

9. **A gate promoted on a belief about its mutant needs the mutant run before
   the promotion ships.** `plan.md:183-185` promoted G29 from "positive
   control" to a real gate, scolding rev 1 for giving it no mutant: "It has
   one; run it." It has one — and it is caught in five other places. **G28 can
   fail alone; G29 cannot.** G29 is documentation, in the same category as the
   G26 the same plan correctly demoted. The plan made the right diagnosis and
   the wrong prescription, in a document written to prevent exactly that.
10. **Every fix commit is a fresh chance to put a false claim in the record,
    and in this phase every one did.** Round 1's fix introduced a gate count
    spending 15 from a 14-item list — in the paragraph added to correct a
    count. Round 2's fix corrected a line cite to `:111:57` using the
    reviewer's figure, which its own comment edit had already pushed to
    `:118:57`. Re-measure after editing, including the thing you just measured.

## Decisions, as built

- **D-Hb2-2** — `refsFor(graph, entity, opts?)`. Exact, **case-sensitive**;
  unknown entity → `[]` (`relationsOf`'s precedent). Order **inherited** from
  `graph.entityRefs`, never re-sorted — the one ordering decision stays in the
  walker. `opts.via` absent means **both** vias, not a filter on `undefined`.
- **D-Hb2-3** — exact, not fuzzy. `/api/repos/:id/search` owns fuzzy lookup;
  two endpoints answering the same question differently is the failure avoided.
- **D-Hb2-4** — the route reports **`known`** separately from `refs`, because
  `refs: []` is otherwise ambiguous between "referenced nowhere" and "you typed
  a name this repo never heard of" — live, given H-b1's measured name-keying
  imprecision. Unknown entity is **200 with `known: false`, never 404**; 404
  means the *repo* is not open.
- **D-Hb2-5** — **404 beats 400** (repo lookup before validation, copying
  `/search`'s commented precedent); `entity` and `via` are query params and are
  **not coerced** (`?entity=a&entity=b` arrives as an array → 400, not a lookup
  of `"a,b"`); `via` validated with **`RefVia.safeParse`**. **One deliberate
  divergence from `/search`:** a present-but-blank `?entity=` is a **400**,
  where `/search` treats `?q=` as a 200 with no hits. Noted in `app.ts`.
- **D-Hb2-6** — `via: "dbSetName"` is a **mention** rule, not an access kind,
  and must never be documented as one. Recorded in `refs.ts`'s doc comment.
- **Recorded, not gated:** `refsFor` returns a fresh array because `filter`
  always allocates — a claim with no reachable mutant, recorded in the
  `prev.kind === "punct"` tradition rather than shipped as a gate that cannot
  fail alone.

## Known gaps, recorded deliberately

- **G29 is documentation, not a gated claim** — see rule 9. Kept, relabelled,
  with the "no mutant reddens it alone" argument marked **INFERRED, not
  measured**: no counter-mutant was found, and none was proven impossible.
- **G26 (`unknown entity → []`)** — same category; G25's negative half already
  proves that path.
- **G37 is a tripwire, not a behavioural gate.** It asserts that sorting the
  ref files by code unit and by `localeCompare` yields **different** orderings
  — the environmental fact that makes G17 discriminating. It passed on arrival
  (node v24.19.0, ICU 78.3), so **G17 is not disarmed today**. Review round 1
  widened it from the `Course` subset to **all refs**, so it now also fires if a
  future edit removes only the `Student` `_Stale` row; its control (drop the
  `_Stale` rows from the derivation) reddens at 18 rows. **It does not
  duplicate G17's behavioural claim and must not be "simplified" into one.**
- **The auth gate was withdrawn at plan review as dead.** `auth.test.ts:90-96`
  already asserts the `/api` mount gates *routes it has never heard of*, so
  mounting this route outside `/api` would still return 401 and the gate would
  pass green on its own mutant. **Do not "restore" it.**
- **`apps/web/src/lib/api.ts:126`** is now **five** fields behind the schema
  (`kind`, `shapes`, `routes`, `entityRefs`, and it will not see this route).
  H-a2 owns it.
- **`apps/server/package.json` still does not declare `zod`.** Unchanged by this
  phase — `Section.safeParse` predates it — and examined for the seventh time.
- The route serves a **lookup**, not the whole ref table; `entity` is required.
  A later "all refs" form can be added without breaking the shape. James was
  offered the alternative and did not take it.

## Flakes

**One fired, and it is recorded as unresolved rather than dismissed.**
`api.test.ts > opening a repo > reopening replaces the old copy instead of
leaking a database` failed once during M27's JSON-reporter run. **Its message
and mode were not captured and have not been reconstructed** — so a later reader
cannot tell a vitest timeout under load from a real assertion failure.

It did not reproduce in ~10 subsequent full-suite runs across two agents. Three
re-verified facts behind "unrelated to this phase": `api.test.ts:16-20` builds a
**fresh `Workspace` per test**; `openMini()` posts `MINI_EFCORE`, not the refs
fixture; the test never reaches `refsFor`. This phase's diff to that file is 109
insertions and **one** deletion — the import line. **If it recurs, capture the
message first.**

Neither the G-b2 `graph endpoints` flake nor the 401 cross-connect flake
appeared.

## Deferred to H-e — D-Hb-10, fully designed and measured

**Do not re-derive this.** It cost a scout pass, five scratch-copy measurements
and a plan-review round.

**Why deferred.** Measured against the *shipped* walker, D-Hb-10 yields **+6
refs on repoA** (241 → 247), of which **2 are genuine and 4 are false
positives**; repoB does not move at all. The false positives all come from one
shape: a single-expression id helper on a controller that reads the caller from
ASP.NET's inherited `ControllerBase.User` — a `ClaimsPrincipal` — which
collides by name with repoA's Identity-derived `User` entity. They move the
controller-yield statistic 6/10 → 8/10 on **pure noise**. H-e narrows
call-vs-mention, so shipping the fix there means the noise never lands.

**This refutes the H-b1 record's demotion figure** of "+2 refs and zero
controllers", which came from a pre-build simulation against a baseline whose
own split summed to 234, not the 232 it claimed. The record's reason — that
those controller helpers reference no entity — was right in substance and wrong
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
  second near-identical flow. **Never fold into the six-case test at
  `:305-307`**, pinned to `{loaded:3, failed:3, missing:1}`.
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

## The ladder from here

- **H-e — call-vs-mention narrowing + D-Hb-10**, per above. Now has a measured
  case (4 false positives on repoA) rather than an impression.
- **H-c — the TS side.** Coverage capped by the ~4% `mirrors` bridge.
- **H-a2 — surfaces.** CLI + web. `apps/web/src/lib/api.ts:126` is five fields
  behind.
- **H-d — the .NET route blind spot.** Needs its own third fixture.

## Starting the next phase

Read this file and `audit.md`, then write a **new** plan. H-b2 is closed.

**This is the first phase in four where the plan was not the defect.** What it
did differently: **every reachability claim was measured in a scratch copy
before approval, not reasoned about** — G26's trap construct, both vias on one
entity, the non-palindromic filtered list, `MINI_EFCORE`'s real-entities-zero-
refs case. Two dead gates were caught at plan review as a result, one of them in
a plan already rewritten once to avoid exactly that.

The defects that remained were all **in the record, not the code** — and there
were four of them across two fix commits. Carry rule 10 forward: the fix commit
is where the next false claim gets in.
