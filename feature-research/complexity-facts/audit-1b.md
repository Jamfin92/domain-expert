# Phase 1b-i — AUDIT

Plan: `plan-phase1b.md` (Revision 2). Branch `m5b-component-attribution`,
uncommitted (Phase 1's work is uncommitted in the same tree). **Not committed —
James commits.**

---

## Files changed

**This list scopes the review. It is complete.**

New:

1. `packages/extract/src/merge.ts`
2. `packages/extract/test/merge.test.ts`
3. `test/fixtures/mini-fullstack-csharp/client/tsconfig.json`
4. `test/fixtures/mini-fullstack-csharp/client/src/components/ProductList.tsx`
5. `test/fixtures/mini-fullstack-csharp/client/src/services/products.ts`
6. `test/fixtures/mini-fullstack-csharp/client/src/types/product-dto.ts`
7. `test/fixtures/mini-fullstack-csharp/server/Data/ShopDbContext.cs`
8. `test/fixtures/mini-fullstack-csharp/server/Dtos/ProductDto.cs`
9. `test/fixtures/mini-fullstack-csharp/server/Models/Category.cs`
10. `test/fixtures/mini-fullstack-csharp/server/Models/Product.cs`
11. `test/mini-fullstack-csharp.test.ts`
12. `feature-research/complexity-facts/audit-1b.md` (this file)

Modified:

13. `packages/extract/src/detect.ts`
14. `packages/schema/src/index.ts`
15. `apps/server/src/workspace.ts`
16. `packages/quiz/src/generate/ds-cloze.ts`
17. `packages/quiz/src/generate/entity-mcq.ts`
18. `apps/cli/src/index.ts`
19. `test/fixtures.ts`
20. `test/mini-node.test.ts`
21. `packages/extract/test/node.test.ts`
22. `feature-research/complexity-facts/roadmap.md`
23. `feature-research/m5b-component-attribution/roadmap.md`
24. `README.md`
25. **`tsconfig.json` — NOT in the plan's "Files touched" list. See Deviation 1.**

`packages/extract/src/csharp/structure.ts`, `packages/extract/src/dotnet.ts`,
`packages/extract/test/structure.test.ts`, `test/fixtures/mini-efcore-*` and
`test/mini-efcore-primary-ctor.test.ts` also show in `git status`. **Those are
Phase 1's uncommitted work. This phase did not touch them.**

---

## Deviations from the plan

### Deviation 1 — `tsconfig.json` (one line), outside "Files touched"

`pnpm typecheck` failed the moment the fixture existed:

```
test/fixtures/mini-fullstack-csharp/client/src/services/products.ts(1,33):
  error TS2307: Cannot find module '@/types/product-dto' or its corresponding type declarations.
```

The root `tsconfig.json` includes `test/**/*.ts` and already excludes
`test/fixtures/mini-react` and `test/fixtures/mini-solution-tie` for exactly
this reason — a fixture with its own tsconfig cannot compile under the root
program. I added `"test/fixtures/mini-fullstack-csharp"` to the same `exclude`
array, one line, immediately above the `mini-react` entry.

This is a mechanical consequence of Step 8, which the plan does list, and it
follows an established two-case precedent. It is still **outside the plan's
file list**, so it is called out here first rather than buried. The alternative
— dropping the `@/` import — would have destroyed D7's positive control, which
is the point of the whole fixture. Leaving it out would have left the tree with
a red `pnpm typecheck` for every other task on the branch.

Note the `.tsx` file did not error: the root `include` is `test/**/*.ts` only.

### Deviation 2 — `mergeGraphs` takes a fourth parameter

The plan specifies `mergeGraphs(dotnet, node, prefix)`. `nodeRootFor`'s warning
(D6) has to reach the merged graph's `warnings`, and mutating the returned graph
from `detect.ts` would be worse. Signature is
`mergeGraphs(dotnet, node, prefix, rootWarnings: string[] = [])`, and
`nodeRootFor` returns `{ root, warnings }` rather than a bare string.

### Deviation 3 — the new fixture's selftest is NOT clean, deliberately

Gate 4 reads as if the fixture would come back clean. It does not, and the
reason is structural rather than fixable here. **This is the one place where
the plan's expectation did not survive contact with the code.** Full analysis
under Gate 4.

### Nothing else

No file in the plan's "Not touched" list was modified. `node.ts`, `dotnet.ts`,
`pair.ts`, `node/*`, `packages/extract/src/index.ts`, `packages/graph/**`,
`apps/web/**`, `bank.ts`, `grade.ts`, `ds-mcq.ts`, `selftest.ts`,
`test/corpus.local.json` and every existing fixture are untouched. Nothing from
"Out of scope" was attempted — in particular no cross-stack `mirrors`, no
`programFor` change, no C# route reading, no Northwind vendoring, and no work on
Phase 1b-ii.

---

## What changed, per file

**`packages/extract/src/merge.ts` (new, ~200 lines).**
`nodeRootFor(root) -> {root, warnings}`: root itself if it has a
`tsconfig.json`; otherwise the single directory one level below that has one;
otherwise the root, with the D6 warning when there is more than one candidate
and silence when there are none. Carries its own small SKIP set with a comment
saying why it is not shared with `files.ts` (different job, one level deep,
looking for a config not for source).
`mergeGraphs(dotnet, node, prefix, rootWarnings)`: re-prefixes `Entity.file`,
`Shape.file`, `Route.file`, `ClientCall.file`, `Component.file`,
`Component.key` and every string in `ClientCall.components`; concatenates and
re-sorts entities (name-then-file), relations (id) and shapes (name-then-file);
concatenates routes / clientCalls / components **without** re-sorting, because
the .NET reader contributes none of the three, so a concat is exactly the node
reader's own order (documented in the file); rewrites the D4 schema warning when
the merged graph has entities and leaves it verbatim when it does not; emits
the D2 both-sides-have-entities warning and the D3 unpaired-shapes warning.
Pure — neither input is mutated, and that is asserted.

**`packages/extract/src/detect.ts`.** `Provider` gains `"fullstack"`. Detection
splits into `hasDotnet` / `hasNode` over the one existing `walk`. New
`extract()` arm runs both readers on two roots and merges. **Docblock rewritten,
not patched** — it now states the reversal, quotes the expired M4 premise, says
why it expired, and records the `walk`-has-no-`isTestFile` sharp edge (one stray
`.ts` in a .NET repo flips it to `"fullstack"` and pays for a `ts.Program`;
harmless but slow, and narrowing it would be a guess).

**`packages/schema/src/index.ts`.** `provider: z.string()` →
`z.enum(["efcore","sqlite-ddl","fullstack","none"])`, with a comment saying the
enum exists so consumers narrow and a missing arm stops compiling.

**`apps/server/src/workspace.ts`.** A `"fullstack"` arm in the empty-entities
message chain, and the trailing *"React clients arrive in a later milestone"*
replaced — that sentence became false with this phase.

**`packages/quiz/src/generate/ds-cloze.ts`.** Comment only, at the `columnType`
site. Says a fullstack graph is dormant here **on purpose** (its entities are
EF-sourced; a React client has no DDL) and explicitly warns the next reader not
to hoist the condition to `generateDsCloze`, because `fieldType` and
`discriminator` are ungated and already run on efcore graphs. No behaviour
change.

**`packages/quiz/src/generate/entity-mcq.ts`.** Comment only, at the distractor
ternary. Records that the else-branch is correct for `"fullstack"` **only
because** a fullstack graph's entities come wholly from the .NET side, and that
`merge.ts`'s warning — not `invariants()` — is what keeps that true. No
behaviour change.

**`apps/cli/src/index.ts`.** One extra `console.log` in `psq graph`, printing
provider plus shapes / routes / client calls / components when any is non-zero.

**`test/fixtures.ts`.** `MINI_FULLSTACK_CSHARP` with a docblock naming the three
things it controls for, the aliased import first and with the measurement that
every other number survives a broken root selection.

**`test/fixtures/mini-fullstack-csharp/**` (new, 8 files).** `server/` is an
ordinary `ShopDbContext : DbContext` with two `DbSet`s, two entities, one fluent
relation, and one DTO (`ProductDto`). `client/` carries the **only**
`tsconfig.json` in the fixture, with `paths: {"@/*": ["./src/*"]}` and
`moduleResolution: "bundler"`; `ProductList.tsx` reaches its `fetch` only
through `@/services/products`. `ProductDto` is declared on both sides, same
field count, optional differing only by casing. No build output; nothing depends
on the `walk` SKIP set.

**`packages/extract/test/merge.test.ts` (new, 19 tests).** `mergeGraphs` over
hand-built literals plus `nodeRootFor` over `mkdtemp` directories. Fully
hermetic.

**`test/mini-fullstack-csharp.test.ts` (new, 7 tests).** End to end through the
real `extract()`.

**`test/mini-node.test.ts`.** Both existing `detectProvider` assertions kept; the
`"fullstack"` one added beside them, with a comment noting the risk in reversing
this decision was never "fullstack is wrong" but "efcore stopped happening".

**`packages/extract/test/node.test.ts`.** Step 13. Quoted in full below.

**Docs.** `complexity-facts/roadmap.md`: open question 2 struck through and
answered at length (one graph, two roots, with the measurement and the two
things the merge deliberately does not do); Phase 1b-ii added as a real phase
with today's measured numbers; the "blocker that precedes everything" section
marked RESOLVED so it stops reading as present tense; Phase 1b marked done.
`m5b-component-attribution/roadmap.md` section C2 marked **SUPERSEDED**, naming
both premises that did not survive (it did not need a C# route reader — `dotnet.ts`
still hardcodes `routes: []`; and "two explicit roots" turned out to be what the
merge does internally, not an alternative to it). `README.md` test counts
138 / 193 → 204 / 262.

---

## Step 13 — the assertion quoted before and after

This is the one edit in the phase where "making a test pass" and "deleting a
real check" look alike, so both versions are here in full.

**Before** (`packages/extract/test/node.test.ts:78-81`):

```ts
  it("records the regex SPA route as a warning rather than a path", () => {
    expect(g.routes.map((r) => `${r.method} ${r.path}`)).toEqual(exp.routes!);
    expect(g.warnings.some((w) => /regular expression/.test(w))).toBe(true);
  });
```

**After:**

```ts
  it("records the regex SPA route as a warning rather than a path", () => {
    // A FLOOR, not the exact list. This was a full ordered `toEqual` over a
    // live repo that takes commits under the test, so it went stale within a
    // day of every re-pin and the whole corpus gate stopped being runnable —
    // which is worse than a weaker assertion, because a permanently-red gate
    // verifies nothing at all. Same idiom as the repoE table floor above:
    // every hand-verified route must still be found, and the count may only
    // grow. A route the repo genuinely deletes still reddens this, and that is
    // a stale pin to update rather than a psq bug.
    const routes = g.routes.map((r) => `${r.method} ${r.path}`);
    expect(routes).toEqual(expect.arrayContaining(exp.routes!));
    expect(routes.length).toBeGreaterThanOrEqual(exp.routes!.length);
    // The half that was never flaky, and the actual subject of this test: the
    // regex-path route is refused rather than recorded as a literal path.
    expect(g.warnings.some((w) => /regular expression/.test(w))).toBe(true);
  });
```

**What was kept:** the `warnings.some(/regular expression/)` assertion, verbatim
and untouched — the actual subject of the test. All nine hand-verified routes
are still individually required to be present. A count floor was **added**.

**What was given up:** exact list equality, therefore ordering, therefore the
ability to notice a route the repo *adds*.

**It was genuinely stale, measured rather than assumed.** Probe against the live
repoD, before the edit:

```
pinned count : 9
actual count : 11
old toEqual would pass?  false
missing from actual (would redden the floor): []
extra in actual (invisible to the floor): 2 routes, a GET and a PUT on one
                path that the pin does not list (corpus repo: paths withheld)
```

So the old assertion was red on arrival — the repo had grown two routes since
the Phase 1 re-pin — and the corpus gate could not be run at all. The new form
is green, and every one of the nine pinned routes is still verified. Nothing was
weakened to accommodate a psq change: no behaviour of the route reader moved in
this phase, and `test/corpus.local.json` was not touched (it is in the plan's
"Not touched" list).

---

## Step 7 — what was checked for the CLI-stdout risk

The plan required confirming no stdout assertion exists before changing
`psq graph`'s output. Checked, in this order:

1. `grep -rn "spawn\|execSync\|execFile\|console.log\|stdout" --include="*.test.ts"`
   over `packages apps test e2e` → **no matches at all.** No test file in the
   repo spawns a process or reads stdout.
2. `grep -rn "apps/cli\|cli/src/index"` over the same tree → **no matches.** No
   test imports the CLI module either, so nothing can capture its output by
   monkeypatching `console`.
3. `e2e/harness.ts` — `grep` for `spawn|exec|stdout|console` returns only
   `chromium.launch({ executablePath })` and a comment about browser console
   errors. The harness starts the server in-process and drives a browser; it
   never runs the CLI.
4. `package.json` scripts: `psq`, `selftest` and `doctor` all invoke
   `tsx apps/cli/src/index.ts` directly from a terminal, never from a test.

Conclusion: the CLI has **no** automated consumer of its stdout, so the new line
cannot break a test. It does change what a human sees for `sqlite-ddl` repos as
well as fullstack ones, which is intended and is stated in the code comment. Both
full test runs below (hermetic and corpus) were green after the change, which is
the empirical half of the same check.

---

## Recorded, not fixed

The plan asks for two categories to be written down rather than repaired.

**D5's item — `packages/quiz/src/sql/**` hardcodes C#-flavoured `baseType`
values with no provider gate.** Confirmed present and unchanged:

- `sql/types.ts:4-15` `sqliteType(p)` believes SQLite storage classes when it
  sees them (`INTEGER`/`REAL`/`TEXT`/`BLOB`/`NUMERIC`) and otherwise maps C#
  type names — `int`, `long`, `short`, `byte`, `sbyte`, `uint`, `ulong`,
  `ushort`, `bool`.
- `sql/seed.ts:85` `p.baseType === "bool"`.
- `sql/seed.ts:107-109` `p.baseType === "Guid"` and
  `["DateTime","DateTimeOffset","DateOnly"].includes(p.baseType)`.
- `sql/seed.ts:322` `p.baseType === "Guid"`.

Correct today for exactly the reason D5 gives: a graph's entities are either
all EF-sourced or all DDL-sourced, and `sqliteType`'s storage-class branch
happens to make the file tolerant of the DDL case. It stops being correct the
moment one graph holds both entity languages — which is precisely the state
`merge.ts` now warns about. **Not fixed, by instruction.**

**Anything else in that class.** One item found, and it is the same defect
one level up:

- `packages/quiz/src/generate/entity-mcq.ts:269` (the distractor ternary D5
  sends me to) is not merely *documented* as depending on the single-entity-
  language invariant — it is the **only** consumer of `provider` in the quiz
  layer that would produce a visibly wrong question if that invariant broke. It
  would offer `Guid` and `int` as distractors beside a real answer of `TEXT`.
  A comment is now there. The structural fix is per-fact provenance (a `source`
  field on `Entity`), which the plan lists as out of scope.

No third instance. `grep -rn "provider"` over `packages apps test e2e` returns
exactly the three consumers D5 names plus the four literal write sites, the one
test literal, and `apps/web/src/lib/api.ts:107` which types it as `string` over
the wire — the plan's claim that the consumer list is complete is confirmed.

---

# Gates

## Gate 1 — `PSQ_NO_CORPUS=1 pnpm test`

**Exact expected total, stated before running:** baseline is 178 passed | 58
skipped (236). This phase adds `merge.test.ts` (19 tests) and
`mini-fullstack-csharp.test.ts` (7 tests); the `mini-node.test.ts` change adds an
assertion to an existing test, not a new test. So **204 passed | 58 skipped
(262)**.

```
$ PSQ_NO_CORPUS=1 pnpm test

 Test Files  15 passed | 3 skipped (18)
      Tests  204 passed | 58 skipped (262)
   Duration  3.18s
```

**204 | 58 (262), 0 failed.** Matches the prediction exactly.

## Gate 2 — full `pnpm test` with the corpus

```
$ pnpm test

 ✓ packages/extract/test/merge.test.ts (19 tests) 8ms
 ✓ test/mini-fullstack-csharp.test.ts (7 tests) 5ms
 ✓ packages/extract/test/node.test.ts (18 tests) 5ms
 ✓ apps/server/test/api.test.ts (25 tests) 2696ms

 Test Files  18 passed (18)
      Tests  262 passed (262)
   Duration  3.33s
```

**262 passed, 0 skipped, 0 failed.**

Which kind of result this is, as the gate demands: the corpus suite was **red
before this phase** and is green after, and the single change responsible is
Step 13's repoD route assertion — the one the plan sent me to fix. Measured
above: the pin said 9 routes, the live repo has 11. Nothing else moved. No
corpus repo can change provider (the plan verified `.cs`/`.ts` counts per repo;
none holds both), so no corpus test could have been re-routed through the new
merge path, and none was: the 58 previously-skipped tests all pass unchanged.

## Gate 3 — `pnpm typecheck`

```
$ pnpm typecheck
$ tsc -p tsconfig.json --noEmit && tsc -p e2e/tsconfig.json --noEmit && pnpm --filter @psq/web typecheck && pnpm --filter @psq/desktop typecheck
$ tsc -p tsconfig.json --noEmit
$ tsc -p tsconfig.json --noEmit
```

Clean, all four projects. Whether this is a *real* control for D5 rather than a
formality is tested under Gate 7 (controls D-1 and D-2) — it is.

## Gate 4 — `pnpm selftest`, both repos

**The floor first, because a clean selftest on an empty bank is not a result.**
Graph-only generators on the new fixture: **9 questions across 7 generators** —
`cardinality` 1, `delete-behavior` 1, `dto-only-field` 1, `field-collection` 1,
`field-drift` 1, `field-optional` 2, `key-type` 2. Through the full bank
(`pnpm selftest`, which adds the SQL generators): **16 questions.** The plan's
two named preconditions behave as predicted: `entity-mcq.ts:258-259` needs
`composite.length === 1 && simple.length >= 3` and the fixture has neither
(2 entities, no composite key), so no composite-key question — but `key-type`
fires twice; `ds-mcq.ts:24`'s `MIN_CHOICES = 3` plus exactly one optional field
is satisfied by both `ProductDto` twins. This is pinned in the test file, so an
empty bank would redden rather than pass quietly.

**New fixture — 2 findings across 16 questions.**

```
$ pnpm selftest --repo test/fixtures/mini-fullstack-csharp
selftest failed — 2 finding(s) across 16 questions
  field-optional/ds.optional.client/src/types/product-dto.ts.ProductDto: prompt has 2 different reference answers across the set (description | Description): "Which field of ProductDto is optional?"
  field-optional/ds.optional.server/Dtos/ProductDto.cs.ProductDto: prompt has 2 different reference answers across the set (description | Description): "Which field of ProductDto is optional?"
```

**Northwind — 2 findings across 113 questions.**

```
$ pnpm selftest --repo ~/Developer/northwind-fullstack
selftest failed — 2 finding(s) across 113 questions
  field-collection/ds.collection.client/src/lib/api-types.ts.OrderDto: prompt has 2 different reference answers across the set (details | Details): "Which field of OrderDto holds many values rather than one?"
  field-collection/ds.collection.server/Dtos/NorthwindDtos.cs.OrderDto: prompt has 2 different reference answers across the set (details | Details): "Which field of OrderDto holds many values rather than one?"
```

**Reported plainly, as instructed: Northwind has 2 findings. That is Phase
1b-ii's subject, not a regression, and it was not "fixed".** Both findings are
one mechanism: `selftest.ts:123-129` keys `answersByPrompt` on the raw
`q.prompt`, and the DS prompts name only `shape.name` while keying the question
id on `shape.file`, so two same-named shapes read as one prompt with two
answers. Read at source to confirm it is the mechanism the plan describes and
not something new:

```ts
  const answersByPrompt = new Map<string, Map<string, string[]>>();
  for (const q of questions) {
    const byAnswer = answersByPrompt.get(q.prompt) ?? new Map<string, string[]>();
```

**Deviation 3, stated properly.** Gate 4 reads as though the fixture would come
back clean. It cannot, and the two requirements are in tension inside the plan
itself: D7 *mandates* that the DTO name be shared across the C# and TypeScript
sides, and a shared shape name is exactly the trigger for the 1b-ii defect. I
could have made the fixture clean by giving the twins different optional-field
sets — but that would be tuning a fixture to hide a live defect, which is the
worse of the two failures. So the fixture keeps its faithful shape and the test
asserts the findings **exactly**:

```ts
    const findings = selftest(questions);
    expect(findings.map((f) => `${f.generator}/${f.questionId}`)).toEqual([
      "field-optional/ds.optional.client/src/types/product-dto.ts.ProductDto",
      "field-optional/ds.optional.server/Dtos/ProductDto.cs.ProductDto",
    ]);
    expect(findings.every((f) => /2 different reference answers/.test(f.problem))).toBe(true);
```

A third finding, a different generator, or a different failure mode reddens this
rather than hiding behind a "known issues" allowance. The upside is real: this
is the **first hermetic reproduction** of 1b-ii — until now it existed only on
gitignored corpus repos and on Northwind — so Phase 1b-ii starts with a
committed failing case and a one-line way to see it go green. Recorded in the
roadmap with today's numbers.

This is the only place where the plan's stated expectation did not hold against
the real code. No design was improvised around it.

## Gate 5 — measured end-to-end on `~/Developer/northwind-fullstack`

Run through the real `extract()`:

```
provider    : fullstack
contextName : NorthwindDbContext
entities    : 8
relations   : 8
shapes      : 43
routes      : 0
clientCalls : 5
components  : 77

--- attribution, merged (root) ---
  GET /api/orders/*  @client/src/components/orders/order-detail-panel.tsx:21  -> [OrderDetailPanel]
  POST /api/contact  @client/src/pages/form-page.tsx:43  -> [FormPage]
  GET /api/customers  @client/src/services/customers.ts:21  -> [CustomersPage]
  GET /api/orders  @client/src/services/orders.ts:12  -> [OrdersPage]
  GET /api/products  @client/src/services/products.ts:16  -> [ProductList, CategoriesPage]

calls with components: [] -> 0

--- attribution, rooted at client/ (the reference) ---
  GET /api/orders/*  @src/components/orders/order-detail-panel.tsx:21  -> [OrderDetailPanel]
  POST /api/contact  @src/pages/form-page.tsx:43  -> [FormPage]
  GET /api/customers  @src/services/customers.ts:21  -> [CustomersPage]
  GET /api/orders  @src/services/orders.ts:12  -> [OrdersPage]
  GET /api/products  @src/services/products.ts:16  -> [ProductList, CategoriesPage]

merged attribution === client-rooted attribution ? true
every merged DefKey resolves ? true
shape field types 'error' : 0
```

**Every number the plan predicted, hit exactly:** provider `"fullstack"`,
`contextName` `NorthwindDbContext`, **8 entities, 8 relations, 43 shapes, 0
routes, 5 client calls, 77 components**.

**The control B1 was missing, and the reason this revision exists.** All five
client calls are attributed exactly as they are when rooted at `client/` —
`OrderDetailPanel`; `FormPage`; `CustomersPage`; `OrdersPage`; `ProductList` +
`CategoriesPage`. **Zero calls with `components: []`.** The comparison is
element-wise against a second extraction rooted at `client/`, not eyeballed:
`merged attribution === client-rooted attribution ? true`. Every `DefKey` inside
`ClientCall.components` resolves to a `Component.key` in the merged graph.

Also checked, because Revision 1's re-measurement flagged it: **zero shape fields
typed `error`.** Rooted at the outer root, `PaginationLinkProps` and
`UseCarouselParameters` came back with `error`-typed fields; two-root selection
means they do not.

Through the CLI, showing Step 7's new line:

```
$ pnpm psq graph --repo ~/Developer/northwind-fullstack
NorthwindDbContext  8 entities, 8 relations
fullstack  43 shapes, 0 routes, 5 client calls, 77 components
3 warning(s):
  - tsconfig.json: 3 referenced projects; reading only tsconfig.app.json
  - No CREATE TABLE statement was found on the TypeScript side; this graph's schema comes from the .NET entity model instead. psq reads a TypeScript schema from raw DDL only; an ORM-defined schema is not read.
  - 33 shapes from the TypeScript side were not paired against the .NET entity model; psq pairs shapes within a stack only, so mirrors:null on a TS shape means "not computed", not "no mirror".

most connected
  Order                      4
  Employee                   3
  Product                    3
  OrderDetail                2
  Category                   1
```

Without Step 7's line, this phase's entire outcome would have been invisible on
stdout — the first line alone is byte-identical to what the .NET half printed in
Phase 1.

## Gate 6 — the merged warning list is asserted, not just the counts

Northwind's full warning list is the three above, and none of them is the D4
false fact. The `tsconfig.json: 3 referenced projects` warning is pre-existing,
comes from `programFor` reading the client's solution-style config, and is
correct.

The fixture's list is asserted as an **exact array**, not sampled:

```ts
    expect(g.warnings).toEqual([
      "No CREATE TABLE statement was found on the TypeScript side; this graph's schema " +
        "comes from the .NET entity model instead. psq reads a TypeScript schema from raw " +
        "DDL only; an ORM-defined schema is not read.",
      '2 shapes from the TypeScript side were not paired against the .NET entity model; ' +
        'psq pairs shapes within a stack only, so mirrors:null on a TS shape means ' +
        '"not computed", not "no mirror".',
    ]);
    expect(g.warnings.some((w) => /this repo has shapes but no schema/.test(w))).toBe(false);
    expect(g.warnings.some((w) => /both stacks contributed entities/.test(w))).toBe(false);
    expect(g.warnings.some((w) => /candidates below it/.test(w))).toBe(false);
```

The last three are negative assertions with named subjects: the un-rewritten D4
warning must be absent, the two-entity-languages warning must be silent when
only one side has entities, and root selection must not have warned because it
had exactly one candidate and lost nothing. `merge.test.ts` covers the same
warnings from literals, including the case where the D4 warning must survive
**verbatim** (a merged graph with genuinely no schema), so the rewrite is not
unconditional.

## Gate 7 — positive controls: what makes each one FAIL

Every control below was **actually broken and the failure observed**, then
reverted. A gate that passes by finding nothing can pass because it broke.

### Control A — the fixture test fails if the `"fullstack"` arm is removed from `extract()`

Mutation: comment out `if (hasDotnet && hasNode) return "fullstack";` in
`detectProvider`, so a full-stack repo falls through to `"efcore"`.

```
   × a full-stack C# + React repo > is detected as fullstack rather than as a .NET repo
   × a full-stack C# + React repo > attributes the aliased client call to its component
   × a full-stack C# + React repo > re-prefixes every node-side path into the merge root
   × a full-stack C# + React repo > carries the shared DTO name twice, keyed by file
   × a full-stack C# + React repo > says exactly what it could not do, and states no wrong fact
   × a full-stack C# + React repo > yields a bank worth running the selftest against
   × choosing a reader > recognizes each fixture for what it is
      Tests  7 failed | 24 passed (31)
```

Six of the seven fixture tests plus the Step 12 detection test. **What makes it
fail:** the client half of the graph disappears entirely, so the shape list, the
component list, the call list and the warning list all empty out.

### Control B — the fixture test fails if `nodeRootFor` returns the root

**This is the control Revision 1 lacked, and the reason for the whole D7
fixture design.** Mutation: make the single-candidate branch return `root`
instead of descending into `client/`.

```
   × nodeRootFor > descends to the single candidate, silently — nothing was lost
   × nodeRootFor > ignores a tsconfig inside a directory that never holds repo source
   × a full-stack C# + React repo > attributes the aliased client call to its component
      Tests  3 failed | 23 passed (26)
```

```
- Expected
+ Received
-     "components": Array [
-       "client/src/components/ProductList.tsx#ProductList",
-     ],
+     "components": Array []
```

**Exactly one fixture assertion fails, and it is the attribution one.** The
shape count, the component count, the call count, every file path and every
warning are byte-identical under the mutation — verified independently by
running `extractNode` on the fixture root directly:

```
shapes:     [ 'client/src/types/product-dto.ts#CategorySummary', 'client/src/types/product-dto.ts#ProductDto' ]
components: [ 'client/src/components/ProductList.tsx#ProductList' ]
clientCalls:[ 'GET /api/products @client/src/services/products.ts:10 components=[]' ]
```

Identical to the correct extraction in every field except `components`. This is
Revision 1's failure reproduced in miniature: **a count-based fixture would pass
against a broken root selection.** The aliased import is what makes it fail.

### Control C — the name-collision test fails if the merge dedupes by name

Mutation: `shapes = [...new Map(all.map(s => [s.name, s])).values()]`.

```
   × mergeGraphs: shapes are concatenated, never deduped by name > keeps every twin, with the EXACT duplicate-name count
   × mergeGraphs: shapes are concatenated, never deduped by name > keys the twins apart by file, which is unique
   × mergeGraphs: shapes are concatenated, never deduped by name > re-sorts by name then file across both sides
   × a full-stack C# + React repo > carries the shared DTO name twice, keyed by file
   × a full-stack C# + React repo > yields a bank worth running the selftest against
      Tests  5 failed | 21 passed (26)
```

**What makes it fail:** the count is asserted **exactly** (`toHaveLength(4)`,
`byName.get("CustomerDto") === 2`, and `[...byName.values()].filter(n => n > 1)`
equal to `[2]`), so a dedupe leaves 3 shapes and one `CustomerDto` and reddens.
A `toBeGreaterThanOrEqual(3)` check would have passed. The fixture side fails
too, on the exact `file#name` multiset.

### Control D — Gate 3 is a real control for D5, not a formality

Two mutations, both against `pnpm typecheck`.

**D-1, a missing switch arm.** Delete the `case "fullstack":` block from
`extract()`:

```
packages/extract/src/detect.ts(51,44): error TS2366: Function lacks ending return statement and return type does not include 'undefined'.
```

**D-2, a mistyped provider literal that `z.string()` would have accepted.**
Change `provider: "sqlite-ddl"` to `"sqlite-dll"` in `node.ts`:

```
packages/extract/src/node.ts(224,5): error TS2820: Type '"sqlite-dll"' is not assignable to type '"efcore" | "sqlite-ddl" | "fullstack" | "none"'. Did you mean '"sqlite-ddl"'?
```

Under the old `z.string()` both mutations compiled silently, and D-2 would have
shipped a graph whose provider matched no consumer's `===` — every one of them
falling to its else-branch. Both reverted; `pnpm typecheck` clean afterwards.

### Control E — the D4 schema-warning rewrite

Mutation: pass node warnings through unchanged.

```
   × mergeGraphs: warnings > rewrites the node reader's schema warning when the merge has a schema
   × a full-stack C# + React repo > says exactly what it could not do, and states no wrong fact
      Tests  2 failed | 24 passed (26)
```

**What makes it fail:** the fixture asserts the exact warning array and
separately asserts `/this repo has shapes but no schema/` is absent. Every count
in the fixture test is unaffected by this mutation — the plan is right that the
false warning is invisible to count-based checks.

### `invariants()` is not a gate, as the plan states

Confirmed by reading `packages/graph/src/index.ts:27-61`: it reads only
`entities` and `relations`. Both come wholly from the .NET side and are
byte-identical to what Phase 1 verified, so it cannot fail here. It is called in
the fixture test (`expect(invariants(g)).toEqual([])`) as a cheap sanity check
only — the real assertions are the exact `file#name` multiset over `shapes`, the
sorted order, and the warning list.

---

## Open risks

1. **Deviation 1 needs a human decision.** One line in `tsconfig.json`, outside
   the plan's file list. Everything else is in scope. If it is rejected, the
   fixture's `@/` import must go — and with it the phase's only positive control
   for root selection.
2. **The repoD route assertion is now weaker in one direction.** It cannot see a
   route the repo *adds*. That was the price of a runnable gate; the alternative
   was a gate that has been red for a day and stays red. Ordering is no longer
   checked either.
3. **Detection sensitivity, unchanged from the plan's assessment.** One stray
   `.ts` in a .NET repo flips it to `"fullstack"` and pays for a `ts.Program`.
   It cannot move a corpus expectation or a fixture today (re-verified: the full
   corpus suite is green and every provider assertion holds), but it is a sharp
   edge and is recorded in the `detect.ts` docblock.
4. **`sql/types.ts` and `sql/seed.ts` remain provider-blind** (recorded above).
   Correct only while a graph holds one entity language. `merge.ts` now warns
   when that stops being true; nothing enforces it.
5. **Phase 1b-ii is now demonstrably live on real output.** `psq selftest`
   exits non-zero on Northwind and on the new fixture. Anyone treating
   "selftest exits 0" as a release gate will be blocked until 1b-ii lands.
6. **`test/corpus.local.json` is gitignored and untouched.** Gate 2's numbers are
   time-stamped, per Phase 1's warning; only Gate 1 reproduces on a clean
   checkout.

## Not committed

The work is in the working tree on `m5b-component-attribution`, on top of Phase
1's uncommitted changes. No git state was modified.

---

# Post-review fix — the `Property` literal in `merge.test.ts`

Review returned **Ship**, no blocking issues, with one non-blocking fix. Applied
here. **`packages/extract/test/merge.test.ts` is the only file changed by this
section**; nothing else was touched and nothing was committed.

## The finding

`packages/extract/test/merge.test.ts:33-37` built a `Property` that is not a
`Property`. It invented three fields (`isNullable`, `isKey`, `source`), omitted
two required ones (`nullable`, `isPrimaryKey`), and passed `null` where the
schema declares optional `number` / `[number, number]`.

The reason it survived: the root `tsconfig.json` `include` is
`packages/*/src/**/*.ts`, so `packages/*/test/**` is outside every project and
`pnpm typecheck` never compiled the file. `isNullable` and `isKey` appear
nowhere else in the repo — this was invented, not house style.

**Before** (`merge.test.ts:32-36`):

```ts
    properties: [{
      name: "Id", column: "Id", type: "int", baseType: "int", isNullable: false,
      isKey: true, isForeignKey: false, isNavigation: false, isCollection: false,
      maxLength: null, precision: null, source: "convention",
    }],
```

**After**, matching `packages/schema/src/index.ts:49-65` exactly — the two
optional fields (`maxLength`, `precision`) are now omitted rather than nulled:

```ts
    properties: [{
      name: "Id", type: "int", baseType: "int", nullable: false,
      isPrimaryKey: true, isForeignKey: false, isNavigation: false,
      isCollection: false, column: "Id",
    }],
```

## Verification

**1. The two standalone errors are gone.**

Before:

```
$ pnpm exec tsc --noEmit --strict --skipLibCheck --target ES2022 \
    --module NodeNext --moduleResolution NodeNext packages/extract/test/merge.test.ts
packages/extract/test/merge.test.ts(36,7): error TS2322: Type 'null' is not assignable to type 'number | undefined'.
packages/extract/test/merge.test.ts(36,24): error TS2322: Type 'null' is not assignable to type '[number, number] | undefined'.
```

After — same command, clean, exit 0:

```
$ pnpm exec tsc --noEmit --strict --skipLibCheck --target ES2022 \
    --module NodeNext --moduleResolution NodeNext packages/extract/test/merge.test.ts
exit=0
```

**2. The graphs now actually validate, which was the substance of the finding.**
`tsc` only caught the two `null`s; the missing/invented fields were the real
problem and are only visible at runtime. Checked with `zod` directly:

```
OLD literal -> INVALID: nullable: Required | isPrimaryKey: Required
               | maxLength: Expected number, received null
               | precision: Expected array, received null
NEW literal -> VALID
```

And end to end, feeding the corrected literals through `mergeGraphs` and
parsing all three graphs with the real `EntityGraph` schema:

```
dotnet input    EntityGraph.safeParse -> VALID
node input      EntityGraph.safeParse -> VALID
merged output   EntityGraph.safeParse -> VALID
```

So the merge tests no longer operate on graphs that would fail `EntityGraph`
validation, and the file will survive anyone widening the typecheck include.
(Both probes were throwaway files, run and deleted; `git status` shows none.)

**3. Full gates re-run.**

```
$ pnpm typecheck
$ tsc -p tsconfig.json --noEmit && tsc -p e2e/tsconfig.json --noEmit && pnpm --filter @psq/web typecheck && pnpm --filter @psq/desktop typecheck
$ tsc -p tsconfig.json --noEmit
$ tsc -p tsconfig.json --noEmit

$ PSQ_NO_CORPUS=1 pnpm test
 Test Files  15 passed | 3 skipped (18)
      Tests  204 passed | 58 skipped (262)

$ pnpm test
 Test Files  18 passed (18)
      Tests  262 passed (262)
```

Unchanged from the pre-fix run, as expected: `mergeGraphs` reads only `.file`,
`.name` and `.mirrors` off these literals, so this is a type correction with no
behavioural surface.

**4. Gate 7 mutation controls re-run — the tests still bite.**

This is the check that matters, because a type fix that quietly stopped
exercising the code would be worse than the original problem. Control B was
requested; Control C was run as well, since it is the one that reads the
`entity()` helper's output most directly.

**Control B** — `nodeRootFor` mutated to return the root instead of descending
to the single candidate:

```
   × nodeRootFor > descends to the single candidate, silently — nothing was lost
   × nodeRootFor > ignores a tsconfig inside a directory that never holds repo source
   × a full-stack C# + React repo > attributes the aliased client call to its component
      Tests  3 failed | 23 passed (26)
```

**Control C** — merge mutated to dedupe shapes by name:

```
   × mergeGraphs: shapes are concatenated, never deduped by name > keeps every twin, with the EXACT duplicate-name count
   × mergeGraphs: shapes are concatenated, never deduped by name > keys the twins apart by file, which is unique
   × mergeGraphs: shapes are concatenated, never deduped by name > re-sorts by name then file across both sides
   × a full-stack C# + React repo > carries the shared DTO name twice, keyed by file
   × a full-stack C# + React repo > yields a bank worth running the selftest against
      Tests  5 failed | 21 passed (26)
```

Both are **identical to the pre-fix results recorded under Gate 7** — same
failing test names, same 3/23 and 5/21 counts. The tests exercise exactly what
they did before.

`merge.ts` was restored from a backup and confirmed byte-identical (`diff` clean,
zero `MUTATED` markers remaining), and the two files pass green again:

```
      Tests  26 passed (26)
```

## Two notes from review, recorded not fixed

Both were explicitly marked no-action and are carried to `progress.md` for the
next phase. Neither is live today.

1. **`merge.ts:70` descends to a single tsconfig candidate without checking
   whether TypeScript also lives outside it.** A repo with `scripts/build.ts` at
   the root plus `client/tsconfig.json` is classified `"fullstack"` *because of*
   that root-level `.ts`, and then the node reader is pointed at `client/` and
   never reads the file that caused the classification — silently. This is the
   same "detection sensitivity" sharp edge already recorded in the `detect.ts`
   docblock and risk 3 above, seen from the other side: not just a wasted
   `ts.Program`, but a file that motivated the routing and then went unread. Not
   live: Northwind has 0 `.ts` outside `client/`, and no fixture has this shape.
2. **`node.test.ts:87` pins the route floor at 9, not the live 11**, so the
   reader could regress from 11 back to 9 without reddening. Inherent to the
   floor idiom chosen in Step 13, and the reason the exact-list assertion was
   worth having before it went permanently stale. The durable fix is a pinned
   count in `test/corpus.local.json`, which is in this plan's "Not touched" list.
