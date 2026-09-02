# Audit — Phase B1: Northwind testbed repo fork + EF Core server

Implementer audit for `plan-b1.md` (revision 2). Executed 2026-08-27.
Repo: `~/Developer/northwind-fullstack`, branch `b1-northwind-server`,
commits `6784fd1` (B1 implementation) and `bc53197` (review follow-ups) on top
of `95855ff` (`main`). No remote exists; nothing pushed.

## Files changed

All in `~/Developer/northwind-fullstack`:

New:
- `server/Models/Customer.cs`
- `server/Models/Order.cs`
- `server/Models/OrderDetail.cs`
- `server/Models/Product.cs`
- `server/Models/Category.cs`
- `server/Models/Supplier.cs`
- `server/Models/Employee.cs`
- `server/Models/Shipper.cs`
- `server/Data/NorthwindDbContext.cs`
- `server/Dtos/NorthwindDtos.cs`
- `server/Endpoints/NorthwindEndpoints.cs`

Modified:
- `server/Server.csproj`
- `server/Program.cs`
- `server/appsettings.json`
- `.gitignore`

Nothing else. `client/**`, `README.md`, root `package.json`, root
`package-lock.json`, and the `Packages` class + its three endpoints are
untouched (gate 7 proves the client half byte-for-byte).

The audit file itself (this file) is the only write outside the testbed repo,
as the plan directs.

## What changed per file

- **`server/Models/*.cs`** — the core-8 entities with real Northwind columns and
  nullability. `Customer.CustomerId` is a string; `Product.SupplierId/CategoryId`
  and `Order.CustomerId/EmployeeId/ShipVia` are nullable per real Northwind.
  Required reference navigations use `= null!;`, optional ones are `?`.
  `Employee` has the self-referencing `ReportsTo` -> `Manager`/`DirectReports`
  pair.
- **`server/Data/NorthwindDbContext.cs`** — `DbSet` for all eight; fluent config:
  composite key `HasKey(od => new { od.OrderId, od.ProductId })`;
  `ToTable("Order Details")`; `Customer.CustomerId` `HasMaxLength(5)` +
  `ValueGeneratedNever()`; explicit `HasOne/WithMany/HasForeignKey` for every
  relation in the plan's table; `DeleteBehavior.Restrict` on the employee
  self-reference and `Order.ShipVia`, `Cascade` on `Order -> OrderDetail` and
  `Product -> OrderDetail`; `HasIndex` on `Customer.CompanyName` and
  `Product.CategoryId`; `IsRequired`/`HasMaxLength` on name columns and
  `HasPrecision(19, 4)` on the money columns.
- **`server/Dtos/NorthwindDtos.cs`** — DTO records; entities are never returned
  directly.
- **`server/Endpoints/NorthwindEndpoints.cs`** — `MapNorthwindEndpoints`
  extension with all 11 routes the plan's Step 6 enumerates. Paged routes reuse the
  `{ Items, Page, PageSize, TotalItems, TotalPages }` envelope and the 1–50
  `pageSize` clamp from `/api/packages`. `/api/customers/{id}` binds a string
  id; `/api/products` takes an optional `categoryId`; `/api/orders/{id}`
  projects its order details inline.
- **`server/Server.csproj`** — two PackageReferences added via
  `dotnet add package`:
  - `Microsoft.EntityFrameworkCore` **10.0.11**
  - `Microsoft.EntityFrameworkCore.Sqlite` **10.0.11**
- **`server/Program.cs`** — three `using`s above the top-level statements;
  `AddDbContext` between `CreateBuilder` and `Build()` with the
  `GetConnectionString("Northwind")` read **inside** the options lambda (no
  hoist, no `?? throw`); `app.MapNorthwindEndpoints();` before `app.Run();`.
  `/api/hello` untouched.
- **`server/appsettings.json`** — `ConnectionStrings:Northwind` =
  `Data Source=northwind.db`.
- **`.gitignore`** — appended `*.db`, `*.db-shm`, `*.db-wal` (none were covered).

## Step 1 verification (repo creation)

```
$ git remote -v
(no output)
$ git rev-parse main
95855ff74243345c131ee0ee257ffc4b6e654b7c
$ git branch
* b1-northwind-server
  main
$ git status --porcelain
(empty)
```

`npm ci` (never `install`) run from `client/`; `git status --porcelain` was
empty immediately after, so `client/package-lock.json` is byte-identical.
`npm run shots` was never run. npm was never run at the repo root.

## Verification gates

### Gate 1 — `dotnet build server` (repo root)

```
  Server -> ~/Developer/northwind-fullstack/server/bin/Debug/net10.0/Server.dll

Build succeeded.
    0 Warning(s)
    0 Error(s)

Time Elapsed 00:00:01.72
```

### Gate 2 — `npm run build` (client)

```
dist/assets/index-DzmiGmPW.css                              71.33 kB │ gzip:  12.28 kB
dist/assets/index-BSc-BSw_.js                              647.18 kB │ gzip: 207.51 kB

✓ built in 428ms
```

Bundle is exactly **647.18 kB / `index-BSc-BSw_.js`** as the plan requires.

### Gate 3 — port check + e2e

Port check before the run (this lsof rejects two bare `:port` args in one call,
so each port was checked individually — exit 1 = nothing listening):

```
$ lsof -ti :5170; echo "5170 exit=$?"; lsof -ti :5173; echo "5173 exit=$?"
5170 exit=1
5173 exit=1
```

`npm run e2e`:

```
Running 7 tests using 7 workers

  ✓  2 [chromium] › e2e/pages.spec.ts:54:3 › pagination › deep-links to a page via the URL (652ms)
  ✓  5 [chromium] › e2e/pages.spec.ts:4:3 › guide (bento README) › renders the parsed README as cards and proves the server pipe (683ms)
  ✓  3 [chromium] › e2e/pages.spec.ts:63:3 › dos & don'ts › renders every rule with a Don't/Do pair (707ms)
  ✓  7 [chromium] › e2e/pages.spec.ts:46:3 › pagination › serves page 1 from the server and navigates by click (735ms)
  ✓  6 [chromium] › e2e/pages.spec.ts:16:3 › carousel › advances slides and updates the counter (778ms)
  ✓  4 [chromium] › e2e/pages.spec.ts:27:3 › form › shows zod errors for invalid input (794ms)
  ✓  1 [chromium] › e2e/pages.spec.ts:35:3 › form › submits a valid form to the server (798ms)

  7 passed (4.3s)
```

**7/7.** The default reporter prints no webServer line, so to produce the
required "started, not reused" evidence the suite was re-run once with
`DEBUG=pw:webserver` (ports re-confirmed empty first — Playwright had killed
its own servers, itself evidence it started them):

```
pw:webserver Error while checking if http://localhost:5170/api/hello is available: connect ECONNREFUSED ::1:5170
pw:webserver Starting WebServer process dotnet run --project ../server...
pw:webserver Process started
pw:webserver Waiting for availability...
...
pw:webserver WebServer available
```

Playwright **started** `dotnet run --project ../server` (ECONNREFUSED first, so
nothing was reused), and its `/api/hello` readiness probe succeeded against the
server **with** the new `AddDbContext` registration. The debug re-run also
passed 7/7.

### Gate 4 — `npm run lint`

Exit 0. **7** warnings, all in `client/src/**` — see Deviations below; the plan
predicted 6. Warning list:

```
src/lib/markdown.ts:83:7: warning eslint(no-unused-expressions)
src/pages/form-page.tsx:82:22: warning react(incompatible-library)
src/components/ui/button.tsx:67:18: warning react(only-export-components)
src/components/ui/navigation-menu.tsx:163:3: warning react(only-export-components)
src/lib/useApi.ts:23:5: warning react(set-state-in-effect)
src/components/ui/carousel.tsx:239:3: warning react(only-export-components)
src/components/ui/carousel.tsx:96:5: warning react(set-state-in-effect)
```

### Gate 5 — `npm audit`

```
found 0 vulnerabilities
```

### Gate 6 — `npx tsc -b --force`

Exit 0, no output (all three projects clean).

### Gate 7 — `git diff --stat main..b1-northwind-server -- client/`

Empty output, exit 0. **Pass.**

### Gate 8 — `git status --porcelain` after the commit

Empty output. **Pass.** No stray `.db` file, no lockfile churn, no screenshot
churn.

## Resolved EF Core versions

- `Microsoft.EntityFrameworkCore` **10.0.11**
- `Microsoft.EntityFrameworkCore.Sqlite` **10.0.11**

Both added with plain `dotnet add package` (latest stable resolving for
`net10.0`).

## Deviations from the plan

1. **Gate 4 warning count: 7, not the plan's "6 pre-existing warnings".** All 7
   are in `client/src/**`, and gate 7 proves `client/` is byte-identical to
   `main` — so every warning is pre-existing by construction; the plan's count
   was simply off by one (or the template's count moved between plan-writing and
   now). Lint still exits 0. Nothing was changed in response.
2. **lsof invocation shape.** The plan's literal `lsof -ti :5170 :5173` is not
   valid for this system's lsof (it treats the second port as a filename and
   errors). The check was performed as two single-port calls, same semantics,
   both empty. Cosmetic deviation only.
3. **e2e ran twice.** Once plain (the gate), once with `DEBUG=pw:webserver` to
   capture the "Starting WebServer process dotnet run --project ../server" line
   the plan asks for, since the default reporter never prints one. Both runs
   7/7; ports were verified empty before each.

No other deviations. The `?? throw` guardrail, the lambda-scoped
`GetConnectionString`, the no-root-tsconfig and no-rename rules, and the
no-database rule were all followed as written.

## Process constraints

- Written as an app: no domain-expert extractor/attribution source
  (`clients.ts`, `refs.ts`, or any other) was opened at any point during this
  task.
- No push, no remote (`git remote -v` empty), no commits on `main`. Two commits
  `6784fd1` and `bc53197` on `b1-northwind-server` only.
- `npm run shots` never run.

## Test results summary

All eight gates pass: server build 0/0, client bundle hash unmoved, e2e 7/7
against a freshly started server, lint exit 0, audit 0 vulnerabilities,
`tsc -b` clean, empty `client/` diff, clean tree.

## Review follow-ups (post-Ship, commit `bc53197`)

The reviewer's three non-blocking items, all requested by the user, were applied
after the initial audit:

1. **`/api/orders` paging tiebreaker.** `OrderDate` is nullable and non-unique;
   ordering by it alone lets SQLite order ties differently per query, so rows
   could repeat or vanish across page boundaries. Now
   `.OrderByDescending(o => o.OrderDate).ThenByDescending(o => o.OrderId)`.
   Confirmed (not assumed) that every other paged/list route already orders by
   its PK: customers by `CustomerId`, products by `ProductId`, order details by
   `ProductId`, categories/suppliers/employees/shippers by their PKs. Only
   orders needed the fix.
2. **`server/appsettings.json` line endings restored to CRLF.** The initial
   commit had rewritten the file LF (an undisclosed deviation — the JSON
   round-trip through Python dropped the CRLFs), which made a 3-line addition
   show as `21 ++++--` against `main` and left the server files internally
   inconsistent. The file was reconstructed from `main`'s CRLF bytes with only
   the `ConnectionStrings` block inserted; `git diff main -- server/appsettings.json`
   now shows exactly the three added lines (plus the two context braces). No
   `.gitattributes` added, no other files normalised, per instruction.
3. **Audit route count corrected** from "twelve" to 11 above — there are 11
   `MapGet` calls and the plan's Step 6 enumerates exactly 11; nothing was
   missing from the implementation, the audit number was simply wrong.

Re-run gate output after the fixes:

`dotnet build server`:

```
Build succeeded.
    0 Warning(s)
    0 Error(s)
```

Ports clear before e2e (`lsof -ti :5170` / `:5173` each exit 1, no output).
Single `DEBUG=pw:webserver npm run e2e` run:

```
pw:webserver Starting WebServer process dotnet run --project ../server...
pw:webserver Process started
pw:webserver WebServer available
pw:webserver Starting WebServer process npm run dev...
pw:webserver Process started
pw:webserver WebServer available
  7 passed (4.3s)
```

`git diff --stat main..b1-northwind-server -- client/` — empty.
`git status --porcelain` after commit `bc53197` — empty.

## Open risks / known limitations

- **No database — by design.** Every new resource route 500s at runtime
  (`Data Source=northwind.db` points at a file that does not exist). The plan
  marks this intended: the testbed is source-complete, not running. No
  `EnsureCreated`, migrations, or seeding were added.
- **Forward note for B2** (restating the plan's): B2 pages fetching these
  endpoints can e2e-assert loading and error states only, never rendered rows.
- The plan's expected lint-warning count (6) should be corrected to 7 wherever
  it is carried forward, or the discrepancy will be re-flagged every phase.

## Pre-publication history rewrite (2026-08-28)

### Files changed
- `~/Developer/northwind-fullstack/README.md` — the only working-tree file modified. Everything else was commit-metadata rewriting (messages + identities); every tree is byte-identical to before, proven below.

### Safety backup
- Bundle: `/private/tmp/claude-501/-Users-james-Developer/7ee2e817-d4a8-4b85-8618-13f4e5675051/scratchpad/northwind-pre-rewrite.bundle` (`--all`, taken with a clean `git status --porcelain`).
- Pre-rewrite heads: `main` = `95855ff74243345c131ee0ee257ffc4b6e654b7c`, `b1-northwind-server` = `bc531979ff5f3cc6a6afd16dd244114f79d683da`.

### Step 1 — README fix (commit `704df6c` pre-rewrite, on b1-northwind-server)
- "Two versions, two branches" section: replaced the `console-host` bullet and the `git switch console-host` bash lines; now describes `main` and `b1-northwind-server` only, single `npm install && npm run dev:all` launch block.
- Step 15 body: reworded to past tense ("was built as a separate version, not published here"), removed the `git switch console-host` / `dotnet run` bash block.
- No markdown heading changed (diff touched only two `#`-prefixed lines, both bash comments inside a code fence). `## Step 15 — The other version: branch console-host` heading intentionally left byte-identical per constraint.
- Deviation note: the plan said the directory tree documents a `ConsoleHost/` entry — it does not on this branch (tree lists only `client/`, `server/`, `package.json`). The only tree-adjacent mention was `ConsoleHost.csproj` in Step 15 prose, which the reword removed. Nothing else to delete.

### Steps 2+3 — one `git filter-branch` pass over `-- --all`
- `git-filter-repo` IS installed (`/opt/homebrew/bin/git-filter-repo`) but was deliberately not used: it prunes original objects, which would have broken the required old-vs-new tree-diff verification. `filter-branch` keeps `refs/original/`.
- `--msg-filter`: perl script removing exactly the trailing `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` + `Claude-Session: https://claude.ai/code/session_...` pair (all 7 carriers — the 6 listed plus the new README commit — had the identical end-of-message shape). Subjects and bodies untouched.
- `--env-filter`: `GIT_AUTHOR_EMAIL` and `GIT_COMMITTER_EMAIL` -> `36896551+Jamfin92@users.noreply.github.com` on all 30 commits; names untouched.
- `refs/original/*` deleted after verification (old SHAs remain recoverable via the bundle).

### Verification (real output)
- Identities — `git log --all --format='%an <%ae>|%cn <%ce>' | sort -u`:
  `James Finnerty <36896551+Jamfin92@users.noreply.github.com>|James Finnerty <36896551+Jamfin92@users.noreply.github.com>` (exactly one line).
- Trailers — `git log --all --format='%B' | grep -ci 'claude-session\|session_01\|Co-Authored-By'` -> `0`.
- Tree identity — `git diff 95855ff7...(old main) aefc94e0...(new main)` empty; `git diff 704df6c1...(old b1 head incl. README commit) a34564c6...(new b1 head)` empty. Not a single file altered by the rewrite.
- Dates — `git log --format='%ai %ci %s'` diffed old (refs/original) vs new for both branches before deleting the backups: identical.
- Branch structure — exactly `main` (27 commits) and `b1-northwind-server` (30 commits, 3 ahead of main). Note: the plan's checklist said "b1 still 2 commits ahead" but also directed the README commit onto b1 (not main), which makes 3 ahead: the original 2 server commits + the README commit. main is untouched at 27.
- `git status --porcelain` empty; `git remote -v` empty (no remote added, nothing pushed).
- Gates: ports 5170/5173 cleared (separate single-port lsof calls); `client && DEBUG=pw:webserver npm run e2e` -> **7 passed (5.2s)**, including test 1 asserting on parsed README headings; `npm run build` clean (`dist/assets/index-B_kSJEA6.js` 646.98 kB, only the pre-existing >500 kB chunk warning). `npm run shots` not run (barred).

### New heads
- `main` = `aefc94e01fabe1eab6268416d6af26e5ae20b81d`
- `b1-northwind-server` = `a34564c62628757528223c6a247a29e178f62a86`

### Open risks
- None functional. The bundle in the session scratchpad is the only remaining copy of pre-rewrite history; it is deleted when the scratchpad is cleaned, which is fine once the push is done and accepted.
