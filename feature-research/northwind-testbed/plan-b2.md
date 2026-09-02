# Phase B2 — Northwind testbed, the client (plan, revision 2)

Revision 1 was sent to the reviewer and came back **Revise** with five blocking
issues. All five are fixed below; `plan-b2-rev1.md` is kept for the record.
The substantive change: rev1 asserted in bold that nothing was built for the
reader, then specified a no-express rule for a .NET backend, a no-trailing-slash
style rule, a cache prime against an endpoint that sends no cache headers, and a
raw `fetch` shadowing a service function in the same folder. Those are struck.

Fork point: branch `b1-northwind-server` @ **`a34564c`**. (`bc53197` from
progress.md is the pre-rewrite SHA — still in the object store, unreachable from
any ref. Do not use it.) Repo: `~/Developer/northwind-fullstack`.

## Objective

Replace the single-`useApi` client with the layered services / hooks / pages
structure a real Northwind CRUD app would have, in the template's own idioms.
Delete the `Packages` feature. Keep every surviving Phase A gate green.

## Split into B2a and B2b, on purpose

Rev1 offered a split as an overrun contingency and got it wrong — its step 8
dropped `/pagination` inside the half that was supposed to keep all seven tests
green. The split is now deliberate and the line is drawn correctly:

- **B2a — additive only.** Every new file, plus four new routes. `/pagination`,
  `Packages`, `/api/packages` and all seven e2e tests stay exactly as they are.
  All eight gates stay green as regression checks. This is B1's winning strategy
  reused, and it is a genuinely strong checkpoint.
- **B2b — the deletions.** Remove `Packages` + `/api/packages`, rewrite
  `pagination-page.tsx` into the customers page, rewrite e2e tests 5 and 6, and
  clear every stale reference.

Each half is independently green and reviewable. **This plan covers B2a and B2b
in one document; approve both or approve B2a and hold B2b.**

## The non-negotiable, restated honestly

**Write this as an app, not as a fixture.** The implementer must not read
domain-expert's `clients.ts`, `refs.ts`, or any extraction source, and no new
file may contain `extract`, `attribut`, `walker`, `fixture`, `testbed`,
`domain-expert`, `psq`, `analy`.

Two shapes the roadmap demands are **concessions, not idiom**, and the plan says
so rather than inventing a justification:

- **`React.forwardRef`.** `client/package.json` pins React `^19.2.8`, where refs
  are ordinary props and `forwardRef` is soft-deprecated with a codemod to remove
  it. No 2026 React 19 app would add one. The roadmap requires the shape, so it
  goes in, labelled.
- **`export default function OrdersPage()`** among three named-export siblings.
  Mixed export styles exist in real codebases, but here it is the roadmap's ask.

Everything else below has to earn its place as app design.

## House style for services

One rule, and it is genuinely app-motivated: **check `res.ok` before parsing.**
The server has no exception handler, so a 500 returns an HTML developer-exception
page; parsing first yields a confusing JSON syntax error instead of the status.
`client/src/pages/form-page.tsx:41-48` already does exactly this.

Rev1's other four sub-rules (no computed keys, no trailing slashes, no arrow
properties, no express import) are **struck**. They had no app-level meaning —
the backend is ASP.NET Core; there is no express to import.

### The request wrapper — a real decision, flagged for you

Rev1 banned a generic `call<T>(path, init)` wrapper. That ban was reader-facing:
the roadmap records that such wrappers currently yield no client calls. Removing
the reader's one known weak spot from the testbed means the testbed can never
detect it — which is the M5a failure the roadmap opens with.

So: **most services spell out their own `fetch` with a literal path** (following
`form-page.tsx`, the template's only hand-written fetch), **and `reference.ts`
uses a small shared `getJson<T>(path)` helper** — because its four functions are
four identical unparameterised GETs and a real developer would factor that out on
the third one. That mixed state is what actual codebases look like, and it leaves
the wrapper case present and measurable in Phase D instead of legislated away.

*See "Open questions" — this is decision 1.*

## Architecture

```
client/src/
  lib/api-types.ts                        TS mirrors of the nine DTOs + Paged<T>
  services/customers.ts                   listCustomers(page, pageSize)
  services/products.ts                    listProducts(page, pageSize, categoryId?)
  services/orders.ts                      listOrders(page, pageSize)
  services/reference.ts                   listCategories/Suppliers/Shippers/Employees
                                          + module-scope `categoriesPromise`
  hooks/use-customers.ts                  -> services/customers
  hooks/use-products.ts                   -> services/products
  context/reference-data-context.ts       createContext + useReferenceData
  components/reference-data-provider.tsx  provider component, owns its fetches
  components/customer-search-input.tsx    React.forwardRef const (concession)
  components/orders/index.ts              barrel
  components/orders/order-table.tsx       OrderTable
  components/orders/product-list.tsx      ProductList — line items of one order
  components/orders/order-detail-panel.tsx  owns its own by-id fetch
  components/products/product-list.tsx    ProductList — the catalogue
  pages/{products,orders,categories}-page.tsx      (B2a)
  pages/customers-page.tsx                (B2b, from pagination-page.tsx)
```

**The two `ProductList`s.** Rev1 paired `products/` with `categories/` and
justified it as "different empty-state copy and columns" — which describes one
component with a prop. The pairing is now `products/product-list.tsx` (the
catalogue: paged, fetches via `useProducts`) and `orders/product-list.tsx` (the
line items on one order: renders `OrderDto.details` passed in as a prop, fetches
nothing). Different data, different props, nothing to merge.

## B2a — steps

**A1 — Branch.** `git switch -c b2-northwind-client` from `a34564c`.
`npm ci` in `client/`. Never `npm install`.

**A2 — `lib/api-types.ts`.** Mirrors of the nine DTOs plus
`export type Paged<T> = { items: T[]; page: number; pageSize: number;
totalItems: number; totalPages: number }`. **camelCase** — minimal APIs use
`JsonSerializerDefaults.Web` and configure no override. Nullable C# maps to
nullable TS: `decimal? UnitPrice` → `unitPrice: number | null`, `short?
UnitsInStock` → `number | null`, `int? CategoryId` → `number | null`,
`DateTime?` → `string | null`. Strict null checking is on, so getting this wrong
fails `tsc -b`. Types only, no runtime export.

**A3 — Services.** `customers.ts`, `products.ts`, `orders.ts` each export one
list function with its own literal-path `fetch` and an `res.ok` check.
`reference.ts` exports `listCategories/listSuppliers/listShippers/listEmployees`
over a local `getJson<T>(path)` helper, plus a module-scope
`export const categoriesPromise = listCategories()` that the provider awaits.

That module-scope promise replaces rev1's `lib/warmup.ts`. The reviewer was
right that the warmup was a fake: it primed a cache against an endpoint that
sends no `Cache-Control`, `ETag` or `Last-Modified`, so it was one wasted request
milliseconds before an identical one. A module-scope promise the provider awaits
is a real fetch-then-render dedup pattern that actually works — and it is still a
call in a module no component owns.

**No by-id service functions.** The convention is: *a service owns collection
queries used by more than one screen; a detail panel owns its single by-id
request.* This is why `getOrder(id)` does not exist — rev1 had it exported and
then had `OrderDetailPanel` bypass it with a hand-rolled fetch to the same URL,
leaving `getOrder` with no callers. Same for the unused `getCustomer` /
`getProduct` rev1 declared.

**A4 — Hooks.** `use-customers.ts` and `use-products.ts`: `useEffect` +
`AbortController`, returning the template's `ApiState<T>` union.

**They must initialise `useState<ApiState<T>>({ status: 'loading' }) and never
re-set it synchronously in the effect body.** That synchronous reset is what
trips oxlint's `set-state-in-effect` — measured: with the reset, +1 warning per
hook; without it, clean. Paging still shows a loading state, via the React-docs
idiom of resetting state with a key: the page renders `<ProductList key={page} />`,
so a page change remounts the list and the hook starts fresh. That is idiomatic,
not a workaround.

**A5 — Reference data provider.** Two files, because a single `.tsx` exporting
`useReferenceData` beside `ReferenceDataProvider` fires
`react/only-export-components` (reviewer confirmed the split is both necessary
and sufficient). `context/reference-data-context.ts` holds the context and the
`useReferenceData()` accessor; `components/reference-data-provider.tsx` holds the
component, which awaits `categoriesPromise` and loads suppliers and shippers on
mount. `App.tsx` wraps the layout route in it.

**It must always render `children`.** There is no database, so all three of its
requests 500 on every page load, including `/`, `/carousel`, `/form` and
`/dos-donts`. If the provider gates children behind success, or throws, or
suspends, it takes out the five surviving e2e tests — the entire regression
value of B2a. It exposes empty arrays plus an error flag and renders children
unconditionally. **Record as a checked fact, not an assumption, that the five
surviving tests still pass with three failing XHRs in flight on every page.**

**A6 — Components.** `products/product-list.tsx` (`ProductList`, consumes
`useProducts`); `orders/product-list.tsx` (`ProductList`, presentational, renders
`details` from its props); `orders/order-table.tsx` (`OrderTable`,
presentational); `orders/order-detail-panel.tsx` (`OrderDetailPanel`, owns its
own `fetch` for the selected order and renders `orders/ProductList`);
`orders/index.ts` (barrel of pure `export { X } from './x'` re-exports —
reviewer confirmed lint-safe); `customer-search-input.tsx`
(`const CustomerSearchInput = React.forwardRef<HTMLInputElement, Props>(...)`
wrapping the shadcn `Input`, makes no calls; the concession noted above).

**A7 — Pages.** `products-page.tsx` (`export function ProductsPage()`, renders
`products/ProductList`, category filter from `useReferenceData()`);
`categories-page.tsx` (`export function CategoriesPage()`, categories from
`useReferenceData()`, and consumes `useProducts` directly to show the selected
category's products — this is `useProducts`' second consumer);
`orders-page.tsx` (`export default function OrdersPage()`, calls
`services/orders` directly, renders `OrderTable` + `OrderDetailPanel` from the
barrel).

**A8 — Wiring, additive only.** `routes.tsx` **adds** `/products`, `/orders`,
`/categories` (default-import `OrdersPage`) and **keeps `/pagination`**.
`App.tsx` wraps in `ReferenceDataProvider`. `layout.tsx` needs no change — it
maps `routes` — so the nav temporarily shows eight items. Nothing is deleted in
B2a.

**A9 — Gates.** All eight, with real output recorded:
`dotnet build server --no-incremental` (0/0) · `npx tsc -b --force` ·
`npm run build` · `npm run lint` · `npm audit` · `DEBUG=pw:webserver npm run e2e`
(**7/7 still**) · `git status --porcelain` empty · the vocabulary grep.
Plus two the plan adds:
- `git diff --stat main..b2-northwind-client -- client/package.json
  client/package-lock.json package.json package-lock.json` must be **empty**.
  `git status --porcelain` does not catch a lockfile churned by `npm install`
  and then committed, which is precisely B1 trap #3.
- Lint warning count must still be **7**. Measured baseline, corrected from
  rev1: `ui/button.tsx:67`, `ui/navigation-menu.tsx:163`, `ui/carousel.tsx:239`
  (`only-export-components`), `ui/carousel.tsx:96` and `lib/useApi.ts:23`
  (`set-state-in-effect`), `lib/markdown.ts:83` (`no-unused-expressions`),
  `pages/form-page.tsx:82` (`incompatible-library`). **Three of the seven are
  not under `ui/`** — rev1 said they all were, which was wrong.

**Clear ports 5170 and 5173 before every e2e run, with two single-port `lsof -ti`
calls** — `lsof -ti :5170 :5173` errors on this machine, and
`reuseExistingServer: true` will serve a green run off a stale server from
another repo.

## B2b — steps

**B1 — `pagination-page.tsx` → `customers-page.tsx`.** Rewrite it as the paged
customers page at `/customers`, consuming `use-customers`, URL-driven via
`useSearchParams` exactly as today, rendering `CustomerSearchInput`. Update
`routes.tsx`. This is the roadmap's "rewrite `pagination-page.tsx`".

**B2 — Delete `Packages`.** In `server/Program.cs`: the `/api/packages` route,
`record Package`, and `static class Packages`. **Leave `/api/hello` and
`/api/contact` byte-identical** — `/api/hello` is Playwright's readiness probe on
port 5170 and the suite cannot start without it.

**B3 — Clear every stale reference.** Rev1 named two; there are six, and four of
them are statements the app renders on screen and that B2 makes false:

| file:line | what is now false |
|---|---|
| `client/src/pages/dos-donts-page.tsx:24` | "The pagination page derives the page number from the URL…" |
| `client/src/pages/dos-donts-page.tsx:63` | code sample using `Packages.All` |
| `client/src/pages/dos-donts-page.tsx:74` | "`useApi.ts` — the only fetch effect in the app; every page goes through it" |
| `client/src/pages/dos-donts-page.tsx:99` | "exactly two effects" |
| `README.md:218,223` | Step 11 prose referencing `Packages.All` |
| `README.md:230-232` | the same "exactly two effects" claim, rendered as a card on `/` |

**Trap: e2e test 7 asserts `"Don't"` and `"Do"` each appear exactly 6 times**
(`client/e2e/pages.spec.ts:69-71`), and test 7 is *not* on the rewrite list. The
`rules` array in `dos-donts-page.tsx` must keep **exactly six** entries — reword
the pagination rule, never delete it.

**README headings must not change.** Test 1 asserts the `#` title
`vite-react-webapi-template` — **which stays, despite the repo now being called
`northwind-fullstack`; do not "helpfully" rename it** — plus the text `Step 1`,
the heading `Init the repo`, and `/The server says/`. Rev1 wrongly said test 1
asserts Step 11; it does not. The real reason to leave headings alone is
`client/src/lib/markdown.ts:63`, which matches `/^Step (\d+) — (.*)$/` with a
**literal em-dash and single spaces**, and `guide-page.tsx:88`, which keys the
section list on `section.title`. A heading normalised by `sed` loses its step
chip; a duplicated title collides on the React key. Edit prose lines only.
**Do not round-trip any JSON or Markdown through a parser** — B1 lost a whole
file to a CRLF→LF rewrite that way.

**B4 — E2E.** Rewrite tests 5 and 6 for `/customers` and add one per new page.
**No database, so no test may assert rendered rows.** Each asserts the page
mounts, its heading renders, and it reaches its error state. The
`/customers?page=4` deep-link test additionally proves the outgoing URL carries
`page=4` — **`page.waitForRequest` must be set up before `page.goto`**, or the
request is missed, and React 19 StrictMode double-invokes effects in dev so two
requests are expected. Every hook stays a **role / accessible name**; the suite
has no `data-testid` anywhere and new code must not start.

**B5 — Screenshots.** Drop `/pagination` from `screenshots.spec.ts`, add the four
new pages, delete the orphaned `client/public/screenshots/pagination.png` and its
`README.md:226` image line. **`npm run shots` stays barred**, so the new PNGs
will not exist until you authorise a run — the README's illustrated tour is
incomplete until then. Flagged, not silently accepted.

**B6 — Gates.** All ten from A9, with the e2e count now **10/10**, not 7/7.

## Files touched

**B2a new (15):** `client/src/lib/api-types.ts`,
`client/src/services/{customers,products,orders,reference}.ts`,
`client/src/hooks/{use-customers,use-products}.ts`,
`client/src/context/reference-data-context.ts`,
`client/src/components/{reference-data-provider.tsx,customer-search-input.tsx}`,
`client/src/components/orders/{index.ts,order-table.tsx,product-list.tsx,order-detail-panel.tsx}`,
`client/src/components/products/product-list.tsx`,
`client/src/pages/{products,orders,categories}-page.tsx`
*(18 files — three pages counted separately)*

**B2a modified (2):** `client/src/routes.tsx`, `client/src/App.tsx`

**B2b modified (6):** `client/src/routes.tsx`, `client/src/pages/dos-donts-page.tsx`,
`client/e2e/pages.spec.ts`, `client/e2e/screenshots.spec.ts`,
`server/Program.cs`, `README.md`

**B2b renamed (1):** `client/src/pages/pagination-page.tsx` →
`client/src/pages/customers-page.tsx`

**B2b deleted (1):** `client/public/screenshots/pagination.png`

## Deliberately NOT touched

`client/src/components/ui/*` (the 11 shadcn primitives stay — they are the
call-free decoys the roadmap asks for); `client/src/lib/useApi.ts` (still the
right tool for the guide page's `/api/hello` card, which test 1 asserts; the
roadmap replaces the single-hook *architecture*, not the file);
`client/src/components/layout.tsx`; `client/tsconfig*.json`;
`client/package.json`; `client/package-lock.json`; `client/vite.config.ts`;
`client/playwright.config.ts`.

**No repo-root `tsconfig.json`.** Phase C1 targets the solution-style config at
`client/tsconfig.json`; a root one would break it.

**B1's empty-`client/`-diff gate is retired by design.** B2 is the phase that
rewrites `client/`. The bundle hash and size will move off Phase A's
`647.18 kB` / `index-BSc-BSw_.js`. Recorded here so a reviewer reading
progress.md does not flag both as regressions.

## Traps

- `verbatimModuleSyntax` is on → type-only imports must be `import type { … }`.
- `noUnusedLocals` / `noUnusedParameters` are on → an unused import fails
  `tsc -b`. Note it does **not** catch exported dead code.
- `react/rules-of-hooks` is **error** → no conditional or post-early-return hooks.
- `react/only-export-components` is **warn** → never export a non-component
  beside a component (this is why A5 splits into two files).
- `set-state-in-effect` is **warn** → no synchronous `setState` in an effect body.
- `npm ci`, never `npm install`.
- **react-router is v8** (`^8.3.0`), not v7 as rev1 said. Import from
  `'react-router'`; there is no `react-router-dom` in the v8 single-package era.
- The `@/` alias is declared in `tsconfig.json`, `tsconfig.app.json` and
  `vite.config.ts`. Use it; do not add a fourth declaration.

## Standing user decisions (do not re-ask, do not violate)

1. **No commits on `main`.** B2 lives on `b2-northwind-client`. Ask before
   merging.
2. **Do not tag.** Phase C pulls a tag; tagging before B2 is accepted would
   vendor a stock-template client.
3. **`npm run shots` stays barred.** If run by accident:
   `git checkout -- client/public/screenshots`.
4. Pushing to the public GitHub repo is a **separate** decision, after
   acceptance.

## Open questions

**1 — The request wrapper (recommend: mixed, as written).** `reference.ts` uses a
shared `getJson<T>()`; the other three services spell out their own fetches. The
roadmap records that wrapper-style calls currently extract as nothing, so the
mixed state keeps that weak spot present and measurable in Phase D. The
alternative is all-literal everywhere, which would make B2 extract more cleanly
today and tell you less later.

**2 — E2E strength (recommend: request-assertion, no body-mocking).** With no
database the tests assert loading/error states plus the outgoing request URL.
`page.route()` body-mocking would let them assert rendered rows, but a mock I
author to match my own TS types proves the types agree with themselves, not with
the server. Say the word and B4 switches.

**3 — Approve both halves, or B2a only?** B2a is additive and leaves all seven
tests green; B2b does the deletions. Approving B2a alone is a real option.
