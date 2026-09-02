> **SUPERSEDED as the current-state file.** This remains the accurate record of
> B2a itself. Phase B2b **Part 1** shipped 2026-09-01 at `955a680` — read
> `progress-b2b-1.md` for current state and for Part 2's scope. The bundle
> figure below (`657.74 kB`) and the "three reference endpoints" count are both
> retired; see the newer file.

# Phase B2a (Northwind testbed — client, additive half) — progress

Status: **SHIPPED, reviewer-approved (verdict: Ship, no blocking issues),
accepted by the user 2026-08-31. Not pushed. Not tagged. `main` untouched.**

Do not re-explore. Everything below was measured by re-running, not recalled —
the reviewer re-ran all ten gates itself rather than trusting the audit.

- Approved plan: `plan-b2.md` (**revision 2**; rev 1 is kept as `plan-b2-rev1.md`
  and was rejected — see "Why rev 1 was rejected", it matters for B2b).
- Implementer audit with full command output: `audit-b2a.md`.
- B1's record is `progress.md`. It is still accurate for the server.

## What shipped

Branch `b2-northwind-client`, commit **`08f7e51`**, forked from
`b1-northwind-server` @ **`a34564c`**.

> The fork SHA in `progress.md` (`bc53197`) is **pre-rewrite**. It still exists
> in the object store but is unreachable from any ref. `a34564c` is correct.

`git diff --name-status a34564c..08f7e51` = exactly **18 A + 2 M**, matching the
plan character for character. **Purely additive** — nothing deleted or renamed,
no B2b work leaked.

New: `client/src/lib/api-types.ts`;
`client/src/services/{customers,products,orders,reference}.ts`;
`client/src/hooks/{use-customers,use-products}.ts`;
`client/src/context/reference-data-context.ts`;
`client/src/components/{reference-data-provider.tsx,customer-search-input.tsx}`;
`client/src/components/orders/{index.ts,order-table.tsx,product-list.tsx,order-detail-panel.tsx}`;
`client/src/components/products/product-list.tsx`;
`client/src/pages/{products,orders,categories}-page.tsx`.
Modified: `client/src/routes.tsx`, `client/src/App.tsx`.

## Verified end state (reviewer reproduced all of it by running)

- `dotnet build server --no-incremental` — 0 warnings, 0 errors.
- `npx tsc -b --force` — exit 0.
- `npm run build` — clean. **Bundle moved to 657.74 kB / `index-BdX0NRz9.js`.**
  Phase A's `647.18 kB` / `index-BSc-BSw_.js` is **retired by design** — B2 is the
  phase that rewrites `client/`. Do not flag either as a regression.
- `npm run lint` — **exactly 7 warnings**, unchanged, at the same 7 file:line.
- `npm audit` — 0 vulnerabilities.
- `DEBUG=pw:webserver npm run e2e` — **7/7**, both servers provably *started*
  (full `ECONNREFUSED` → `HTTP Status: 200` handshake for 5170 and 5173).
- `git status --porcelain` — empty.
- Package/lockfile diff — empty for `main..branch` and `a34564c..08f7e51`.
- Vocabulary grep — exit 1, clean (see the trap below).

**A5 hard requirement met structurally, not just empirically:**
`reference-data-provider.tsx:45` has one unconditional return of
`<ReferenceDataContext value={data}>{children}</ReferenceDataContext>`. No gate,
no throw, no Suspense, no early return; `failed` is data, not control flow. With
no database, `/api/categories`, `/api/suppliers` and `/api/shippers` all 500 on
**every** page load and the suite is still 7/7 with those three XHRs in flight.

## The corrected lint baseline — 7, and NOT all under `ui/`

Rev 1 of the plan claimed all 7 were under `client/src/components/ui/`. False,
and the falsehood hid the problem it caused. Measured:

| file:line | rule |
|---|---|
| `ui/button.tsx:67` | `only-export-components` |
| `ui/navigation-menu.tsx:163` | `only-export-components` |
| `ui/carousel.tsx:239` | `only-export-components` |
| `ui/carousel.tsx:96` | `set-state-in-effect` |
| `lib/useApi.ts:23` | `set-state-in-effect` |
| `lib/markdown.ts:83` | `no-unused-expressions` |
| `pages/form-page.tsx:82` | `incompatible-library` |

`lib/useApi.ts:23` is the synchronous `setState({status:'loading'})` in an effect
body — the exact shape rev 1 told the implementer to copy. Four new hooks would
have taken 7 → 11. **Fix already applied and working:** hooks initialise
`useState<ApiState<T>>({ status: 'loading' })` and never re-set synchronously;
loading-on-page-change comes from the React-docs `key` remount idiom. Keep this
rule in B2b — `customers-page.tsx` will hit it.

## Two traps that cost real time — do not rediscover them

1. **A grep gate can FAKE-PASS.** The implementer's first vocabulary grep passed
   an unquoted variable holding the file list; zsh does not word-split it, so the
   whole list went through as one filename → exit 2, which reads as "no matches".
   Re-run with paths written out longhand: exit 1, genuinely clean. **The
   reviewer then validated the gate with a positive control** — the identical
   command with `product` as the pattern matched 10 files. Any negative gate
   (grep for forbidden words, "diff is empty", "no warnings") needs a positive
   control before it is believed.
2. **`node`/`npm` are not on `PATH` on this machine** — a stale nvm entry leads
   it. Use `~/.local/share/fnm/node-versions/v24.19.0/installation/bin`.

Still live from B1: `lsof -ti :5170 :5173` errors on this machine (lsof 4.91) —
use two separate single-port calls; `reuseExistingServer: true` will serve a
green run off a stale server from another repo; `npm ci`, never `npm install`;
do not round-trip JSON/Markdown through a parser.

## Why rev 1 of the plan was rejected — carry this into B2b

The reviewer rejected rev 1 for asserting in bold that nothing was built for the
static reader, then specifying: a **no-express-import** rule for an ASP.NET
backend, a **no-trailing-slashes** style rule, a **cache prime** against an
endpoint that sends no cache headers, and a raw `fetch` **shadowing a service
function in the same folder**. Each small; together, the plan doing what its own
non-negotiable forbade. All four were struck in rev 2.

**The same failure recurred one level down in the code, and B2b must fix it.**
The reviewer's summary: *the code reads as an app; the comments are where it
slips.* Every shape it was asked to attack is defensible as structure and is
defended in-file with a reason that does not survive checking.

## B2b's scope — the plan's steps B1-B6, PLUS these accepted review findings

The user accepted B2a and approved folding the following into B2b.

**Comment rewrites (the honesty fixes):**
- `services/reference.ts:31` — claims categories are "needed by the first screen
  that renders" (false: `/` is the guide page, which needs nothing from the
  provider) and claims a dedup that is **development-only** (StrictMode
  double-invokes in dev, not production). Reword to the true reason: avoiding a
  duplicate flight across remounts.
- `order-detail-panel.tsx:13` — states a "collection queries serve several
  screens" convention the code contradicts (only `listProducts` has two
  consumers), and `orders-page.tsx:11-13` argues the opposite way. Reconcile.
- `customer-search-input.tsx:13` — implies `forwardRef` is what enables focusing.
  It is not: `ui/input.tsx` types `Input` as `React.ComponentProps<"input">`,
  which in React 19 already includes `ref`. The `forwardRef` is a roadmap
  concession; that label belongs in the plan, not disguised in the code.

**Real bugs:**
- `categories-page.tsx:18` — `useProducts(1, 6, selectedId)` has no `key`
  remount, so switching category renders the **previous** category's products
  under the new category's heading until the response lands, with no loading
  state. `products-page.tsx` already solves this with
  `` key={`${categoryId ?? 'all'}:${page}`} ``.
- `products/product-list.tsx:19` — `` `${value.toFixed(2)}` `` is a template
  literal wrapping a single interpolation and nothing else. Swallowed `$`;
  prices render bare while the null branch says "Price on request".
- `products/product-list.tsx:67,80` — pagination `href`s are decorative and lie.
  Lifted from the URL-driven `pagination-page.tsx`, but here `page` is local
  state and the URL is never written, so open-in-new-tab gives `/products?page=2`
  and renders page 1. Make the page URL-driven like its sibling, or use buttons.
- `services/reference.ts:26` — **cut `listEmployees` or give it a consumer.** No
  phase ever calls it. In a testbed that is worse than neutral: it hands the
  reader a call site the app does not actually cause. Obvious consumer if kept:
  label `OrderSummaryDto.employeeId` on the orders table.

**Lower priority, reviewer-noted:** `products/product-list.tsx:28` dead `: page`
fallback; `categories-page.tsx:27` hardcodes "Eight categories"; the provider
exposes `failed: boolean` rather than a `status` union, so loading is
indistinguishable from "loaded and empty"; `orders/product-list.tsx` would be
better named `LineItems` (the two same-named `ProductList`s are genuinely
different components, so the pairing itself stands).

## Decisions already made (do not re-ask)

1. **Request wrapper: mixed, deliberately.** `reference.ts` uses a shared
   `getJson<T>()`; the other three services spell out their own literal-path
   fetches. The roadmap records that wrapper-style calls currently extract as
   nothing — banning wrappers outright would remove the reader's one known weak
   spot from the testbed, so it could never detect it.
2. **E2E: request-assertion, no `page.route()` body-mocking.** A mock authored to
   match our own TS types proves the types agree with themselves, not with the
   server.
3. **No database.** Every Northwind route 500s. No test may assert rendered rows.
   Not a reason to reopen the decision under pressure.
4. **`useApi.ts` survives** — still the right tool for the guide page's
   `/api/hello` card, which e2e test 1 asserts.
5. **No commits on `main`; do not tag; `npm run shots` stays barred; pushing to
   the public repo is a separate decision after acceptance.**
6. **No repo-root `tsconfig.json`** — Phase C1 targets `client/tsconfig.json`.

## B2b traps the plan already records

`/api/hello` must keep answering (Playwright's readiness probe on 5170).
README **headings** must not change — `lib/markdown.ts:63` matches
`/^Step (\d+) — (.*)$/` with a literal em-dash, and `guide-page.tsx:88` keys the
section list on `section.title`. The `#` title stays `vite-react-webapi-template`
despite the repo being `northwind-fullstack`. **e2e test 7 asserts `"Don't"` and
`"Do"` appear exactly 6 times** and is not on the rewrite list — reword the
pagination rule in `dos-donts-page.tsx`, never delete it. Six stale references
need clearing, not two (the table is in `plan-b2.md` step B3).
`page.waitForRequest` must be set up **before** `page.goto`. react-router is
**v8**, not v7.

## Next

Start B2b at step 1 of the workflow (scout, then plan) or go straight to
implementing `plan-b2.md` steps B1-B6 plus the accepted findings above — the plan
for B2b is already written and approved in outline; only the folded-in review
findings are new. Nothing from B2a is unfinished and no decision is outstanding.
