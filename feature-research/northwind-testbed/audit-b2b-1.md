# Phase B2b, PART 1 — implementer audit

Repo `~/Developer/northwind-fullstack`, branch `b2-northwind-client`.
Base `08f7e51` → one commit **`18d5d61`**. Not pushed, not tagged, `main` untouched.
Part 2 not started.

## Files changed

1. `client/src/pages/pagination-page.tsx` → `client/src/pages/customers-page.tsx` (rewritten; landed as **D + A**, see below)
2. `client/src/routes.tsx`
3. `client/src/services/customers.ts`
4. `client/src/hooks/use-customers.ts`
5. `client/src/pages/dos-donts-page.tsx`
6. `client/e2e/pages.spec.ts`
7. `client/e2e/screenshots.spec.ts`
8. `server/Program.cs`
9. `server/Endpoints/NorthwindEndpoints.cs`
10. `README.md`
11. `client/public/screenshots/pagination.png` (deleted)

Exactly the plan's Part 1 list. No other file created, modified or deleted.

## What changed, per file

**`client/src/pages/customers-page.tsx`** — `git mv`'d from `pagination-page.tsx` and
rewritten as the paged customers screen. Keeps the file's existing idiom: `useSearchParams`
for `?page=`, extended with `?q=`; both derived during render, no copy in `useState`. Consumes
`useCustomers(page, 6, search)`. Renders `CustomerSearchInput` with a forwarded ref and a
"Clear search" button that resets `?q=`/`?page=` and focuses the field through that ref.
Pagination links keep the original real-`href` + `preventDefault` pattern.

One deliberate deviation from the old file's structure: the `<Pagination>` block is **not**
gated on `state.status === 'success'`. It could not be — with no database `/api/customers`
500s, `success` never arrives, and a gated block would leave e2e test 5 ("click page 2")
with nothing to click. The page number is known from the URL before any response, so
rendering the controls unconditionally is the honest shape; only the upper bound waits for
the server (`Page 4` vs `Page 4 of 12`, and Next disabled only once `totalPages` is known).

State: the page holds none (`useRef` only), so it adds no `set-state-in-effect` risk.

**`client/src/routes.tsx`** — import and route entry `/pagination` `Pagination` →
`/customers` `Customers`.

**`client/src/services/customers.ts`** — `listCustomers(page, pageSize, search, signal)`;
builds the query with `URLSearchParams` and sets `search` only when the trimmed term is
non-empty. The block comment at lines 4-5 was left alone — it is Part 2, step 6b.

**`client/src/hooks/use-customers.ts`** — signature `(page, pageSize = 6, search = '')`,
`search` added to the effect deps and passed to the service. Initial state stays
`{ status: 'loading' }` and is never re-set synchronously.

**`server/Endpoints/NorthwindEndpoints.cs`** — `/api/customers` gains optional
`string? search = null`, filtering case-insensitively on `CompanyName` before the existing
`OrderBy`. The paging envelope and the `Math.Clamp(pageSize, 1, 50)` are untouched.
Translation verified against a live server: the generated SQL is
`WHERE instr(lower("c"."CompanyName"), @term) > 0`, and
`GET /api/customers?page=1&pageSize=6&search=alfred` returns 500 from the missing table —
i.e. it bound and translated, and only the absent database stopped it.

**`server/Program.cs`** — removed `MapGet("/api/packages", …)`, `record Package` and
`static class Packages`. `/api/hello` and `/api/contact` are **byte-identical**; the diff
shows only deletions between the contact handler and `app.MapNorthwindEndpoints()`.
Confirmed live: `/api/hello` → `{"message":"Hello from ASP.NET Core minimal API"}`,
`/api/packages` → 404.

**`client/src/pages/dos-donts-page.tsx`** — still **exactly 6 rules**, all titles unchanged.
Four stale strings reworded/retargeted: the pagination-page `inThisApp` (now the customers
page and its two URL-derived values), the `fetch(\`/api/packages?page=…\`)` sample (now
`/api/customers`), "the only fetch effect in the app" (now `useApi.ts` plus the hooks in
`src/hooks`, all aborting in cleanup), and "exactly two effects" (now "every effect is one of
two kinds"). The pagination rule was reworded, never deleted.

**`README.md`** — `## Step 11 — Example: pagination` → `## Step 11 — Example: customers`,
with the section rewritten for the customers screen: URL-driven page **and** search term, EF
`ToLower().Contains` sample replacing the `Packages.All` sample, `useCustomers` sample
replacing the `useApi<PackagePage>` one, and the `pagination.png` image line deleted. Step
12's "exactly two effects in the whole app" reworded the same way as the dos & don'ts card.
Format rules held: literal em-dash `Step N — Title`, all 16 titles unique, and the four
anchors e2e test 1 asserts (`# vite-react-webapi-template`, `Step 1`, `Init the repo`,
`/The server says/`) untouched. Edited in place, no parser round-trip; the file was and
remains pure LF.

Two surviving mentions of "pagination" were checked and left: line 146 (the shadcn component
install list — the `pagination` component is still used) and line 292 (a historical note
about a11y bugs the e2e suite found). Neither is a claim about a page that no longer exists.

**`client/e2e/pages.spec.ts`** — 7 → **10** tests, exactly the plan's table. Tests 5 and 6
rewritten for `/customers`, tests 8-10 added for `/products`, `/orders`, `/categories`.
Everything is hooked by role and accessible name; no `data-testid`, no `page.route()`.

**`client/e2e/screenshots.spec.ts`** — `/pagination` dropped, `/customers`, `/products`,
`/orders`, `/categories` added. This spec is excluded from `npm run e2e` by
`--grep-invert @shots`, so it does not touch the 10/10 gate. `npm run shots` was **not** run;
the four new PNGs do not exist and `client/public/screenshots/` is otherwise untouched.

## Deviations from the plan, and why

**1. Test 5 cannot assert rendered rows, so it asserts the error state instead.**
The plan's table says "`/customers` — list renders, click page 2". With no database the list
cannot render — Standing decision 1 forbids asserting rows and the standing decision wins.
The test asserts the page mounts (`heading Customers`), reaches its error state
(`Failed to load customers`), and that clicking the next-page link drives the URL to
`?page=2` with the control reading `Page 2`. This is what forced the ungated `<Pagination>`
described above.

**2. Gate 9's pattern collides with a Playwright API name — `toHaveAttribute` matches
`attribut`.** My first version of the deep-link test asserted the Previous link's
`aria-disabled` with `toHaveAttribute`, and Gate 9 failed on it (exit 0, one hit at
`pages.spec.ts:74`). This is a false positive — the word comes from Playwright, not from
reading domain-expert — but the gate must be clean, so the assertion was replaced with a
stronger one that does not need the word: **click** Previous and assert the URL walks back
to `?page=3`. Worth recording for Part 2: any changed file that uses `toHaveAttribute`,
`getAttribute` or `setAttribute` will trip Gate 9.

**3. Test 6's request count is measured with a listener plus a `waitForRequest`.**
`page.waitForRequest` alone can only observe one request, and registering a second one after
the first resolves would race. A `page.on('request')` listener and the `waitForRequest`
promise are both installed **before** `page.goto`, per the plan's ordering rule; the count is
then polled to `2` and every URL is checked to carry `page=4`. Measured: exactly 2, as the
plan predicted for StrictMode's double-invoke.

**4. Nothing else.** No `client/src/lib/useApi.ts` change, no repo-root `tsconfig.json`, no
new files, no Part 2 work.

## Rename: `D` + `A`, not `R`

As the plan anticipated. The `git mv` staged as `R` (`git status` showed
`RM client/src/pages/pagination-page.tsx -> client/src/pages/customers-page.tsx`), but the
rewrite falls below Git's similarity threshold, so `git diff --name-status 08f7e51..HEAD`
reports `D client/src/pages/pagination-page.tsx` + `A client/src/pages/customers-page.tsx`.
Both are acceptable for Gate 10.

---

# The ten gates

All from a clean tree, at `18d5d61`.

## Gate 1 — `dotnet build server --no-incremental`

```
  Determining projects to restore...
  All projects are up-to-date for restore.
  Server -> ~/Developer/northwind-fullstack/server/bin/Debug/net10.0/Server.dll

Build succeeded.
    0 Warning(s)
    0 Error(s)

Time Elapsed 00:00:00.94
```

## Gate 2 — `npx tsc -b --force` in `client/`

```
tsc exit=0
```
(no output, exit 0)

## Gate 3 — `npm run build`

```
vite v8.2.2 building client environment for production...
dist/assets/index-CzVZLvxs.css                              73.20 kB │ gzip:  12.57 kB
dist/assets/index-MzL24UXY.js                              659.16 kB │ gzip: 209.97 kB
✓ built in 184ms
(!) Some chunks are larger than 500 kB after minification. …
```

Clean. Bundle moved **657.74 kB / `index-BdX0NRz9.js` → 659.16 kB / `index-MzL24UXY.js`**,
which is expected for this phase and not a regression. The >500 kB chunk notice is the
pre-existing Vite advisory, present in every prior phase.

## Gate 4 — `npm run lint` — exactly 7 warnings, none new

```
> client@0.0.0 lint
> oxlint

src/lib/markdown.ts:83:7: warning eslint(no-unused-expressions): Expected expression to be used
src/components/ui/button.tsx:67:18: warning react(only-export-components): …
src/lib/useApi.ts:23:5: warning react(set-state-in-effect): …
src/pages/form-page.tsx:82:22: warning react(incompatible-library): …
src/components/ui/navigation-menu.tsx:163:3: warning react(only-export-components): …
src/components/ui/carousel.tsx:239:3: warning react(only-export-components): …
src/components/ui/carousel.tsx:96:5: warning react(set-state-in-effect): …
```

`npm run lint 2>&1 | grep -c warning` → **7**. Same seven `file:line` + rule pairs as the
B2a baseline, in a different print order (oxlint is parallel). `lib/useApi.ts:23`
`set-state-in-effect` is still among them, as required.

## Gate 5 — `npm audit` in `client/`

```
found 0 vulnerabilities
```

## Gate 6 — `DEBUG=pw:webserver npm run e2e` — 10/10

Both ports cleared first with two separate single-port `lsof` calls (`lsof -ti :5170`,
`lsof -ti :5173` — both reported `none`, nothing to kill), so nothing could be served off a
stale server.

Handshake — both servers provably *started*, not reused:

```
pw:webserver Error while checking if http://localhost:5170/api/hello is available: connect ECONNREFUSED ::1:5170
pw:webserver Error while checking if http://localhost:5170/api/hello is available: connect ECONNREFUSED ::1:5170
pw:webserver Error while checking if http://localhost:5170/api/hello is available: connect ECONNREFUSED ::1:5170
pw:webserver Error while checking if http://localhost:5170/api/hello is available: connect ECONNREFUSED ::1:5170
pw:webserver HTTP Status: 200
pw:webserver Error while checking if http://localhost:5173/ is available: connect ECONNREFUSED ::1:5173
pw:webserver Error while checking if http://localhost:5173/ is available: connect ECONNREFUSED ::1:5173
pw:webserver HTTP Status: 200
```

Results:

```
  ✓   3 [chromium] › e2e/pages.spec.ts:4:3 › guide (bento README) › renders the parsed README as cards and proves the server pipe (592ms)
  ✓   9 [chromium] › e2e/pages.spec.ts:83:3 › dos & don'ts › renders every rule with a Don't/Do pair (692ms)
  ✓   4 [chromium] › e2e/pages.spec.ts:35:3 › form › submits a valid form to the server (724ms)
  ✓   2 [chromium] › e2e/pages.spec.ts:16:3 › carousel › advances slides and updates the counter (867ms)
  ✓  10 [chromium] › e2e/pages.spec.ts:102:3 › orders › mounts and reports the failed orders request (914ms)
  ✓   7 [chromium] › e2e/pages.spec.ts:110:3 › categories › mounts and reports the failed reference-data request (930ms)
  ✓   1 [chromium] › e2e/pages.spec.ts:27:3 › form › shows zod errors for invalid input (934ms)
  ✓   6 [chromium] › e2e/pages.spec.ts:58:3 › customers › deep-links to a page via the URL (957ms)
  ✓   8 [chromium] › e2e/pages.spec.ts:94:3 › products › mounts and reports the failed catalogue request (1.4s)
  ✓   5 [chromium] › e2e/pages.spec.ts:49:3 › customers › mounts, reports the failed request and pages by clicking a link (1.5s)

  10 passed (4.9s)
```

The log is full of `SQLite Error 1: 'no such table: Customers'` / `Products` /
`Categories` developer-exception pages — that is the no-database standing decision working
as designed, and every screen reaching its error state is what tests 5, 6, 8, 9 and 10
assert.

## Gate 7 — `git status --porcelain`

```
$ git status --porcelain
(status exit 0)
```

Empty. No stray `*.db` / `-shm` / `-wal`.

## Gate 8 — package/lockfile diff

```
$ git diff --name-status main..HEAD -- package.json package-lock.json client/package.json client/package-lock.json
(exit 0)
$ git diff --name-status a34564c..HEAD -- package.json package-lock.json client/package.json client/package-lock.json
(exit 0)
```

Both empty. Positive control that the range is not itself empty:
`git diff --name-only main..HEAD | wc -l` → **42**. No `npm install` was run at any point —
only `npm run build`, `npm run lint`, `npm audit`, `npm run e2e`, `npx tsc`.

## Gate 9 — vocabulary grep, **with positive control**

Paths written out longhand (no variable), so the B2a fake-pass cannot recur.

Negative (the forbidden vocabulary):

```
$ grep -rniE 'extract|attribut|walker|fixture|testbed|domain-expert|psq|analy' \
    README.md client/e2e/pages.spec.ts client/e2e/screenshots.spec.ts \
    client/src/hooks/use-customers.ts client/src/pages/customers-page.tsx \
    client/src/pages/dos-donts-page.tsx client/src/routes.tsx \
    client/src/services/customers.ts server/Endpoints/NorthwindEndpoints.cs server/Program.cs
grep exit=1
```

Exit 1, no output — genuinely clean.

Positive control, the identical command with `product` as the pattern:

```
$ grep -rniE 'product' <the same ten paths, longhand>
client/e2e/screenshots.spec.ts:17:  { route: '/products', name: 'products' },
client/e2e/pages.spec.ts:93:test.describe('products', () => {
client/e2e/pages.spec.ts:95:    await page.goto('/products')
client/e2e/pages.spec.ts:96:    await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible()
client/e2e/pages.spec.ts:97:    await expect(page.getByText(/Failed to load products/)).toBeVisible()
client/src/routes.tsx:6:import { ProductsPage } from '@/pages/products-page'
client/src/routes.tsx:27:  { path: '/products', label: 'Products', Component: ProductsPage },
server/Endpoints/NorthwindEndpoints.cs:51:        routes.MapGet("/api/products", …
server/Endpoints/NorthwindEndpoints.cs:56:            var query = db.Products.AsQueryable();
server/Endpoints/NorthwindEndpoints.cs:62:            var ordered = query.OrderBy(p => p.ProductId);
server/Endpoints/NorthwindEndpoints.cs:68:                .Select(p => new ProductDto(…
grep exit=0
```

The command matches when there is something to match, so exit 1 above means "no matches",
not "broken invocation". `client/public/screenshots/pagination.png` is excluded from both
runs: it is deleted, and it was a binary file.

Note the one real hit this gate caught during the run — `toHaveAttribute` matching
`attribut` — and how it was resolved: see Deviation 2.

## Gate 10 — `git diff --name-status 08f7e51..HEAD`

```
M	README.md
M	client/e2e/pages.spec.ts
M	client/e2e/screenshots.spec.ts
D	client/public/screenshots/pagination.png
M	client/src/hooks/use-customers.ts
A	client/src/pages/customers-page.tsx
M	client/src/pages/dos-donts-page.tsx
D	client/src/pages/pagination-page.tsx
M	client/src/routes.tsx
M	client/src/services/customers.ts
M	server/Endpoints/NorthwindEndpoints.cs
M	server/Program.cs
```

12 lines = the 11 entries of Part 1's Files touched list, with the rename split into `D`+`A`.
Nothing extra, nothing missing. Base is `08f7e51`, as required.

---

## Open risks

1. **Test 5 and 6 assert against the error path.** They are correct today and would need a
   second look if a database is ever seeded — the success branch of the customers page
   (rows, `Page N of M`, Next disabled on the last page) is compiled and type-checked but
   never executed by the suite. That is inherent to the no-database standing decision, not
   new to this change.
2. **`/api/customers?search=` is proven only as far as SQL generation.** `instr(lower(…))`
   was read off the live server's EF log; no row has ever been filtered, because there are
   no rows.
3. **`useCustomers` still shows the previous page's rows while a new page loads** (no `key`
   remount on the customers page). Invisible with no database. It is the same class of issue
   as Part 2 step 7a, which fixes it centrally in `use-products.ts`; if that pattern is
   liked, `use-customers.ts` is the obvious second application — but it is outside Part 1's
   scope and I did not touch it.
4. **Gate 9 will fire on `toHaveAttribute`/`getAttribute`** in any changed file. Part 2 does
   not obviously need one, but it is a live tripwire.
5. **Four screenshots referenced by nothing and one README image line removed.**
   `screenshots.spec.ts` now names `customers`, `products`, `orders`, `categories` PNGs that
   do not exist; `npm run shots` is barred, so they appear only when the user authorises a
   run. No README line points at any of them, so no docs link is broken today.

---

# Review fixes (round 2)

Verdict on `18d5d61` was **Ship with edits**: two blocking false sentences and two
non-blocking items. All four are folded in. Commit **amended** — the branch tip is now
**`994aff2`**, still one commit on `b2-northwind-client`, same base `08f7e51`, same twelve
`--name-status` lines. Not pushed, not tagged. No file outside Part 1's list was touched, and
nothing from Part 2 was started.

## What changed

**BLOCKING 1 — the "one of two kinds" universal, in both places.**
`client/src/pages/dos-donts-page.tsx:99` and its mirror at `README.md:232-235` claimed every
effect in the app was an abort-safe fetch or the embla subscription. The reviewer's three
counter-examples are real (`theme-controls.tsx:54` timer teardown, `theme-controls.tsx:205`
interval + `visibilitychange`, `reference-data-provider.tsx:22` ignore-flag fetch that
cannot abort because `services/reference.ts:9` `getJson` takes no signal). Rather than
substitute a more careful census — the thing that keeps breaking — both now state the rule
the page teaches and count nothing:

- card: *"Those three questions are the review an effect has to pass before it is added here
  — the same review generated code needs and rarely gets."*
- README Step 12: *"The rule the page teaches is the one the app is written against: an
  effect earns its place by synchronizing with a system outside React, it cleans up after
  itself, and anything an event handler could do belongs in the handler. Values that can be
  derived during render are derived during render."*

No claim about how many effects exist, and no claim over the whole set.

**BLOCKING 2 — `dos-donts-page.tsx:74`, "every fetch in this app aborts in its cleanup".**
False for the four reference endpoints and for the module-scope `categoriesPromise`. Reworded
to the rule matching the card's own title ("make stale responses impossible"): *"This is
src/lib/useApi.ts, and the hooks in src/hooks follow it line for line: a fetch effect has to
abort its request or ignore the answer it no longer wants, so the older response can never
win."* The `src/hooks` half was left as the reviewer said — both hooks do abort.

**NON-BLOCKING 3 — history spam, `client/src/pages/customers-page.tsx`.** `navigate()` now
ends `setSearchParams(params, { replace: nextQuery !== search })`: editing the search term
replaces, turning a page still pushes. The behaviour was fixed, not the prose — and the fix
makes the prose true in the strong sense, because with per-keystroke entries replaced, the
entry behind a search *is* the unsearched screen, so one Back undoes the whole search
exactly as `customers-page.tsx:17` and `README.md:212-213` say.

**NON-BLOCKING 4 — `server/Endpoints/NorthwindEndpoints.cs:16-20`.** The collation comment
now gives the true reason and the true cost: lowering both sides makes the match
collation-independent rather than leaving case sensitivity to the column's collation, at the
price of any index on `CompanyName`, since a function on the column stops the database using
it.

**Untouched, as instructed:** `use-customers.ts:11-13`'s docblock (Part 2 step 7a retargets
it) and the ungated `<Pagination>`.

`dos-donts-page.tsx` still holds **exactly 6 rules** (`grep -c "^  {$"` → 6, no title
changed). README keeps the literal-em-dash `Step N — Title` format, all titles unique, and
test 1's four anchors untouched. Both files edited in place by literal string replacement —
no Markdown parser, no re-serialization; both remain pure LF.

## Re-run gates

### Gate 4 — `npm run lint` — exactly 7, none new

```
src/lib/markdown.ts:83:7: warning eslint(no-unused-expressions): Expected expression to be used
src/pages/form-page.tsx:82:22: warning react(incompatible-library): Use of incompatible library
src/components/ui/navigation-menu.tsx:163:3: warning react(only-export-components): …
src/components/ui/button.tsx:67:18: warning react(only-export-components): …
src/lib/useApi.ts:23:5: warning react(set-state-in-effect): …
src/components/ui/carousel.tsx:239:3: warning react(only-export-components): …
src/components/ui/carousel.tsx:96:5: warning react(set-state-in-effect): …
```

`grep -c warning` → **7**. Same seven file:line + rule pairs; `lib/useApi.ts:23` still there.

### Gate 6 — `DEBUG=pw:webserver npm run e2e` — 10/10

Ports cleared first, two separate single-port calls, both already free:

```
port 5170 before: none
port 5173 before: none
port 5170 after: none
port 5173 after: none
```

Handshake — both servers started, neither reused:

```
pw:webserver Error while checking if http://localhost:5170/api/hello is available: connect ECONNREFUSED ::1:5170
pw:webserver Error while checking if http://localhost:5170/api/hello is available: connect ECONNREFUSED ::1:5170
pw:webserver Error while checking if http://localhost:5170/api/hello is available: connect ECONNREFUSED ::1:5170
pw:webserver Error while checking if http://localhost:5170/api/hello is available: connect ECONNREFUSED ::1:5170
pw:webserver HTTP Status: 200
pw:webserver Error while checking if http://localhost:5173/ is available: connect ECONNREFUSED ::1:5173
pw:webserver Error while checking if http://localhost:5173/ is available: connect ECONNREFUSED ::1:5173
pw:webserver HTTP Status: 200
```

```
  ✓   6 [chromium] › e2e/pages.spec.ts:16:3 › carousel › advances slides and updates the counter (669ms)
  ✓   5 [chromium] › e2e/pages.spec.ts:4:3 › guide (bento README) › renders the parsed README as cards and proves the server pipe (687ms)
  ✓   9 [chromium] › e2e/pages.spec.ts:83:3 › dos & don'ts › renders every rule with a Don't/Do pair (726ms)
  ✓   4 [chromium] › e2e/pages.spec.ts:27:3 › form › shows zod errors for invalid input (773ms)
  ✓   2 [chromium] › e2e/pages.spec.ts:58:3 › customers › deep-links to a page via the URL (868ms)
  ✓   8 [chromium] › e2e/pages.spec.ts:35:3 › form › submits a valid form to the server (1.2s)
  ✓   1 [chromium] › e2e/pages.spec.ts:110:3 › categories › mounts and reports the failed reference-data request (1.3s)
  ✓  10 [chromium] › e2e/pages.spec.ts:102:3 › orders › mounts and reports the failed orders request (1.3s)
  ✓   7 [chromium] › e2e/pages.spec.ts:49:3 › customers › mounts, reports the failed request and pages by clicking a link (1.4s)
  ✓   3 [chromium] › e2e/pages.spec.ts:94:3 › products › mounts and reports the failed catalogue request (1.5s)

  10 passed (4.9s)
```

Test 7 (`Don't`/`Do` ×6) passes with the reworded card, confirming the rules array is intact.
Test 5 still pages by clicking with `{ replace: true }` now in play — it only ever replaces
on the `q` path, and test 5 changes `page`, which still pushes.

### Gate 9 — vocabulary grep, with positive control

Paths longhand, both runs identical but for the pattern:

```
$ grep -rniE 'extract|attribut|walker|fixture|testbed|domain-expert|psq|analy' <ten paths>
grep exit=1
$ grep -rniE 'product' <the same ten paths> | wc -l
      20
grep exit=0
```

Clean, and proven live by the control (20 matching lines, up from 11 before — the earlier
figure was a `head -12`-truncated listing, this one is the full count).

### Also re-run, since C# and TS both changed

- Gate 1 `dotnet build server --no-incremental` — **0 Warning(s), 0 Error(s)**.
- Gate 2 `npx tsc -b --force` — **exit 0** (the `{ replace }` overload of `setSearchParams`
  type-checks).
- Gate 7 `git status --porcelain` — empty.
- Gate 10 `git diff --name-status 08f7e51..HEAD` — the same twelve lines as before, unchanged.

Gates 3, 5 and 8 were not re-run: no dependency, lockfile or bundle input changed in this
round beyond comment and string text already covered by the build in the first pass.

## Open risks — one added

6. **The rewritten sentences now describe a rule, not the tree.** That is what makes them
   safe from a counter-example, but it also means nothing in the suite can catch it if the
   app later stops following the rule. The claim is a commitment, not a measurement.

---

# Review fixes (round 3)

Re-review of `994aff2`: **Ship with edits** — both original blocking items confirmed closed,
one new blocking item introduced by round 2's non-blocking 3. Fixed and verified in a real
browser. Commit amended again; branch tip is now **`955a680`**, still one commit on
`b2-northwind-client`, base `08f7e51`, same twelve `--name-status` lines. Not pushed, not
tagged.

## BLOCKING — the first keystroke destroyed the unsearched entry

Round 2's `{ replace: nextQuery !== search }` replaced on *every* search edit, including the
first, so the unsearched `/customers` entry was overwritten the moment a user typed one
character. My claim that "the entry behind a search is the unsearched screen" was reasoning
from the code, and it was wrong. Applied the reviewer's fix at
`client/src/pages/customers-page.tsx:39`:

```ts
setSearchParams(params, { replace: nextQuery !== search && search !== '' })
```

I also reworded the comment above it, which round 2 had left describing the broken rule
("editing the search replaces instead"). It now says starting a search pushes — that entry is
the unsearched list — and only editing an existing search replaces.

## Verified in a browser, not by reading the code

Driven with a headless Chromium script against the dev servers running on 5170/5173
(script lived in the scratchpad, not in the repo; the tree stayed clean throughout).
Observed URL after each Back:

| scenario | before round 3 | observed now |
|---|---|---|
| 1. Guide → `/customers`, type "alf", Back ×1 | `/` | **`/customers`** ✓ |
| 2. `/customers?q=alf` deep link, edit to "alfred", Back ×1 | leaves the screen | `/customers?q=alfred` → `/` (unchanged — see below) |
| 2b. `/customers`, type "alf" then edit to "alfred", Back ×1 | — | `/customers?q=alfred` → **`/customers`** ✓ |
| 3. `/customers`, search "al", Next, Back ×1 | `?page=2&q=al` → `?q=al` ✓ | `/customers?page=2&q=al` → **`/customers?q=al`** ✓ |
| 4. `/customers?q=alf` deep link, Clear search, Back ×1 | leaves the screen | `/customers` → `/` (unchanged — see below) |
| 4b. `/customers`, type "alf", Clear search, Back ×1 | — | `/customers` → **`/customers`** ✓ |

Rows 1 and 3 are the reviewer's scenarios and both now behave as the prose claims. Rows 2 and
4 still leave the customers screen, and that is **correct, not a residual bug**: they start by
deep-linking straight to `?q=alf`, so there has never been an unsearched list in that tab's
history to go back to — Back goes wherever the user actually came from. Rows 2b and 4b are
the same two scenarios entered the way a user reaches them (typing on the list), and there one
Back lands on the unsearched list exactly as claimed.

A first pass of the harness ran rows 2 and 4 in a fresh context whose only history entry was
the deep link itself, so Back reported `about:blank`; I re-ran all of them with the guide page
loaded first, which is why the table above says `/` rather than `about:blank`. Recording the
mis-measurement rather than only the corrected number.

**Conclusion: the prose stands as written**, so `customers-page.tsx:16-18` and
`README.md:212-213` were left alone — "the back button undoes a search for free" is now true
for the flow those sentences describe. No third mechanism was invented.

## Gate 3's figure — my round-2 reasoning was wrong

I skipped gate 3 in round 2 on the grounds that only comment and string text had changed. The
reviewer measured `659.25 kB` / `index-hOcMMDC_.js` at `994aff2` — it had moved from
`18d5d61`'s `659.16 kB` / `index-MzL24UXY.js`, because comment and string text are bundle
input like anything else. Gate 3 is now re-run every round.

**Current figure, measured at `955a680`:**

```
vite v8.2.2 building client environment for production...
dist/assets/index-CzVZLvxs.css                              73.20 kB │ gzip:  12.57 kB
dist/assets/index-CW33IDHv.js                              659.26 kB │ gzip: 210.04 kB
✓ built in 182ms
```

**`659.26 kB` / `dist/assets/index-CW33IDHv.js`**, CSS unchanged at 73.20 kB. This supersedes
both `659.16 kB` / `index-MzL24UXY.js` and the reviewer's `659.25 kB` / `index-hOcMMDC_.js`;
no earlier hash should be carried forward. Gates 5 and 8 remain correctly skipped — no
dependency or lockfile is in the diff.

## Re-run gates

### Gate 3 — `npm run build`

Clean; figures above.

### Gate 4 — `npm run lint` — exactly 7, none new

```
src/lib/markdown.ts:83:7: warning eslint(no-unused-expressions): Expected expression to be used
src/lib/useApi.ts:23:5: warning react(set-state-in-effect): …
src/pages/form-page.tsx:82:22: warning react(incompatible-library): Use of incompatible library
src/components/ui/button.tsx:67:18: warning react(only-export-components): …
src/components/ui/navigation-menu.tsx:163:3: warning react(only-export-components): …
src/components/ui/carousel.tsx:239:3: warning react(only-export-components): …
src/components/ui/carousel.tsx:96:5: warning react(set-state-in-effect): …
```

`grep -c warning` → **7**. Same seven file:line + rule pairs, `lib/useApi.ts:23` included.

### Gate 6 — `DEBUG=pw:webserver npm run e2e` — 10/10

Ports cleared first with two separate single-port calls. This time they were **not** free —
the manual dev servers from the browser verification were still up — so the kill did real
work, which is exactly the case `reuseExistingServer: true` would have silently exploited:

```
port 5170 before: 50804
port 5173 before: 50803
port 5170 after: none
port 5173 after: none
```

Handshake, both servers started fresh by Playwright:

```
pw:webserver Error while checking if http://localhost:5170/api/hello is available: connect ECONNREFUSED ::1:5170
pw:webserver Error while checking if http://localhost:5170/api/hello is available: connect ECONNREFUSED ::1:5170
pw:webserver Error while checking if http://localhost:5170/api/hello is available: connect ECONNREFUSED ::1:5170
pw:webserver HTTP Status: 200
pw:webserver Error while checking if http://localhost:5173/ is available: connect ECONNREFUSED ::1:5173
pw:webserver Error while checking if http://localhost:5173/ is available: connect ECONNREFUSED ::1:5173
pw:webserver HTTP Status: 200
```

```
  ✓   7 [chromium] › e2e/pages.spec.ts:83:3 › dos & don'ts › renders every rule with a Don't/Do pair (633ms)
  ✓   4 [chromium] › e2e/pages.spec.ts:27:3 › form › shows zod errors for invalid input (677ms)
  ✓   2 [chromium] › e2e/pages.spec.ts:16:3 › carousel › advances slides and updates the counter (689ms)
  ✓   8 [chromium] › e2e/pages.spec.ts:4:3 › guide (bento README) › renders the parsed README as cards and proves the server pipe (724ms)
  ✓  10 [chromium] › e2e/pages.spec.ts:58:3 › customers › deep-links to a page via the URL (917ms)
  ✓   9 [chromium] › e2e/pages.spec.ts:94:3 › products › mounts and reports the failed catalogue request (1.0s)
  ✓   3 [chromium] › e2e/pages.spec.ts:35:3 › form › submits a valid form to the server (1.1s)
  ✓   6 [chromium] › e2e/pages.spec.ts:110:3 › categories › mounts and reports the failed reference-data request (1.1s)
  ✓   1 [chromium] › e2e/pages.spec.ts:49:3 › customers › mounts, reports the failed request and pages by clicking a link (1.2s)
  ✓   5 [chromium] › e2e/pages.spec.ts:102:3 › orders › mounts and reports the failed orders request (1.4s)

  10 passed (4.2s)
```

### Also re-run

`npx tsc -b --force` — exit 0. `git status --porcelain` — empty. Gate 10 unchanged, the same
twelve lines. Gate 9 not re-run: no changed-file list change and no new text matching the
pattern (the round-3 edits add no `attribut`-family word).

## Open risks — two added

7. **README's closing "Values that can be derived during render are derived during render"
   is an indicative claim about the tree, not a rule.** The reviewer checked every `useState`
   in `client/src` and none mirrors a prop or other state, so it holds today — but only by
   hand-check, and nothing in the suite would catch it going stale. Watched, deliberately not
   fixed.
8. **The history behaviour is verified by hand, not by a test.** The four scenarios above
   were driven through a scratchpad script that is not part of the repo, so a future change to
   `navigate()` can silently reintroduce the round-2 defect. The e2e suite covers the paging
   push (test 5) but nothing asserts the search push/replace split.
