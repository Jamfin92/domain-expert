# Phase B2b Part 1 (Northwind testbed — deletions to green) — progress

Status: **SHIPPED, reviewer verdict "Ship" after three review rounds,
2026-09-01. Not pushed. Not tagged. `main` untouched.**

Do not re-explore. Everything below was measured by re-running, not recalled —
the reviewer re-ran every gate itself in each round rather than trusting the
audit, and drove a real browser for the history behaviour.

- Approved plan: `plan-b2b.md` (**revision 2**; rev 1 was rejected by the
  reviewer with eight blocking issues — see "Why rev 1 was rejected").
- Implementer audit with full output for all three rounds: `audit-b2b-1.md`.
- B2a's record is `progress-b2a.md`; B1's is `progress.md`. Both still accurate.
- **Part 2 is written and approved in outline in `plan-b2b.md`. Start there.**

## What shipped

Branch `b2-northwind-client`, commit **`955a680`**, base **`08f7e51`**.
`git diff --name-status 08f7e51..955a680` = **12 lines**, exactly Part 1's
Files touched list.

Renamed (landed as `D`+`A`, as the plan predicted — a full rewrite falls below
Git's similarity threshold):
`client/src/pages/pagination-page.tsx` → `client/src/pages/customers-page.tsx`

Modified: `client/src/routes.tsx`, `client/src/services/customers.ts`,
`client/src/hooks/use-customers.ts`, `client/src/pages/dos-donts-page.tsx`,
`client/e2e/pages.spec.ts`, `client/e2e/screenshots.spec.ts`,
`server/Program.cs`, `server/Endpoints/NorthwindEndpoints.cs`, `README.md`.

Deleted: `client/public/screenshots/pagination.png`.

**The `Packages` feature is gone** — route, `record Package`, `static class
Packages`. `/api/packages` 404s. `/api/hello` and `/api/contact` are
byte-identical to `08f7e51` (0 added lines in `Program.cs`), which matters
because `/api/hello` is Playwright's readiness probe on 5170.

**The customers search is real end to end**, not a decorative box.
`/api/customers` gained an optional `search` parameter; verified live against a
running server, it generates
`WHERE instr(lower("c"."CompanyName"), @term) > 0` and 500s only on the missing
table. Service → hook → page → `?q=` all carry it.

## Verified end state (reviewer reproduced all of it by running)

- `dotnet build server --no-incremental` — 0 warnings, 0 errors.
- `npx tsc -b --force` — exit 0.
- `npm run build` — clean. **Bundle is `659.26 kB` / `dist/assets/index-CW33IDHv.js`,
  CSS `73.20 kB` / `index-CzVZLvxs.css`.** These are the current figures.
  Phase A's `647.18 kB`, B2a's `657.74 kB`, and the two intermediate readings
  (`659.16`/`index-MzL24UXY`, `659.25`/`index-hOcMMDC_`) are all retired.
- `npm run lint` — **exactly 7** warnings, the same seven `file:line`+rule pairs
  as the B2a baseline, with `src/lib/useApi.ts:23 set-state-in-effect` among them.
- `npm audit` — 0 vulnerabilities.
- `DEBUG=pw:webserver npm run e2e` — **10/10**, genuine handshake
  (`ECONNREFUSED`×3 → `HTTP Status: 200` on 5170, ×2 → `200` on 5173).
- `git status --porcelain` — empty, before and after every run.
- Package/lockfile diff — empty for `main..HEAD` and `08f7e51..HEAD`
  (positive control: 42 files in `main..HEAD`).
- Vocabulary grep — exit 1, with a positive control matching (26 hits on
  `customer`).

## The ten e2e tests

1-4 unchanged. **5** and **6** rewritten from `/pagination` to `/customers`
(mount + `Failed to load customers` + click-next drives `?page=2`; and the
`?page=4` deep link, `waitForRequest` before `goto`, expecting 2 requests for
StrictMode's double-invoke). **7** unchanged — still asserts `"Don't"` and
`"Do"` appear exactly 6 times, and `dos-donts-page.tsx`'s `rules` array still
has exactly 6 entries. **8, 9, 10** new: `/products`, `/orders`, `/categories`,
each asserting mount, heading, error state only.

No test asserts rendered rows. There is no database; every Northwind route
500s. Standing decision, not a gap.

## Five traps that cost real time — do not rediscover them

1. **Gate 9's own pattern collides with Playwright.** `attribut` matches
   `toHaveAttribute`, so a legitimate deep-link assertion failed the vocabulary
   gate on the test framework's own API name. It was replaced with a stronger
   assertion (click Previous, expect the URL at `?page=3` plus `Page 3`) that
   exercises the handler, the URL write and the re-render. **Any Part 2 file
   using `toHaveAttribute`/`getAttribute` will trip this.**
2. **The `reuseExistingServer` trap fired for real this round.** 5170/5173 were
   still held by the implementer's own browser-verification servers when e2e
   started, and again by the reviewer's probe servers. Documented since B1;
   this is the first time it would actually have served a green run off the
   wrong server. Always clear both ports (two single-port `lsof` calls —
   `lsof -ti :5170 :5173` errors on this machine, lsof 4.91).
3. **A browser harness can be incapable of a positive result.** The first
   history-verification pass ran the deep-link scenarios in a fresh context
   whose *only* entry was the deep link, so Back reported `about:blank` — a
   harness artifact, not app behaviour. Re-run with the guide loaded first. Same
   principle as the grep positive control: a negative from a probe that could
   never have gone positive is worth nothing.
4. **Comment and string text ARE bundle input.** Gate 3 was skipped in round 2
   on the reasoning that only comments changed; the hash and size had in fact
   moved. Re-run `npm run build` after prose-only edits, or a stale hash goes
   into the record.
5. Still live from B1/B2a: `npm ci` never `npm install`; do not round-trip
   JSON/Markdown through a parser; `node`/`npm` are not on `PATH` (use
   `~/.local/share/fnm/node-versions/v24.19.0/installation/bin`).

## The standing prose rule — adopted this phase

**Prose may quantify only over a directory the audit enumerates; anything wider
is stated as a rule, not as a census.**

This came out of three rounds on the same two sentences. `dos-donts-page.tsx:99`
originally claimed "exactly two effects"; the fix replaced it with "every effect
is one of two kinds", which was a *new* universal and also false
(`theme-controls.tsx:54`, `theme-controls.tsx:205`,
`reference-data-provider.tsx:22` — the last being a fetch effect that cannot
abort, since `services/reference.ts:9` `getJson` takes no `AbortSignal`). The
second fix removed the quantifier rather than recounting. Likewise
`dos-donts-page.tsx:74`'s "every fetch aborts in its cleanup" became "abort **or
ignore**", which covers the reference provider's `current` flag.

The reviewer's reasoning for accepting normative wording: a sentence whose
extension is the whole tree cannot be kept true by prose discipline — the
enforceable form of "the app follows this rule" is a lint rule, not a card.
The surviving quantified claim is over `src/hooks` (2 files, both matching
`useApi`'s shape), which an audit can enumerate.

## Decisions made — do not re-open

1. **`customers-page.tsx` renders `<Pagination>` ungated**, unlike
   `products/product-list.tsx:62` which gates on `status === 'success'`.
   Reviewed explicitly as "is this shaping the app to fit the test?" and
   accepted as honest: the page number comes from the URL and is genuinely known
   before any response, so only the upper bound waits (`totalPages === null` →
   "Page 4" rather than "Page 4 of 12"). A real user sees this during loading.
   **Part 2 Step 9a must reconcile the two conventions or explain the
   divergence in `product-list.tsx`** — a reader diffing the two files currently
   gets no answer.
2. **The search push/replace split is deliberate.**
   `setSearchParams(params, { replace: nextQuery !== search && search !== '' })`
   — the first search edit pushes over the unsearched screen, later edits
   replace, page turns push. The `&& search !== ''` clause is load-bearing:
   without it the first keystroke destroys the unsearched entry and Back lands
   on `/`.
3. **"The back button undoes a search for free" is true as written** and both
   `customers-page.tsx:16-18` and `README.md:212-213` were correctly left alone.
   Adjudicated behaviourally: in every session where the user *performed* a
   search, one Back lands on the unsearched list. The deep-link cases leave the
   screen because no unsearched list ever existed in that tab's history — making
   Back synthesise a state that never existed would be a History API bug.
4. Unchanged from earlier phases: no database; mixed request-wrapper style,
   deliberately; testbed written as an app, not a fixture; `useApi.ts` survives
   for the guide page's `/api/hello` card; no commits on `main`; do not tag;
   `npm run shots` barred; no repo-root `tsconfig.json` (Phase C1 targets
   `client/tsconfig.json`).

## Open risks (logged, not fixed)

- **Nothing in the e2e suite asserts the search push/replace split.** It is
  verified only by hand, in a browser. A future change to `navigate()` can
  silently reintroduce the round-2 defect where Back walks off the page.
- **README's "values that can be derived during render are derived during
  render" is still an indicative claim about the tree.** It holds today — every
  `useState` in `client/src` was checked and none mirrors a prop or other state
  — but only by hand-check.
- **The reworded prose is now normative, so nothing in the suite catches the app
  drifting away from it.** Accepted as the better of two states; see the prose
  rule above.
- Cosmetic: after Clear search, Back moves to a history entry with the same URL
  (`/customers` → `/customers`), so it reads as a no-op. Correct given clear
  replaces; not worth a change.

## Review history — three rounds, each found something real

- **Round 1 (`18d5d61`)** — "Ship with edits". Two blocking, both prose, both on
  the exact lines Step 3 existed to correct. Everything mechanical reproduced.
- **Round 2 (`994aff2`)** — "Ship with edits". The prose was properly fixed, but
  a *non-blocking* fix folded into that round (history `replace`) introduced a
  new blocking defect, making the Back-button prose false in a worse direction
  than before. Caught only because the reviewer drove a browser instead of
  reading the code.
- **Round 3 (`955a680`)** — "Ship". One-line fix, six scenarios verified in a
  real browser by both implementer and reviewer independently.

**The lesson worth carrying:** three phases running, the mechanics have been
sound and the *comments* have been where it slips. Part 2 is almost entirely
comment-honesty work. Be more sceptical of it than of the code.

## Why rev 1 of plan-b2b was rejected

Eight blocking issues: a gate base that spanned B2a and could never match
(`a34564c` instead of `08f7e51`); a `key`-remount fix with no child to apply it
to; a "bug" that was already guarded at `product-list.tsx:62`; a claim that
`ProductList` is presentational when it fetches at line 27 (following the plan
would have deleted the one component-attributed call site that file contributes);
an e2e count that summed to 11; a search box with no behaviour — **the rev-1
built-for-the-reader pattern recurring**; a `listEmployees` consumer that would
have broken its host's stated "holds no state and fetches nothing" contract; and
a README rule that forbade fixing a whole section about a deleted page.

## Next: Part 2 — honesty and bugs

`plan-b2b.md`, **Steps 6 through 9**. 13 files modified, 1 conditional. Touches
no gate threshold; the same ten gates must still pass, with base
`08f7e51..HEAD` now spanning both parts.

Step 6 — the three comment honesty rewrites (`services/reference.ts:31`; the
contradictory convention across `order-detail-panel.tsx:13`,
`orders-page.tsx:11-13` and `services/customers.ts:4-5`;
`customer-search-input.tsx:13`'s false `forwardRef` causal claim).
Step 7 — the real bugs (hook-level loading reset in `use-products.ts` rather
than a `key`; the swallowed `$`; URL-driven `products-page.tsx`; the dead
`: page` fallback, tidied and **not** reported as a fixed bug; `listEmployees`
into the reference-data provider, which makes it four reference endpoints for
the A5 requirement, not three).
Step 8 — the hardcoded "Eight categories"; the provider status union, with the
A5 unconditional-return requirement intact; **do not rename
`orders/product-list.tsx`** — the two same-named `ProductList`s are the
roadmap's most important shape.
Step 9 — carried from this review: reconcile the two pagers, retarget
`use-customers.ts:11-13`'s docblock.

Nothing from Part 1 is unfinished and no decision is outstanding.

## Housekeeping the next session should know

- **These `feature-research/` documents are UNTRACKED in the `domain-expert`
  repo** (`git status` shows `?? feature-research/northwind-testbed/`). A
  `git clean` would delete the entire phase record. Consider committing them.
- **The `scout`, `reviewer` and `implementer` agents are pinned to
  `qwen3.8:27b-64k`**, served by a local model gateway at `127.0.0.1:3001`. They
  only resolve when the session is launched via the `ccf` wrapper
  (`~/.local/bin/ccf`), which sets `ANTHROPIC_BASE_URL` after a health check.
  This session was started with plain `claude`, so every agent 404'd until
  launched with an explicit model override. The gateway itself was up and
  advertising the model throughout — the session was simply not pointed at it.
