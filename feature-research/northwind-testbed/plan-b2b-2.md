# Phase B2b PART 2 (Northwind testbed — honesty and bugs) — PLAN, hand-off revision 2

Supersedes `plan-b2b.md` Steps 6–9. Every line number re-verified against
**HEAD `955a680`**. Revision 1 of this document was rejected by the reviewer with
nine blocking issues; all nine are resolved below — see "What rev 1 got wrong".

Base for all gates: **`08f7e51..HEAD`**, spanning Part 1 and Part 2.
Branch `b2-northwind-client`. One commit. No commits on `main`. Do not tag.

**Standing decision 3 still applies: do not read domain-expert's `clients.ts`,
`refs.ts`, or any extractor/attribution source while working. Gate 9 checks it.**

---

## What rev 1 got wrong — read this first

Rev 1 proposed disabling Next whenever the page bound was unknown
(`totalPages === null`). **That is unimplementable in this testbed.** There is no
database (standing decision 1), so every route 500s and `totalPages` is
permanently `null` — not transiently. "Disable Next when the bound is unknown"
therefore means "disable Next always, everywhere, forever". It would have:

- broken shipped e2e test 5 (`client/e2e/pages.spec.ts:49-56`), which clicks Next
  on `/customers` **in the error state** and expects `?page=2` — the click would
  hit Playwright's actionability timeout on `pointer-events-none`;
- made new test 11 unwritable for the same reason;
- reversed Part 1 decision #1, which was explicitly reviewed and accepted;
- falsified `customers-page.tsx:104-106` ("Next stays open until it knows better").

Gating on `error` instead of `null` fails identically — with no database every
state settles to `error`. **Any rule that disables Next on absent data kills
pagination outright here.** The convention below is Part 1's, extended to both
files.

Rev 1's other six blocking issues were all the same failure this phase keeps
hitting: a step that **falsifies a comment** without listing that comment for
repair. Steps 7a, 7c, 7e and 8b each did it. They are fixed in place below, and
each carries a **[falsifies]** marker so the implementer cannot miss it.

---

## Corrections to the outline

**C1. Step 6b's premise was wrong, and the fix changes shape.**
The outline said "only `listProducts` genuinely has two [consumers]." At the
service layer that is false. Measured at HEAD, *every* collection function has
exactly one direct caller:

| function | direct call sites in `client/src` |
|---|---|
| `listCategories` | 1 — `reference.ts:36` (module scope) |
| `listSuppliers` | 1 — `reference-data-provider.tsx:29` |
| `listShippers` | 1 — `reference-data-provider.tsx:30` |
| `listEmployees` | **0** |
| `listOrders` | 1 — `orders-page.tsx:23` |
| `listCustomers` | 1 — `use-customers.ts:25` |
| `listProducts` | 1 — `use-products.ts:23` |

The "two consumers" is real only one level up: `useProducts` is called from
`categories-page.tsx:18` and `product-list.tsx:27`. So a corrected head-count
would swap one false census for another. **Step 6b states a placement rule, not
a count.**

**C2. Step 6c is not "false", it is "not load-bearing".**
`CustomerSearchInput` really does use `React.forwardRef` (`:17`), and the parent
really does focus it (`customers-page.tsx:22,52,66-67`). But `ui/input.tsx:5`
types `Input` as `React.ComponentProps<"input">`, so under React 19 `ref` is an
ordinary prop and the parent could focus without `forwardRef`. The description is
true; the word **"so"** is what fails. Drop the causality, keep `forwardRef`.

**C3. Step 8a is rendered UI text, not a comment** — `categories-page.tsx:27`,
inside a `<p>`. It is **not** the only count in the file: `:13` says "it wants
six rows", which is **true** and needs no edit. Only `:27` is wrong.

**C4. Step 7e and Step 8b collide. Do 7e first.** There are two consumers of
`useReferenceData` today (`products-page.tsx:17`, `categories-page.tsx:16`), but
7e adds `order-table.tsx` as a third. **8b updates three consumers.**

---

## Decisions — do not re-open

**D1 (Step 9a) — one convention: both pagers ungated, and Next stays open until
a known bound closes it.** This is Part 1's accepted semantics
(`totalPages === null` means "upper bound not known yet"), now extended to
`product-list.tsx` by removing its `success` gate. The page number comes from the
URL and is genuinely known before any response; only the upper bound waits.

**Consequence: Step 7d still inverts.** `product-list.tsx:28`'s `: page` fallback
is dead *only because* line 62 gates the pager. Once ungated it becomes
reachable, so it changes to `: null`, matching customers. Do **not** report 7d as
a fixed bug — it was never user-visible.

**The unbounded-Next behaviour is accepted, not fixed.** In the error state both
screens show a live Next that walks the URL forward through empty pages. That is
a consequence of standing decision 1 (no database), and e2e test 5 depends on it.
**Do not describe it as a bug, and do not write a comment claiming Next is
disabled at the last page beyond what D2's guard actually enforces.**

**D2 — the disabled state must actually disable, within its real limits.**
Verified at HEAD: `aria-disabled` is decorative (`ui/pagination.tsx` passes it to
an `<a>` and reads it nowhere); the real block is a conditional
`pointer-events-none opacity-50` class applied by the page
(`customers-page.tsx:114,127-129`; `product-list.tsx:70,83`). `goTo` has **no
range guard**, so the block is pointer-only — keyboard Enter on a focused
"disabled" anchor still runs `navigate()` out of range.

Add a range guard inside `goTo` in both files:

```ts
if (target < 1) return
if (totalPages !== null && target > totalPages) return
```

Nothing more. **A guard on `totalPages === null` would disable Next permanently
(see "What rev 1 got wrong").** Keep the CSS class as the visible affordance.

**D3 — e2e goes 10 → 12.** Two tests appended to `client/e2e/pages.spec.ts` as
11 and 12. Tests 1–10 are **unchanged**; D1 was chosen partly so test 5 keeps
passing untouched.

**D4 (from B9) — both hooks get the same reset.** 7a's render-time reset goes
into `use-customers.ts` as well as `use-products.ts`. This keeps `src/hooks`
uniform, so `dos-donts-page.tsx:74` ("the hooks in `src/hooks` follow it line for
line") stays true and **`dos-donts-page.tsx` stays out of Files touched**. It
also fixes the identical stale-rows bug on customers, which 9b would otherwise
merely document.

---

## Step 6 — comment honesty rewrites

**6a. `client/src/services/reference.ts`, comment at lines 30–35.** It reads:

> Categories are needed by the first screen that renders, so the request goes
> out when this module is first imported rather than waiting for a mount. The
> provider awaits this promise; because it is created once at module scope, a
> remount reuses the settled result instead of asking again.

`/` is the guide page and needs nothing from the provider, so the first clause is
false; the reuse framing describes a dedup that only bites under StrictMode's
development double-invoke.

Reword to the true reason: **the promise is created once at module scope so a
remount reuses the settled result instead of starting a second flight.** Assert
nothing about which screen renders first. Leave `categoriesPromise` (`:36`), the
early-rejection `catch` (`:41`) and its own comment alone.

**6b. State the placement rule once; delete the two count claims.**
The rule the code actually follows, verified against `reference.ts`, `orders.ts`,
`customers.ts`, `products.ts` and `order-detail-panel.tsx`:

> **Collection reads live in a service module. A by-id read lives in the
> component that displays that record.**

Normative, no census — it obeys standing decision 6.

- `client/src/services/customers.ts`, comment at lines 3–10. Line 4's
  "collection queries that more than one screen needs" is the count claim.
  **This is the one file that states the rule.** Replace the count clause with
  the rule. **Keep the second paragraph (`:7-9`, status-checked-before-parse)
  exactly as it is** — true, unrelated, added in Part 1.
- `client/src/components/orders/order-detail-panel.tsx`, comment at lines 7–15.
  Delete "Collection queries stay in the service, because several screens ask for
  those" (`:13-14`) **and** the "a service function with a single caller inside
  the same folder is indirection without a reason" justification (`:11-12`). It
  may keep one plain descriptive sentence — that this by-id read lives here
  rather than in `services/orders` — with **no reason and no count**.
- `client/src/pages/orders-page.tsx`, comment at lines 8–14. Delete the "This
  screen is the only consumer of the orders collection, so…" justification
  (`:11-13`) entirely. Say what the screen does; do not explain why it calls the
  service.

Forbidden in all three: "only consumer", "several screens", "more than one",
"single caller", or any other count.

**6c. `client/src/components/customer-search-input.tsx`, comment at lines 9–16.**
Line 13's "The ref is forwarded through `React.forwardRef` **so** a parent can
focus the field" states a causal relationship that does not hold (C2).

Rewrite to describe what the component does — holds no state, makes no requests,
exposes the underlying input's ref so the screen can focus it — without claiming
`forwardRef` is what makes focusing possible. **Keep `React.forwardRef` in the
code**; its roadmap justification lives in this plan, not in the file. Do not
touch `ui/input.tsx`.

---

## Step 7 — real bugs

**7a. Stale rows on argument change — fix in the hooks.**
`categories-page.tsx:18` calls `useProducts(1, 6, selectedId)` in the page body
and renders its products **inline at `:64-72` — there is no `<ProductList>` child
to key.** Switching category shows the previous category's products under the new
heading, with no loading state, until the response lands. `customers-page.tsx:26`
has the same bug via `useCustomers` and likewise no `key`.

Fix in **both** `client/src/hooks/use-products.ts` and
`client/src/hooks/use-customers.ts` (D4): **reset to `{ status: 'loading' }` when
the hook's arguments change**, using React's adjust-state-during-render pattern —
store the previous argument key in state, compare during render, set during
render. This is a render-time set, not an effect.

> **The lint result is already measured, not assumed.** The reviewer wrote this
> exact pattern into a probe and ran the linter (**oxlint**, not ESLint): zero new
> diagnostics, total still exactly 7. A deliberate `setState`-in-effect on the
> same probe fired `react(set-state-in-effect)`, so the clean result is
> meaningful. **There is no conditional extracted-child fallback in this plan.**
> Still re-run `npm run lint` immediately after this step and record the count.

Then **remove the now-redundant `key` on `products-page.tsx:61`**
(`key={`${categoryId ?? 'all'}:${page}`}`) so there is one mechanism, not two.
`ProductList` holds no other state, so this is safe.

**[falsifies] Two comments die with that `key` — rewrite both:**
- `client/src/pages/products-page.tsx:12-14` — "`key` on the list is doing real
  work: changing the page or the category remounts it, so the hook inside starts
  from its loading state instead of showing the previous page's rows until the
  new ones land." The `key` is gone; describe the hook-level reset instead.
- `client/src/hooks/use-products.ts:9-11` — "Same shape as `useCustomers`:
  **initial state only**, an AbortController…". Under D4 "same shape as
  `useCustomers`" stays true, but "initial state only" does not. Update the
  clause in both hooks so they still agree with each other.

**7b. `client/src/components/products/product-list.tsx:18`.**
`return value === null ? 'Price on request' : `${value.toFixed(2)}`` renders
prices bare while the null branch talks about price. Restore the `$`.

**7c. `client/src/pages/products-page.tsx` — make it URL-driven.**
Lines 18–19 hold `categoryId` and `page` in `useState`; the file imports no
`useSearchParams`. Meanwhile `product-list.tsx:67,80` render
`href={`?page=${page ± 1}`}` with `onClick={goTo(...)}` calling `preventDefault()`,
so open-in-new-tab on `/products?page=2` renders page 1.

Move `page` and `category` into `useSearchParams`, mirroring
`customers-page.tsx:19-48`, and have the page-change callback write the URL.

> **[falsifies] The `href`s do NOT become true by moving state alone.**
> `?page=${n}` is a bare query string that **replaces the entire search string**,
> so once `category` lives in the URL, middle-clicking Next silently drops the
> filter. **Build every pagination `href` from the full current parameter set**
> — copy the existing `URLSearchParams`, set `page`, and keep the rest. Apply the
> same fix to `customers-page.tsx:111,124`, whose `href`s already drop `q` today.
> Only then may any comment say the `href`s are true.

> **`ProductList` is NOT presentational — do not make it so.** It calls
> `useProducts(page, 6, categoryId)` at `:27` and derives `totalPages` at `:28`.
> Moving the fetch out would delete the one component-attributed call site this
> file contributes — the exact shape Phase C/D exists to measure. **The hook
> stays inside; `totalPages` stays derived; only the parent's source of `page`
> changes.**

**7d. `client/src/components/products/product-list.tsx:28` — folded into 9a.**
Per D1 the pager stops being gated, so `: page` stops being unreachable. Change
`state.status === 'success' ? state.data.totalPages : page` to `… : null`,
matching `customers-page.tsx:27`. **Do not report as a fixed bug.**

**7e. `client/src/services/reference.ts:26` — `listEmployees` has zero
consumers.** Confirmed: the only occurrence in `client/src` is its own
definition. In a testbed that is worse than dead code — it hands the static
reader a call site the app never causes.

**Move the fetch into the reference-data provider.**
`reference-data-provider.tsx:27-30` currently loads `categoriesPromise`,
`listSuppliers()`, `listShippers()`. Add `listEmployees()` as the fourth.

**This requires a field the outline never mentioned:** add
`employees: EmployeeDto[]` to the `ReferenceData` type
(`reference-data-context.ts:12-18`) **and** to `emptyReferenceData` (`:21-26`).

Then have `client/src/components/orders/order-table.tsx` read
`useReferenceData()` to label `OrderSummaryDto.employeeId`. The table renders
`orderId`, `orderDate`, `shippedDate`, `freight`, `shipName`/`shipCountry` and a
select button today and does **not** render `employeeId`, so this adds the label.

> **[falsifies] `order-table.tsx:18-21` opens with "Presentational:".** A
> component that subscribes to context is no longer a function of its props
> alone, so **the word "Presentational" comes out** — this plan settles it, the
> implementer does not have to judge it. The clauses "holds no state and fetches
> nothing" remain true and stay. Rewrite the comment to say what the component
> does: renders the order rows it is given, reads the shared reference lists to
> label the employee, and reports clicks back. **Do not add a fetch or
> `useState` here.**

> **[falsifies] `reference-data-context.ts:6`** claims the context carries
> "suppliers and shippers for the labels on an order". False at HEAD — no
> component reads either list; the only occurrences outside this file are the
> context, the provider and the service. Correct it to describe what is actually
> consumed. **Do not add consumers for suppliers and shippers** — that is scope
> this plan does not take; log it (see Open risks).

---

## Step 8 — lower-priority items

**8a. `client/src/pages/categories-page.tsx:27`** renders "Eight categories,
loaded once for the whole app." With no database the count is not knowable at
runtime. Reword so it asserts no count. It is user-visible copy (C3) — keep it
reading as product copy, not as a caveat. **Leave `:13` ("six rows") alone; it is
true.**

**8b. Provider status union.** `reference-data-context.ts:12-18` types
`ReferenceData` as `{ categories, suppliers, shippers, failed: boolean }`, and
`emptyReferenceData` (`:21-26`) is `failed: false` with empty arrays — identical
in shape to "loaded and genuinely empty". Replace `failed` with a status union
and update **all three** consumers (C4): `products-page.tsx:17`,
`categories-page.tsx:16`, and `order-table.tsx` from 7e.

> **A5 hard requirement — do not break it.** `reference-data-provider.tsx` must
> keep **exactly one unconditional return** of
> `<ReferenceDataContext value={…}>{children}</ReferenceDataContext>` — today at
> `:46`. No gate, no throw, no Suspense, no early return. `status` is **data,
> never control flow**, the same rule `failed` was under. After 7e there are
> **four** reference endpoints; all four 500 with no database, and the suite must
> stay green with those XHRs in flight.

> **[falsifies] The failure messages name a list they do not know failed.**
> `categories-page.tsx:33` ("Failed to load categories") and
> `products-page.tsx:55` ("Categories are unavailable") fire when **any**
> reference list fails, and 7e makes it four. While replacing the flag they read,
> **reword them so they do not name a specific list**, or make the status carry
> enough to know. Do not leave a message asserting more than the state knows.

**8c. Do NOT rename `client/src/components/orders/product-list.tsx`.**
Both `ProductList`s stay: `orders/product-list.tsx:7` and
`products/product-list.tsx:26`. Two same-named components in different
directories is the roadmap's most important shape, because `ClientCall.components`
holds `DefKey`s (`<file>#<name>`), not names.

---

## Step 9 — carried from the Part 1 review

**9a. Both pagers, one convention (D1 + D2).**
Apply to `client/src/pages/customers-page.tsx` **and**
`client/src/components/products/product-list.tsx`:

```ts
const totalPages = state.status === 'success' ? state.data.totalPages : null
// label:    totalPages === null ? `Page ${page}` : `Page ${page} of ${totalPages}`
// Previous: disabled when page <= 1
// Next:     disabled when totalPages !== null && page >= totalPages
```

- **Ungate the `product-list.tsx` pager** — remove the
  `{state.status === 'success' && (…)}` wrapper at `:62-88`. Verified structurally
  safe: the block reads `page` and `totalPages`, never `state.data` directly.
- **`customers-page.tsx:126,128` already has the correct Next condition — leave
  it.** Only `product-list.tsx` changes to match.
- Keep `pointer-events-none opacity-50` as the visible affordance.
- Add the D2 range guard in both `goTo`s.
- Build the `href`s from the full parameter set (7c).

`customers-page.tsx:104-106` ("Only the upper bound waits for the server, so Next
stays open until it knows better") **stays true under this convention — do not
edit it.**

**Any sentence written about this must not claim more than the guard enforces.**
The controls remain focusable when disabled (`ui/pagination.tsx` sets no
`tabIndex={-1}`) — a known, accepted wart. Do not describe them as "removed from
the tab order", and **do not edit `ui/pagination.tsx`**. Do not claim Next is
disabled in the error state; per D1 it is not.

**9b. `client/src/hooks/use-customers.ts`, docblock at lines 6–14.**
It says "A caller that wants the loading state back when the page changes
remounts the consuming component with a `key`, which is the React way to reset
state on a prop change." Its sole caller is `customers-page.tsx:26` and uses no
`key`. Under D4 this hook now performs the render-time reset itself.

Retarget the docblock to describe that mechanism. **7a and 9b now describe the
same mechanism in two files and must agree word for word on what it does.**

---

## Files touched

**Modified — 15.** No conditional file; no new files.

1. `client/src/services/reference.ts` — 6a, 7e
2. `client/src/services/customers.ts` — 6b
3. `client/src/pages/orders-page.tsx` — 6b
4. `client/src/pages/products-page.tsx` — 7c, 7a (`key` + docblock `:12-14`)
5. `client/src/pages/categories-page.tsx` — 8a, 8b
6. `client/src/hooks/use-products.ts` — 7a (reset + docblock `:9-11`)
7. `client/src/context/reference-data-context.ts` — 8b, 7e (`employees` field, `:6`)
8. `client/src/components/reference-data-provider.tsx` — 8b, 7e
9. `client/src/components/customer-search-input.tsx` — 6c
10. `client/src/components/products/product-list.tsx` — 7b, 7d, 9a
11. `client/src/components/orders/order-detail-panel.tsx` — 6b
12. `client/src/components/orders/order-table.tsx` — 7e, 8b
13. `client/src/hooks/use-customers.ts` — 7a (D4), 9b
14. `client/src/pages/customers-page.tsx` — 9a (guard + `href`s)
15. `client/e2e/pages.spec.ts` — tests 11 and 12

Nothing else. **No `dos-donts-page.tsx`** (D4 keeps `:74` true), no
`ui/pagination.tsx`, no `ui/input.tsx`, no `lib/useApi.ts`, no `README.md`, no
repo-root `tsconfig.json`, no new screenshots, no commits on `main`, no tag.

---

## The two new e2e tests

Append to `client/e2e/pages.spec.ts` as 11 and 12 (it has exactly 10 today).
**Tests 1–10 are unchanged — do not edit test 5.**

**Test 11 — products pagination is URL-driven (covers 7c).** On `/products`:
clicking Next drives the URL to `?page=2`, and a `?page=N` deep link renders
page N. Both halves are reachable under D1 because Next stays live while
`totalPages` is null. Mirror Part 1's tests 5 and 6 for `/customers`, including
`waitForRequest` before `goto` and the StrictMode double-invoke count if you
follow test 6's deep-link form.

**Test 12 — the customers search push/replace split (closes a Part 1 open risk).**
Part 1 decision #2: `setSearchParams(params, { replace: nextQuery !== search &&
search !== '' })` — the first search edit **pushes** over the unsearched screen,
later edits **replace**, page turns **push**. The `&& search !== ''` clause is
load-bearing: without it the first keystroke destroys the unsearched entry and
Back lands on `/`. Nothing asserts this today.

**Verified writable: the input is not debounced** — `customers-page.tsx:70`
calls `navigate()` directly from `onChange`, so a two-keystroke refinement
produces exactly one pushed entry then one replaced one. From `/customers`,
search, refine, and confirm **one** Back returns to the unsearched list.

**Three traps:**

1. **Gate 9's vocabulary grep matches `attribut`, so `toHaveAttribute` and
   `getAttribute` fail the gate** on the test framework's own API name. Assert
   through `toHaveURL` and `toHaveClass`. This cost Part 1 a round.
2. **Playwright's actionability check times out on `pointer-events-none`.** No
   new test needs to click a disabled control; if one does, use `force: true` and
   do not let a timeout read as a failing assertion.
3. **A harness must be capable of a positive result.** Part 1's first history
   check ran deep links in a fresh context whose only entry was the deep link, so
   Back reported `about:blank` — a harness artifact. Test 12 must navigate to
   `/customers` first so a real prior entry exists.

---

## Gates — all ten, from a clean tree, full output in the audit

1. `dotnet build server --no-incremental` — 0 warnings, 0 errors. **Part 2
   touches no server file; this must stay clean.**
2. `npx tsc -b --force` in `client/` — exit 0.
3. `npm run build` — clean. **The hash and size WILL move.** Part 1's
   `659.26 kB` / `index-CW33IDHv.js` and CSS `73.20 kB` / `index-CzVZLvxs.css`
   are retired the moment Part 2 lands. **Comment and string text are bundle
   input** — re-run after prose-only edits, or a stale hash goes into the record
   (this cost Part 1 a round).
4. `npm run lint` — **exactly 7 warnings** (the linter is **oxlint**), the same
   seven `file:line`+rule pairs as the Part 1 baseline, with `src/lib/useApi.ts`
   `set-state-in-effect` among them. Line numbers may shift; the count and rule
   set may not. **Run immediately after 7a as well as at the end.**
5. `npm audit` in `client/` — 0 vulnerabilities.
6. `DEBUG=pw:webserver npm run e2e` — **12/12**, with the `ECONNREFUSED` →
   `HTTP Status: 200` handshake proving both 5170 and 5173 were actually started.
7. `git status --porcelain` — empty, before and after every run. No stray
   `*.db`/`-shm`/`-wal`.
8. Package/lockfile diff empty for `main..HEAD` and `08f7e51..HEAD`. **Run a
   positive control** — `main..HEAD` shows 42 files, so an empty result from the
   same command shape is meaningful.
9. Vocabulary grep over all changed files for
   `extract|attribut|walker|fixture|testbed|domain-expert|psq|analy` — must be
   clean. **Write the paths longhand and run a positive control before believing
   it** (e.g. `product`, which is present). B2a fake-passed here on an unquoted
   variable: zsh did not word-split it, the whole list went through as one
   filename, and exit 2 read as "no matches".
10. `git diff --name-status 08f7e51..HEAD` — the **union of Part 1 and Part 2**:
    Part 1's 12 entries plus the 11 files new in Part 2 = **23 entries**. Four
    files appear in both parts (`customers.ts`, `use-customers.ts`,
    `customers-page.tsx`, `pages.spec.ts`) and are counted once. **23 is exact —
    scope did not grow.**

**Environment traps — all five still live:**

- `node`/`npm` are **not on `PATH`** (a stale nvm entry leads it). Use
  `~/.local/share/fnm/node-versions/v24.19.0/installation/bin`.
- `npm ci`, never `npm install`.
- `lsof -ti :5170 :5173` errors on this machine (lsof 4.91) — two single-port calls.
- **Clear both 5170 and 5173 before e2e.** `reuseExistingServer: true` will serve
  a fully green run off a stale server from another repo. This fired for real in
  Part 1.
- Do not round-trip JSON/Markdown through a parser.

---

## Open risks to log in the audit — do not fix in this phase

- **`suppliers` and `shippers` are fetched by the provider and read by nothing.**
  Same class of defect as 7e's `listEmployees`, found while verifying
  `reference-data-context.ts:6`. Only the comment is corrected here.
- **7a introduces a label flicker with a real database:** on every page turn the
  reset makes `totalPages` null, so the label goes "Page 3 of 12" → "Page 3" →
  "Page 4 of 12". Invisible in this testbed (no database). Do not claim the
  change removes flicker; it adds this.
- **Pagination controls stay focusable when visually disabled** (`ui/pagination.tsx`
  sets no `tabIndex={-1}`). The D2 guard makes activation harmless, but the
  affordance is still wrong for keyboard users.

---

## Deliverable

`feature-research/northwind-testbed/audit-b2b-2.md`, with full output for all ten
gates including the Gate 8 and Gate 9 positive controls, the post-7a lint
measurement, and an explicit list of every comment rewritten under a
**[falsifies]** marker. One commit on `b2-northwind-client`.

---

## Standing decisions — do not re-open

1. **No database.** Every Northwind route 500s. Assert loading and error states
   only. A roadmap decision ("source-complete, not running"), not a gap.
2. **Request wrapper: mixed, deliberately.** `reference.ts` uses a shared
   `getJson<T>()`; the other three services spell out literal-path fetches.
   Wrapper-style calls currently extract as nothing, and that weak spot is
   exactly what the testbed must contain in order to detect it.
3. **Write the testbed as an app, not as a fixture.** Do not read domain-expert's
   `clients.ts`, `refs.ts`, or any extractor/attribution source while working.
4. **`useApi.ts` survives** — the guide page's `/api/hello` card, e2e test 1.
5. **No commits on `main`; do not tag; `npm run shots` barred; pushing to the
   public repo is a separate decision after acceptance.**
6. **The prose rule, adopted in Part 1:** prose may quantify only over a
   directory the audit enumerates; anything wider is stated as a rule, not a
   census. **Part 2 is almost entirely comment work — this is the rule it lives
   or dies by.**
