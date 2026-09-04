# Phase 1b-i — Reverse `detectProvider`, and give it a fixture

**Revision 2.** Roadmap: `roadmap.md`, Phase 1b. Previous phase: `progress.md`
(Phase 1, ACCEPTED 2026-09-02, uncommitted on `m5b-component-attribution`).

Revision 1 was reviewed and returned **Fix first**. Six blocking issues; one of
them (B1) falsified the measurement Revision 1's central decision rested on.
This revision is the re-plan. **The DS-bank prompt-ambiguity work that Revision 1
carried as D8 is split out into Phase 1b-ii** — see the last section.

**Ends with: a React + .NET repo yields both components and entities in one
graph, with client-call attribution intact, pinned by a committed fixture.**

---

## What Revision 1 got wrong, measured

Revision 1 argued that both readers could run on the shared full-stack root
because `extractNode` returns "identical numbers" there and at `client/`:
33 shapes, 5 client calls, 77 components either way.

**Those three numbers cannot detect the failure that matters.** Shapes are
per-file top-level declarations, client calls are syntactic `fetch` detection,
and components are a per-file JSX + PascalCase scan. None of them moves when
module resolution breaks. Attribution does — and this repo already pins that at
`packages/extract/test/node.test.ts:155-163`.

Re-measured element-wise:

| client call | rooted at `client/` | rooted at the full-stack root |
|---|---|---|
| `GET /api/orders/*` (`order-detail-panel.tsx:21`) | `OrderDetailPanel` | `OrderDetailPanel` |
| `POST /api/contact` (`form-page.tsx:43`) | `FormPage` | `FormPage` |
| `GET /api/customers` (`services/customers.ts:21`) | `CustomersPage` | **(none)** |
| `GET /api/orders` (`services/orders.ts:12`) | `OrdersPage` | **(none)** |
| `GET /api/products` (`services/products.ts:16`) | `ProductList`, `CategoriesPage` | **(none)** |

**Three of five attributions are destroyed** — every call reached through an
`@/services/...` import. Only the two in-file fetches survive. Also 2 of 33
shapes come back with fields typed `error` (`PaginationLinkProps`,
`UseCarouselParameters`).

Cause: `client/tsconfig.app.json` carries `"paths": {"@/*": ["./src/*"]}` and
`"moduleResolution": "bundler"`. At the full-stack root `programFor`
(`node.ts:115-168`) finds no `tsconfig.json`, falls to `walk` +
`FALLBACK_OPTIONS` (`node.ts:29-40`, NodeNext, no `paths`), and the cross-file
chains break. `components: []` is then indistinguishable from "no owner".

**Component keys and the component set are identical either way** (77 both ways,
none only-at-one-root), which is exactly why the counts looked clean. That is the
lesson: a count is not a control.

## What stands from Revision 1's measurements

Re-verified and unchanged:

- The blocker reproduces: `psq graph --repo ~/Developer/northwind-fullstack`
  prints `NorthwindDbContext  8 entities, 8 relations` and nothing of the client.
- `extractDotnet` at the full-stack root == at `server/`: 8 / 8 / 10.
- Each reader is a silent, instant no-op on the other's territory —
  `extractNode` on `server/` all zeros in 0 ms, `extractDotnet` on `client/` all
  zeros in 1 ms. Running both needs no guard.
- Both readers emit paths relative to the root they were given (`repoRelative`,
  `files.ts:42`), so a client-rooted path `src/pages/orders-page.tsx` is exactly
  `client/` + itself at the outer root. Verified by matching all 5 calls, all 33
  shapes and all 77 components across the two roots under a plain string prefix.
- **No corpus repo and no fixture changes provider.** repoA 101 `.cs` / 0 `.ts`,
  repoB 39 / 0, repoC 0 / 9, repoD 0 / 163, repoE 0 / 28, repoAClient 0 / 260;
  only `mini-efcore*` hold `.cs` and none holds a `.ts`.
- Hermetic baseline: `PSQ_NO_CORPUS=1 pnpm test` → **178 passed | 58 skipped
  (236), 0 failed**.

## The finding that shapes the phase

**Nine of the ten C# DTOs share a name with a TypeScript shape**: `CategoryDto`,
`CustomerDto`, `EmployeeDto`, `OrderDetailDto`, `OrderDto`, `OrderSummaryDto`,
`ProductDto`, `ShipperDto`, `SupplierDto`. `file#name` does not collide; bare
`name` collides nine times.

They are the same DTO twice, in two naming conventions. Field counts match
exactly across all nine (3/3, 7/7, 7/7, 5/5, 12/12, 8/8, 8/8, 3/3, 6/6), and
eight differ in their optional-field set *only by casing* — C# `CategoryDto` is
optional on `Description`, TypeScript `CategoryDto` on `description`.

The C# side carries `mirrors` (`CategoryDto -> Category`, and seven more); the
TypeScript side carries `mirrors: null`, because when the Node reader ran there
were no entities to pair against.

So the merge's real product is cross-stack drift, arriving before anything exists
to consume it. D3 keeps it from being stated as a wrong fact; the question
ambiguity it also causes is Phase 1b-ii.

---

## Decisions

### D1 — One graph. Two roots. Node-side paths re-prefixed into the merge root.

**This is the answer to roadmap open question 2**, which the roadmap requires this
plan to settle rather than cast away.

`Provider` becomes `"efcore" | "sqlite-ddl" | "fullstack" | "none"`. The
`extract()` fullstack arm is:

```
extractDotnet(root)  +  extractNode(nodeRootFor(root))  ->  mergeGraphs(...)
```

**`nodeRootFor(root)`** — root itself if it has a `tsconfig.json`; otherwise the
single directory below it that has one; if there is more than one candidate,
the root, with a warning naming them. Never a guess between candidates (rule 3).

**The merge re-prefixes every node-side path** by `relative(root, nodeRoot)`.
The fields that carry a path — miss one and a `DefKey` stops resolving:

- `Shape.file`, `Entity.file`, `Route.file` (if present)
- `ClientCall.file`
- `Component.file` **and `Component.key`** (the key embeds the path)
- **every string in `ClientCall.components`** (they are `Component.key`s)

*Why one graph and not two the CLI composes:* both readers produce one
coordinate system once the prefix is applied, `contextName` and the entity model
have exactly one source, and the thing a merged graph is for — comparing a C#
DTO against its TypeScript mirror — is only computable when both are in one
array.

*Why two roots and not one:* the measurement above. A shared root costs three of
five attributions and two shapes' field types. Revision 1 chose the shared root
on evidence that could not see the loss.

*Why not fix `programFor` to discover a nested tsconfig instead:* that would
change extraction for every single-stack repo with no root tsconfig — corpus
repoD is exactly that shape (no root `tsconfig.json`, four nested: `web/`,
`server/`, `shared/`, `worker/`), and its expectations are pinned. **Confining
root selection to the fullstack path leaves every single-stack extraction
byte-identical**, which is worth more here than the generality. Say so in the
code comment, so the next reader knows it was a choice.

*Why a scalar and not an array:* per N1 below, `provider` also stops being
`z.string()`, so the compiler enforces the choice.

### D2 — The merge concatenates and re-sorts. It never dedupes by name.

Deduping `shapes` by `name` would delete nine real facts from Northwind alone,
and `Shape` has no key field, so a name-dedupe would also be non-deterministic
about which twin survives — a rule 7 violation on top of a rule 3 one.

Each reader sorts its own arrays at construction and the comparators differ
(`node/shapes.ts:210` is name-then-file; `dotnet.ts:631` is name only), so a
plain concat breaks sorted output. The merge re-sorts by name then file.

**The merge warns when both sides contribute entities.** `invariants()`
(`packages/graph/src/index.ts:33`) catches only the case where the names
*collide*; an EF `Customer` alongside a DDL `customers` merges silently into one
graph holding two entity languages, which is precisely the state
`entity-mcq.ts:269` and `packages/quiz/src/sql/types.ts` depend on not existing.
**The warning is the guard, not `invariants()`.**

### D3 — `mirrors` stays a within-stack fact in 1b, and the merge says so once.

`mirrors` is computed by `pairShapes()` (`packages/extract/src/pair.ts:26-58`),
called at extraction time from **both** readers (`dotnet.ts:623`, `node.ts:194`)
against that run's own entities, and frozen there. Nothing recomputes it.

`pairShapes` matches on **names only** — `conceptKey` (`names.ts:47-58`) folds
case and separators, strips a DTO/Row/Response suffix and plurals. So cross-stack
pairing would mostly *succeed* mechanically today: TS `CategoryDto` → `category`
→ entity `Category`, and camelCase folds onto PascalCase.

That is exactly why it is deferred rather than switched on. A newly paired TS
shape immediately starts emitting `fieldDrift` / `dtoOnlyField` questions whose
evidence bar (rule 4a) has never been argued for a **cross-language** pairing —
`number` against `int`, `string | null` against `string?`. That argument is a
phase, not a line.

What 1b does not do is leave the wrong fact standing silently. The merge emits
**one** warning naming the count:

> `N shapes from the TypeScript side were not paired against the .NET entity
> model; psq pairs shapes within a stack only, so mirrors:null on a TS shape
> means "not computed", not "no mirror".`

One warning, not one per shape.

### D4 — The node reader's schema warning is false on a merged graph, and must not survive the merge.

`node.ts:202-208` fires whenever `entities.length === 0 && shapes.length > 0`:

> "No CREATE TABLE statement was found, so this repo has shapes but no schema.
> psq reads a schema from raw DDL only; an ORM-defined schema is not read."

On **every** full-stack repo the node side has zero entities and non-zero shapes,
so it always fires — and the merged graph does have a schema, eight entities of
it. The CLI prints it (`apps/cli/src/index.ts:105-107`). That is the same class
of wrong fact D3 exists to prevent.

The merge drops or rewrites this warning when the merged graph has entities.
Dropping is only honest if the reason is recorded — prefer rewriting it to say
the schema came from the .NET side.

*(Revision 1's D4 — prefixing merged warnings with `[dotnet]` / `[node]` — is
cut. Its premise was wrong: every node-side warning except `node.ts:160` and
`node.ts:204` already carries a `file:line`, and making warning text a function
of detection means one stray `.ts` in a .NET repo rewrites every warning string
in the graph.)*

### D5 — Each of the three provider consumers gets an explicit answer, not a default.

The three are `apps/server/src/workspace.ts:117-119`,
`packages/quiz/src/generate/ds-cloze.ts:113`, and
`packages/quiz/src/generate/entity-mcq.ts:269`. Verified complete.

- **`workspace.ts:117-119`** — the empty-entities message chain gets a
  `"fullstack"` arm. Falling through to "did not recognize this as a project" on
  a repo psq just read both halves of would be a lie. **While in there, fix
  `workspace.ts:125`**, which still ends with *"…and Node backends with a SQLite
  schema; React clients arrive in a later milestone."* That is false the moment
  this phase lands.
- **`ds-cloze.ts:113`** — the gate is inside **`columnType` only**, not the
  module. `GENERATORS = [fieldType, discriminator, columnType]`
  (`ds-cloze.ts:143`), and `fieldType` (line 51) and `discriminator` (line 85)
  are ungated and already run on `efcore` graphs. **Do not hoist this condition
  to `generateDsCloze`** — that would silently delete two question classes from
  every .NET repo. `columnType` staying dormant on a fullstack graph is correct
  (storage classes come from raw DDL, which a React client has none of); make
  that intent explicit at the `columnType` site and nowhere else.
- **`entity-mcq.ts:269`** — the
  `sqlite-ddl ? [TEXT,INTEGER,…] : [string,long,Guid,int]` distractor ternary.
  A fullstack graph's entities are always EF-sourced, so the C# branch is
  correct — but only because of the invariant D2 now warns about. State that
  link in the comment; a future reader must not have to re-derive it.

Also record, do not fix: `packages/quiz/src/sql/types.ts:3-5` and
`sql/seed.ts:85,107-108,322` hardcode C#-flavoured `baseType` values (`bool`,
`Guid`, `DateTime`, `DateOnly`) with no provider gate. Correct for the same
reason, and for exactly as long.

### D6 — Root selection warns only when it cannot decide.

Revision 1 put a warning in `programFor`. Cut: D1 no longer routes a full-stack
repo through that branch at all, and the condition as written would have fired in
two branches whose text it contradicts (`node.ts:120-123`, `node.ts:160-163`
both reach the fallback *with* a root tsconfig present).

Instead `nodeRootFor` warns in the one case where it genuinely cannot tell:

> `no tsconfig.json at the repo root and N candidates below it (a/, b/, …);
> read the TypeScript side from the root with default compiler options, so
> client-call attribution may be incomplete.`

Single candidate: no warning, because nothing was lost. No candidate and no root
config: no warning, because a tsconfig-less Node repo reads correctly today —
verified silent on `mini-node` and `mini-fullstack`, neither of which has a
`tsconfig.json` anywhere.

### D7 — The fixture is hand-written `mini-fullstack-csharp`, and it uses `paths`.

Verified: `~/Developer/northwind-fullstack` is on `b2-northwind-client` at
`55b5437`, clean tree, **no tags**, and **that branch is not on origin** (origin
has `main` and `b1-northwind-server` only). Vendoring now would couple 1b to the
tagging decision `northwind-testbed/progress-b2b-3.md` leaves open, and there is
no precedent — all eight existing fixtures are small and hand-written. Northwind
stays the realistic hand-measured check, pinned by nothing, as Phase 1 left its
8 / 8 / 10 / 0.

The fixture must reproduce what actually breaks:

- `server/` — a `DbContext` with two `DbSet`s, two entities, and **one DTO**;
- `client/` — **its own `tsconfig.json` carrying `paths`, and none at the fixture
  root**, plus a component that reaches its `fetch` **through a `@/`-aliased
  import**, so the attribution edge exists only if root selection worked;
- **the DTO name shared between the C# and the TypeScript side**, so D2's
  "never dedupe by name" rule has a committed test rather than a Northwind
  observation.

Revision 1 specified the tsconfig without `paths`, which would have made the
fixture the one full-stack layout that happens to work — a fixture that passes
whether or not D1 is implemented. **The aliased import is the positive control
for this entire phase.**

One component is enough. A second buys nothing this plan names.

---

## Steps

1. **`packages/extract/src/merge.ts` (new).** `nodeRootFor(root)` and
   `mergeGraphs(dotnet, node, prefix)`: path re-prefixing over the full field
   list in D1, concat + re-sort (D2), the both-sides-have-entities warning (D2),
   the unpaired-shapes warning (D3), the schema-warning rewrite (D4). Pure over
   its inputs apart from `nodeRootFor`'s directory probe.
2. **`packages/extract/src/detect.ts`.** Add `"fullstack"` to `Provider`; split
   detection into `hasDotnet` / `hasNode` over the single existing `walk`; add
   the `extract()` arm. **Rewrite the docblock** — the current text argues a
   full-stack repo *is* a .NET repo "for M4's purposes"; that premise expired
   when M5 landed. Say what is true now and why it changed. Do not patch it
   quietly.
3. **`packages/schema/src/index.ts:297`.** `provider: z.string()` becomes
   `z.enum(["efcore","sqlite-ddl","fullstack","none"])`. This is what makes gate
   3 a real control for D5 — every `=== "efcore"` narrows and a missing arm
   fails to compile. Verified safe: the only writes are literals at
   `dotnet.ts:292`, `dotnet.ts:628`, `node.ts:224`, `detect.ts:46` and one test
   literal at `packages/graph/test/layout3d.test.ts:48`;
   `apps/web/src/lib/api.ts:107` types it as `string` over the wire.
4. **`apps/server/src/workspace.ts`** — D5, both the arm and line 125.
5. **`packages/quiz/src/generate/ds-cloze.ts`** — D5, at the `columnType` site
   only.
6. **`packages/quiz/src/generate/entity-mcq.ts`** — D5, comment at line 269.
7. **`apps/cli/src/index.ts`.** `psq graph` prints only entity and relation
   counts, so the phase's outcome would be invisible on stdout. Add one line for
   shapes / routes / client calls / components when any is non-zero. Note this
   also changes output for `sqlite-ddl` repos, not only fullstack ones; no stdout
   assertion exists anywhere (`e2e/psq.e2e.ts` drives the browser and HTTP API,
   `e2e/harness.ts` spawns no CLI), but confirm that before writing it.
8. **`test/fixtures/mini-fullstack-csharp/**` (new).** Per D7.
9. **`test/fixtures.ts`.** `MINI_FULLSTACK_CSHARP` + a docblock stating what the
   fixture is a control for — specifically the aliased import.
10. **`packages/extract/test/merge.test.ts` (new).** `mergeGraphs` on hand-built
    literals: path re-prefixing across every field in D1's list, **every
    `ClientCall.components` DefKey resolving to a `Component.key` after merge**,
    sortedness, the nine-way name collision surviving, `file#name` uniqueness,
    the both-sides-have-entities warning (unreachable from any fixture, reachable
    from literals), and the D4 schema-warning rewrite. Import
    `../src/merge.js` directly, as `dotnet.test.ts:2` does — do not widen
    `packages/extract/src/index.ts` for a test.
11. **`test/mini-fullstack-csharp.test.ts` (new).** End-to-end through the real
    `extract()`: provider is `"fullstack"`, exact entity / shape / component /
    clientCall counts, **the aliased call attributed to its component**, the
    shared DTO name present twice with two distinct files, no false schema
    warning.
12. **`test/mini-node.test.ts:215-216`.** Keep both existing assertions; add the
    `"fullstack"` one beside them.
13. **`packages/extract/test/node.test.ts:79-80`.** Phase 1's follow-up 1.
    Replace the full-list ordered `toEqual` over the live repo-D route list with
    a subset or floor check; keep the `warnings.some(/regular expression/)`
    assertion. Not separable this time — gate 2 is otherwise unverifiable again,
    which is the complaint Phase 1 handed forward.
14. **`feature-research/complexity-facts/roadmap.md`.** Record the answer to open
    question 2; it must not stay open after this phase. Add Phase 1b-ii.
15. **`feature-research/m5b-component-attribution/roadmap.md:128-139`** (section
    C2) documents "extract the two halves as separate roots" as the intended
    design and defers the merge. 1b-i overturns it. Update it, or it becomes a
    stale record the next phase inherits as current.
16. **`README.md:336-337`** — Phase 1's follow-up 6; the claimed 138 / 193 counts
    are already wrong (178 / 236) and this phase moves them again.

## Files touched

1. `packages/extract/src/merge.ts` — **new**
2. `packages/extract/src/detect.ts`
3. `packages/schema/src/index.ts`
4. `apps/server/src/workspace.ts`
5. `packages/quiz/src/generate/ds-cloze.ts`
6. `packages/quiz/src/generate/entity-mcq.ts`
7. `apps/cli/src/index.ts`
8. `test/fixtures/mini-fullstack-csharp/**` — **new**
9. `test/fixtures.ts`
10. `packages/extract/test/merge.test.ts` — **new**
11. `test/mini-fullstack-csharp.test.ts` — **new**
12. `test/mini-node.test.ts`
13. `packages/extract/test/node.test.ts`
14. `feature-research/complexity-facts/roadmap.md`
15. `feature-research/m5b-component-attribution/roadmap.md`
16. `README.md`

**Not touched:** `packages/extract/src/node.ts` (D6 cut the change),
`packages/extract/src/dotnet.ts`, `csharp/**`, `pair.ts`, `node/refs.ts`,
`node/clients.ts`, `node/shapes.ts`, `node/ddl.ts`, `packages/extract/src/index.ts`,
`packages/graph/**`, `apps/web/**`, `bank.ts`, `grade.ts`, `ds-mcq.ts`,
`selftest.ts`, `test/corpus.local.json`, and every existing fixture.

## Gates

1. `PSQ_NO_CORPUS=1 pnpm test` → **0 failed**, and state the **exact** expected
   total before running it, from 178 | 58 (236) plus the tests this phase adds.
   "≥ 178" is not an assertion.
2. Full `pnpm test` with the corpus → exact numbers. No corpus repo can change
   provider (verified), so any corpus failure is either the repo-D route
   assertion step 13 is fixing, or something this phase caused. Say which.
3. `pnpm typecheck` — and with step 3 this is now a real control for D5, not a
   formality.
4. `pnpm selftest` against the new fixture **and** against Northwind. Report the
   finding count. **A clean selftest on an empty bank is not a result** — assert
   first that the fixture yields at least a stated number of questions across at
   least two generators (`ds-mcq.ts:24` needs `MIN_CHOICES = 3` plus exactly one
   optional/collection field; `entity-mcq.ts:258-259` needs
   `composite.length === 1 && simple.length >= 3`), then report clean.
   **Expect findings on Northwind** — that is Phase 1b-ii's subject, not a
   regression. Record the number and move on.
5. **Measured end-to-end**, through the real `extract()`, on
   `~/Developer/northwind-fullstack`: `provider: "fullstack"`,
   `contextName: NorthwindDbContext`, **8 entities, 8 relations, 43 shapes,
   0 routes, 5 client calls, 77 components**, and — the control B1 was missing —
   **all five client calls attributed exactly as they are when rooted at
   `client/`**: `OrderDetailPanel`; `FormPage`; `CustomersPage`; `OrdersPage`;
   `ProductList` + `CategoriesPage`. Zero calls with `components: []`.
   Paste the command and its output.
6. **The merged warning list is asserted, not just the counts.** The D4 false
   schema warning is invisible to every count-based check.
7. **Positive controls.** For each, state the assertion *and* what makes it fail:
   - the fixture test fails if the `"fullstack"` arm is removed from `extract()`;
   - the fixture test fails if `nodeRootFor` returns the root — this is what the
     aliased import in D7 exists for, and it is the control Revision 1 lacked;
   - the name-collision test asserts the **exact** duplicate-name count, so a
     merge that silently dedupes fails rather than passes;
   - `invariants()` is **not** a gate. It reads only `entities` and `relations`
     (`packages/graph/src/index.ts:27-61`), both of which come wholly from the
     dotnet side and are byte-identical to what Phase 1 already verified. It
     cannot fail here. Assert the exact multiset of `file#name` over `shapes`,
     the sorted order, and the warning list instead.

## Out of scope

- **The DS-bank prompt ambiguity — Phase 1b-ii below.**
- **Cross-stack `mirrors` / DTO drift.** The most valuable thing the merge makes
  computable, and the top candidate for a later phase. 1b-i warns (D3) and stops.
- **Per-fact provenance** — a `source` field on `Entity` / `Shape`.
- **Changing `programFor`.** D6 cut it; single-stack extraction stays
  byte-identical, and corpus repoD keeps its numbers.
- **C# route reading.** `dotnet.ts:613-615` stays hardcoded empty.
- **Vendoring or tagging Northwind.**
- **Any complexity metric.** That is Phase 2, unblocked either way.

## Risks

- **Step 7 changes CLI stdout** for `sqlite-ddl` repos too. No stdout assertion
  was found; confirm before writing, and list what was checked in the audit.
- **Step 13 edits a corpus ground-truth assertion.** The one place in this phase
  where "making a test pass" and "deleting a real check" look alike. The audit
  must quote the assertion before and after.
- **Detection sensitivity.** `walk` (`files.ts:14-38`) does not apply
  `isTestFile`. After the rewrite one `.ts` anywhere in a .NET repo — a build
  script, a Playwright spec — flips it to `"fullstack"` and pays an ~870 ms
  `ts.Program`. It cannot move a corpus expectation or a fixture today
  (verified), but it is a sharp edge; note it in the docblock.
- **The `walk` SKIP set** (`files.ts:5-8`) already excludes `node_modules`,
  `dist`, `obj`, `bin`. The fixture must not depend on that and must ship no
  build output.

---

## Phase 1b-ii — shape-name ambiguity in the DS bank

Split out of Revision 1's D8, because review established it is **a pre-existing
defect on real repos, not something the merge invents**.

`selftest.ts:123-129` keys `answersByPrompt` on the raw `q.prompt` and raw
`referenceAnswer(q)`, never `normalize()` — so `Description` and `description`
count as two answers for one prompt. Five prompt sites name only `shape.name`
while keying the id on `shape.file`:

- `ds-mcq.ts:125/127` `optionalField`
- `ds-mcq.ts:147/149` `collectionField`
- `ds-mcq.ts:180/182` `notAMember`
- `ds-cloze.ts:91/93` `discriminator`
- `ds-cloze.ts:71/73` `fieldType` (collides only when the field spelling matches)

**Measurable today, before the merge exists:** corpus repoAClient has ≥18
duplicated shape names (the worst repeated 11 times, three more at 9-10 each;
names withheld — corpus repo) and repoD ≥39. Run `pnpm psq selftest --repo <repoAClient>`
first; the real number decides the shape of the fix.

Likely fix: one helper — `shapeLabel(g, shape)` returning `shape.name` when
unique in the graph and `shape.name (shape.file)` when not — used at all five
sites. Byte-identical wherever the name is unique.

Also record for the cross-stack-mirrors phase: `ds-mcq.ts:82` and `ds-mcq.ts:103`
build ids as `ds.drift.entity.${entity.name}.${shape.name}` with **no file**, so
two same-named shapes mirroring one entity produce duplicate question ids
(`selftest.ts:152`). Unreachable while TS shapes carry `mirrors: null` — a
landmine for the moment they stop.
