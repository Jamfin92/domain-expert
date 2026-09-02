# Phase B1 — Northwind testbed: repo fork + EF Core server

Phase B was split into B1 (server) and B2 (client) by user decision on 2026-08-27,
because the combined scope does not fit one context window. This is B1.

Revision 2 — incorporates a reviewer critique of revision 1 (verdict: Revise).

## Goal

Create the standalone Northwind testbed repo locally as a genuine fork of the
refreshed template, and build its server half: EF Core package refs, the core-8
entity model, a `NorthwindDbContext` with fluent configuration, DI wiring, and
minimal-API endpoints.

All of it **additive**. The template's `/api/hello`, `/api/contact`,
`/api/packages` and the static `Packages` class stay exactly as they are, so every
Phase A verification gate — build, lint, audit, `tsc -b`, e2e 7/7 — stays usable
as a regression check on B1 instead of going dark for two phases.

B1 touches **no file under `client/`**, and no shared root file except
`.gitignore`.

## Non-goals — these are B2 or later, do not do them here

- No client work at all. No `client/src/**` edits. The services/hooks/pages layer
  and the required component-pattern list are B2.
- Do not delete `Packages`, do not touch `/api/packages`, do not rewrite
  `pagination-page.tsx` or e2e tests 5 and 6. They come out together in B2.
- **Do not rename the repo in `package.json`.** Root and `client/package.json`
  keep their current names. The rename lands in B2, where `client/**` is already
  in scope; doing it here would desynchronise the root lockfile for no gain.
- **Do not create a repo-root `tsconfig.json`.** Adding a `server/` sibling makes
  this a plausible reflex. It would change what Phase C's `programFor` sees —
  C1's fix targets the solution-style config that already exists at
  `client/tsconfig.json`, and C2 extracts `client/` and `server/` as two explicit
  roots. A root tsconfig breaks both.
- No GitHub repo, no remote, no push. (Standing user decision; the roadmap also
  marks creating the public repo as outward-facing and confirm-first.)
- No vendoring into domain-expert, no `refresh-testbed.ts`. That is Phase C.
- No database, no migrations, no seeding, no `EnsureCreated`, no deployment.

## Context the implementer needs

- Fork point: `~/Developer/vite-react-webapi-template`, branch
  `template-refresh` @ `95855ff`. Node 24.19.0, npm 11.17.0, .NET SDK 10.0.400.
- `export PATH="$HOME/.local/share/fnm/node-versions/v24.19.0/installation/bin:$PATH"`
  is required before any npm command.
- The template server today: `net10.0`, `Microsoft.NET.Sdk.Web`, `Nullable=enable`,
  `ImplicitUsings=enable`, **zero** PackageReference, no DI, no `builder.Services`
  call of any kind, no CORS, no Swagger, no `.sln`, no server tests.
  `Program.cs` is 73 lines and listens on `http://localhost:5170`.
  Line 2 is `var app = builder.Build();`, immediately after `CreateBuilder` —
  service registration goes between them, and any `using` for a new namespace
  goes above the top-level statements.
- Playwright's readiness probe is `GET /api/hello`. **If that endpoint stops
  answering, the entire e2e suite fails to start.** Do not restructure it away.
- `guide-page.tsx` renders `README.md?raw` and e2e test 1 asserts on its parsed
  headings. **Do not edit README headings in this phase.**
- All npm scripts (`build`, `lint`, `e2e`, `shots`) live in `client/package.json`.
  The repo root defines only `dev:all`. Run npm gates from `client/`.

## Step 1 — Create the testbed repo (clone, keep history)

```
git clone --no-hardlinks --branch template-refresh \
  ~/Developer/vite-react-webapi-template \
  ~/Developer/northwind-fullstack
cd ~/Developer/northwind-fullstack
git remote remove origin     # also drops origin/*; nothing left to push to
git branch -M main           # rename checked-out template-refresh -> main
git checkout -b b1-northwind-server
cd client && npm ci          # `ci`, NEVER `install` — see below
```

`--branch template-refresh` makes this independent of whatever the source repo
has checked out. `git branch -M` renames the current branch (legal, unlike
`branch -f` on a checked-out ref) and cannot collide, because removing origin
already guaranteed no `main` exists.

**`npm ci`, never `npm install`.** A fresh clone has no `client/node_modules`, so
every npm gate below needs an install first. `npm install` would resolve fresh
patches inside the `^` ranges — legitimately moving the bundle hash, possibly
changing the audit result, and rewriting `client/package-lock.json`, which is a
file under `client/` and would fail gate 7 for a reason unrelated to B1.
`client/package-lock.json` must come out byte-identical.

Do **not** run npm at the repo root.

Verify before moving on: `git remote -v` prints nothing; `git rev-parse main` is
`95855ff`; `git branch` lists exactly `main` and `b1-northwind-server`;
`git status --porcelain` is empty.

(`main`/`template-refresh` history is preserved in full. `origin/console-host`,
an unrelated branch that is not an ancestor of `95855ff`, is dropped with origin
— intentionally.)

## Step 2 — EF Core package references

`server/Server.csproj`: add `Microsoft.EntityFrameworkCore` and
`Microsoft.EntityFrameworkCore.Sqlite`, latest stable resolving for `net10.0`, via
`dotnet add package` so the version is real and not invented. **Record the exact
resolved versions in the audit.**

## Step 3 — The core-8 entity model

`server/Models/`, one file per entity: `Customer`, `Order`, `OrderDetail`,
`Product`, `Category`, `Supplier`, `Employee`, `Shipper`.

These eight are fixed by the roadmap because between them they carry every
relation shape the extractor claims to handle. All of these must be present:

| shape | where |
|---|---|
| composite primary key | `OrderDetail(OrderId, ProductId)` |
| non-integer, app-assigned PK | `Customer.CustomerId` — `nchar(5)` string, `ValueGeneratedNever` |
| self-referencing optional FK | `Employee.ReportsTo -> Employee` |
| optional FK, distinct delete behaviour | `Order.ShipVia -> Shipper` |
| 1:N | `Product -> Category`, `Product -> Supplier` |
| 1:N | `Customer -> Order`, `Employee -> Order` |
| 1:N (cascade) | `Order -> OrderDetail`, `Product -> OrderDetail` |

**Fidelity rule — follow real Northwind, including its nullability.** In real
Northwind `Products.CategoryID`, `Products.SupplierID`, `Orders.CustomerID` and
`Orders.EmployeeID` are all **nullable**. Model them that way. Revision 1 called
these "plain 1:N", which contradicted its own instruction to use real Northwind
types; this rule settles it. Real column names and types throughout
(`CompanyName`, `ContactName`, `UnitPrice`, `QuantityPerUnit`, `Discontinued`, …).

`Customer.CustomerId` being a string means `GET /api/customers/{id}` binds a
string, not an int.

This is a deliberate subset of Northwind's ~13 tables, chosen for relation
coverage, not fidelity of table count — do not add the missing tables.

`Nullable=enable` is on: required reference navigations use the `= null!;` idiom,
optional ones are genuinely `?`.

## Step 4 — `NorthwindDbContext`

`server/Data/NorthwindDbContext.cs`: `DbSet<T>` for all eight, and an
`OnModelCreating` carrying real fluent configuration —

- `HasKey(od => new { od.OrderId, od.ProductId })` for `OrderDetail`.
- `ToTable("Order Details")` for `OrderDetail` — real Northwind's table name has
  a space in it, so entity name ≠ mapped table name. Free, accurate, and a shape
  a fixture written to please a walker would never contain.
- `Customer.CustomerId`: `HasMaxLength(5)`, `ValueGeneratedNever()`.
- Explicit `HasOne/WithMany/HasForeignKey` for every relation in the table above.
- Delete behaviours that actually differ: `Restrict` on the self-reference and on
  `Order.ShipVia`, `Cascade` on `Order -> OrderDetail`. Deliberate, not uniform.
- At least two `HasIndex` (e.g. `Customer.CompanyName`, `Product.CategoryId`).
- A few `IsRequired` / `HasMaxLength` / `HasPrecision` where Northwind implies it.

## Step 5 — DI wiring

`Program.cs`, between `CreateBuilder` and `Build()`:

```
builder.Services.AddDbContext<NorthwindDbContext>(o =>
    o.UseSqlite(builder.Configuration.GetConnectionString("Northwind")));
```

with a `ConnectionStrings:Northwind` entry added to `appsettings.json`.

This is the app's first-ever `builder.Services` call. The options lambda is not
invoked at registration — it runs when `DbContextOptions<T>` is first resolved,
i.e. on the first request that injects the context. `/api/hello` never does, so
it keeps answering and the e2e suite still starts.

**Guardrail:** keep the configuration read *inside* the lambda. Do **not** hoist
it to builder scope, and do not write
`GetConnectionString("Northwind") ?? throw new InvalidOperationException(...)`.
That defensive line is exactly what a careful implementer adds unprompted, and at
builder scope it evaluates at startup — taking `/api/hello`, and therefore the
whole e2e suite, down with it.

## Step 6 — Endpoints

`server/Endpoints/NorthwindEndpoints.cs`, an extension method
`MapNorthwindEndpoints(this IEndpointRouteBuilder)`, called from `Program.cs`.
Plain resource routes — an app would not namespace these, and none collide:

- `GET /api/customers` (paged), `GET /api/customers/{id}` (string id)
- `GET /api/products` (paged, optional `categoryId` filter), `GET /api/products/{id}`
- `GET /api/orders` (paged), `GET /api/orders/{id}` (includes its order details)
- `GET /api/categories`, `GET /api/suppliers`
- `GET /api/employees`, `GET /api/employees/{id}`
- `GET /api/shippers`

Paged responses reuse the existing `{ Items, Page, PageSize, TotalItems,
TotalPages }` envelope and the 1–50 `pageSize` clamp already in `/api/packages`,
so the two halves of the app agree with each other.

DTOs in `server/Dtos/NorthwindDtos.cs` as records, projected with `.Select(...)`.
Entities are never returned directly — that is what stops the navigation cycles.

## Step 7 — `.gitignore`

Add `*.db`, `*.db-shm`, `*.db-wal` if not already covered. SQLite creates the
file on first connect, so a single stray `curl` would otherwise leave an
untracked `northwind.db` in the tree and trip gate 8.

## Step 8 — Verify

Run every one of these and paste real output into the audit.

1. `dotnet build server` (from repo root) — expect 0 warnings, 0 errors.
2. `cd client && npm run build` — clean. Bundle should stay
   **647.18 kB / `index-BSc-BSw_.js`**; no client source changed and `npm ci`
   preserves the lockfile, so a moved hash means something unintended happened.
3. **Before the e2e run**, confirm `lsof -ti :5170 :5173` is empty; kill anything
   found. `playwright.config.ts` sets `reuseExistingServer: true` on both fixed
   ports, so a leftover `dotnet run` from the *template* repo would let all 7
   tests pass green against a server with no `AddDbContext` in it. Then
   `cd client && npm run e2e` — **7/7** — and paste the Playwright line showing it
   *started* `dotnet run --project ../server` rather than reused a server.
   With that check in place this is the load-bearing gate: it proves the new DI
   and DbContext registration did not break server startup.
4. `cd client && npm run lint` — exit 0, 6 pre-existing warnings in `client/src/**`.
5. `cd client && npm audit` — 0 vulnerabilities.
6. `cd client && npx tsc -b --force` — exit 0 across all three projects.
7. `git diff --stat main..b1-northwind-server -- client/` — **must be empty.**
8. `git status --porcelain` — **empty** after the commit. (Broader than checking
   `client/public/screenshots/` alone: also catches lockfile churn and stray
   `.db` files, for the same effort.)

Then commit to `b1-northwind-server`. Local only. No push.

## Known and accepted limitation — state it, do not fix it

There is no database. Hitting any of the new resource routes at runtime returns a
500, because no SQLite file or schema exists. This is intended: the roadmap
specifies the testbed is **"source-complete, not running"** — no database, no
seeding, no deployment — because the extractor only ever parses source. No test
touches these routes. Do not add `EnsureCreated`, migrations, or a seed file to
make them respond.

**Forward note for B2, recorded here so it is not rediscovered under pressure:**
B2's pages will fetch these endpoints, so B2's e2e can assert loading and error
states only, never rendered rows. That is a constraint on B2's tests, not a
reason to reopen the no-database decision.

## Files touched

New:
- `server/Models/{Customer,Order,OrderDetail,Product,Category,Supplier,Employee,Shipper}.cs`
- `server/Data/NorthwindDbContext.cs`
- `server/Dtos/NorthwindDtos.cs`
- `server/Endpoints/NorthwindEndpoints.cs`

Modified:
- `server/Server.csproj`
- `server/Program.cs`
- `server/appsettings.json`
- `.gitignore`

Explicitly NOT touched: all of `client/**`, `README.md`, root `package.json`,
root `package-lock.json`, and the existing `Packages` class and its three
endpoints.

## Process constraints — non-negotiable

1. **Write this as an app, not as a fixture.** The roadmap marks this
   non-negotiable. Do not read domain-expert's `clients.ts`, `refs.ts`, or any
   attribution/extractor source while writing it. The testbed's value depends on
   it not having been written to satisfy the walker.
2. **No push, no remote, no `main` commits.** Local branch only.
3. **`npm run shots` is barred** — it rewrites `client/public/screenshots/`.
   If run by accident: `git checkout -- client/public/screenshots`.
4. Write the audit to
   `~/Developer/domain-expert/feature-research/northwind-testbed/audit-b1.md`,
   with real command output, the resolved EF Core versions, and any deviation
   from this plan called out explicitly rather than quietly absorbed.
