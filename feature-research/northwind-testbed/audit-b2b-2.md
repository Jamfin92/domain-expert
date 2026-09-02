# Phase B2b PART 2 — implementation audit

Plan: `plan-b2b-2.md` (hand-off revision 2). Branch `b2-northwind-client`.
Start state verified before any edit: HEAD `955a680`, `git status --porcelain` empty.
End state: one commit, **`7cf5ecf`**. Not pushed, not tagged. No commit on
`main`. `npm run shots` was not run.

**Revised after review (fix round 1).** The reviewer's verdict was *Ship with
edits*: the code was correct and every gate reproduced, but two comments were
false. That round changed prose only — no behaviour, no new file — and the
original commit `c2a234b` was **amended**, not followed by a second commit. The
phase deliverable is still one commit. The fix round is written up under
"Fix round 1 — comment corrections" below. **The gate section is mixed, not
uniformly fresh**, and each gate now says which it is: gates 3, 4, 6, 7, 9 and
10 were re-run from a clean tree after the amend; gates 1, 2 and 5 are carried
over from the pre-fix run; gate 8's status was not recorded at the time and is
not claimed here. All ten recorded results are correct — the reviewer
independently re-ran all ten at `7cf5ecf`. See "Review outcome" below.

**Revised again (documentation round 2).** Documentation only: no code, no
commit, no amend. `7cf5ecf` is untouched and `git status --porcelain` is empty.
This round corrected stale line citations inside this file and the
self-contradiction about which gates were fresh. See "Documentation round 2".

---

## Files changed

All 15 are on the plan's Files touched list. Nothing outside it was modified.

1. `client/src/services/reference.ts`
2. `client/src/services/customers.ts`
3. `client/src/pages/orders-page.tsx`
4. `client/src/pages/products-page.tsx`
5. `client/src/pages/categories-page.tsx`
6. `client/src/hooks/use-products.ts`
7. `client/src/context/reference-data-context.ts`
8. `client/src/components/reference-data-provider.tsx`
9. `client/src/components/customer-search-input.tsx`
10. `client/src/components/products/product-list.tsx`
11. `client/src/components/orders/order-detail-panel.tsx`
12. `client/src/components/orders/order-table.tsx`
13. `client/src/hooks/use-customers.ts`
14. `client/src/pages/customers-page.tsx`
15. `client/e2e/pages.spec.ts`

No new files. No deletions. Machine check of Part-2-only scope:

```
$ git diff --name-status 955a680..HEAD
M	client/e2e/pages.spec.ts
M	client/src/components/customer-search-input.tsx
M	client/src/components/orders/order-detail-panel.tsx
M	client/src/components/orders/order-table.tsx
M	client/src/components/products/product-list.tsx
M	client/src/components/reference-data-provider.tsx
M	client/src/context/reference-data-context.ts
M	client/src/hooks/use-customers.ts
M	client/src/hooks/use-products.ts
M	client/src/pages/categories-page.tsx
M	client/src/pages/customers-page.tsx
M	client/src/pages/orders-page.tsx
M	client/src/pages/products-page.tsx
M	client/src/services/customers.ts
M	client/src/services/reference.ts
$ git diff --name-status 955a680..HEAD | wc -l
      15
```

---

## What changed, per step

### 6a — `services/reference.ts`

Dropped the false first clause ("Categories are needed by the first screen that
renders") and the "asking again" reuse framing. `categoriesPromise`, the
early-rejection `catch` and its own comment are untouched. See the comment table.

### 6b — the placement rule, stated once

- `services/customers.ts` — the count clause becomes the rule. The
  status-checked-before-parse paragraph is byte-identical to HEAD.
- `components/orders/order-detail-panel.tsx` — both justifications deleted; one
  plain descriptive sentence remains, with no reason and no count.
- `pages/orders-page.tsx` — the "only consumer … so" justification deleted; the
  replacement says what the screen does.

Forbidden phrases confirmed absent from all three:

```
$ grep -niE "only consumer|several screens|more than one|single caller" \
    client/src/services/customers.ts \
    client/src/components/orders/order-detail-panel.tsx \
    client/src/pages/orders-page.tsx
(no output, exit 1)
```

### 6c — `components/customer-search-input.tsx`

The causal "so" is gone. `React.forwardRef` stays in the code, unmodified.
`ui/input.tsx` untouched.

### 7a / D4 — the render-time reset, in both hooks

`use-products.ts` and `use-customers.ts` each gained the same three-part
adjust-state-during-render pattern (identical wording of the explanatory comment
in both files):

```ts
  const argumentKey = `${page}:${pageSize}:${categoryId ?? 'all'}`   // customers: `${page}:${pageSize}:${search}`
  const [renderedFor, setRenderedFor] = useState(argumentKey)

  // Reset during render, not from an effect: when the arguments change, the
  // rows in `state` belong to the request being replaced, so the state goes
  // back to `loading` before React commits this render.
  if (renderedFor !== argumentKey) {
    setRenderedFor(argumentKey)
    setState({ status: 'loading' })
  }
```

`key={`${categoryId ?? 'all'}:${page}`}` removed from `products-page.tsx`, so the
reset is the single mechanism. `dos-donts-page.tsx` was **not** touched: D4 keeps
its `:74` claim ("the hooks in `src/hooks` follow it line for line") true, because
both hooks changed the same way.

### 7b — `products/product-list.tsx:18`

`` `${value.toFixed(2)}` `` → `` `$${value.toFixed(2)}` ``.

### 7c — products page is URL-driven, and the hrefs carry the whole query

`products-page.tsx` drops `useState` for `useSearchParams`; `page` is read the
same way `customers-page.tsx:20` reads it, `category` is read alongside it.
`selectCategory` and `goToPage` both start from a copy of the current
`URLSearchParams`, so setting one does not drop the other.

The href fix the plan insisted on was applied to **both** pagers. Each builds
from the full current parameter set:

```ts
  const hrefFor = (target: number) => {
    const params = new URLSearchParams(searchParams)
    params.set('page', String(target))
    return `?${params.toString()}`
  }
```

`ProductList` still calls `useProducts(page, 6, categoryId)` and still derives
`totalPages` itself — the fetch was not moved out. Only the parent's source of
`page` changed. It now also reads `useSearchParams` (read-only) to build hrefs.

### 7d — folded into 9a

`state.status === 'success' ? state.data.totalPages : page` → `: null`. Not
reported as a fixed bug; it was unreachable before the pager was ungated.

### 7e — `listEmployees` gains a consumer

- `reference-data-context.ts`: `employees: EmployeeDto[]` added to `ReferenceData`
  and to `emptyReferenceData`; `EmployeeDto` imported.
- `reference-data-provider.tsx`: `listEmployees().catch(() => null)` added as the
  fourth entry of the existing `Promise.all`.
- `orders/order-table.tsx`: reads `useReferenceData()` and labels
  `OrderSummaryDto.employeeId` in a new "Handled by" column. No fetch, no
  `useState` added.

The A5 requirement holds — the provider still has exactly one unconditional
return and no gate, throw, Suspense or early return:

```
$ grep -n "return" client/src/components/reference-data-provider.tsx
41:      if (!current) return
59:    return () => {
64:  return <ReferenceDataContext value={data}>{children}</ReferenceDataContext>
```

`:41` is the stale-result bail inside the `.then`, `:59` is the effect cleanup;
`:64` is the component's one and only return, and it is unconditional.

All four reference endpoints 500 with no database and the suite is green with
those XHRs in flight — Gate 6 below.

### 8a — `categories-page.tsx` rendered copy

"Eight categories, loaded once for the whole app." → "The category list is loaded
once for the whole app." No count. The "six rows" clause in the module docblock
(`categories-page.tsx:12-13`) was left alone; it is true.

### 8b — `failed: boolean` becomes a status union

```ts
export type ReferenceList = 'categories' | 'suppliers' | 'shippers' | 'employees'

export type ReferenceDataStatus =
  | { state: 'loading' }
  | { state: 'ready' }
  | { state: 'incomplete'; missing: ReferenceList[] }
```

`emptyReferenceData` is now `status: { state: 'loading' }`, so "not yet loaded" is
no longer identical in shape to "loaded and genuinely empty". The provider builds
`missing` and publishes `{ state: 'ready' }` or `{ state: 'incomplete', missing }`.
`status` is data on the context, never control flow.

All three consumers updated (7e was done first, so `order-table.tsx` existed as
the third): `products-page.tsx`, `categories-page.tsx`, `order-table.tsx`.

The field is gone. Grepping the bare word is not the right check — the new
doc comment in `reference-data-context.ts` legitimately contains the English word
"failed" — so the check matches `failed` in identifier positions:

```
$ grep -rnE "\bfailed\b *[:,)}]|\{ *[a-zA-Z, ]*failed|\.failed" client/src/
[no output]
exit=1
```

Positive control, the same pattern against the parent commit, where the field
still existed:

```
$ git show 955a680:client/src/context/reference-data-context.ts | grep -nE "\bfailed\b *[:,)}]"
17:  failed: boolean
25:  failed: false,
$ git show 955a680:client/src/pages/products-page.tsx | grep -nE "\{ *[a-zA-Z, ]*failed"
17:  const { categories, failed } = useReferenceData()
53:        {failed && (
```

**What that check does and does not establish.** It establishes that the
identifier `failed` is gone from `client/src`: the two patterns above match the
word only in identifier positions (followed by `:`/`,`/`)`/`}`, inside a
destructuring brace, or after a `.`), and the positive control shows both
patterns firing on the parent commit where the field existed. It establishes
nothing about the English word.

Case-insensitively the word is still present in eight places in `client/src` —
one of them the doc comment in `reference-data-context.ts`, the other seven
rendered error copy (`Failed to load products/orders/order/customers/categories`,
`Failed to send`), none of them an identifier:

```
$ grep -rni "failed" client/src/
client/src/context/reference-data-context.ts:23: * list it did not know had failed.
client/src/components/products/product-list.tsx:56:        <p className="text-destructive">Failed to load products: {state.error}</p>
client/src/components/orders/order-detail-panel.tsx:55:          <p className="text-sm text-destructive">Failed to load order {orderId}: {state.error}</p>
client/src/pages/form-page.tsx:110:              <p className="text-sm text-destructive">Failed to send: {submitted.error}</p>
client/src/pages/customers-page.tsx:93:        <p className="text-destructive">Failed to load customers: {state.error}</p>
client/src/pages/orders-page.tsx:45:        <p className="text-destructive">Failed to load orders: {orders.error}</p>
client/src/pages/categories-page.tsx:33:          Failed to load categories. The list below stays empty.
client/src/pages/categories-page.tsx:62:            <p className="text-sm text-destructive">Failed to load products: {products.error}</p>
```

*(Corrected in fix round 1 — N7. The earlier text here claimed "the one
surviving occurrence of the word anywhere in `client/src` is prose", which was a
census over a case-sensitive grep read as a census over the word. The
identifier-position check itself is unchanged and still passes.)*

**Deviation, and why — see "Deviations" below:** the plan's `[falsifies]` note
offered two ways to stop the failure messages naming a list they do not know
failed. I took the second ("make the status carry enough to know") rather than
the first ("reword them"), because rewording breaks e2e test 10, which D3 forbids
editing. Detail in Deviations.

### 8c — no rename

`orders/product-list.tsx` and `products/product-list.tsx` both still exist.

```
$ git diff --name-status --find-renames 955a680..HEAD | grep -c "^R"
0
```

### 9a — one pagination convention in both files

`product-list.tsx`'s `{state.status === 'success' && (…)}` wrapper removed; the
pager now renders in every state, with the customers label form
(`totalPages === null ? \`Page ${page}\` : …`), the customers Previous condition
(`page <= 1`) and the customers Next condition
(`totalPages !== null && page >= totalPages`). Those three in `customers-page.tsx`
were left exactly as they were; in the committed tree they are:

```
$ grep -n "Page \${page}\|page <= 1\|page >= totalPages" client/src/pages/customers-page.tsx
125:              aria-disabled={page <= 1}
126:              className={page <= 1 ? 'pointer-events-none opacity-50' : ''}
131:                {totalPages === null ? `Page ${page}` : `Page ${page} of ${totalPages}`}
138:              aria-disabled={totalPages !== null && page >= totalPages}
140:                totalPages !== null && page >= totalPages ? 'pointer-events-none opacity-50' : ''
```

(The earlier text cited `:126,128`, the Next conditions' line numbers at
`955a680`, as if they were current.)

The D2 range guard was added inside `goTo` in both files, verbatim from the plan,
nothing more:

```ts
    if (next < 1) return
    if (totalPages !== null && next > totalPages) return
```

`pointer-events-none opacity-50` kept as the visible affordance. `ui/pagination.tsx`
untouched. The "Next stays open until it knows better" comment is untouched and
still true; Part 2's `hrefFor` shifted it down twelve lines, so in the committed
tree it is `customers-page.tsx:116-118` (it was `:104-106` at `955a680`).

### 9b — `use-customers.ts` docblock

Retargeted off the `key`-remount story onto the mechanism the hook now performs.
7a and 9b use the **same sentence** in both files (see the comment table).

---

## Every comment rewritten under a `[falsifies]` marker

Five markers in the plan, plus the three 6a/6b/6c rewrites and the 9b docblock.
Before/after for all of them.

### [falsifies] 1 — `products-page.tsx:12-14` (the `key` is gone)

Before:
```
 * `key` on the list is doing real work: changing the page or the category
 * remounts it, so the hook inside starts from its loading state instead of
 * showing the previous page's rows until the new ones land.
```
After:
```
 * The page and the category live in the URL, not in useState: they survive
 * refresh, are shareable, and the back button undoes a filter for free.
 * Changing either one changes the hook's arguments inside the list, and
 * `useProducts` resets itself to its loading state on that render — so the
 * previous rows are not left showing while the next request is in flight.
```

### [falsifies] 2 — `use-products.ts:9-11` ("initial state only")

Before:
```
 * Same shape as `useCustomers`: initial state only, an AbortController so a
 * stale response can never overwrite a newer one, and no synchronous setState
 * in the effect body.
```
After:
```
 * Same shape as `useCustomers`: the state resets to `loading` during the render
 * that changes the hook's arguments, an AbortController so a stale response can
 * never overwrite a newer one, and no setState in the effect body.
```

### [falsifies] 3 — the pagination `href`s (7c)

Not a prose rewrite alone: the hrefs were **made true** before any comment says
so. Both pagers now build from the full current parameter set (`hrefFor` above).
The one comment that describes them, `customers-page.tsx:43-44`, was extended to
state exactly what the code now does:

Before:
```
  // Real hrefs keep these semantically links (middle-click, a11y role); the
  // click handler intercepts normal navigation for the SPA path.
```
After:
```
  // Real hrefs keep these semantically links (middle-click, a11y role); the
  // click handler intercepts normal navigation for the SPA path. An href
  // carries the whole current query, not just `page`, so opening one in a new
  // tab keeps the search term that is already applied.
```
`product-list.tsx` carries the same claim over its own `hrefFor`, worded for the
category filter rather than the search term.

### [falsifies] 4 — `order-table.tsx:18-21` ("Presentational:")

Before:
```
/**
 * The order summaries, one row each. Presentational: it holds no state and
 * fetches nothing — the page passes the rows in and hears about clicks back.
 */
```
After:
```
/**
 * The order summaries, one row each. It holds no state and fetches nothing: the
 * page passes the rows in and hears about clicks back. It does read the shared
 * reference lists, to turn an order's employee id into a name.
 */
```

### [falsifies] 5 — `reference-data-context.ts:6` (suppliers/shippers label an order)

Before:
```
 * The lookup lists every screen needs but none of them owns: categories for
 * the catalogue filter, suppliers and shippers for the labels on an order.
```
After:
```
 * The lookup lists loaded once for the whole app rather than owned by a screen:
 * categories drive the catalogue filter, and employees label the rows in the
 * order table. Suppliers and shippers are loaded alongside them and are read by
 * no screen in `client/src` today.
```

Under standing decision 6 that last sentence quantifies over `client/src`, so the
audit enumerates it. Every occurrence of either name in `client/src`:

```
$ grep -rn "suppliers\|shippers" client/src/
client/src/context/reference-data-context.ts:7: * order table. Suppliers and shippers are loaded alongside them and are read by
client/src/context/reference-data-context.ts:16:export type ReferenceList = 'categories' | 'suppliers' | 'shippers' | 'employees'
client/src/context/reference-data-context.ts:32:  suppliers: SupplierDto[]
client/src/context/reference-data-context.ts:33:  shippers: ShipperDto[]
client/src/context/reference-data-context.ts:41:  suppliers: [],
client/src/context/reference-data-context.ts:42:  shippers: [],
client/src/components/reference-data-provider.tsx:40:    ]).then(([categories, suppliers, shippers, employees]) => {
client/src/components/reference-data-provider.tsx:46:      if (suppliers === null) missing.push('suppliers')
client/src/components/reference-data-provider.tsx:47:      if (shippers === null) missing.push('shippers')
client/src/components/reference-data-provider.tsx:52:        suppliers: suppliers ?? [],
client/src/components/reference-data-provider.tsx:53:        shippers: shippers ?? [],
client/src/services/reference.ts:19:  return getJson<SupplierDto[]>('/api/suppliers')
client/src/services/reference.ts:23:  return getJson<ShipperDto[]>('/api/shippers')
```

Context, provider and service only — no screen. Positive control on the same
command shape, the name that *does* now have a screen consumer:

```
$ grep -rn "employees" client/src/ | grep components/orders
client/src/components/orders/order-table.tsx:25:  const { employees, status } = useReferenceData()
client/src/components/orders/order-table.tsx:31:    const match = employees.find((employee) => employee.employeeId === employeeId)
```

No consumer was added for suppliers or shippers. Logged as an open risk below.

### [falsifies] 6 — the failure messages that name a list (8b)

`categories-page.tsx` before:
```
      {failed && (
        <p className="text-destructive">
          Failed to load categories. The list below stays empty until the server answers.
        </p>
      )}
```
after:
```
      {status.state === 'incomplete' && status.missing.includes('categories') && (
        <p className="text-destructive">
          Failed to load categories. The list below stays empty.
        </p>
      )}
```

`products-page.tsx` before:
```
        {failed && (
          <span className="text-sm text-muted-foreground">
            Categories are unavailable, so the filter is empty.
          </span>
        )}
```
after:
```
        {status.state === 'incomplete' && status.missing.includes('categories') && (
          <span className="text-sm text-muted-foreground">
            Categories are unavailable, so the filter is empty.
          </span>
        )}
```

Both messages now fire only when categories specifically did not load, so neither
asserts more than the state knows. ("until the server answers" also came out of
the first one: the server has answered, with a 500.)

### 6a — `services/reference.ts:30-35`

Before:
```
 * Categories are needed by the first screen that renders, so the request goes
 * out when this module is first imported rather than waiting for a mount. The
 * provider awaits this promise; because it is created once at module scope, a
 * remount reuses the settled result instead of asking again.
```
After:
```
 * The categories request goes out when this module is first imported rather
 * than waiting for a mount. The promise is created once at module scope, so a
 * remount reuses the settled result instead of starting a second flight.
```

### 6b — `services/customers.ts:3-10`

Before (first paragraph):
```
 * The customers collection. A service owns the collection queries that more
 * than one screen needs; a detail panel owns its own by-id request.
```
After:
```
 * The customers collection. Collection reads live in a service module; a by-id
 * read lives in the component that displays that record.
```
Second paragraph unchanged.

### 6b — `orders/order-detail-panel.tsx:7-15`

Before:
```
 * The request lives here rather than in `services/orders`: a by-id read is
 * only ever wanted by the panel showing that record, and a service function
 * with a single caller inside the same folder is indirection without a reason.
 * Collection queries stay in the service, because several screens ask for
 * those.
```
After:
```
 * This by-id read lives here, in the panel that displays the record, rather
 * than in `services/orders`.
```

### 6b — `pages/orders-page.tsx:8-14`

Before:
```
 * This screen is the only consumer of the orders collection, so it calls the
 * service straight from its own effect instead of adding a hook that would
 * have exactly one caller.
```
After:
```
 * The screen holds the page number and the selected order id, and calls the
 * orders service from an effect keyed on the page.
```

### 6c — `components/customer-search-input.tsx:9-16`

Before:
```
 * The ref is forwarded through `React.forwardRef` so a parent can focus the
 * field (for example after clearing a filter) while still styling it through
 * the shadcn `Input`.
```
After:
```
 * It exposes the underlying input's ref, so the screen can focus the field
 * after clearing a filter, and it styles that input through the shadcn
 * `Input`.
```

### 9b — `hooks/use-customers.ts:6-14`

Before:
```
 * The state starts as `loading` and is only ever set from the resolved
 * promise — never synchronously in the effect body, which would start a second
 * render for no reason. A caller that wants the loading state back when the
 * page changes remounts the consuming component with a `key`, which is the
 * React way to reset state on a prop change.
```
After:
```
 * Same shape as `useProducts`: the state resets to `loading` during the render
 * that changes the hook's arguments, an AbortController so a stale response can
 * never overwrite a newer one, and no setState in the effect body.
```

7a and 9b agree word for word — the two docblocks differ only in which sibling
hook they name:

```
$ grep -n "resets to \`loading\` during the render" client/src/hooks/*.ts
client/src/hooks/use-customers.ts:9: * Same shape as `useProducts`: the state resets to `loading` during the render
client/src/hooks/use-products.ts:9: * Same shape as `useCustomers`: the state resets to `loading` during the render
```

---

## The post-7a lint measurement

Run immediately after step 7a, before any other step, as the plan requires.
**Exactly 7 warnings**, the same seven rule pairs as the Part 1 baseline, with
`src/lib/useApi.ts` `set-state-in-effect` among them. Zero new diagnostics from
the render-time reset — the plan's probe result reproduced.

```
$ npm run lint

> client@0.0.0 lint
> oxlint

src/lib/markdown.ts:83:7: warning eslint(no-unused-expressions): Expected expression to be used
src/components/ui/button.tsx:67:18: warning react(only-export-components): ...
src/components/ui/navigation-menu.tsx:163:3: warning react(only-export-components): ...
src/pages/form-page.tsx:82:22: warning react(incompatible-library): ...
src/lib/useApi.ts:23:5: warning react(set-state-in-effect): ...
src/components/ui/carousel.tsx:239:3: warning react(only-export-components): ...
src/components/ui/carousel.tsx:96:5: warning react(set-state-in-effect): ...
```

Seven lines. Rule set: `no-unused-expressions` ×1, `only-export-components` ×3,
`incompatible-library` ×1, `set-state-in-effect` ×2. Nothing in `src/hooks/`.

---

## Fix round 1 — comment corrections

Verdict on the first submission was **Ship with edits**: code correct, all ten
gates reproduced, two comments false. This round is **prose only**. No behaviour
changed, no file was added or removed, and the scope stayed at the same 15 files
(4 of them touched). Commit `c2a234b` was amended to `7cf5ecf`.

Governing constraint for every edit here — standing decision 6: prose may
quantify only over a directory the audit enumerates, anything wider is stated as
a rule rather than a census. **The two blocking comments were both universals the
code violated, so neither was replaced with a different universal.** Part 1 lost
two rounds to exactly that move (a fix swapped "exactly two effects" for "every
effect is one of two kinds", which was a new universal and also false). Each
replacement below names the specific functions or lists it is talking about.

### B1 — `client/src/pages/products-page.tsx:25`

**Before**

```
  // Each write starts from the parameters already there, so setting one does
  // not drop the other.
```

**Why it was false.** `selectCategory` is the very next function and calls
`params.delete('page')` — correctly, since a new filter should start at page 1
(`products-page.tsx:30` in the committed tree). The comment's "each write"
quantified over both writers and one of them dropped a parameter on purpose.

**After**

```
  // `selectCategory` copies the current parameters and then drops `page`: a
  // change of filter starts again at page 1. `goToPage` below copies them too
  // and leaves `category` alone, so paging stays inside the current filter.
```

Two named functions, two stated behaviours, no quantifier. Both claims, located
against the committed tree at `7cf5ecf`:

```
$ grep -n "params.delete('page')" client/src/pages/products-page.tsx
30:    params.delete('page')
39:    else params.delete('page')
$ sed -n '36,41p' client/src/pages/products-page.tsx
  function goToPage(next: number) {
    const params = new URLSearchParams(searchParams)
    if (next > 1) params.set('page', String(next))
    else params.delete('page')
    setSearchParams(params)
  }
```

The `page 1` claim is the `params.delete('page')` at `:30`, inside
`selectCategory`. The `goToPage` claim is `:36-41`, which sets or deletes `page`
and touches nothing else.

### B2 — `client/src/components/reference-data-provider.tsx:19`

**Before**

```
 * It renders its children unconditionally. Reference data is a convenience for
 * labels and filters, not a precondition for the app: if the lookup requests
 * fail, the screens that need them say so locally and every other screen is
 * unaffected. Gating children behind success would turn one failing request
 * into a blank application.
```

**Why it was false.** True at `955a680`; this commit falsified it twice. Step 7e
added `order-table.tsx` as a third consumer that needs `employees` and reports
nothing when they are missing — `:33` renders `` `#${employeeId}` ``, an id, not
a failure. Step 8b then narrowed both existing failure messages to
`status.missing.includes('categories')` (`categories-page.tsx:31`,
`products-page.tsx:70`), so suppliers, shippers and employees can fail with
categories succeeding and no screen saying anything.

**After**

```
 * It renders its children unconditionally. Reference data is a convenience for
 * labels and filters, not a precondition for the app: a lookup that fails leaves
 * an empty list rather than blocking the render. A missing `categories` list is
 * reported on screen — the catalogue filter and the categories screen check
 * `status.missing` for that name. A missing `employees` list surfaces instead as
 * a bare id in the order table. Gating children behind success would turn one
 * failing request into a blank application.
```

Narrowed to `categories`, as instructed, and the `employees` degradation is
described rather than claimed to be a report. **No failure messaging was added
for suppliers, shippers or employees** — that would be behaviour change and is
out of scope. The comment now says only what the code does; it makes no claim
about suppliers or shippers at all, which avoids replacing one census with
another.

### N1 — `client/src/context/reference-data-context.ts:19`

**Before**

```
 * `incomplete` naming the ones that did not. A boolean could not separate
 * `loading` from `ready` with nothing in it, so a screen that wanted to report
 * a failure had to name a list it did not know had failed.
```

**Why it was wrong.** Both halves are true; the `so` between them is not. Screens
had to name a list because the old `failed` was a single OR carrying no list
identity — nothing to do with the loading/ready ambiguity. False-causal `so` is
the defect class that blocked revision 1 of the plan.

**After**

```
 * `incomplete` naming the ones that did not. Two things were wrong with the
 * boolean this replaced: it could not separate `loading` from `ready` with
 * nothing in it, and it carried no list identity, which left a screen naming a
 * list it did not know had failed.
```

Two independent defects listed as two defects. The surviving `which left` is a
real consequence of the second one, not a bridge between them.

### N2 — `client/src/components/products/product-list.tsx:22`

**Before**

```
 * The catalogue: one page of products, plus the controls for moving between
 * pages. The page number is owned by the screen above and arrives as a prop —
 * this component asks for whatever page it is told to show.
```

**Why it was misleading.** Still read as a pure ownership statement after step 7c
gave the component its own `useSearchParams` read at `:29`. Not false about
`page`, but silent about the global URL state the component now reads directly.

**After**

```
 * The catalogue: one page of products, plus the controls for moving between
 * pages. `page` arrives as a prop — this component asks for whatever page it is
 * told to show — while the pagination hrefs are built from the live query read
 * through `useSearchParams`, so a link carries the rest of the query with it.
```

Both facts, neither generalised.

### N8 — `client/src/context/reference-data-context.ts:13`

Structural, not textual: the module docblock ended at `:13` and the
`ReferenceList` docblock began at `:14` with no blank line between them, so an
IDE or doc tool binds the module-level prose to the `ReferenceList` type. A blank
line was inserted. No words changed.

### N7 — audit correction, no code

`audit-b2b-2.md` claimed under step 8b that "the one surviving occurrence of the
word `failed` anywhere in `client/src` is prose". Case-insensitively there are
eight, seven of them rendered error copy. The identifier-position check that the
sentence was summarising is sound and its positive control is genuine; only the
summary sentence overreached. Corrected in place under **8b**, with the full
case-insensitive listing and an explicit statement of what the check does and
does not establish.

### Not touched in this round, deliberately

- `client/src/lib/useApi.ts` — its false universals at `:9` and `:15-16` are real
  but pre-existing and out of scope; logged under Open risks.
- `client/src/pages/dos-donts-page.tsx`.
- The D2 range guard in `products/product-list.tsx`.
- No failure messaging added for suppliers, shippers or employees.

### Scope proof for the round

The amended-away commit is still reachable through the reflog, so the round's
own edits can be diffed directly. Four files, prose only:

```
$ git diff --stat c2a234b 7cf5ecf
 client/src/components/products/product-list.tsx   |  5 +++--
 client/src/components/reference-data-provider.tsx | 10 ++++++----
 client/src/context/reference-data-context.ts      |  8 +++++---
 client/src/pages/products-page.tsx                |  5 +++--
 4 files changed, 17 insertions(+), 11 deletions(-)
```

All four are on the plan's Files touched list and were already modified by this
phase, so no 16th file was opened. The phase file list is unchanged:

```
$ git diff --name-status 955a680..HEAD | wc -l
      15
```

**Which gates were re-run in this round, and which were not.** Gates 3, 4, 6, 7,
9 and 10 were re-run from a clean tree after the amend, and the gate section
below is that run for those six. Gates 1, 2 and 5 were **carried over from the
pre-fix run** — the round changed comments in four client files only, so no
server build, no type-check and no dependency change was implied, but that is a
reason to expect the result, not a run. Gate 8's status was not recorded at the
time; it reads the committed tree through `git diff`, so it is not sensitive to
when it ran, but no re-run is claimed for it either. Each gate below is labelled.
The reviewer re-ran all ten independently at `7cf5ecf` and all ten passed — see
"Review outcome".

---

## Gates

### Gate 1 — `dotnet build server --no-incremental`

**Carried over from the pre-fix run — not re-run in fix round 1.** Fix round 1
edited four client files, comments only, and Part 2 touched no server file at
all, so nothing this phase did could move this result. That is an expectation,
not a measurement. The reviewer re-ran it at `7cf5ecf` and it passed.

```
  Determining projects to restore...
  All projects are up-to-date for restore.
  Server -> ~/Developer/northwind-fullstack/server/bin/Debug/net10.0/Server.dll

Build succeeded.
    0 Warning(s)
    0 Error(s)

Time Elapsed 00:00:01.78
```
0 warnings, 0 errors. Part 2 touched no server file.

### Gate 2 — `npx tsc -b --force` in `client/`

**Carried over from the pre-fix run — not re-run in fix round 1.** The round
changed comment text only, which cannot change a type. Again an expectation, not
a measurement. The reviewer re-ran it at `7cf5ecf` and it passed.

```
$ npx tsc -b --force
$ echo $?
0
```
No output, exit 0.

### Gate 3 — `npm run build`

**Re-run in fix round 1.** Re-run in fix round 1 from a clean tree, **after** the last comment edit, so
the hash below is the hash of the committed tree at `7cf5ecf`.

```
vite v8.2.2 building client environment for production...
transforming...
✓ 2496 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                                              1.58 kB │ gzip:   0.72 kB
dist/assets/geist-cyrillic-ext-wght-normal-DjL33-gN.woff2    7.42 kB
dist/assets/geist-vietnamese-wght-normal-6IgcOCM7.woff2      8.00 kB
dist/assets/geist-cyrillic-wght-normal-BEAKL7Jp.woff2       15.08 kB
dist/assets/geist-latin-ext-wght-normal-DC-KSUi6.woff2      16.51 kB
dist/assets/geist-latin-wght-normal-BgDaEnEv.woff2          29.40 kB
dist/assets/index-CzVZLvxs.css                              73.20 kB │ gzip:  12.57 kB
dist/assets/index-L7wpOmcH.js                              660.59 kB │ gzip: 210.37 kB

✓ built in 187ms
```

Clean. **The Part 1 JS record is retired**: `index-CW33IDHv.js` / 659.26 kB →
**`index-L7wpOmcH.js` / 660.59 kB**. The CSS is byte-identical to Part 1
(`index-CzVZLvxs.css` / 73.20 kB) — Part 2 changed no styles, and the hash
confirms it rather than assuming it. The >500 kB chunk notice is the pre-existing
Vite advisory, unchanged from Part 1.

**Fix round 1 result — the hash did not move, and that is measured, not
assumed.** The round changed five comments and nothing else; comments are
stripped in minification and no string literal was touched, so the emitted
bundle is byte-identical to the pre-fix build: `index-L7wpOmcH.js` / 660.59 kB
again, CSS again `index-CzVZLvxs.css` / 73.20 kB. The build above **is** the
post-fix run — it was re-run rather than carried over, which is the thing the
plan's warning is actually about.

### Gate 4 — `npm run lint` (final)

**Re-run in fix round 1.** Same seven, unchanged from the post-7a measurement and
from the pre-fix run (ordering varies between runs; the `file:line`+rule pairs do
not):

```
src/lib/markdown.ts:83:7: warning eslint(no-unused-expressions)
src/components/ui/navigation-menu.tsx:163:3: warning react(only-export-components)
src/components/ui/button.tsx:67:18: warning react(only-export-components)
src/lib/useApi.ts:23:5: warning react(set-state-in-effect)
src/pages/form-page.tsx:82:22: warning react(incompatible-library)
src/components/ui/carousel.tsx:239:3: warning react(only-export-components)
src/components/ui/carousel.tsx:96:5: warning react(set-state-in-effect)
```
Exactly 7 — counted, not eyeballed:

```
$ npm run lint 2>&1 | grep -cE "^src/.*warning"
7
```

`src/lib/useApi.ts` `set-state-in-effect` present.

### Gate 5 — `npm audit` in `client/`

**Carried over from the pre-fix run — not re-run in fix round 1.** No dependency
changed in this phase; Gate 8 shows `package.json` and `package-lock.json`
unmodified in both ranges. The reviewer re-ran it at `7cf5ecf` and it passed.

```
found 0 vulnerabilities
```

### Gate 6 — `DEBUG=pw:webserver npm run e2e` — 12/12

**Re-run in fix round 1.**

Ports were cleared first with two single-port `lsof` calls (the combined
`lsof -ti :5170 :5173` form errors on this machine), and both reported free
before the run — so `reuseExistingServer: true` could not have served this off a
stale server. The `ECONNREFUSED` → `HTTP Status: 200` handshake below is the
proof that Playwright started both servers itself.

```
pw:webserver Error while checking if http://localhost:5170/api/hello is available: connect ECONNREFUSED ::1:5170
pw:webserver Starting WebServer process dotnet run --project ../server...
pw:webserver Error while checking if http://localhost:5170/api/hello is available: connect ECONNREFUSED ::1:5170
pw:webserver Error while checking if http://localhost:5170/api/hello is available: connect ECONNREFUSED ::1:5170
pw:webserver Error while checking if http://localhost:5170/api/hello is available: connect ECONNREFUSED ::1:5170
pw:webserver HTTP Status: 200
pw:webserver WebServer available
pw:webserver Error while checking if http://localhost:5173/ is available: connect ECONNREFUSED ::1:5173
pw:webserver Starting WebServer process npm run dev...
pw:webserver Error while checking if http://localhost:5173/ is available: connect ECONNREFUSED ::1:5173
pw:webserver HTTP Status: 200
pw:webserver WebServer available
```

Both ports: refused, then started, then 200. Results:

```
  ✓  12 [chromium] › e2e/pages.spec.ts:83:3 › dos & don'ts › renders every rule with a Don't/Do pair (649ms)
  ✓   2 [chromium] › e2e/pages.spec.ts:16:3 › carousel › advances slides and updates the counter (724ms)
  ✓   1 [chromium] › e2e/pages.spec.ts:58:3 › customers › deep-links to a page via the URL (963ms)
  ✓   8 [chromium] › e2e/pages.spec.ts:120:3 › products pagination › pages by clicking a link and honours a ?page deep link (948ms)
  ✓  11 [chromium] › e2e/pages.spec.ts:140:3 › customers search history › the first search pushes and later edits replace (939ms)
  ✓   5 [chromium] › e2e/pages.spec.ts:27:3 › form › shows zod errors for invalid input (1.0s)
  ✓   9 [chromium] › e2e/pages.spec.ts:35:3 › form › submits a valid form to the server (1.1s)
  ✓   7 [chromium] › e2e/pages.spec.ts:110:3 › categories › mounts and reports the failed reference-data request (1.1s)
  ✓   6 [chromium] › e2e/pages.spec.ts:102:3 › orders › mounts and reports the failed orders request (1.2s)
  ✓   3 [chromium] › e2e/pages.spec.ts:49:3 › customers › mounts, reports the failed request and pages by clicking a link (1.2s)
  ✓  10 [chromium] › e2e/pages.spec.ts:4:3 › guide (bento README) › renders the parsed README as cards and proves the server pipe (1.3s)
  ✓   4 [chromium] › e2e/pages.spec.ts:94:3 › products › mounts and reports the failed catalogue request (1.5s)

  12 passed (4.4s)
```

(Fix round 1 re-run. Worker ordering differs from the pre-fix run — the suite is
parallel and the numbering is assignment order, not a stable test id. The set of
twelve titles and their `spec.ts:line` anchors are identical.)

The server log is full of `SQLite Error 1: 'no such table'` and
`DeveloperExceptionPageMiddleware` traces throughout — standing decision 1, all
four reference endpoints included. The ten pre-existing tests are unmodified;
the customers error-state test at `pages.spec.ts:49` still clicks Next in the
error state and still passes, which is the D1 check. (Referring to it by line
rather than by the run's ✓ number: that number is worker-assignment order and
changes between runs.)

### Gate 7 — `git status --porcelain`

**Re-run in fix round 1.**

Before the first edit: empty. After the commit:

```
$ git status --porcelain
[no output]
```

No stray `*.db` / `-shm` / `-wal` in the working tree. `server/northwind.db`
exists on disk as a `dotnet run` artifact but is gitignored (`!!` under
`--ignored`) and pre-dates this phase; it is invisible to the gate.

### Gate 8 — package/lockfile diff empty, **with positive control**

**Re-run status not recorded at the time, and none is claimed.** Every command
here reads the committed tree through `git diff`, so the output is a function of
`7cf5ecf` rather than of when it was run. The reviewer re-ran it at `7cf5ecf`
and it reproduced.

```
$ git diff --name-status main..HEAD -- '*package.json' '*package-lock.json'
[no output]
$ git diff --name-status 08f7e51..HEAD -- '*package.json' '*package-lock.json'
[no output]
```

Positive control — the same command shape, run without the pathspec, must show
the 42 files the plan predicts, or the empty results above mean nothing:

```
$ git diff --name-status main..HEAD | wc -l
      42
$ git diff --name-status main..HEAD
M	.gitignore
M	README.md
M	client/e2e/pages.spec.ts
M	client/e2e/screenshots.spec.ts
D	client/public/screenshots/pagination.png
M	client/src/App.tsx
A	client/src/components/customer-search-input.tsx
A	client/src/components/orders/index.ts
A	client/src/components/orders/order-detail-panel.tsx
A	client/src/components/orders/order-table.tsx
A	client/src/components/orders/product-list.tsx
A	client/src/components/products/product-list.tsx
A	client/src/components/reference-data-provider.tsx
A	client/src/context/reference-data-context.ts
A	client/src/hooks/use-customers.ts
A	client/src/hooks/use-products.ts
A	client/src/lib/api-types.ts
A	client/src/pages/categories-page.tsx
A	client/src/pages/customers-page.tsx
M	client/src/pages/dos-donts-page.tsx
A	client/src/pages/orders-page.tsx
D	client/src/pages/pagination-page.tsx
A	client/src/pages/products-page.tsx
M	client/src/routes.tsx
A	client/src/services/customers.ts
A	client/src/services/orders.ts
A	client/src/services/products.ts
A	client/src/services/reference.ts
A	server/Data/NorthwindDbContext.cs
A	server/Dtos/NorthwindDtos.cs
A	server/Endpoints/NorthwindEndpoints.cs
A	server/Models/Category.cs
A	server/Models/Customer.cs
A	server/Models/Employee.cs
A	server/Models/Order.cs
A	server/Models/OrderDetail.cs
A	server/Models/Product.cs
A	server/Models/Shipper.cs
A	server/Models/Supplier.cs
M	server/Program.cs
M	server/Server.csproj
M	server/appsettings.json
```

42, as predicted. A second positive control, this time a *pathspec* that really
does match, proving the `-- '<pathspec>'` form is not the thing swallowing
results:

```
$ git diff --name-status main..HEAD -- '*.csproj'
M	server/Server.csproj
$ git diff --name-status 08f7e51..HEAD -- 'client/src/*' | wc -l
      17
```

So the two empty results above are real: no `package.json` or `package-lock.json`
changed in either range. (`server/Server.csproj` did change in `main..HEAD`, but
it landed before `08f7e51` — it is not in this phase's range and is not a
package/lockfile.)

### Gate 9 — vocabulary grep, **with positive control**

**Re-run in fix round 1** (noted again at the end of this section).

Paths written longhand, one per line, never through a variable — the B2a
fake-pass mode.

```
$ grep -nEi 'extract|attribut|walker|fixture|testbed|domain-expert|psq|analy' \
  client/e2e/pages.spec.ts \
  client/src/components/customer-search-input.tsx \
  client/src/components/orders/order-detail-panel.tsx \
  client/src/components/orders/order-table.tsx \
  client/src/components/products/product-list.tsx \
  client/src/components/reference-data-provider.tsx \
  client/src/context/reference-data-context.ts \
  client/src/hooks/use-customers.ts \
  client/src/hooks/use-products.ts \
  client/src/pages/categories-page.tsx \
  client/src/pages/customers-page.tsx \
  client/src/pages/orders-page.tsx \
  client/src/pages/products-page.tsx \
  client/src/services/customers.ts \
  client/src/services/reference.ts
[no output]
exit=1   (1 = no matches = clean; NOT 2, which would be a usage error)
```

Positive control — identical command shape and identical 15-path list, with a
pattern that is certainly present:

```
$ grep -cEi 'product' <the same 15 paths>
client/e2e/pages.spec.ts:9
client/src/components/orders/order-table.tsx:0
client/src/components/products/product-list.tsx:13
client/src/components/orders/order-detail-panel.tsx:2
client/src/hooks/use-customers.ts:1
client/src/components/customer-search-input.tsx:0
client/src/hooks/use-products.ts:6
client/src/context/reference-data-context.ts:0
client/src/pages/orders-page.tsx:0
client/src/components/reference-data-provider.tsx:0
client/src/pages/products-page.tsx:5
client/src/pages/customers-page.tsx:0
client/src/pages/categories-page.tsx:12
client/src/services/customers.ts:0
client/src/services/reference.ts:0
exit=0   (matched: the harness reads all 15 files and can go positive)
```

Re-run unchanged in fix round 1: forbidden pattern exit 1, positive control
exit 0 with the same per-file counts (the five comments edited in that round
added no occurrence of `product` and removed none). The per-file counts show all
15 paths were actually opened, so exit 1 on the forbidden pattern is a real
negative. The `attribut` trap was respected in the
new tests: they assert through `toHaveURL` only, and no `toHaveAttribute` or
`getAttribute` appears anywhere in the spec.

### Gate 10 — `git diff --name-status 08f7e51..HEAD`

**Re-run in fix round 1.**

```
M	README.md
M	client/e2e/pages.spec.ts
M	client/e2e/screenshots.spec.ts
D	client/public/screenshots/pagination.png
M	client/src/components/customer-search-input.tsx
M	client/src/components/orders/order-detail-panel.tsx
M	client/src/components/orders/order-table.tsx
M	client/src/components/products/product-list.tsx
M	client/src/components/reference-data-provider.tsx
M	client/src/context/reference-data-context.ts
M	client/src/hooks/use-customers.ts
M	client/src/hooks/use-products.ts
M	client/src/pages/categories-page.tsx
A	client/src/pages/customers-page.tsx
M	client/src/pages/dos-donts-page.tsx
M	client/src/pages/orders-page.tsx
D	client/src/pages/pagination-page.tsx
M	client/src/pages/products-page.tsx
M	client/src/routes.tsx
M	client/src/services/customers.ts
M	client/src/services/reference.ts
M	server/Endpoints/NorthwindEndpoints.cs
M	server/Program.cs

$ git diff --name-status 08f7e51..HEAD | wc -l
      23
```

**23 entries, exact.** Part 1's 12 plus Part 2's 11 new files, with the four
files common to both parts (`customers.ts`, `use-customers.ts`,
`customers-page.tsx`, `pages.spec.ts`) counted once. Scope did not grow.

---

## The two new e2e tests

Appended as 11 and 12; the file had exactly 10 and now has 12. Tests 1–10 are
byte-identical (`git diff 955a680..HEAD -- client/e2e/pages.spec.ts` is pure
addition after the last existing `})`).

**Test 11 — products pagination is URL-driven.** One test carrying both halves,
so the total is 12 and not 13. Clicks Next on `/products` (live because
`totalPages` is null under D1) and asserts `toHaveURL(/page=2/)` plus the rendered
"Page 2"; then registers `waitForRequest` **before** `goto`, deep-links
`/products?page=4`, and asserts the rendered "Page 4". Both halves exercise the
7c change: without it the deep link would render page 1.

**Test 12 — the customers push/replace split.** Navigates to `/customers` first,
so a real prior history entry exists — Part 1's `about:blank` harness artifact
cannot recur here. Then `fill('al')` (first search: pushes, because
`search === ''` makes `replace` false) and `fill('alf')` (refinement: replaces).
The input is not debounced, so that is exactly one pushed entry and one replaced
one. A **single** `goBack()` must land on the unsearched list, asserted as
`toHaveURL(/\/customers$/)` — the `$` anchor is what makes it prove the absence
of `?q=`. If the `&& search !== ''` clause were removed from
`customers-page.tsx:40`, the first keystroke would replace the unsearched entry
and this Back would leave `/customers` entirely, failing the assertion.

No new test clicks a `pointer-events-none` control, so trap 2 never arises and no
`force: true` was needed.

---

## Deviations from the plan

**One substantive deviation, in Step 8b's `[falsifies]` note.**

The note offers two remedies for the failure messages that name a list they do
not know failed: *"reword them so they do not name a specific list, **or** make
the status carry enough to know."* Rev 2 does not choose between them.

I took the second. The first is not available: `categories-page.tsx:33` renders
"Failed to load categories", and shipped e2e test 10 (`pages.spec.ts:110-114`)
asserts `getByText(/Failed to load categories/)`. Rewording that string breaks
test 10, and D3 states tests 1–10 are unchanged and the task forbids editing
them. So the status carries `missing: ReferenceList[]`, and both messages are
gated on `status.missing.includes('categories')`. Each now fires only when
categories specifically failed, which is exactly what the note asks for, and
test 10 passes untouched.

This makes the union a three-arm discriminated union rather than a bare string
union. That is more type than "replace `failed` with a status union" strictly
implies, but it is the smallest shape that satisfies the `[falsifies]` note
without touching a shipped test. The discriminant is named `state` so consumers
read `status.state === 'incomplete'` rather than `status.status`.

**Two small additions inside touched files, both required by a plan instruction
that named no mechanism:**

- `product-list.tsx` gained a `useSearchParams` import. The plan requires every
  pagination href to be built from the full current parameter set, and this
  component owns its own hrefs; it had no other way to see the current query.
  It is read-only there — the component still receives `page` as a prop and the
  parent still owns navigation, so the "not presentational, keeps its hook"
  requirement is untouched.
- `order-table.tsx` gained a "Handled by" column (one `<th>`, one `<td>`).
  Step 7e requires the table to label `employeeId`, which it did not render at
  all; a label needs a cell.

**Nothing else deviates.** Every other step was implemented as written, including
the ones I would have argued with: 7d changed to `: null` and is not reported as
a bug fix; the unbounded Next is described nowhere as a bug; no comment claims
the controls leave the tab order; `ui/pagination.tsx`, `ui/input.tsx`,
`lib/useApi.ts`, `dos-donts-page.tsx`, `README.md` and every server file were not
opened for editing.

**Nothing in the plan turned out to be wrong or unimplementable**, with the single
exception of the unresolved either/or above. In particular the two measured
claims both held: the render-time reset produced zero new lint diagnostics with
the total still exactly 7, and `08f7e51..HEAD` came to exactly 23 entries.

---

## Review outcome

**Verdict at `7cf5ecf`: Ship. No blocking issues.** The reviewer did not take
this document's gate results on trust — it re-ran **all ten gates itself** at
`7cf5ecf` and all ten reproduced, including the three (1, 2 and 5) this audit
had carried over from the pre-fix run. That is why the recorded values above are
correct even where they were not freshly measured by me.

It also ran three positive controls of its own, none of which this audit had:

1. **An oxlint probe.** It moved the render-time reset into an effect and
   confirmed `set-state-in-effect` fires there — so Gate 4's "zero new
   diagnostics from the render-time reset" is a real negative, not a rule that
   never triggers on this code.
2. **Two source mutations against the new tests.** One each proving e2e tests 11
   and 12 can fail — so 12/12 is not two tests that pass regardless of the code.
3. **A reverse-applied patch rebuild.** It reverted the fix round's comment edits
   and rebuilt, confirming the emitted bundle is byte-identical. That
   independently establishes the Gate 3 claim that `index-L7wpOmcH.js` /
   660.59 kB did not move because comments are stripped, rather than because the
   build was carried over.

The reviewer additionally checked that **the fix round falsified no other
comment** — the five prose edits did not turn some third comment false as a side
effect, which is the failure mode that cost Part 1 two rounds.

Non-blocking observations were the two documentation defects corrected in
documentation round 2 below.

---

## Documentation round 2 — this file only

**No code, no commit, no amend.** `7cf5ecf` is exactly as the reviewer saw it;
`git status --porcelain` was empty before and after. The only file changed in
this round is `audit-b2b-2.md` itself. Two defects, both of them this document
describing itself wrongly.

### D2a — stale line citations

Fix round 1 shifted lines in three files — `reference-data-provider.tsx` by +2,
`reference-data-context.ts` by +1 and `products-page.tsx` by +1 — but several
grep blocks and prose citations were carried over from the pre-fix run without
being re-run. **The match sets were all correct; only the offsets had drifted.**
Every correction below is pasted from a command re-run against the committed
tree at `7cf5ecf`, not hand-edited.

| Where | Was | Is |
| --- | --- | --- |
| A5 return grep (step 7e) | `39` / `57` / `62` | `41` / `59` / `64` |
| suppliers/shippers enumeration ([falsifies] 5) | `context.ts:15,:30,:31,:39,:40` | `:16,:32,:33,:41,:42` |
| suppliers/shippers enumeration ([falsifies] 5) | `provider.tsx:38,:44,:45,:50,:51` | `:40,:46,:47,:52,:53` |
| B1 — the `page 1` claim | line `29` | `products-page.tsx:30` |
| B1 — the `goToPage` claim | `:36-39` | `:36-41` |
| B2 — the narrowed products message | `products-page.tsx:69` | `:70` |
| N2 — `useSearchParams` read | `:28` | `:29` |
| 9a — "Next stays open until it knows better" | `customers-page.tsx:104-106` | `:116-118` |
| 9a — the customers pager conditions | `customers-page.tsx:126,128` | `:125,:126,:131,:138,:140` |
| 8a — the "six rows" clause | `categories-page.tsx:13` | `:12-13` |

The last three were **not** on the list the reviewer supplied; they were found by
the sweep. Two of them (`:104-106` and `:126,128`) had drifted earlier than the
fix round — they were correct at `955a680` and were carried into a present-tense
sentence about the committed tree without being re-run when Part 2's `hrefFor`
pushed them down twelve lines.

**Scope of the sweep — standing decision 6.** The sweep covers every line
citation in this file, and this file only. It was enumerated mechanically rather
than by reading, so that nothing depended on my noticing it:

```
$ grep -oE '[a-zA-Z0-9._/-]+\.(tsx|ts|md)`?:[0-9]+(-[0-9]+)?' audit-b2b-2.md
$ grep -oE '`:[0-9]+(-[0-9]+)?`' audit-b2b-2.md
```

The first pattern catches every `<file>.<ext>:<n>` citation, the second every
bare `` `:<n>` ``; between them they match every line citation the document
makes. Every match of both was resolved against `7cf5ecf` — or, where the
citation is of a pre-change location, against the commit that convention names
(see below). Re-running those two greps on this file now returns more matches
than were swept, because the corrections and this section add citations of their
own.
**No claim is made about line citations in any other document** — `plan-b2b-2.md`
and the Part 1 audit were not swept.

### D2a note — the two citation conventions in this file, made explicit

The drift was easy to miss because this document uses line numbers against three
different trees, and never said so. It does it consistently; it just never
declared it. Stated now:

- **"Every comment rewritten under a `[falsifies]` marker"** — every header in
  that section (`products-page.tsx:12-14`, `use-products.ts:9-11`,
  `order-table.tsx:18-21`, `reference-data-context.ts:6`,
  `products/product-list.tsx:18`, `services/reference.ts:30-35`,
  `services/customers.ts:3-10`, `orders/order-detail-panel.tsx:7-15`,
  `pages/orders-page.tsx:8-14`, `customer-search-input.tsx:9-16`,
  `use-customers.ts:6-14`) locates the comment **as it stood at `955a680`**,
  before the edit being described. All eleven were checked against `955a680` and
  all eleven are correct. They are *not* current-tree numbers: the 7b price
  expression, for instance, is `955a680:product-list.tsx:18` and sits at `:19`
  in the committed tree.
- **"Fix round 1 — comment corrections"** — each header locates the comment **as
  it stood at `c2a234b`**, before the amend. `products-page.tsx:25`,
  `reference-data-provider.tsx:19` and `product-list.tsx:22` happen to be
  unchanged in the committed tree as well. `reference-data-context.ts:19` (N1) is
  not: the blank line N8 inserted at `:14` pushed that docblock down one, so the
  same sentence is at `:20` in `7cf5ecf`. N8's own `:13`/`:14` describe the
  pre-fix structure explicitly and read correctly as written.
- **Everything else** — prose and grep output — is the committed tree at
  `7cf5ecf`. That is the convention the ten corrections above restore.

Citations checked and found already correct, for the record:
`dos-donts-page.tsx:74`, `order-table.tsx:33`, `categories-page.tsx:31`,
`customers-page.tsx:20`, `customers-page.tsx:40`, `customers-page.tsx:43-44`,
`pages.spec.ts:49`, `pages.spec.ts:110-114`, `lib/useApi.ts:9` and `:15-16`, the
twelve `e2e/pages.spec.ts:<n>` anchors in Gate 6, the seven `src/…:<line>:<col>`
oxlint pairs in Gates 4 and the post-7a measurement, and every `file:count` line
in the Gate 9 positive control.

### D2b — the document contradicted itself about which gates were fresh

The header said the gate section was "the fix round's re-run from a clean tree,
not the original one". The end of fix round 1 said gates 3, 4, 6, 7, 9 and 10
were re-run. Both could not be true, and the second was the accurate one: gates
1, 2 and 5 were carried over from the pre-fix run, and gate 8's status was not
recorded.

Fixed by labelling every gate individually with whether it was re-run in the fix
round, carried over, or unrecorded, and by rewriting both sentences to agree.
**I did not re-run gates 1, 2 and 5 myself** — this round was constrained to
touch no file in the repository, and `dotnet build`, `tsc -b --force` and
`npm audit` all write into the checkout. So they remain labelled as carried over,
with the reason each is expected to hold stated as an expectation rather than a
measurement. The reviewer's independent re-run of all ten at `7cf5ecf` is what
actually confirms them, and that is now recorded under "Review outcome".

---

## Open risks — logged, not fixed

1. **`suppliers` and `shippers` are fetched by the provider and read by nothing.**
   The same defect class as 7e's `listEmployees`, and after 7e they are the only
   two lists left in it. Enumerated above. Only the comment was corrected; no
   consumer was added, because that is scope this plan does not take.

2. **7a adds a label flicker once there is a database.** On every page turn the
   reset makes `totalPages` null for a render, so the label will read
   "Page 3 of 12" → "Page 3" → "Page 4 of 12". Invisible in this checkout because
   nothing ever reaches `success`. The change does not remove flicker — it
   introduces this one, as the trade for never showing the previous page's rows.

3. **Pagination controls stay focusable when visually disabled.**
   `ui/pagination.tsx` sets no `tabIndex={-1}`, and it was out of scope. The D2
   range guard makes activating one harmless — `goTo` returns before
   `navigate`/`onPageChange` — but the affordance is still wrong for a keyboard
   user, who can tab to and press a control that looks disabled and get nothing.
   The guard fixes the consequence, not the affordance.

4. **`status.missing` is a new thing a consumer can get wrong.** A screen that
   forgets `.includes(...)` and tests only `status.state === 'incomplete'` is back
   to naming a list it does not know failed. Three consumers exist today and all
   three are correct; there is no lint rule that would catch a fourth.

5. **`hrefFor` always writes `page`, including `page=1` and `page=0`.** The SPA
   path omits `page` when it is 1, so a middle-clicked href and a clicked link
   can produce cosmetically different URLs for the same page. Both render the
   same page; `page=0` only ever appears on the Previous control at page 1, which
   is disabled and now guarded. Chosen over `params.delete('page')` because that
   yields a bare `?` href when no other parameter is set.

6. **`client/src/lib/useApi.ts` carries false universals at `:9` and `:15-16`.**
   Raised in the fix-round review and confirmed, but the file is pre-existing,
   untouched by this phase, and not on the plan's Files touched list — so it was
   deliberately left alone. It is a comment-honesty defect of the same class this
   phase addressed, and it is still there.
