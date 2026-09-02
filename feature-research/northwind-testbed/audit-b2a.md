# B2a audit — northwind-fullstack client, additive layer

Branch `b2-northwind-client`, forked from `b1-northwind-server` @ `a34564c`.
Single commit `08f7e51`. Not pushed, not tagged. `main` untouched.

Scope executed: plan `plan-b2.md` steps **A1–A9 only**. Nothing under "B2b —
steps" was started. Nothing was deleted or renamed.

## Files changed

**Created (18)**

- `client/src/lib/api-types.ts`
- `client/src/services/customers.ts`
- `client/src/services/products.ts`
- `client/src/services/orders.ts`
- `client/src/services/reference.ts`
- `client/src/hooks/use-customers.ts`
- `client/src/hooks/use-products.ts`
- `client/src/context/reference-data-context.ts`
- `client/src/components/reference-data-provider.tsx`
- `client/src/components/customer-search-input.tsx`
- `client/src/components/orders/index.ts`
- `client/src/components/orders/order-table.tsx`
- `client/src/components/orders/product-list.tsx`
- `client/src/components/orders/order-detail-panel.tsx`
- `client/src/components/products/product-list.tsx`
- `client/src/pages/products-page.tsx`
- `client/src/pages/orders-page.tsx`
- `client/src/pages/categories-page.tsx`

**Modified (2)**

- `client/src/routes.tsx`
- `client/src/App.tsx`

That is exactly the plan's "B2a new (18) / B2a modified (2)" list, no more.

## What changed, per file

**`lib/api-types.ts`** — types only, no runtime export. The nine DTOs plus
`Paged<T>`. camelCase throughout (the minimal API serialises with
`JsonSerializerDefaults.Web` and overrides nothing). Every nullable C# member
is `| null` in TS: `decimal? UnitPrice` → `unitPrice: number | null`,
`short? UnitsInStock` → `number | null`, `int? CategoryId` → `number | null`,
`DateTime?` → `string | null`. `OrderDetailDto.unitPrice/quantity/discount` are
non-null because the C# record declares them non-nullable.

**`services/customers.ts`, `services/products.ts`, `services/orders.ts`** — one
list function each, its own `fetch` with a literal path, `res.ok` checked before
the body is parsed (the house rule from A3, motivated by the server's HTML
developer-exception page). Each takes an optional `AbortSignal` so the calling
hook can cancel. `listProducts` builds its query with `URLSearchParams` and only
sends `categoryId` when one is selected.

**`services/reference.ts`** — `listCategories/listSuppliers/listShippers/
listEmployees` over a local `getJson<T>(path)` helper (the four identical
unparameterised GETs), plus module-scope
`export const categoriesPromise = listCategories()`.

**No by-id service functions** were added, per A3. The one by-id read in this
half lives in `OrderDetailPanel`.

**`hooks/use-customers.ts`, `hooks/use-products.ts`** — `useEffect` +
`AbortController`, returning the template's existing `ApiState<T>` union
(imported as a type from `lib/useApi.ts`; that file is not modified). State is
initialised to `{ status: 'loading' }` and **never re-set synchronously in the
effect body** — the only `setState` calls are inside `.then`/`.catch`. Loading
state on a page change comes from the `key` remount idiom, not from a reset.

**`context/reference-data-context.ts`** — `ReferenceData` type,
`emptyReferenceData`, the context, and `useReferenceData()`. A `.ts` file, so
the `only-export-components` rule (which fires on `.tsx`) does not apply.

**`components/reference-data-provider.tsx`** — exports exactly one component. It
awaits `categoriesPromise` and calls `listSuppliers()` / `listShippers()` on
mount, each with its own `.catch(() => null)`, then publishes empty arrays plus
a `failed` flag. **It renders `children` unconditionally** — no gate, no throw,
no suspense.

**`components/orders/*`** — `OrderTable` (presentational table of summaries,
selection raised to the page), `ProductList` (line items of one order, all from
props, fetches nothing), `OrderDetailPanel` (owns its own `fetch` for
`/api/orders/{id}` and renders the orders `ProductList`), `index.ts` (barrel of
three pure `export { X } from './x'` re-exports).

**`components/products/product-list.tsx`** — the catalogue `ProductList`:
consumes `useProducts`, renders cards plus prev/next controls; the page number
arrives as a prop.

**`components/customer-search-input.tsx`** — `const CustomerSearchInput =
React.forwardRef<HTMLInputElement, Props>(...)` wrapping the shadcn `Input`.
Makes no requests. Unused in B2a by design — the customers screen that renders
it is B2b. This is the plan's declared concession (React 19 makes `ref` an
ordinary prop; no 2026 app would add a `forwardRef`), carried because the plan
asks for the shape.

**`pages/products-page.tsx`** — `export function ProductsPage()`, category
filter from `useReferenceData()`, renders the catalogue list with
`key={`${categoryId ?? 'all'}:${page}`}` so a page or filter change remounts and
shows the loading state.

**`pages/categories-page.tsx`** — `export function CategoriesPage()`, categories
from `useReferenceData()`, and consumes `useProducts` directly for the selected
category (the hook's second consumer, as A7 requires).

**`pages/orders-page.tsx`** — `export default function OrdersPage()` among named
siblings (the plan's second declared concession). Calls `services/orders`
directly from its own effect; renders `OrderTable` + `OrderDetailPanel` through
the barrel, with `key` on the panel so a selection change does not show the
previous order's line items under the new heading.

**`routes.tsx`** — adds `/products`, `/orders`, `/categories`
(`import OrdersPage from '@/pages/orders-page'`, a default import).
`/pagination` is kept. Nav therefore shows eight items, as A8 predicts.

**`App.tsx`** — wraps the layout route element in `<ReferenceDataProvider>`.
`layout.tsx` is untouched.

## Deviations from the plan

One addition, no removals or substitutions:

- **`services/reference.ts` ends with `categoriesPromise.catch(() => undefined)`.**
  The module-scope promise is created at import time and the provider only
  attaches its handler on mount. Every one of these requests rejects (there is
  no database), so without this line a rejection that lands before mount would
  surface as an unhandled rejection. It is a no-op guard; the provider still
  attaches the handler that matters. Flagged rather than done silently.

Everything else is as written. Open question 1 was implemented as recommended
(mixed: `reference.ts` uses the shared `getJson<T>`, the other three services
spell out their own fetches). Open question 2 is B2b and was not touched.

## Small decisions inside the plan's latitude

- `pageSize` defaults to 6 in every service and hook, matching the server's
  own default.
- The category filter is a row of `Button`s rather than a `Select`; both are
  in the template, buttons need no controlled-value plumbing, and the
  accessible name is the category name.
- `OrderDetailPanel` renders "Open an order to see its line items." when
  nothing is selected. Its effect returns early on `orderId === null`; the hooks
  themselves are unconditional, so `rules-of-hooks` is satisfied.
- The catalogue list shows "Page N of M" instead of a numbered page strip; with
  ~10 product pages a strip would be noise, and prev/next matches the data.

## Gates — real output

### 1. `dotnet build server --no-incremental`

```
  Determining projects to restore...
  All projects are up-to-date for restore.
  Server -> ~/Developer/northwind-fullstack/server/bin/Debug/net10.0/Server.dll

Build succeeded.
    0 Warning(s)
    0 Error(s)

Time Elapsed 00:00:01.82
```

### 2. `npx tsc -b --force` (in `client/`)

No output; exit 0.

### 3. `npm run build`

```
dist/index.html                                              1.58 kB │ gzip:   0.72 kB
dist/assets/index-CllLNnzC.css                              73.13 kB │ gzip:  12.56 kB
dist/assets/index-BdX0NRz9.js                              657.74 kB │ gzip: 209.62 kB

✓ built in 447ms
(!) Some chunks are larger than 500 kB after minification. …
```

The bundle moved from Phase A's `647.18 kB` / `index-BSc-BSw_.js` to
`657.74 kB` / `index-BdX0NRz9.js`. The plan records this as expected, not a
regression. The >500 kB advisory is pre-existing.

### 4. `npm run lint` — exactly 7 warnings, the same 7

```
src/lib/markdown.ts:83:7: warning eslint(no-unused-expressions)
src/components/ui/button.tsx:67:18: warning react(only-export-components)
src/pages/form-page.tsx:82:22: warning react(incompatible-library)
src/lib/useApi.ts:23:5: warning react(set-state-in-effect)
src/components/ui/navigation-menu.tsx:163:3: warning react(only-export-components)
src/components/ui/carousel.tsx:239:3: warning react(only-export-components)
src/components/ui/carousel.tsx:96:5: warning react(set-state-in-effect)
```

`npm run lint | grep -c warning` → `7`. Baseline before any edit was the same
seven at the same file:line, matching the plan's corrected list. No new file
contributes a warning: no `set-state-in-effect`, no `only-export-components`.

### 5. `npm audit`

```
found 0 vulnerabilities
```

### 6. `DEBUG=pw:webserver npm run e2e` — 7/7, servers started not reused

Ports cleared first with two separate single-port calls
(`lsof -ti :5170` then `lsof -ti :5173`; both reported nothing listening).

```
2026-08-31T13:43:43.359Z pw:webserver Starting WebServer process dotnet run --project ../server...
2026-08-31T13:43:45.194Z pw:webserver WebServer available
2026-08-31T13:43:45.497Z pw:webserver Starting WebServer process npm run dev...
2026-08-31T13:43:45.912Z pw:webserver WebServer available
  ✓  3 … pagination › deep-links to a page via the URL (515ms)
  ✓  5 … dos & don'ts › renders every rule with a Don't/Do pair (531ms)
  ✓  1 … guide (bento README) › renders the parsed README as cards and proves the server pipe (555ms)
  ✓  4 … pagination › serves page 1 from the server and navigates by click (580ms)
  ✓  7 … form › shows zod errors for invalid input (606ms)
  ✓  2 … carousel › advances slides and updates the counter (616ms)
  ✓  6 … form › submits a valid form to the server (649ms)
  7 passed (4.0s)
```

`Starting WebServer process` appears for both servers — Playwright started them,
it did not reuse a stale one. The earlier run in this session logged the same,
with the full `ECONNREFUSED` → `HTTP Status: 200` handshake on
`http://localhost:5170/api/hello`.

### 7. `git status --porcelain`

Empty, after the commit.

### 8. Vocabulary grep

```
grep -rinE "extract|attribut|walker|fixture|testbed|domain-expert|psq|analy" <all 18 new files + the 2 modified>
→ exit 1 (no matches)
```

### 9. Package/lockfile diff gate

```
git diff --stat main..b2-northwind-client -- client/package.json client/package-lock.json package.json package-lock.json
→ empty
```

`npm ci` was used, never `npm install`; `git status` was clean immediately
after it.

### 10. Bonus: nothing deleted

`client/public/screenshots/` still holds all five PNGs including
`pagination.png`. `npm run shots` was **not** run.

## The A5 checked fact

**Checked, not assumed.** With the servers up, every reference endpoint 500s:

```
/api/hello      -> 200
/api/categories -> 500
/api/suppliers  -> 500
/api/shippers   -> 500
```

Driving a real browser over the five surviving pages and recording every `/api/`
response:

```
/          | first heading: "vite-react-webapi-template" | 500 /api/categories, 200 /api/hello, 500 /api/shippers, 500 /api/suppliers, 500 /api/shippers, 500 /api/suppliers
/carousel  | first heading: "Carousel"                   | 500 /api/categories, 500 /api/suppliers, 500 /api/shippers, 500 /api/shippers, 500 /api/suppliers
/form      | first heading: "Form"                       | 500 /api/categories, 500 /api/shippers, 500 /api/suppliers, 500 /api/suppliers, 500 /api/shippers
/dos-donts | first heading: "React dos & don'ts"         | 500 /api/categories, 500 /api/shippers, 500 /api/suppliers, 500 /api/suppliers, 500 /api/shippers
/pagination| first heading: "Pagination"                 | 500 /api/categories, 500 /api/shippers, 500 /api/suppliers, 500 /api/shippers, 500 /api/suppliers, 200 /api/packages
```

Every page renders its heading with three failing provider XHRs in flight, and
the suite is 7/7 with them in flight. `/pagination` still gets its 200 from
`/api/packages`.

Suppliers and shippers appear **twice** per load, categories **once** — React 19
StrictMode double-invokes the effect in dev, and the module-scope
`categoriesPromise` is the thing that absorbs the second invocation. That is the
dedup the plan claimed, visible in the network log.

## Things that surprised me

- **`categoriesPromise` is a real dedup, and it is measurable.** I expected to
  have to take the plan's word for it; the doubled suppliers/shippers next to
  the single categories request is direct evidence.
- **`node` and `npm` are not on `PATH` on this machine.** The `PATH` leads with
  a stale `~/.nvm/versions/node/v24.17.0/bin` that does not exist. Every node
  command here ran with
  `~/.local/share/fnm/node-versions/v24.19.0/installation/bin` prepended
  (node 24.19.0, npm 11.17.0). Worth knowing before the B2b gates.
- **zsh does not word-split an unquoted variable**, so my first vocabulary grep
  passed the whole file list as one filename and "passed" with exit 2. Re-run
  with the paths written out; exit 1, genuinely no matches. Recording it because
  a grep gate that silently greps nothing is exactly the kind of fake pass the
  plan warns about elsewhere.

## Open risks

- `CustomerSearchInput` currently has no caller. Intended — B2b's customers page
  renders it — but until then it is exported dead code that `tsc` will not flag
  (`noUnusedLocals` does not reach exports).
- The eight-item nav is wider than the header was designed for. Cosmetic, and
  B2b removes `/pagination`, taking it back to seven.
- The new screens have no e2e coverage in B2a (tests are B2b step B4). They were
  hand-verified in a browser: all three mount, render their headings, and reach
  their error states with no page errors.
- `services/reference.ts` exports `listEmployees`, which nothing calls yet. It
  is one of the four lookups the plan names for that module.
