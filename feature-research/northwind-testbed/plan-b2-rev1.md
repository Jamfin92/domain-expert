# Phase B2 — Northwind testbed, the client (plan, revision 1)

Fork point: branch `b1-northwind-server` @ **`a34564c`** (NOT `bc53197` — that SHA
is pre-rewrite and no longer exists). New branch: `b2-northwind-client`.
Repo: `~/Developer/northwind-fullstack`.

## Objective

Replace the single-`useApi` client with the layered services / hooks / pages
structure a real Northwind CRUD app would have, in the template's own idioms.
Delete the `Packages` feature. Keep every surviving Phase A gate green.

## Non-negotiable constraint carried from the roadmap

**Write this as an app, not as a fixture.** The implementer must not read
domain-expert's `clients.ts`, `refs.ts`, or any extraction/attribution source
while writing it, and no new file may contain the words
`extract`, `attribut`, `walker`, `fixture`, `testbed`, `domain-expert`, `psq`,
`analy`. B1 was verified clean by grep; B2 gets the same check.

Every structure below is justified as an app decision. That justification is
real, not a cover story — if a step reads as "put shape X here for the reader",
it is wrong and should be pushed back on.

## Architecture

```
client/src/
  lib/api-types.ts              TS mirrors of the server DTOs + Paged<T>
  lib/warmup.ts                 module-scope prefetch of /api/categories
  services/{customers,products,orders,reference}.ts
  hooks/{use-customers,use-products}.ts
  context/reference-data-context.ts       createContext + useReferenceData
  components/reference-data-provider.tsx  provider component, owns its fetches
  components/customer-search-input.tsx    React.forwardRef const
  components/orders/{index.ts,order-table.tsx,order-detail-panel.tsx}
  components/products/product-list.tsx    ProductList
  components/categories/product-list.tsx  ProductList  (same name, other dir)
  pages/{customers,products,orders,categories}-page.tsx
```

House style for services, stated as app style (all three are ordinary explicit-code
choices, and the template already fetches this way in `form-page.tsx`):

1. **No generic request wrapper.** Each service function spells out its own
   `fetch` with a **full literal `/api/...` path** and a **literal** `method`
   where one is given. No `call<T>(path, init)` indirection, no spread options,
   no computed keys, no trailing slashes.
2. Services are **plain exported `async function`s** (or object-literal `async
   method(){}` form) — never arrow properties on an object literal.
3. No service, hook or component file imports `express`, even as a type.

## Steps

**1 — Branch.** `git switch -c b2-northwind-client` from `a34564c`. `npm ci` in
`client/` (never `npm install`).

**2 — `lib/api-types.ts`.** TypeScript mirrors of the nine server DTOs, plus
`export type Paged<T> = { items: T[]; page: number; pageSize: number;
totalItems: number; totalPages: number }`. **camelCase property names** — the
server configures no naming policy, so ASP.NET's default camelCase is what is on
the wire. `DateTime?` → `string | null`; `decimal/float/short/int` → `number`.
Types only, no runtime export.

**3 — Services.** `customers.ts` (`listCustomers(page, pageSize)`,
`getCustomer(id)`), `products.ts` (`listProducts(page, pageSize, categoryId?)`,
`getProduct(id)`), `orders.ts` (`listOrders(page, pageSize)`, `getOrder(id)`),
`reference.ts` (`listCategories()`, `listSuppliers()`, `listShippers()`,
`listEmployees()`). Each checks `res.ok` before parsing — the server returns an
HTML developer-exception page on 500, so parsing first would throw a confusing
JSON error. Query strings built with `URLSearchParams`, path prefix literal.

**4 — Hooks.** `use-customers.ts` and `use-products.ts`: `useEffect` +
`AbortController` + the template's `ApiState<T>` discriminated union, calling the
matching service. These are the layer the pages consume.
*Shapes this yields: `CustomersPage → useCustomers → customersService → fetch`
is the 3-hop; `useProducts` is consumed by two components (step 6).*

**5 — Reference data provider.** Split across two files so the lint rule
`react/only-export-components` does not fire:
`context/reference-data-context.ts` holds the context object and the
`useReferenceData()` accessor; `components/reference-data-provider.tsx` holds the
`ReferenceDataProvider` component, which loads categories, suppliers and shippers
once on mount via `reference.ts` and supplies them to filter controls. `App.tsx`
wraps the layout route in it. Lookup tables loaded once at app start is the
ordinary reason a real CRUD app has a provider at all.

**6 — Feature components.**
- `products/product-list.tsx` — `ProductList`, uses `useProducts`, renders the
  full paged product list.
- `categories/product-list.tsx` — `ProductList`, uses `useProducts` with a
  `categoryId`, renders one category's products. Same component name, different
  directory, because each feature folder owns its own list rendering — the two
  differ in empty-state copy and columns.
- `orders/order-table.tsx` — `OrderTable`, presentational.
- `orders/order-detail-panel.tsx` — `OrderDetailPanel`, does its **own inline
  `fetch('/api/orders/' + id)`** in a `useEffect` for the selected row. A detail
  drawer that owns its one request is a normal pattern and avoids a hook that
  would have exactly one consumer.
- `orders/index.ts` — barrel re-exporting both order components; the orders page
  imports from `@/components/orders`. Components only, so the lint rule is quiet.
- `components/customer-search-input.tsx` —
  `const CustomerSearchInput = React.forwardRef<HTMLInputElement, Props>(...)`,
  wrapping the shadcn `Input` so the customers page can focus it on mount. Makes
  no calls.

**7 — Pages.**
- `customers-page.tsx` — `export function CustomersPage()`, paged, URL-driven via
  `useSearchParams` (same idiom as the page it replaces), consumes
  `useCustomers`, renders `CustomerSearchInput`.
- `products-page.tsx` — `export function ProductsPage()`, renders
  `products/ProductList`, category filter fed by `useReferenceData()`.
- `categories-page.tsx` — `export function CategoriesPage()`, category list from
  `useReferenceData()`, renders `categories/ProductList` for the selected one.
- `orders-page.tsx` — **`export default function OrdersPage()`**, calls
  `orders.ts` directly (no hook — it is the only consumer), renders `OrderTable`
  and `OrderDetailPanel` from the barrel.

**8 — Wiring.** `routes.tsx`: drop `/pagination`, add `/customers`, `/products`,
`/orders`, `/categories` (default-import `OrdersPage`). `App.tsx`: wrap in
`ReferenceDataProvider`. `main.tsx`: `import './lib/warmup'` for its side effect.
Delete `pages/pagination-page.tsx`.

**9 — `lib/warmup.ts`.** A module-scope `fetch('/api/categories')` that primes the
browser cache before the provider mounts, with its rejection swallowed. Imported
for its side effect by `main.tsx`. No component owns it.

**10 — Delete `Packages`.** `server/Program.cs`: remove the `/api/packages`
route, `record Package`, and `static class Packages`. **Leave `/api/hello` and
`/api/contact` byte-identical** — `/api/hello` is Playwright's readiness probe on
port 5170 and the suite cannot start without it. Also clear the two stale
references: the code-sample template string in `dos-donts-page.tsx` and the
Step 11 prose in `README.md`.
**README headings must not change** — `guide-page.tsx` parses `README.md?raw` and
e2e test 1 asserts the `#` title and the `## Step 11 — …` em-dash form. Edit prose
lines only, with `sed`/heredoc. **Do not round-trip any JSON or Markdown through a
parser** (B1 lost a whole file to a CRLF→LF rewrite that way).

**11 — E2E.** Rewrite tests 5 and 6 (they assert `react`, `react-router`,
`motion` and exactly 4 pages, all of which are gone) and add one per new page.
**There is no database, so no test may assert rendered rows.** Each test asserts
that the page mounts, that its heading renders, and that it reaches its error
state; the `/customers?page=4` deep-link test additionally uses
`page.waitForRequest` to prove the outgoing URL carries `page=4` — that is what
replaces the lost data assertion. Every hook stays a **role / accessible name**;
the suite uses no `data-testid` anywhere and new code should not introduce the
habit. Also drop the `/pagination` entry from `screenshots.spec.ts`.

**12 — Gates.** Run all eight, and record real output:
`dotnet build server --no-incremental` (0/0) · `npx tsc -b --force` ·
`npm run build` · `npm run lint` · `npm audit` ·
`DEBUG=pw:webserver npm run e2e` · `git status --porcelain` empty · the
vocabulary grep over every new file.
**Clear ports 5170 and 5173 first, with two single-port `lsof -ti` calls** —
`lsof -ti :5170 :5173` errors on this machine, and `reuseExistingServer: true`
will happily serve a green run off a stale server from another repo.

## Files touched

New (20): `client/src/lib/api-types.ts`, `client/src/lib/warmup.ts`,
`client/src/services/{customers,products,orders,reference}.ts`,
`client/src/hooks/{use-customers,use-products}.ts`,
`client/src/context/reference-data-context.ts`,
`client/src/components/reference-data-provider.tsx`,
`client/src/components/customer-search-input.tsx`,
`client/src/components/orders/{index.ts,order-table.tsx,order-detail-panel.tsx}`,
`client/src/components/products/product-list.tsx`,
`client/src/components/categories/product-list.tsx`,
`client/src/pages/{customers,products,orders,categories}-page.tsx`

Modified (8): `client/src/routes.tsx`, `client/src/App.tsx`,
`client/src/main.tsx`, `client/src/pages/dos-donts-page.tsx`,
`client/e2e/pages.spec.ts`, `client/e2e/screenshots.spec.ts`,
`server/Program.cs`, `README.md`

Deleted (1): `client/src/pages/pagination-page.tsx`

## Deliberately NOT touched

`client/src/components/ui/*` (11 shadcn primitives — they stay as-is),
`client/src/lib/useApi.ts` (still the right tool for the guide page's
`/api/hello` card; the roadmap replaces the single-hook *architecture*, and
deleting the file would churn test 1 for nothing),
`client/src/pages/{guide,carousel,form,dos-donts}-page.tsx` beyond step 10,
`client/tsconfig*.json`, `client/package.json`, `client/package-lock.json`,
`client/vite.config.ts`, `client/playwright.config.ts`.

**No repo-root `tsconfig.json`.** Phase C1 targets the solution-style config at
`client/tsconfig.json`; a root one would break it.

## Traps the implementer must know

- `verbatimModuleSyntax` is on → type-only imports must be `import type { … }`.
- `noUnusedLocals` / `noUnusedParameters` are on → an unused import fails `tsc -b`.
- `react/rules-of-hooks` is **error** → no conditional or post-early-return hooks.
- `react/only-export-components` is **warn** → do not export non-components
  alongside components (this is why step 5 splits into two files). Baseline is
  **7** warnings, all under `client/src/components/ui/`; the count should not rise.
- `npm ci`, never `npm install` — `install` moves the bundle hash inside the `^`
  ranges and rewrites the lockfile.
- react-router v7: import from `'react-router'`, not `react-router-dom`.
- The `@/` alias exists in `tsconfig.json`, `tsconfig.app.json` and
  `vite.config.ts`. Use it; do not add a fourth declaration.

## Standing user decisions (do not re-ask, do not violate)

1. **No commits on `main`.** B2 lives on `b2-northwind-client`. Ask before
   merging to `main`.
2. **Do not tag.** Phase C pulls a tag; tagging before B2 is accepted would
   vendor a stock-template client.
3. **`npm run shots` stays barred** (it rewrites `client/public/screenshots/`).
   If run by accident: `git checkout -- client/public/screenshots`.
4. Pushing to the public GitHub repo is a **separate** decision, after acceptance.

## Open question for the user

**Step 11's test strength.** With no database every Northwind route 500s, so the
new tests can only assert loading / error states plus the outgoing request URL.
The alternative is `page.route()` body-mocking, which would let the tests assert
rendered rows and genuinely exercise the render path.

Recommendation: **request-assertion, no body-mocking** — as written above. It
honours the recorded "loading and error states only" constraint, and a mock that
I author to match my own TS types proves the types agree with themselves, not
with the server. Say the word and step 11 switches to mocking.

## Note on size

This is ~29 files against B1's 15. If it overruns the context window, the clean
split is **after step 9**: B2a = steps 1-9 (the whole client layer, `/pagination`
still live and all 7 gates untouched), B2b = steps 10-12 (delete `Packages`,
rewrite the e2e suite). Each half is independently green.
