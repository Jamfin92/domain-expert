# Phase 1 — a base constructor argument list silently truncates C# type parsing

**Revision 2.** Rev 1 was rejected by the reviewer with six blocking issues; it
pointed the implementer at code that is already correct. The diagnosis below is
the reviewer's, independently reproduced and measured.

**This replaces the roadmap's original Phase 1 (`detectProvider`).** The reorder is
driven by measurement: `detectProvider` is real but is not the blocker. Even with
perfect detection the .NET half extracts an empty entity model from the actual
target repo, so every downstream .NET fact — complexity included — would be built
on nothing.

Repo: `~/Developer/domain-expert`, branch `m5b-component-attribution`,
HEAD `1bb9a8a`. One commit. No push, no tag.

---

## The bug

Not "primary constructors" — **base constructor argument lists**. A parameter list
after the type name already parses correctly. Proven:

```
class C(int o) : DbContext      { DbSet<A> As => Set<A>(); void M(){} }
  -> props ["o:int","As:DbSet<A>"], methods ["M"]     WORKS TODAY
class C(int o) : DbContext(o)   { DbSet<A> As => Set<A>(); void M(){} }
  -> props ["o:int"],              methods []          BROKEN
```

**Mechanism.** `packages/extract/src/csharp/structure.ts:477-485` already accepts
the type-name parameter list. The failure is at **`:488-501`**: the base loop calls
`readTypeRef`, which stops on `(`; the loop breaks because `tokens[k]` is not `,`;
the `where` loop at `:503` does not match; the `tokens[k]?.text === "{"` check at
`:508` fails because `k` sits on `(`. Control falls into the **bodyless-declaration
branch at `:532-538`**, which pushes the type with `properties: positional,
methods: []` and resumes at `k + 1` — inside the argument list.

**That is also why `contextName` survives**, which rev 1 never explained.
`findContexts` (`dotnet.ts:165-171`) needs only `keyword === "class"` and a base
matching `isDbContextBase`, and `bases` **does** get `["DbContext"]` — only the
`(options)` is dropped. `dbSets` is empty because `properties` is empty; relations
are 0 because `methods` is empty, so `OnModelCreating` is never found.

**The blast radius is every type with a base argument list, not just DbContexts.**

- **Records are not a separate code path.** `parseCSharp` handles all
  `TYPE_KEYWORDS` through one branch (`structure.ts:464-539`), and records are
  affected: `record R(int Id) : Base(Id) { public string X { get; set; } }` yields
  props `["Id:int"]` — `X` is silently lost.
- **Interfaces after the argument list are silently dropped.**
  `class C(int o) : DbContext(o), IThing` yields bases `["DbContext"]`. For a repo
  writing `: IdentityDbContext<…>(options), ISomething`, that breaks
  `isDbContextBase`/Identity detection.

### Measured, on the real target

`~/Developer/northwind-fullstack/server` (public, Phase B accepted at `55b5437`):

```
provider: efcore   contextName: NorthwindDbContext
entities: 0   relations: 0   shapes: 18   routes: 0   warnings: 0
```

All eight entity classes — `Customer`, `Order`, `OrderDetail`, `Product`,
`Category`, `Supplier`, `Employee`, `Shipper` — are currently misfiled in `shapes`
(verified: none missing). Zero warnings.

**The reviewer applied a four-line fix at `:488-501` (skip a `(...)` after each base
type ref), measured, and reverted. These are the after-numbers to hit:**

```
mini-efcore + primary ctor : 5 entities, 4 relations, 0 shapes, 0 warnings
northwind server           : 8 entities, 8 relations, shapes 18 -> 10, 0 warnings
full suite                 : 1 failed | 218 passed (the pre-existing repoD failure only)
```

## Why this is the most serious class of defect here

`CLAUDE.md` rule 3: *"A missing fact costs one question. A guessed fact costs the
premise of the tool."* This is neither a warning nor an honest gap — it is a
**silent wrong answer**, indistinguishable from a repo that genuinely has no
entities. It is exactly what the Northwind testbed was built to find, and it
surfaced on first contact.

---

## Scope

**1. Consume the base constructor argument list.**
`packages/extract/src/csharp/structure.ts:488-501` — after each base type ref, skip
a balanced `(...)` if present, so parsing continues to the `where` clause and the
body. Records and multi-base lists are the same code path and are fixed by the same
change; assert both.

**2. Warn when a type header is not terminated by `{` or `;` — the generalising fix.**
`structure.ts:532-538` emits a bodyless type declaration **without checking the
header was actually terminated.** A correctly-parsed `record X(...);` arrives with
`tokens[k] === ";"`. A header the reader failed to consume arrives with anything
else, and is emitted anyway, silently.

> **Rev 1 put this warning on "a DbContext with zero DbSets" and called it the
> generalising fix. It is not.** The identical parse failure on a non-context type
> stays completely silent — measured:
> `public class OrderDto(int id) : BaseDto(id) { …three properties… }` yields props
> `["id"]` and `warnings: []`, then falls below `MIN_PROPERTIES = 2`
> (`csharp/shapes.ts:48`) and **vanishes from the graph entirely** with nothing
> said. The check at `:532` catches the whole class — contexts, entities, DTOs,
> interfaces — which is where the generalising warning belongs.

**3. The DbContext zero-entity warning — optional, and narrowed if kept.**
If kept, the condition is **"the context contributed no entities at all"**, not
"zero `DbSet<T>` members", and it must **skip `abstract`**.

> **Rev 1's condition fires falsely.** `dotnet.ts:182-189`: a context deriving from
> `IdentityDbContext<User, IdentityRole<Guid>, Guid>` contributes `User` as an
> entity **with no DbSet**, parses perfectly, and would be warned about. An
> `abstract class BaseContext : DbContext` with DbSets on the derived type is a
> real .NET pattern and would trip a per-context warning. **State whether the
> warning fires for every context found or only the one selected at
> `dotnet.ts:301`.** No fixture or corpus repo would catch either false positive —
> repoA has 16 DbSets and repoB has 9, neither has an abstract or second context.

**4. Two fixtures — the gates require both.**
Do **not** modify `mini-efcore`. (Verified: adding a second context there fires the
multiple-DbContext warning at `dotnet.ts:296-300`, and `test/mini.test.ts:16` and
`:76` both assert `expect(g.warnings).toEqual([])`.)

- `test/fixtures/mini-efcore-primary-ctor/` — a context with a primary constructor
  **and base arguments**, plus a record with base args and a type with an interface
  after the argument list. No `.csproj` needed (`mini-efcore` has none;
  `extractDotnet` walks for `.cs` and filters `/Migrations/`).
- `test/fixtures/mini-efcore-empty-context/` — the positive control for the new
  warning. It must be a **separate directory**: putting a DbSet-less context in the
  first fixture makes `contexts.length === 2` and fires the multiple-context
  warning, so that fixture could no longer assert a clean warning list.

**5. A parser-level regression test.**
`packages/extract/test/structure.test.ts` — assert `class C(int o) : Base(o) { … }`
yields its body members **and its full base list**. The fixture tests give
end-to-end coverage but will not tell you which half broke.

**6. Reconcile the stale corpus ground truth. Decision: option (a).**
The reviewer verified that **corpus repo D genuinely changed**: it is at a newer
commit than when the expectations were written, and every route psq now reports
was traced to that repo's **production source**, not to test files. psq reports
nine; the recorded expectation is two.

**psq is right and the ground truth is stale**, so update `test/corpus.local.json`'s
repoD route expectations. This is the one case where editing the oracle is correct —
because the repo was checked and did change. **Verify independently before editing;
do not copy a number from this plan.**

> The nine values are deliberately **not** listed here. Corpus expectations live in
> the gitignored `test/corpus.local.json`, and `test/fixtures.ts:63-64` holds the
> standing rule that **no name from a private repo may appear in a committed
> file** — this document is committed to a public repository. Reproduce them
> locally: the failing assertion at `packages/extract/test/node.test.ts:79` prints
> the full received list, and `psq graph --repo <repo D>` prints the same.

---

## Files touched

1. `packages/extract/src/csharp/structure.ts` — base argument list (`:488-501`),
   unterminated-header warning (`:532-538`)
2. `packages/extract/src/dotnet.ts` — **only if** the narrowed zero-entity warning
   is kept
3. `test/fixtures/mini-efcore-primary-ctor/**` — new
4. `test/fixtures/mini-efcore-empty-context/**` — new
5. `test/fixtures.ts` — two exported constants + docblocks (no registry exists)
6. `packages/extract/test/structure.test.ts` — parser-level regression test
7. `test/mini-efcore-primary-ctor.test.ts` — new fixture-level test
8. `test/corpus.local.json` — repoD route ground truth (gitignored, not committed)

**Not touched:** `detect.ts` (now Phase 1b), `csharp/shapes.ts` (confirmed
unnecessary — `shapes.ts:37` skips anything in `entityNames`, so the eight leave
`shapes` automatically), `mini-efcore` and its tests, any quiz generator, any app,
the schema.

---

## Gates

**Baselines, re-measured independently today:**

- `PSQ_NO_CORPUS=1 npx vitest run` → **161 passed | 58 skipped (219)**, 11 files
  passed / 4 skipped
- `npx vitest run` (full) → **1 failed | 218 passed**, the repoD failure above
- `pnpm typecheck` → green

1. `pnpm typecheck` — clean. The project's only lint gate.
2. `PSQ_NO_CORPUS=1 pnpm test` — **≥161 passed** plus the new tests, zero failures.
3. Full `pnpm test` — **0 failed** once step 6 of Scope lands (the repoD failure is
   the only one, and this phase fixes its ground truth).
4. **The control, committed as a regression test**: the primary-ctor fixture yields
   its full entity set, full base list, and record body members.
5. **The negative gate needs a positive control.** The unterminated-header warning
   must be *shown to fire* — assert it appears for `mini-efcore-empty-context`, not
   merely that existing fixtures stay warning-free. A warning never triggered in a
   test is a warning that may not work.
6. **End-to-end on the real target**, exact numbers:

   | | before | after (required) |
   |---|---|---|
   | `entities` | 0 | **8** |
   | `relations` | 0 | **8** |
   | `shapes` | 18 | **10** |
   | `warnings` | 0 | 0 |

   The fix must **move** the eight, not copy them. 8 entities with `shapes` still at
   18 means the entity/shape split is double-counting — a failure, not a pass. The
   surviving ten are `CategoryDto, ContactRequest, CustomerDto, EmployeeDto,
   OrderDetailDto, OrderDto, OrderSummaryDto, ProductDto, ShipperDto, SupplierDto`.

**Environment:** `node`/`npm` are not on `PATH` — use
`~/.local/share/fnm/node-versions/v24.19.0/installation/bin`. `pnpm`, not npm.

---

## Ground truth (rule 2)

**Rev 1's claim that "the testbed has no migrations because it has no database" was
wrong** — EF migrations are design-time and need no database. (Generating one is
still not the path here: the installed `dotnet ef` is 8.0.11 against a net10.0 /
EF 10.0.11 project, so it would refuse until `dotnet-ef` 10.x is installed, and per
rule 8 it would have to happen in a copy.)

**Use the far stronger oracle already written in the repo.**
`NorthwindDbContext.OnModelCreating` independently declares:

- **8 relationships** (matching the measured 8 relations after the fix)
- `DeleteBehavior.Restrict` on `Employee.Manager` and `Order.Shipper`
- `Cascade` on both `OrderDetail` foreign keys
- a **composite key**: `HasKey(od => new { od.OrderId, od.ProductId })`
- `ToTable("Order Details")`

Pin all of it, not just a DbSet count. It costs nothing extra and is far more than
a count — and it is declarative source psq did not produce.

---

## Out of scope — deliberately

- **`detectProvider`** — now Phase 1b. TypeScript complexity (roadmap Phase 2) is
  unblocked today by pointing `--repo` at `client/`.
- **A C# route/endpoint reader.** `dotnet.ts` emits `routes: []` unconditionally.
  Logged in `m5b-component-attribution/roadmap.md:128-139`.
- **Any complexity work.** This phase restores the entity model that .NET
  complexity will later hang off. It adds no metric.
- **Cross-stack drift** (TS client types mirroring C# DTOs) — newly plausible with
  the client's 33 shapes and the server's 10, but not this phase.

## Noted, not fixed

- **`README.md:336-337` claims 138 / 193 tests; actual is 161 / 219.** Out of this
  phase's boundary, but worth a sweep soon.
- **`packages/extract/test/node.test.ts:79-80` couples an unrelated assertion to
  route churn.** The test's stated subject is the second assertion
  (`warnings.some(/regular expression/)`), but the first is a full-list `toEqual`
  over every route in the repo, so any route added anywhere in that repo reds it
  under a name that has nothing to do with it. Worth restructuring when the ground
  truth is updated.
- **`northwind-fullstack/server` has generated `obj/Debug/net10.0/*.cs` that
  `dotnet.ts:262-265` walks** — only `/Migrations/` is filtered. Harmless today,
  but it is an unfiltered input on the very repo Gate 6 measures.

## Measured context for whoever picks this up

The React half needs no repair. Same repo, `--repo client`: **77 components,
33 shapes, 5 client calls, 2 warnings**, with attribution working across the two
same-named `ProductList` files:

```
GET /api/products -> [products/product-list.tsx#ProductList, categories-page.tsx#CategoriesPage]
```

That is the exact shape M5b was built to measure, working. The asymmetry between
the two stacks is the whole reason this phase comes first.
