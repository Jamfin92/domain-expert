> **This file is the Phase B1 (server) record and is still accurate for the
> server.** Phase B2b Part 1 shipped 2026-09-01 — read
> `progress-b2b-1.md` for current state and for Part 2's scope. Note the fork SHA
> below (`bc53197`) is pre-rewrite and unreachable; the real one is `a34564c`.

# Phase B1 (Northwind testbed — server) — progress

Status: **SHIPPED, reviewer-approved (verdict: Ship, twice — once on the build,
once on the follow-up delta), 2026-08-27. PUBLISHED PUBLIC 2026-08-28 to
`github.com/Jamfin92/northwind-fullstack`. Nothing left open.**

Do not re-explore. Everything below was measured by re-running, not recalled.
Full command output is in `audit-b1.md`; the approved plan is `plan-b1.md`
(revision 2 — revision 1 was revised after a reviewer critique).

## Phase B was split

Phase B did not fit one context window, so on 2026-08-27 **the user split it into
B1 (server) and B2 (client)**. This file is B1. B2 is next and is described at the
bottom.

## What shipped

New repo: `~/Developer/northwind-fullstack`, a clone of
`vite-react-webapi-template` @ `template-refresh` `95855ff` with full history.
Now public at **https://github.com/Jamfin92/northwind-fullstack**.

| branch | head | contents |
|---|---|---|
| `main` | `aefc94e` | the refreshed template, zero B1 commits |
| `b1-northwind-server` | `a34564c` | **the Northwind server.** Everything below. |

**These SHAs are post-rewrite — see "Published public" below. `main` is NO LONGER
`95855ff`.** Pre-rewrite heads were `main` `95855ff` and `b1` `bc53197`; the trees
are byte-identical, only commit metadata changed.

Three commits on b1: the build, three review follow-ups, and a README fix made for
publication. `origin/console-host` (unrelated, not an ancestor) was dropped at
clone time, deliberately.

15 files, exactly the plan's Files-touched list.
New: 8 entity files in `server/Models/`, `server/Data/NorthwindDbContext.cs`,
`server/Dtos/NorthwindDtos.cs`, `server/Endpoints/NorthwindEndpoints.cs`.
Modified: `server/Server.csproj`, `server/Program.cs`, `server/appsettings.json`,
`.gitignore`.

**EF Core resolved versions: `Microsoft.EntityFrameworkCore` 10.0.11 and
`Microsoft.EntityFrameworkCore.Sqlite` 10.0.11.**

## The design decision that made B1 cheap: additive only

`/api/hello`, `/api/contact`, `/api/packages` and the static `Packages` class are
**byte-identical to the template**. No file under `client/` was touched. That kept
all seven Phase A gates alive as regression checks instead of going dark, and it
is why `client/` has an empty diff.

`Packages` and `pagination-page.tsx` come out **together in B2**, when the client
that calls them is rewritten.

## Verified end state (reviewer reproduced all of it by running, not reading)

- `dotnet build server --no-incremental` — 0 warnings, 0 errors. The forced
  rebuild matters: an incremental build can hide warnings.
- `npm run build` — clean, bundle **647.18 kB**, asset `index-BSc-BSw_.js`,
  gzip 207.51 kB. Byte-for-byte the Phase A hash, as expected for an untouched client.
- `npm run e2e` — **7/7 in ~4.3 s**, with `DEBUG=pw:webserver` proving the server
  was *started*, not reused (see the trap below).
- `npm run lint` — exit 0, **7** warnings, all under `client/src/`.
- `npm audit` in `client/` — 0 vulnerabilities.
- `npx tsc -b --force` in `client/` — exit 0, all three projects.
- `git diff --stat main..b1-northwind-server -- client/ README.md package.json
  package-lock.json` — **empty**.
- `git status --porcelain` — empty. No stray `*.db`/`-shm`/`-wal`.

## Model shapes actually present (verified against a real EF model dump)

Every shape the roadmap demands is real, confirmed by dumping `ctx.Model`:

- composite PK `OrderDetail(OrderId, ProductId)`; mapped `ToTable("Order Details")`
- `Customer.CustomerId` TEXT, maxlen 5, `ValueGeneratedNever` (app-assigned)
- `Employee.ReportsTo -> Employee`, optional, `Restrict`
- `Order.ShipVia -> Shipper`, optional, `Restrict`
- `Product.CategoryId/SupplierId`, `Order.CustomerId/EmployeeId` — all **nullable**,
  `ClientSetNull`, matching real Northwind
- `OrderDetail` FKs both `Cascade`
- explicit `HasIndex` on `Customer.CompanyName` and `Product.CategoryId`

Delete behaviours genuinely span three values. Nothing is convention-only.

11 routes (not 12 — an early audit typo, corrected). Paged routes reuse the
template's `{ Items, Page, PageSize, TotalItems, TotalPages }` envelope, the 1–50
clamp, and its exact arithmetic. DTO projection everywhere; no entity is ever
returned directly, which is what stops the navigation cycles.

## Five traps that cost real time — do not rediscover them in B2

1. **`reuseExistingServer: true` on fixed ports 5170/5173 can fake a green e2e.**
   A leftover `dotnet run` from the *template* repo will serve all 7 tests happily
   against a server without your changes in it. Always clear the ports first, and
   run `DEBUG=pw:webserver npm run e2e` — one run gives both the
   "Starting WebServer process" proof and the pass count.
2. **`lsof -ti :5170 :5173` does not work on this machine** (lsof 4.91:
   `status error on :5173`). Use two single-port calls.
3. **`npm ci`, never `npm install`.** A fresh clone has no `node_modules`, and
   `install` resolves fresh patches inside the `^` ranges — moving the bundle hash
   and rewriting `client/package-lock.json`, which then fails the empty-`client/`
   gate for a reason unrelated to the work.
4. **A Python JSON round-trip silently rewrote `server/appsettings.json`
   CRLF → LF**, turning a 3-line addition into a 21-line whole-file diff. Caught in
   review and restored. B2 touches far more files — do not round-trip JSON through
   a parser to edit it.
5. **Green gates do NOT mean a sound EF model.** Nothing in the eight gates ever
   resolves `NorthwindDbContext` — `dotnet build` only type-checks the fluent
   chain. The model was validated only because the reviewer built a throwaway
   project outside the repo and dumped `ctx.Model`. Any future claim about the
   model needs that, not a green build.

## Corrections to the record

- **Phase A's "6 lint warnings" was wrong — it is 7.** All under `client/src/`, and
  the empty `client/` diff proves B1 did not add them. Do not re-flag this.
- The plan's Step 6 enumerates **11** routes; an early audit line said twelve.
  Both audit references corrected.
- The m5b `progress.md` is **older than Phase A's** and stale where it claims TS 6
  and a missing .NET 10 SDK. Phase A measured both resolved: TS 7.0.2,
  SDK 10.0.400. Prefer `template-refresh/progress.md` and this file.

## Known and accepted limitation

**There is no database.** Hitting any `/api/customers|products|orders|…` route at
runtime returns 500 — no SQLite file, no schema. This is intended: the roadmap
specifies the testbed is *"source-complete, not running"*, because the extractor
only ever parses source. No test touches these routes.

**This constrains B2:** its pages will fetch these endpoints, so B2's e2e can
assert loading and error states only, never rendered rows. That is a constraint on
B2's tests — **not** a reason to reopen the no-database decision under pressure.

Also recorded, so it is not "discovered" later: `HasPrecision(19,4)` is a no-op on
SQLite (decimal maps to TEXT); `(page-1)*pageSize` overflows for extreme `page`,
but that is verbatim the template's existing `/api/packages` arithmetic, i.e.
parity, not a regression; and column coverage is a deliberate subset
(`Employee.Photo`, `Category.Picture` etc. are absent).

## Standing user decisions (do not re-ask)

1. **SUPERSEDED 2026-08-28: the user authorised the public push.** The repo is
   now public. Still standing: **no commits on `main`** — B1 lives on its own
   branch and `main` carries only the refreshed template. Ask before merging
   anything to `main` or before tagging (the roadmap has Phase C pull a tag, and
   nothing is tagged yet — deliberately, since Phase B is only half done).
2. **`npm run shots` stays barred** — it rewrites `client/public/screenshots/`.
   If run by accident: `git checkout -- client/public/screenshots`.
3. **Write the testbed as an app, not as a fixture.** Non-negotiable, from the
   roadmap. The implementer must not read domain-expert's `clients.ts`, `refs.ts`,
   or any extractor/attribution source while writing it. Verified clean in B1:
   grep for `extract|attribut|walker|fixture|testbed|domain-expert|psq|analy`
   across all new server files returned zero hits.
4. **Do not create a repo-root `tsconfig.json`.** It would break Phase C —
   C1's fix targets the solution-style config that already exists at
   `client/tsconfig.json`, and C2 extracts `client/` and `server/` as two roots.

## Published public (2026-08-28)

`https://github.com/Jamfin92/northwind-fullstack` — public, owner `Jamfin92`,
default branch `main`. Both branches pushed; remote SHAs verified equal to local.

A full secret scan ran over **all 165 blobs reachable from both branches**, not
just the working tree, because a push publishes every reachable object.
**No credentials, keys, certs, `.env` files, publish profiles, private registries,
or private-work references anywhere in history.** Zero hits for `domain-expert`,
this project, its corpus, its local tooling, or any machine/Tailscale name. The connection string
is `Data Source=northwind.db` — a relative SQLite path, not a secret. Screenshots
are template UI only: no browser chrome, no PNG text chunks.

Three metadata items were fixed **before** first push, which is the only time they
can be fixed — GitHub retains force-pushed objects, so a later scrub would not
retract them:

1. **`Claude-Session` trailers stripped** from 7 commits. The id was live, and
   would have permanently tied a public repo to a private session.
   `Co-Authored-By` trailers went with them. Message bodies kept verbatim.
2. **Author and committer email rewritten** on all 30 commits to
   `36896551+Jamfin92@users.noreply.github.com`. Display name unchanged. The
   gmail address appears nowhere in the published history.
3. **README fixed** — it told readers to `git switch console-host`, a branch that
   is not published. Real markdown headings are untouched (the two `#` lines that
   moved were shell comments inside a ```bash fence), so e2e test 1 still passes.

Proof the rewrite changed no content: `main`'s tree hash is `4dc25b36…` both
before and after, and `git diff` old-head..new-head is empty for `main` and shows
only `README.md` for b1. Pre-rewrite history is preserved in a bundle at
`scratchpad/northwind-pre-rewrite.bundle` (session scratchpad — will not survive
indefinitely; the old SHAs `95855ff`/`bc53197` exist nowhere else now).

Gates re-run after the rewrite: e2e **7/7**, `npm run build` clean.

**Nothing is tagged.** Phase C expects to pull a tag; do not tag until Phase B is
complete, or C will vendor a testbed whose client is still the stock template.

## Next: Phase B2 — the client

Fork point: `b1-northwind-server` @ `bc53197`.

Scope, from `m5b-component-attribution/roadmap.md` (Phase B, lines 50-93):

- Replace the single `useApi<T>` hook in `client/src/lib/` with a real
  services/hooks/pages layer, **in the template's own idioms**. No `services/` or
  `hooks/` directory exists yet.
- Keep the 11 shadcn `ui/` primitives as decoys (PascalCase components that make
  no calls).
- Delete `Packages` + `/api/packages`, rewrite `pagination-page.tsx`, and update
  e2e tests 5 and 6 — they assert hard-coded package data (`react`,
  `react-router`, `motion`, exactly 4 pages).
- **Keep `/api/hello` answering** — it is Playwright's readiness probe; if it stops,
  the whole suite fails to start.
- **Do not edit README headings** — `guide-page.tsx` renders `README.md?raw` and
  e2e test 1 asserts on its parsed headings.

The roadmap requires the client to *naturally* contain: a 3-hop
component→hook→service→fetch chain, a 2-hop component→service, a direct call in a
component, a module with calls and no component owner, a hook consumed by two
components, a provider that owns calls, `export default function Named()`, a
`React.forwardRef` const, a barrel re-export, and — critically — **two components
with the same name in different directories**.

Roadmap gotchas worth carrying in: `ClientCall.components` holds `DefKey`s
(`<repo-relative file>#<name>`), not names, which is exactly why the two
same-named components matter; the catalogued "provider swallow" means consumers of
a provider's hook are deliberately not attributed, so do not write B2 expecting
otherwise; `readClientCalls` skips test files and express-importing files; and a
`call<T>(path, init)`-style wrapper currently yields no client calls unless
unwrapping runs before attribution.

Start at step 1 of the workflow: scout, then plan. Nothing from B1 is unfinished
and no decision is outstanding.
