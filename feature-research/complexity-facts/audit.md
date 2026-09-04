# Phase 1 audit — a base constructor argument list silently truncates C# type parsing

Plan: `feature-research/complexity-facts/plan-phase1.md` (Revision 2).
Branch `m5b-component-attribution`, on top of `a064d80`. **Not committed, not pushed.**

**Revision 2 of this audit.** Review came back *Ship — no blocking issues*, with
three cheap non-blocking items approved and now done (see "Post-review round"),
and three corrections to what this audit had recorded. All three corrections were
independently reproduced before being written down here; none of them changes a
gate result.

## Files changed

Modified:

1. `packages/extract/src/csharp/structure.ts`
2. `packages/extract/src/dotnet.ts`
3. `packages/extract/test/structure.test.ts`
4. `test/fixtures.ts`
5. `test/corpus.local.json` — gitignored, will not appear in the diff

Created:

6. `test/mini-efcore-primary-ctor.test.ts`
7. `test/fixtures/mini-efcore-primary-ctor/Data/ILibraryContext.cs`
8. `test/fixtures/mini-efcore-primary-ctor/Data/LibraryDbContext.cs`
9. `test/fixtures/mini-efcore-primary-ctor/Models/Author.cs`
10. `test/fixtures/mini-efcore-primary-ctor/Models/Book.cs`
11. `test/fixtures/mini-efcore-primary-ctor/Models/Loan.cs`
12. `test/fixtures/mini-efcore-primary-ctor/Dtos/Summaries.cs`
13. `test/fixtures/mini-efcore-empty-context/Data/EmptyDbContext.cs`
14. `test/fixtures/mini-efcore-empty-context/Dtos/WidgetDto.cs`

Nothing outside the plan's "Files touched" list was edited, in either round. The
post-review round touched only files already on that list (8, 6 and 2).
`mini-efcore` and its tests, `detect.ts`, `csharp/shapes.ts`, the generators, the
apps and the schema are untouched.

---

## What changed, file by file

### 1. `packages/extract/src/csharp/structure.ts`

**Scope item 1 — consume the base constructor argument list.** Inside the base
loop (was `:488-501`), after `readTypeRef` returns a base and before the `,`
check, a balanced `(...)` is skipped when present:

```ts
if (tokens[k]?.text === "(") {
  const close = matchBracket(tokens, k);
  if (close === -1) break;
  k = close + 1;
}
```

Four lines plus a comment naming the failure mode. `matchBracket` already existed
and is already used for the primary-constructor list a few lines above, so this
adds no new machinery. `close === -1` breaks rather than looping, which then
falls through to the item-2 warning below — an unbalanced `(` is reported, not
guessed at.

**Scope item 2 — the unterminated-header warning (the generalising fix).** In the
bodyless branch (was `:532-538`), before pushing the type:

```ts
if (tokens[k]?.text !== ";") {
  const stoppedAt = tokens[k]?.text ?? "end of file";
  warnings.push(
    `${file}:${line}: type ${name} header not terminated by '{' or ';' ` +
    `(stopped at '${stoppedAt}'); members and any remaining base types were not read`,
  );
}
```

Control only reaches this branch when `tokens[k]` is not `{`, so `!== ";"` is
exactly "not terminated by `{` or `;`". A correctly read `record X(...);` sits on
`;` and stays silent. Everything else — a construct the reader met and could not
consume — now says so instead of emitting a type with whatever it happened to
have collected. This catches the whole class, not just contexts: the plan's
`OrderDto(int id) : BaseDto(id)` case would have fallen under `MIN_PROPERTIES`
and vanished from the graph with nothing said.

The warning text names the file, line, type, and the token the reader stopped on,
so the next person can find the construct without re-deriving it.

### 2. `packages/extract/src/dotnet.ts`

**Scope item 3 — the zero-entity warning, kept and narrowed.** Inserted
immediately after the `entities` loop closes and before
`const entityByName = ...`.

**Exact final condition:**

```ts
if (entities.length === 0 && !ctx.decl.modifiers.includes("abstract")) {
  warnings.push(
    `${ctx.parse.file}:${ctx.decl.line}: DbContext ${ctx.decl.name} contributed no entities; the model is empty`,
  );
}
```

**Every context, or only the selected one? Only the selected one** — `ctx`, the
context chosen at what was `dotnet.ts:301` (`contexts.slice().sort(...)[0]`). It
is not a loop over `contexts`. Two reasons, both in the code comment: a second,
empty context is already reported by the multiple-DbContext warning just above,
and a per-context warning would fire on the legitimate
`abstract class BaseContext : DbContext` + derived-context pattern even with the
abstract skip, because the *derived* context would still be warned about if it
were not the one selected.

The condition is **`entities.length === 0`** — "contributed no entities at all" —
not "zero `DbSet<T>` members". `entities` is built from `wanted`, which is
`ctx.dbSets` **plus** `ctx.identityEntities`, so a context deriving from
`IdentityDbContext<User, IdentityRole<Guid>, Guid>` contributes `User` with no
DbSet of its own, has `entities.length === 1`, and is correctly not warned about.
A DbSet-count condition would have warned falsely there.

`abstract` is skipped as the plan requires. **Both branches of that skip are now
covered by the committed suite** — see the post-review round.

The location prefix is `file:line:`, matching the header warning exactly. It uses
`ctx.decl.line`, which the parser already records.

### 3. `test/fixtures/mini-efcore-primary-ctor/**` (new, 6 files)

A small library model. Not a modification of `mini-efcore` — that fixture is
untouched, per the plan.

- `Data/LibraryDbContext.cs` — `public class LibraryDbContext(DbContextOptions<LibraryDbContext> options) : DbContext(options), ILibraryContext`.
  Primary constructor, base argument list, **and an interface after it**. Three
  DbSets in both property forms (`=> Set<T>()` and `{ get; set; }`) and an
  `OnModelCreating` with two fluent relationships (`Restrict` and `Cascade`) plus
  a `ToTable("Loan Records")`.
- `Data/ILibraryContext.cs` — the interface, so the context can list one after
  its base argument list.
- `Models/Author.cs`, `Models/Book.cs`, `Models/Loan.cs` — plain entities.
- `Dtos/Summaries.cs` — `record SummaryDto(int Id);` (correctly terminated, must
  stay silent), `record BookSummaryDto(int Id, string Title) : SummaryDto(Id) { … }`
  (base args on a record, with body members that used to be dropped), and
  `class LoanReportDto(int id) : ReportBase(id), ITimestamped { … }` (interface
  after the argument list).

No `.csproj`, matching `mini-efcore`.

### 4. `test/fixtures/mini-efcore-empty-context/**` (new, 2 files)

The positive control, in its own directory for the reason the plan gives.

- `Data/EmptyDbContext.cs` — a context that exposes nothing. Deliberately not
  abstract and not Identity-derived, since both are legitimate ways for a context
  to contribute no DbSet of its own.
- `Dtos/WidgetDto.cs` — `public class WidgetDto : global::Mini.Empty.Dtos.ReportBase`
  with three properties. See "Gate 5" below for why this is the construct chosen.

### 5. `test/fixtures.ts`

Two exported constants, `MINI_EFCORE_PRIMARY_CTOR` and
`MINI_EFCORE_EMPTY_CONTEXT`, each with a docblock in the file's existing style
saying what the fixture is the only gate on and why it is a separate directory.
No other change; there is no registry to update.

### 6. `packages/extract/test/structure.test.ts`

Two new hermetic `describe` blocks appended. The existing file is entirely
corpus-gated (`describe.skipIf(!repoA)`); these are not, so they run on a clean
checkout and under `PSQ_NO_CORPUS=1`. Six tests: the class case (body + full base
list), the record case, the correctly-terminated bodyless case staying silent,
`abstract` surviving into `modifiers`, and both unterminated-header controls.

### 7. `test/mini-efcore-primary-ctor.test.ts` (new)

Eleven tests: six end-to-end on the primary-ctor fixture, three on the
empty-context control, and two on the `abstract` skip via a throwaway tree.

### 8. `test/corpus.local.json` (gitignored)

`repoD.expect.node.routes` replaced: two entries -> nine. See "Item 6" below.

---

## Post-review round — the three approved non-blocking items

All three landed inside the plan's existing "Files touched" list. No scope
widening.

### (1) The `abstract` branch is now covered

The gap this audit flagged as untested is closed, without a third fixture
directory. `test/mini-efcore-primary-ctor.test.ts` builds a throwaway tree with
`mkdtempSync` under `os.tmpdir()` in `beforeEach`, removes it in `afterEach`, and
runs `extractDotnet` over it. Hermetic, and it cannot perturb either fixture's
warning-count assertions.

Two cases, both asserting `entities: []` **and** `warnings: []`:

- **(a)** a lone `abstract class BaseContext(DbContextOptions options) : DbContext(options)`
  with no DbSets;
- **(b)** that same abstract base *plus* a derived `AppDbContext : BaseContext`
  holding `DbSet<Thing> Things`, with `Thing` a real entity class in the tree.

**(b) is what makes the skip load-bearing rather than defensive.** `findContexts`
(`dotnet.ts:165-170`) matches only classes whose **own** bases name
`DbContext`/`IdentityDbContext`. The derived context's own base is `BaseContext`,
so it is never seen at all, and the abstract base **is** the selected `ctx` —
contributing nothing. Without the skip, that entirely ordinary .NET layout warns
every time. Verified: `contextName` comes back `BaseContext` in case (b), not
`AppDbContext`.

**Negative control.** I temporarily removed just the
`&& !ctx.decl.modifiers.includes("abstract")` clause and re-ran the file:
**2 failed | 9 passed** — precisely these two tests, and nothing else. Restored
from a backup copy and re-run green at 11 passed. These are real controls.

The `Migrations/` route was not used: the reviewer's note that the filter at
`dotnet.ts:262-264` tests the **absolute** path is correct, so a `Migrations/`
subdirectory is excluded even when it is the root being pointed at.

### (2) `ToTable` is now pinned hermetically

It was the one rule-2 pin with no coverage on a clean checkout — `mini.test.ts`
already pins the composite key, `Cascade`/`Restrict`/`fluent` and
`ClientSetNull`/`convention`, but `tableName` was asserted only at
`packages/extract/test/dotnet.test.ts:45-46`, which is corpus-gated.

`builder.Entity<Loan>().ToTable("Loan Records");` added to the primary-ctor
fixture's `OnModelCreating`, with a two-line assertion:

```ts
expect(byName.get("Loan")).toBe("Loan Records"); // not "Loans"
expect(byName.get("Book")).toBe("Books");        // no ToTable: the DbSet name
```

The second line matters as much as the first: it pins that the fallback to the
DbSet name still happens for entities without a `ToTable`, so the test cannot
pass by the extractor simply ignoring DbSet names. The fixture still reports
0 warnings and `invariants(g) === []`.

All six rule-2 pin categories now have hermetic committed coverage.

### (3) The two new warnings' location format is consistent

The zero-entity warning used a bare `file:`; it now uses `file:line:` via
`ctx.decl.line`, matching the header warning. Both fixtures re-measured:

```
Dtos/WidgetDto.cs:19: type WidgetDto header not terminated by '{' or ';'
  (stopped at '::'); members and any remaining base types were not read
Data/EmptyDbContext.cs:13: DbContext EmptyDbContext contributed no entities; the model is empty
```

---

## Gates

Environment: `~/.local/share/fnm/node-versions/v24.19.0/installation/bin`, node
v24.19.0, `pnpm`. All numbers below are from the post-review re-run.

### Gate 1 — `pnpm typecheck`

Clean, before and after, in both rounds. All four projects (`tsconfig.json`,
`e2e`, `@psq/web`, `@psq/desktop`) exit 0 with no diagnostics.

### Gate 2 — `PSQ_NO_CORPUS=1 pnpm test`

| | test files | tests |
|---|---|---|
| baseline (`a064d80`) | 11 passed \| 4 skipped (15) | **161 passed \| 58 skipped (219)** |
| first round | 13 passed \| 3 skipped (16) | 175 passed \| 58 skipped (233) |
| **after post-review round** | 13 passed \| 3 skipped (16) | **178 passed \| 58 skipped (236)** |

Zero failures. +17 over baseline = 6 in `structure.test.ts` + 11 in
`mini-efcore-primary-ctor.test.ts`. The skipped file count drops from 4 to 3
because `structure.test.ts` now has a non-corpus block in it, so the file no
longer skips whole.

**Run count, because of the known flake (see below): 6 consecutive runs, all
`178 passed | 58 skipped`, zero failures, no flake observed in any of them.**

### Gate 3 — full `pnpm test`

| | test files | tests |
|---|---|---|
| baseline (`a064d80`) | 1 failed \| 14 passed (15) | **1 failed \| 218 passed (219)** |
| first round | 16 passed (16) | 233 passed (233) |
| **after post-review round** | 16 passed (16) | **0 failed \| 236 passed (236)** |

**3 consecutive runs, all `236 passed`, zero failures.**

The baseline failure was exactly the one the plan names:
`packages/extract/test/node.test.ts:79`, corpus repo D's route list, expecting 2
and receiving 9. It is fixed by item 6, not by masking.

### Gate 4 — the primary-ctor fixture, as a committed regression test

`extractDotnet(MINI_EFCORE_PRIMARY_CTOR)`:

| | before the fix | after |
|---|---|---|
| `contextName` | `LibraryDbContext` | `LibraryDbContext` |
| `entities` | 0 | **3** (`Author`, `Book`, `Loan`) |
| `relations` | 0 | **2** |
| `warnings` | 0 | 0 |
| `invariants(g)` | — | `[]` |

Asserted: the full entity set; both DbSet property forms
(`Authors` via `=> Set<Author>()`, `Books` via `{ get; set; }`); both relations
with `Book->Author` = `Restrict`/`fluent` and `Loan->Book` = `Cascade`;
`ToTable("Loan Records")` beating the DbSet name while `Book` keeps `Books`;
`BookSummaryDto`'s body members (`AuthorName`, `LoanCount`) alongside its
positional `Id`/`Title`; and `LoanReportDto`'s three body members past
`: ReportBase(id), ITimestamped`.

Parser level, `structure.test.ts`, the full base list pinned directly:
`class C(int o) : DbContext(o), IThing { … }` yields
`bases ["DbContext", "IThing"]`, `properties ["o:int", "As:DbSet<A>"]`,
`methods ["M"]`. Before the fix: `["DbContext"]`, `["o:int"]`, `[]`.

**Negative control on my own gate.** I temporarily removed only the four-line
item-1 change and re-ran the two new test files: **10 failed | 7 passed**. All
eight primary-ctor tests then present and three of the parser tests went red; the
seven that stayed green are the ones that do not depend on item 1 (the `abstract`
modifier test and the two unterminated-header tests, plus corpus-skipped
entries). The change was then restored from a backup copy and the suite re-run
green. These tests fail without the fix — they are not vacuous.

### Gate 5 — the positive control for the unterminated-header warning

This gate required finding a C# construct the hand-written reader **still**
cannot consume after item 1 landed. I probed eight candidates and found two real
ones (a third turned up in review — see Open Risks):

1. **`global::`-qualified base** — `class C : global::N.Base { … }`.
   `readTypeRef` reads `global`, then meets `::`, which is neither `.` nor an
   identifier, and stops. The header is never terminated.
2. **A base whose generic arguments close with an adjacent `>>`** —
   `class C : Dictionary<string, List<int>> { … }`. The lexer emits `>>` as one
   token, so `matchBracket` on the `<` never closes.

Both are valid, ordinary C#. Both are asserted in `structure.test.ts`; (1) is the
fixture control, in `mini-efcore-empty-context/Dtos/WidgetDto.cs`.

Measured on that fixture — the warning is **shown to fire**, with its exact text
(quoted under post-review item 3 above). `warnings.length === 2` is asserted, so
a third warning appearing is a failure rather than a silent addition. The test
also asserts `g.shapes.find(s => s.name === "WidgetDto") === undefined` — that is
the point: the type really does drop out of the graph, and now it drops out
*loudly*.

Neither new warning fires on any pre-existing fixture or on any corpus repo:
Gates 2 and 3 are green with every existing `expect(g.warnings).toEqual([])`
assertion untouched, and the Northwind measurement below reports 0 warnings.

### Gate 6 — end-to-end on `~/Developer/northwind-fullstack/server`

Measured with `extractDotnet` directly. Re-confirmed after the post-review round,
unchanged:

| | before | required | after |
|---|---|---|---|
| `provider` | `efcore` | — | `efcore` |
| `contextName` | `NorthwindDbContext` | — | `NorthwindDbContext` |
| `entities` | 0 | **8** | **8** |
| `relations` | 0 | **8** | **8** |
| `shapes` | 18 | **10** | **10** |
| `routes` | 0 | — | 0 |
| `warnings` | 0 | 0 | **0** |

**It is a move, not a copy.** `shapes` went 18 -> 10; the eight entity classes
left `shapes` as they entered `entities`. `8 + 10 = 18`, no double counting.

Before, `shapes` (18): `Category, CategoryDto, ContactRequest, Customer,
CustomerDto, Employee, EmployeeDto, Order, OrderDetail, OrderDetailDto, OrderDto,
OrderSummaryDto, Product, ProductDto, Shipper, ShipperDto, Supplier, SupplierDto`.

After, `entities` (8): `Category, Customer, Employee, Order, OrderDetail,
Product, Shipper, Supplier`.

After, `shapes` (10): `CategoryDto, ContactRequest, CustomerDto, EmployeeDto,
OrderDetailDto, OrderDto, OrderSummaryDto, ProductDto, ShipperDto, SupplierDto`
— **exactly the ten named in the plan**, character for character.

`csharp/shapes.ts` was not touched; the split happened on its own, as the plan
predicted.

---

## Ground truth (rule 2)

Checked against `Data/NorthwindDbContext.cs`'s `OnModelCreating` — declarative
source psq did not produce — by reading the file and comparing it to psq's
output. All six pins hold.

**8 relationships.** The source declares exactly eight `HasOne(...)` chains; psq
reports eight relations, one for one, with no extra and none missing:

| source chain | psq relation | delete behavior | source |
|---|---|---|---|
| `Product.Category` | `Product.CategoryId -> Category` | `ClientSetNull` | `convention` |
| `Product.Supplier` | `Product.SupplierId -> Supplier` | `ClientSetNull` | `convention` |
| `Employee.Manager` | `Employee.ReportsTo -> Employee` | **`Restrict`** | **`fluent`** |
| `Order.Customer` | `Order.CustomerId -> Customer` | `ClientSetNull` | `convention` |
| `Order.Employee` | `Order.EmployeeId -> Employee` | `ClientSetNull` | `convention` |
| `Order.Shipper` | `Order.ShipVia -> Shipper` | **`Restrict`** | **`fluent`** |
| `OrderDetail.Order` | `OrderDetail.OrderId -> Order` | **`Cascade`** | **`fluent`** |
| `OrderDetail.Product` | `OrderDetail.ProductId -> Product` | **`Cascade`** | **`fluent`** |

**The two `DeleteBehavior.Restrict`** — `Employee.Manager` (FK `ReportsTo`, a
self-reference, navigation pair `Manager`/`DirectReports`) and `Order.Shipper`
(FK `ShipVia`, navigation pair `Shipper`/`Orders`). Both read back as `Restrict`
with `deleteBehaviorSource: "fluent"`. Rule 4 holds: the five relationships the
source does **not** give an `OnDelete` for come back `convention`, not `fluent`,
so a delete-behavior question may only be asked about the three that are.

**The two `Cascade`** — both `OrderDetail` foreign keys, `OrderId` and
`ProductId`, both `fluent`.

**The composite key** — source `entity.HasKey(od => new { od.OrderId, od.ProductId })`;
psq reports `OrderDetail.keys === ["OrderId", "ProductId"]`, in that order.

**`ToTable("Order Details")`** — psq reports
`OrderDetail.tableName === "Order Details"`, space and all, rather than the DbSet
name `OrderDetails`. The other seven fall back to their DbSet names
(`Categories, Customers, Employees, Orders, Products, Shippers, Suppliers`),
which is correct EF behavior.

**Hermetic coverage of these pin categories**, so they survive as committed
regressions rather than as a one-off measurement: the composite key,
`Cascade`/`Restrict` with `deleteBehaviorSource: "fluent"`, and
`ClientSetNull`/`convention` are all pinned by `mini.test.ts`; `ToTable` and the
DbSet-name fallback are now pinned by `mini-efcore-primary-ctor.test.ts`.
**Six of six.**

The Northwind numbers themselves are recorded here, not committed as a test: the
testbed is not one of the six corpus keys (`repoA`..`repoE`), and adding it would
need a new corpus key and a new test file, neither of which is in the plan's
"Files touched". Flagging that as a gap worth closing in a later phase — Gate 6's
numbers are today only reproducible by hand.

---

## Item 6 — corpus ground truth for repo D

The plan's decision was option (a): psq is right, the recorded expectation is
stale, so update `test/corpus.local.json`. **I verified this independently before
editing and did not copy any value from the plan.** The plan deliberately does
not list the nine, and this audit does not either — it is committed to a public
repository and `test/fixtures.ts:63-64` forbids a private repo's names appearing
in a committed file. No repo D path, file name or route string appears anywhere
in this document.

What I did:

1. Ran the extractor over repo D and captured each route with its **source file
   and line**, not just the method and path.
2. Grepped repo D's own tree for the corresponding route registrations and
   matched them one by one. **All nine resolve to production source files** — two
   modules under the server's `src/`. Every reported `file:line` matches the line
   the grep found.
3. Checked the one path that also appears in a `.test.ts` file: the extractor's
   own file filter (`packages/extract/src/files.ts:54-55`) excludes
   `*.test.ts`/`*.spec.ts` and `test/`-style directories, and the reported
   `file:line` for that route is the production module, not the test. So it is
   not a test-file leak.
4. Confirmed the repo genuinely moved: the two route-declaring modules were last
   changed **2026-08-30**, while `packages/extract/test/node.test.ts` — where the
   expectation was written — was last touched **2026-08-25**. The routes are
   newer than the ground truth that was supposed to describe them.

Only then did I replace `repoD.expect.node.routes` (2 entries -> 9), in psq's
emission order so the existing `toEqual` still reads as an ordered assertion.
Nothing else in the file changed; key order is preserved. `git check-ignore`
confirms the file is ignored (`.gitignore:10`), so it will not appear in the diff.

---

## Deviations from the plan, and things I could not do

1. **The primary-ctor fixture's numbers are 3 entities / 2 relations, not the
   plan's "5 entities, 4 relations".** Those were the reviewer's numbers from
   temporarily adding a primary constructor to `mini-efcore` itself — which the
   plan then explicitly forbids. A fresh fixture has its own model, so the
   numbers are its own. Gate 4's actual requirement ("full entity set, full base
   list, record body members") is met and asserted.

2. **~~The abstract-context false positive has no test coverage.~~ Closed in the
   post-review round.** Both branches — the lone abstract context and the
   abstract-base-plus-derived-context layout — are now covered by a `mkdtemp`
   tree inside `test/mini-efcore-primary-ctor.test.ts`, and verified non-vacuous
   by removing the skip and watching exactly those two tests go red. This was the
   one real coverage gap in the first round; it is gone.

3. **The Identity false positive is still not covered by a new test.** It is
   covered incidentally by corpus repo A, which is Identity-derived, contributes
   `User` with no DbSet, and stays warning-free under the full suite (Gate 3
   green). That is real coverage but it is corpus-gated, so it does not run on a
   clean checkout or under `PSQ_NO_CORPUS=1`. Note the sharper reason this now
   matters: the 2-argument Identity base form is itself broken (Open Risk 2), so
   the untested false-positive path and a genuine live defect sit next to each
   other in the same construct family.

4. **Gate 6 is a manual measurement, not an automated test** — see the note at
   the end of the Ground truth section.

5. Nothing was committed, nothing pushed, no branch or tag created. No git
   state-changing command was run at all, in either round.

---

## Open risks

### 1. The new unterminated-header warning changes psq's output surface

It is a `warnings` entry, and `CLAUDE.md` rule 3 says a new warning should be
treated as a bug. Reporting the gap rather than truncating silently is the
intended behavior, but it means a repo that read as clean before may now report
warnings. It fires on none of this repo's fixtures and none of the corpus repos
today.

### 2. `>>` is a wider family than first recorded — and it can eat a whole DbContext

The first version of this audit described the `>>` case as "a base whose generic
arguments close with `>>`", which understated it. Any base type whose generic
argument list ends with two adjacent `>` characters is affected, because the
lexer emits `>>` as a single token. Reproduced:

| construct | result |
|---|---|
| `class H : IRequestHandler<Q, List<Dto>>` | bases `["IRequestHandler"]`, properties `[]`, warned |
| `class AppDbContext : IdentityDbContext<User, IdentityRole<Guid>>` | bases `["IdentityDbContext"]`, **all DbSets lost**, warned |
| `class AppDbContext : IdentityDbContext<User, IdentityRole<Guid>, Guid>` | parses **fine** — the trailing `, Guid` separates the `>`s |

The two-argument Identity form is the serious one: it is an extremely common EF
Core context declaration, and it loses its entire entity model. Because
`isDbContextBase` matches on the head `IdentityDbContext`, the context is still
*found* — so before this phase it produced the same silent zero-entity graph the
whole phase is about. Measured end-to-end on a throwaway tree, it now emits
**both** new warnings together:

```
Data/AppDbContext.cs:3: type AppDbContext header not terminated by '{' or ';' (stopped at '<'); …
Data/AppDbContext.cs:3: DbContext AppDbContext contributed no entities; the model is empty
```

That is the two warnings doing exactly the job they were added for, on a case
nobody designed them around. **The defect itself is not fixed by this phase** —
it is now loud instead of silent. Splitting `>>` in the lexer or `matchBracket`
is queued as a follow-up and was explicitly excluded from this round.

### 3. `record struct` produces a warning naming a type that does not exist

A third broken construct, found in review and reproduced here.
`public readonly record struct Id(Guid Value);` (and the non-`readonly` form)
parses to a bogus type literally **named `struct`**, with keyword `record`, no
bases and no properties, and now emits:

```
T.cs:1: type struct header not terminated by '{' or ';' (stopped at 'Id'); …
```

The underlying misparse is pre-existing — `record` is consumed as the type
keyword and `struct` is taken as the type name — and making it loud is correct
per rule 3. But **the message will send a reader hunting for a type called
`struct` that is not in their source.** The warning-text and naming fix is queued
as a follow-up and was explicitly excluded from this round. Worth prioritising:
`record struct` is common in modern C#, and a misleading warning is a worse
failure mode than a merely noisy one.

### 4. The `close === -1` path in the item-1 fix is untested

An unbalanced `(` in a base argument list breaks the loop and falls into the
item-2 warning. I reasoned it through but wrote no test for a malformed-source
case.

### 5. Positional parameters of a C# 12 *class* primary constructor are still
modelled as properties

They are for records, but not for classes. `LoanReportDto` carries a field named
`id` for this reason, and the Northwind context carries `options`. Pre-existing
behavior, unchanged by this phase, out of scope — but it is visible in the new
fixture's assertions and worth knowing before someone reads it as a bug I
introduced.

### 6. A known flake exists in the suite, unrelated to this diff

The first round's "0 failed" was a **single-run observation** and this audit
should not have implied a clean sweep. In four `PSQ_NO_CORPUS=1` runs during
review, one hit a flake at `apps/server/test/api.test.ts:213` (SQL grading).

It is provably not caused by this diff: that test opens `MINI_EFCORE`, which has
no base argument list and no unterminated header, so its parse output is
byte-identical before and after the change.

To put a number on it rather than repeat the same mistake, the post-review round
ran the hermetic suite **6 consecutive times** and the full suite **3 consecutive
times** — **9 runs, all green, flake not observed in any of them.** That is not
evidence the flake is gone; it is only evidence it is infrequent. It should be
tracked separately.

### 7. Gate 6 will drift

The Northwind testbed is a live repo; nothing in the committed suite pins its
numbers, so the 8/8/10/0 result is only true as measured today.

---

## Queued follow-ups (deliberately NOT implemented in this phase)

1. Fix the `record struct` / `readonly record struct` misparse and the misleading
   warning text it now produces (Open Risk 3).
2. Split `>>` in the lexer or `matchBracket`, which fixes the two-argument
   `IdentityDbContext` case and the whole `>>` family (Open Risk 2).
3. Pin the Northwind testbed's numbers in the committed suite (needs a new corpus
   key and test file).
4. Investigate the `apps/server/test/api.test.ts:213` flake (Open Risk 6).
