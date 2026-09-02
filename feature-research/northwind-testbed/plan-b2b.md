# Phase B2b (Northwind testbed — client, subtractive half) — PLAN, revision 2

Repo `~/Developer/northwind-fullstack`, branch `b2-northwind-client`
@ **`08f7e51`**. Continue on the same branch.

This is `plan-b2.md` steps **B1-B6** plus the review findings the user accepted
at B2a acceptance (`progress-b2a.md`, "B2b's scope"). Read `progress-b2a.md`
before starting; its traps are not repeated here in full.

B2a was purely additive. **B2b deletes, rewrites and tells the truth.** No new
roadmap shape is owed — every shape is already satisfied. The job is removing the
template's leftovers and fixing the places where the code and its comments
disagree.

> **Revision 2.** Rev 1 was rejected by the reviewer with eight blocking issues:
> a wrong gate base, a fix with nowhere to apply it, a "bug" that was already
> guarded, a claim that `ProductList` is presentational when it fetches, an e2e
> count that summed to 11, a search box with no behaviour (the rev-1
> built-for-the-reader pattern), a `listEmployees` consumer that would break its
> host's stated contract, and a README rule that forbade fixing a section about
> a deleted page. All eight are addressed below.

> **Split, on the reviewer's recommendation.** The work is more than one context
> window. **Hand Part 1 to the implementer now; Part 2 after Part 1 is
> accepted.** Part 1 is "deletions to green" — it ends with the repo passing all
> ten gates at 10/10 e2e. Part 2 is "honesty and bugs" and touches no gate.

---

# PART 1 — deletions to green

## Step 1 — Customers page, with a search that works

`git mv client/src/pages/pagination-page.tsx client/src/pages/customers-page.tsx`
and rewrite it as a paged customers screen at `/customers`.

- Consumes `client/src/hooks/use-customers.ts`.
- **URL-driven** via `useSearchParams` — `?page=` and `?q=`. Keep the file's
  existing idiom; do not invent a new one.
- Renders `CustomerSearchInput`.
- `client/src/routes.tsx`: update the import and the route entry
  (`/pagination` / label `Pagination` → `/customers` / label `Customers`).

**`CustomerSearchInput` must do something real.** Today
`client/src/services/customers.ts:16` has no search parameter and
`client/src/hooks/use-customers.ts:15` is `(page, pageSize)`, so rendering the box
beside a list it cannot filter would put a component on screen purely so it has a
render site. That is precisely why rev 1 of `plan-b2.md` was rejected. Wire the
search through the real path instead:

- `server/Endpoints/NorthwindEndpoints.cs` — `/api/customers` gains an optional
  `search` query parameter filtering on `CompanyName` (case-insensitive
  `Contains`). It reuses the existing paging envelope and the 1-50 clamp
  untouched. This is a genuine Northwind feature, not a hook for the reader.
- `client/src/services/customers.ts` — pass `search` through.
- `client/src/hooks/use-customers.ts` — signature becomes
  `(page, pageSize, search)`.
- The page owns `?q=` and passes it down. Clearing the search focuses the input
  through the forwarded ref, which makes that behaviour real. (The *comment*
  claiming `forwardRef` is what enables focusing is still false and is fixed in
  Part 2, Step 6c — React 19's `ComponentProps<"input">` already carries `ref`.)

**Lint constraint, non-negotiable.** `lib/useApi.ts:23` carries a
`set-state-in-effect` warning for a synchronous `setState({status:'loading'})` in
an effect body, and `progress-b2a.md` records this page as the one most likely to
reintroduce it. Initialise state as `{ status: 'loading' }` and never re-set it
synchronously. The gate is **exactly 7 lint warnings, none new.**

**Rename may not survive as `R`.** A full rewrite usually falls below Git's
similarity threshold, so `--name-status` will likely show
`D client/src/pages/pagination-page.tsx` + `A client/src/pages/customers-page.tsx`
rather than `R`. Both are acceptable for Gate 10; record which one occurred.

## Step 2 — Delete the Packages feature

`server/Program.cs`: remove the `MapGet("/api/packages", …)` route (lines 30-48),
the `record Package`, and `static class Packages` with its `All` list (lines
56-83).

**`/api/hello` and `/api/contact` must remain byte-identical.** `/api/hello` is
Playwright's readiness probe on 5170; change its shape and the whole suite fails
to start rather than failing a test.

## Step 3 — Clear stale prose

Corrected table (rev 1 misattributed one row — `dos-donts-page.tsx:63` is a
`fetch` call, not a `Packages.All` sample):

| file:line | what is now false |
|---|---|
| `client/src/pages/dos-donts-page.tsx:24` | "The pagination page derives the page number from the URL…" |
| `client/src/pages/dos-donts-page.tsx:63` | code sample `fetch(\`/api/packages?page=${page}\`)` |
| `client/src/pages/dos-donts-page.tsx:74` | "`useApi.ts` — the only fetch effect in the app; every page goes through it" |
| `client/src/pages/dos-donts-page.tsx:99` | "exactly two effects" |
| `README.md:207` | heading `## Step 11 — Example: pagination` — the whole section describes a deleted page |
| `README.md:218` | Step 11 prose referencing `Packages.All` |
| `README.md:223` | Step 11 prose referencing `Packages.All` |
| `README.md:226` | image line for `pagination.png` (deleted in Step 5) |
| `README.md:230-232` | "exactly two effects", rendered as a card on `/` |

**Three traps:**

1. `dos-donts-page.tsx`'s `rules` array must keep **exactly 6 entries** (titles
   currently at lines 13/27/46/60/77/88) — e2e test 7 asserts `"Don't"` and
   `"Do"` each appear exactly 6 times, and test 7 is not on the rewrite list.
   **Reword the pagination rule; never delete it.**
2. **The README heading rule is narrower than rev 1 stated.** Rev 1 said headings
   must not change, which would have forbidden fixing `README.md:207` — a whole
   section about a page that no longer exists. What is actually required:
   - the `Step N — Title` format with the **literal em-dash**
     (`lib/markdown.ts:63` matches `/^Step (\d+) — (.*)$/`);
   - **title uniqueness** (`guide-page.tsx:88` keys the section list on
     `section.title`);
   - the four anchors e2e test 1 asserts (`pages.spec.ts:6-9`): the `#` title
     `vite-react-webapi-template` (which stays, despite the repo being
     `northwind-fullstack`), `"Step 1"`, `"Init the repo"`, and
     `/The server says/`.

   Within those, **Step 11 may be retitled and rewritten** — e.g.
   `## Step 11 — Example: customers`.
3. **Do not round-trip Markdown or JSON through a parser to edit it.** B1 lost a
   whole file to a CRLF→LF rewrite that way.

## Step 4 — E2E, 7 → 10

`client/e2e/pages.spec.ts`. Rev 1's arithmetic summed to 11 by counting customers
twice. The ten, enumerated:

| # | test | status |
|---|---|---|
| 1-4 | existing (guide page, contact, form, etc.) | unchanged |
| 5 | `/customers` — list renders, click page 2 | **rewritten** (was `/pagination`, lines 46-52) |
| 6 | `/customers?page=4` — deep link | **rewritten** (was lines 54-59) |
| 7 | dos & don'ts — "Don't"/"Do" ×6 each | unchanged |
| 8 | `/products` | **new** |
| 9 | `/orders` | **new** |
| 10 | `/categories` | **new** |

Tests 8-10 assert only: the page mounts, its heading renders, and it reaches its
error state. **No test may assert rendered rows** — there is no database and
every Northwind route 500s. Standing decision, not a gap to fix under pressure.

- The `/customers?page=4` deep-link test must call `page.waitForRequest`
  **before** `page.goto`, and expect **2** requests (React 19 StrictMode
  double-invoke).
- Hook by role and accessible name. **No `data-testid`.**
- **No `page.route()` body-mocking** — a mock authored against our own TS types
  proves only that the types agree with themselves.

## Step 5 — Screenshots

`client/e2e/screenshots.spec.ts`: drop `/pagination`, add the four new pages.
Delete `client/public/screenshots/pagination.png` and its `README.md:226` line.

**Rev 1's "verify first" branch is closed** — the answer is known:
`client/package.json` defines `"e2e": "playwright test --grep-invert @shots"` and
every test in `screenshots.spec.ts` is tagged `${name} @shots` (line 33). The
screenshots spec is **excluded** from `npm run e2e`, so this step cannot affect
the 10/10 gate.

`npm run shots` stays **barred** — it rewrites `client/public/screenshots/`. The
four new PNGs will simply not exist until the user authorises a run. If executed
by accident: `git checkout -- client/public/screenshots`.

## Step 6 — Gates

All ten, from a clean tree, full output captured in the audit:

1. `dotnet build server --no-incremental` — 0 warnings, 0 errors. Forced rebuild;
   incremental can hide warnings.
2. `npx tsc -b --force` in `client/` — exit 0.
3. `npm run build` — clean. **The bundle hash and size WILL move.** B2 is the
   phase that rewrites `client/`; Phase A's `647.18 kB` and B2a's `657.74 kB` are
   both retired. Not a regression.
4. `npm run lint` — **exactly 7 warnings, none new.** The `lib/useApi.ts`
   `set-state-in-effect` warning must still be among them (`useApi.ts` survives —
   it is still the right tool for the guide page's `/api/hello` card,
   `guide-page.tsx:30`). Line numbers may shift; the count and rule set may not.
5. `npm audit` in `client/` — 0 vulnerabilities.
6. `DEBUG=pw:webserver npm run e2e` — **10/10**, with the `ECONNREFUSED` →
   `HTTP Status: 200` handshake proving both 5170 and 5173 were *started*.
7. `git status --porcelain` — empty. No stray `*.db`/`-shm`/`-wal`.
8. Package/lockfile diff empty for `main..HEAD` and `a34564c..HEAD`.
9. Vocabulary grep over all changed files for
   `extract|attribut|walker|fixture|testbed|domain-expert|psq|analy` — must be
   clean. **Run a positive control before believing it.** B2a's first run
   fake-passed on an unquoted variable: zsh did not word-split it, the whole list
   went through as one filename, exit 2 read as "no matches". Write the paths
   longhand, then re-run the identical command with a word that IS present (e.g.
   `product`) and show it matching.
10. `git diff --name-status 08f7e51..HEAD` matches Part 1's Files touched list.
    **Base is `08f7e51`, not `a34564c`** — `a34564c` spans B2a as well and can
    never match a B2b-only list.

**Environment traps:**
- `node`/`npm` are **not on `PATH`** — a stale nvm entry leads it. Use
  `~/.local/share/fnm/node-versions/v24.19.0/installation/bin`.
- `lsof -ti :5170 :5173` errors on this machine (lsof 4.91). Two single-port calls.
- Clear both ports before e2e. `reuseExistingServer: true` will serve a fully
  green run off a stale `dotnet run` from another repo.
- `npm ci`, never `npm install`.

## Part 1 — Files touched

**Renamed (may land as D+A) — 1**
1. `client/src/pages/pagination-page.tsx` → `client/src/pages/customers-page.tsx`

**Modified — 8**
2. `client/src/routes.tsx`
3. `client/src/services/customers.ts`
4. `client/src/hooks/use-customers.ts`
5. `client/src/pages/dos-donts-page.tsx`
6. `client/e2e/pages.spec.ts`
7. `client/e2e/screenshots.spec.ts`
8. `server/Program.cs`
9. `server/Endpoints/NorthwindEndpoints.cs`
10. `README.md`

**Deleted — 1**
11. `client/public/screenshots/pagination.png`

Nothing else. No new files, no `client/src/lib/useApi.ts` change, **no repo-root
`tsconfig.json`** (Phase C1 targets `client/tsconfig.json`), no commits on
`main`, no tag.

**Deliverable:** `feature-research/northwind-testbed/audit-b2b-1.md` with full
output for all ten gates including the Gate 9 positive control. One commit.

---

# PART 2 — honesty and bugs

Hand over only after Part 1 is accepted. Touches no gate threshold; the same ten
gates must still pass at the end, with base `08f7e51..HEAD` now spanning both parts.

## Step 6 — Comment honesty rewrites

The reviewer's verdict on B2a was *"the code reads as an app; the comments are
where it slips."* Each of these defends a shape with a reason that does not
survive checking.

**6a. `client/src/services/reference.ts:31`.** Claims categories are "needed by
the first screen that renders" — false, `/` is the guide page and needs nothing
from the provider — and frames module-scope promise reuse as a dedup, which in
practice only bites under StrictMode's development double-invoke. Reword to the
true reason: **the promise is created once at module scope so a remount reuses
the settled result instead of starting a second flight.** Assert nothing about
which screen renders first.

**6b. Reconcile the contradictory convention, in all three places.**
`client/src/components/orders/order-detail-panel.tsx:13` says "Collection queries
stay in the service, because several screens ask for those";
`client/src/pages/orders-page.tsx:11-13` says it calls the service directly
*because* it is the only consumer. `client/src/services/customers.ts:4-5` repeats
the first claim ("collection queries that more than one screen needs") and also
has one consumer. Only `listProducts` genuinely has two. State one convention the
code actually follows, once, and delete the other two claims.

**6c. `client/src/components/customer-search-input.tsx:13`.** Implies
`forwardRef` is what enables a parent to focus the field. It is not —
`ui/input.tsx` types `Input` as `React.ComponentProps<"input">`, which under
React 19 already carries `ref`. After Part 1 the focus behaviour is real; the
false causal claim is not. Describe what the component does without it. The
roadmap justification for `forwardRef` belongs in this plan, not in the file.

## Step 7 — Real bugs

**7a. Stale products on category change — fix in the hook, not with a `key`.**
`client/src/pages/categories-page.tsx:18` calls `useProducts(1, 6, selectedId)`
**in the page body**, so switching category renders the previous category's
products under the new heading, with no loading state, until the response lands.

Rev 1 told the implementer to "apply the same `key` idiom as
`products-page.tsx:61`". That is not implementable: the key there sits on
`<ProductList>`, a child component, and categories-page has no such child.
Nor may categories-page simply render `<ProductList>` instead — it is one of the
**two consumers of `useProducts`** that satisfy the roadmap's "hook consumed by
two components" shape (the other being `products/product-list.tsx:27`), and
dropping its direct call would destroy that shape.

Fix in `client/src/hooks/use-products.ts` instead: **reset to
`{ status: 'loading' }` when the hook's arguments change**, using React's
documented adjust-state-during-render pattern (store the previous argument key in
state, compare during render, set during render). This is a render-time set, not
an effect, so it is outside `set-state-in-effect`. It fixes both call sites with
one mechanism, after which the `key` on `products-page.tsx:61` is redundant —
remove it, so there is one mechanism rather than two.

> **Verify the lint count immediately after this change, before going further.**
> If the rule does fire on a render-time set, fall back to extracting the
> products section of `categories-page.tsx` into a keyed child component. That
> adds one file to the list; take it only if measured, and say so in the audit.

**7b. `client/src/components/products/product-list.tsx:18`.** The swallowed `$`:
`value === null ? 'Price on request' : \`${value.toFixed(2)}\`` renders prices
bare while the null branch talks about price. Restore the `$`.

**7c. `client/src/pages/products-page.tsx` — make it URL-driven.** The pagination
`href`s at `product-list.tsx:67,80` (`?page=${page ± 1}`) were lifted from the
URL-driven `pagination-page.tsx`, but the parent holds `page` in `useState` and
never writes the URL, so `preventDefault` runs and open-in-new-tab gives
`/products?page=2` rendering page 1. Move `page` and `category` into
`useSearchParams`, matching the customers page from Part 1, and have the
page-change callback write the URL. The `href`s then become true.

> **`ProductList` is NOT presentational — do not make it so.** Rev 1 said to keep
> it presentational; it in fact calls `useProducts(page, 6, categoryId)` at line
> 27 and derives `totalPages` at line 28. Moving the fetch out would delete the
> one component-attributed call site this file contributes — the exact shape
> Phase C/D exists to measure. **The hook stays inside; `totalPages` stays
> derived; only the parent's source of `page` changes.**

**7d. `client/src/components/products/product-list.tsx:28` — dead, not a bug.**
`const totalPages = state.status === 'success' ? state.data.totalPages : page`.
Rev 1 escalated this to a user-visible "page N of N while loading" defect. It is
not: line 62 already gates the entire `<Pagination>` on
`state.status === 'success'`, so the fallback is unreachable. Tidy it as dead
code — compute `totalPages` only where it is used — and **do not report it as a
fixed bug.**

**7e. `client/src/services/reference.ts:26` — `listEmployees` has zero
consumers.** Verified: the only occurrence in `client/src` is its own definition.
In a testbed that is worse than dead code — it hands the static reader a call
site the app never causes.

Rev 1 put the call in `client/src/components/orders/order-table.tsx`, which
documents itself at lines 19-20 as "Presentational: it holds no state and fetches
nothing". Do not break that. **Move the fetch into the reference-data provider**
— employees are a lookup table exactly like categories, suppliers and shippers —
and have `order-table.tsx` read `useReferenceData()` to label
`OrderSummaryDto.employeeId`. Reading context is neither state nor fetching, so
the table's stated contract survives intact.

## Step 8 — Reviewer-noted lower-priority items

**8a. `client/src/pages/categories-page.tsx:27`** hardcodes "Eight categories,
loaded once for the whole app." With no database the count is not knowable at
runtime. Reword so it asserts no count.

**8b. Provider status union.** `client/src/context/reference-data-context.ts` and
`client/src/components/reference-data-provider.tsx` expose `failed: boolean`, so
"still loading" is indistinguishable from "loaded and empty". Replace with a
status union and update both consumers of `useReferenceData`.

> **A5 hard requirement — do not break it.** `reference-data-provider.tsx` must
> keep **exactly one unconditional return** of
> `<ReferenceDataContext value={…}>{children}</ReferenceDataContext>`. No gate,
> no throw, no Suspense, no early return. `status` is **data, never control
> flow** — the same rule `failed` was under. Note that after Step 7e there are
> **four** reference endpoints, not three; all four 500 on every page load with
> no database, and the suite must still be green with those XHRs in flight.

**8c. Do NOT rename `client/src/components/orders/product-list.tsx`.** The
reviewer floated `LineItems`. It is the better name, and it would **destroy the
roadmap's required "two components with the same name in different directories"
shape** — the single most important shape in the testbed, because
`ClientCall.components` holds `DefKey`s (`<file>#<name>`), not names. Both
`ProductList`s stay.

## Step 9 — carried forward from the Part 1 review

Both were raised as non-blocking against `18d5d61` and deferred here on the
reviewer's recommendation.

**9a. Reconcile the two pagers.** Part 1's `client/src/pages/customers-page.tsx`
renders `<Pagination>` **ungated**, with `totalPages === null` meaning "upper
bound not known yet" — honest, because the page number comes from the URL and is
known before any response arrives. `client/src/components/products/product-list.tsx:62`
gates the identical shadcn block on `status === 'success'` and falls back
`totalPages = page`. Same idiom, opposite convention, and a reader diffing the
two files currently gets no answer. Step 7c changes only the parent's source of
`page` and Step 7d only tidies the dead fallback, so neither closes this.

Pick one convention and apply it to both, or — if they should genuinely differ —
say why in `product-list.tsx`, in a sentence that survives checking.

Note the behavioural cost Part 1 accepted and did not record: in the error state
the user sees "Failed to load customers" alongside a live Next that walks the URL
forward through unbounded empty pages, and on a real last page Next stays enabled
while loading. Whichever convention wins should address that.

**9b. `client/src/hooks/use-customers.ts:11-13`.** The docblock still says a
caller "remounts the consuming component with a `key`". No caller does. Retarget
it once Step 7a's hook-level reset lands — the two changes describe the same
mechanism and must agree.

## Part 2 — Files touched

**Modified — 13**
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

**Conditional — 1**
14. A new keyed child extracted from `categories-page.tsx`, **only** if Step 7a's
    render-time set trips the lint rule. Measure first; record the result either
    way.

**Deliverable:** `feature-research/northwind-testbed/audit-b2b-2.md`, all ten
gates re-run. One commit.

---

## Standing decisions — do not re-open

1. **No database.** Every Northwind route 500s. Assert loading and error states
   only. A roadmap decision ("source-complete, not running"), not a gap.
2. **Request wrapper: mixed, deliberately.** `reference.ts` uses a shared
   `getJson<T>()`; the other three services spell out literal-path fetches.
   Wrapper-style calls currently extract as nothing, and that weak spot is
   exactly what the testbed must contain in order to detect it.
3. **Write the testbed as an app, not as a fixture.** The implementer must not
   read domain-expert's `clients.ts`, `refs.ts`, or any extractor/attribution
   source while working. Gate 9 checks this.
4. **`useApi.ts` survives** — the guide page's `/api/hello` card, e2e test 1.
5. **No commits on `main`; do not tag; `npm run shots` barred; pushing to the
   public repo is a separate decision after acceptance.**
