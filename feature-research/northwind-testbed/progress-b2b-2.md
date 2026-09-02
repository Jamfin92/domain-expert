# Phase B2b Part 2 (Northwind testbed — honesty and bugs) — progress

Status: **SHIPPED AND ACCEPTED, reviewer verdict "Ship", 2026-09-01.**
Not pushed. Not tagged. `main` untouched.

Do not re-explore. Everything below was measured by re-running, not recalled —
the reviewer re-ran all ten gates itself in both rounds rather than trusting the
audit, and ran three positive controls of its own.

- Approved plan: `plan-b2b-2.md` (**hand-off revision 2**; rev 1 was rejected by
  the reviewer with nine blocking issues — see "Why rev 1 was rejected").
- Implementer audit, both rounds: `audit-b2b-2.md`.
  **Read its line citations with care: the file uses three baselines on purpose.**
  The `[falsifies]` section headers cite `955a680` (the pre-change tree, so the
  "before" text is findable), the fix-round headers cite `c2a234b` (pre-amend),
  and everything else cites `7cf5ecf`. That convention is now stated in the file
  itself. It was found by a post-review sweep that caught seven stale citations —
  two of which had drifted *before* the fix round, when Part 2's `hrefFor` pushed
  `customers-page.tsx` down twelve lines and left present-tense sentences behind.
  **Gates 1, 2 and 5 in that audit are labelled carried over, not re-run**, and
  gate 8's status was not recorded by the implementer; all ten were independently
  re-run by the reviewer at `7cf5ecf`, which is what actually backs them.
- Part 1's record is `progress-b2b-1.md`; B2a's is `progress-b2a.md`; B1's is
  `progress.md`. All still accurate.
- The outline this supersedes is `plan-b2b.md` Steps 6-9. **Prefer
  `plan-b2b-2.md` — the outline's line numbers are stale and three of its claims
  were wrong.**

## What shipped

Branch `b2-northwind-client`, commit **`7cf5ecf`** (an amend of `c2a234b`),
parent **`955a680`**, base **`08f7e51`**.

`git diff --name-only 955a680..7cf5ecf` = **15 files**, exactly the plan's Files
touched list. `git diff --name-status 08f7e51..HEAD` = **23 entries** (Part 1's
12 plus 11 new; four files appear in both parts and count once).

**Comment honesty (Step 6):** the false "first screen that renders" claim in
`services/reference.ts`; the contradictory three-way convention across
`order-detail-panel.tsx`, `orders-page.tsx` and `services/customers.ts`, replaced
by one placement rule stated once; the `forwardRef` causal claim in
`customer-search-input.tsx`.

**Real bugs (Step 7):** render-time reset in **both** `use-products.ts` and
`use-customers.ts` (fixes stale rows on category change *and* on page/search
change); the swallowed `$` in `products/product-list.tsx`; `products-page.tsx`
made URL-driven; `listEmployees` (previously zero consumers) wired through the
reference-data provider into an order-table label.

**Step 8:** the hardcoded "Eight categories" count removed; `failed: boolean`
replaced by a three-arm status union carrying `missing: ReferenceList[]`.

**Step 9:** both pagers on one convention, plus a keyboard range guard; the
`use-customers.ts` docblock retargeted to the mechanism that now exists.

**E2E 10 → 12.** Tests 1-10 are **byte-identical** (`40 added, 0 removed`).

## Verified end state (reviewer reproduced all ten gates, twice)

- `dotnet build server --no-incremental` — 0 warnings, 0 errors. Part 2 touched
  no server file.
- `npx tsc -b --force` — exit 0.
- `npm run build` — **`dist/assets/index-L7wpOmcH.js` 660.59 kB; CSS
  `index-CzVZLvxs.css` 73.20 kB.** These are the current figures. Part 1's
  `659.26 kB` / `index-CW33IDHv.js` is retired. **The CSS hash did not move
  across either part** — the new `<th>`/`<td>` reuse only existing Tailwind
  utilities.
- `npm run lint` — **exactly 7** warnings (the linter is **oxlint**, not ESLint),
  same seven `file:line`+rule pairs as the Part 1 baseline, with
  `src/lib/useApi.ts:23 set-state-in-effect` among them.
- `npm audit` — 0 vulnerabilities.
- `DEBUG=pw:webserver npm run e2e` — **12/12**, genuine two-port handshake.
- `git status --porcelain` — empty, before and after every run.
- Package/lockfile diff — empty for `main..HEAD` and `08f7e51..HEAD`
  (positive control: 42 files in `main..HEAD`).
- Vocabulary grep — exit 1, positive control (`product`) opened all 15 paths.
- `git diff --name-status 08f7e51..HEAD` — **exactly 23 entries.**

## The reviewer's own positive controls — the reason the green means something

This is the practice worth carrying, not just the result.

1. **Lint probe.** Moved the render-time reset into the effect body; oxlint fired
   `src/hooks/use-products.ts set-state-in-effect` (8 total). So the clean 7
   proves the shipped reset genuinely is not an effect — not that oxlint ignores
   `src/hooks`.
2. **Test mutation, twice.** Changed `customers-page.tsx`'s
   `{ replace: nextQuery !== search }` (dropping `&& search !== ''`) → **test 12
   failed** with `Received string: "about:blank"`. Broke the products param →
   **test 11 failed**. Both new tests can fail; they are not decorative.
3. **Reverse-applied patch rebuild.** For the fix round's claim that the bundle
   hash did not move, the reviewer reverse-applied the patch, rebuilt the pre-fix
   tree, and got a byte-identical bundle. **The claim was not accepted on
   reasoning.**
4. **Browser verification of 7c.** On `/products?category=3` the pager hrefs are
   `?category=3&page=2`; on `/customers?q=alf`, `?q=alf&page=2`. The filter and
   search term survive a middle-click.

## Decisions made — do not re-open

1. **The pager convention is ungated, with Next open until a known bound closes
   it.** Both pagers now share it. **Rev 1 of the plan proposed disabling Next
   when `totalPages === null` and that is unimplementable here:** with no
   database every route 500s, so `totalPages` is *permanently* null, not
   transiently. That rule would disable Next everywhere forever, break shipped
   test 5 (`pages.spec.ts:49-56` clicks Next **in the error state** and expects
   `?page=2`), and make new test 11 unwritable. Gating on `error` instead fails
   identically. **Any rule that disables Next on absent data kills pagination in
   this testbed.**
2. **The unbounded-Next behaviour is accepted, not a bug.** In the error state
   both screens show a live Next that walks the URL forward through empty pages.
   That is a consequence of standing decision 1 (no database) and test 5 depends
   on it. Do not "fix" it.
3. **The D2 range guard is `target < 1 || (totalPages !== null && target >
   totalPages)`** — nothing more. It exists because `aria-disabled` is
   decorative here: `ui/pagination.tsx` passes it to an `<a>` and reads it
   nowhere, and the real block is a `pointer-events-none` class, which keyboard
   Enter bypasses.
4. **Both hooks got the same reset (D4)**, which is what keeps
   `dos-donts-page.tsx:74` ("the hooks in `src/hooks` follow it line for line")
   true and kept that file out of scope. Gate 10 stayed at 23 because of this.
5. **The status union carries `missing: ReferenceList[]`.** More type than "a
   status union" implies, and deliberate: `pages.spec.ts:113` asserts the literal
   string `/Failed to load categories/`, and tests 1-10 may not be edited, so the
   "reword the message" arm was closed. Three arms are forced because a boolean
   cannot separate `loading` from `ready`-and-empty.
6. **`product-list.tsx` reads `useSearchParams`** — a literal deviation from the
   plan's "only the parent's source of `page` changes", declared in the audit and
   cleared on review. The full-parameter-set href requirement gave it no other
   way to see the current query; the parent-passes-a-builder alternative was
   judged not obviously better. **The roadmap shape is intact:** `ProductList`
   still calls `useProducts` at its own line and still derives `totalPages`, so
   it is still NOT presentational and still contributes exactly one
   component-attributed call site.
7. **`order-table.tsx` is no longer described as "Presentational".** A component
   that subscribes to context is not a function of its props alone. "Holds no
   state and fetches nothing" survives and stayed.
8. Unchanged from earlier phases: no database; mixed request-wrapper style,
   deliberately; testbed written as an app, not a fixture; no commits on `main`;
   do not tag; `npm run shots` barred; no repo-root `tsconfig.json`.

## Review history — two rounds

- **Round 1 (`c2a234b`)** — "Ship with edits". Two blocking, **both prose**,
  both universals the commit itself falsified. Every mechanical gate reproduced.
- **Round 2 (`7cf5ecf`)** — "Ship". No blocking issues. The fix round was
  verified prose-only *by rebuild*, and the reviewer hunted specifically for the
  recursion that bit Part 1 and found nothing to attach to: **no comment in
  `client/src` cites a line number or refers to another file's prose.**

### The two blocking issues, because the pattern is the lesson

- **B1** `products-page.tsx` said "Each write starts from the parameters already
  there, so setting one does not drop the other" — and `selectCategory` does
  `params.delete('page')` **three lines below it**. A universal contradicted by
  the very next function.
- **B2** `reference-data-provider.tsx` claimed that when lookups fail "the
  screens that need them say so locally". True at `955a680`; **this commit
  falsified it twice** — 7e added a consumer that renders `#${employeeId}`
  instead of reporting failure, and 8b narrowed both messages to
  `status.missing.includes('categories')`. Three of the four reference lists can
  now fail with no screen saying anything. **Neither the plan nor the audit
  caught this one.**

The accepted fixes name the specific writers and consumers rather than
quantifying over them. B2's named consumer pair is *exactly* the set of
`categories` consumers, verified by enumeration.

## Why rev 1 of plan-b2b-2 was rejected — nine blocking issues

One was the pagination error above. **Six were the same failure: a step that
falsifies a comment without listing that comment for repair** (7a killed the
`key` docblock and `use-products.ts`'s "initial state only"; 7c's "the hrefs
become true" was false while `?page=N` replaced the whole query string; 7e broke
`order-table.tsx`'s "Presentational:" and left
`reference-data-context.ts:6`'s already-false suppliers/shippers claim; 8b left
two messages naming a list they did not know had failed). The fix was to tag each
one **[falsifies]** in the plan so the implementer could not miss it.

Two more: the plan's "only `listProducts` has two consumers" was false at the
service layer (**every** collection function has exactly one direct caller — the
two consumers exist only at the `useProducts` hook layer), and the `forwardRef`
claim was "not load-bearing" rather than "false".

## Open risks (logged, not fixed)

- **`client/src/lib/useApi.ts:9` and `:15-16` carry the most blatant false
  universals left in `client/src`** — "The one data-fetching effect in this
  template" and "Every page in this app fetches through this hook rather than
  writing its own effect". Contradicted by `orders-page.tsx:19`,
  `order-detail-panel.tsx`, `reference-data-provider.tsx` and both hooks.
  Pre-existing and out of scope for Part 2. **The user accepted Part 2 and asked
  for these to be fixed — that is Part 3, in progress.**
- **`suppliers` and `shippers` are fetched by the provider and read by nothing.**
  Same class as `listEmployees` was. Only the comment was corrected.
- **7a introduces a label flicker once a database exists** — every page turn
  makes `totalPages` null, so the label goes "Page 3 of 12" → "Page 3" → "Page 4
  of 12". Invisible in this testbed.
- **Pagination controls stay focusable when visually disabled**
  (`ui/pagination.tsx` sets no `tabIndex={-1}`). The D2 guard makes activation
  harmless; the affordance is still wrong for keyboard users.
- **`status.missing` is newly easy for a fourth consumer to misuse.**
- **The guide's rule "Reset state with a key, not an effect"
  (`dos-donts-page.tsx:77-86`) now teaches a pattern the app deliberately
  abandoned in 7a.** It carries no `inThisApp` field so nothing is false, but the
  next phase should look at it.

## Traps — all still live, all cost real time

1. **Gate 9's own pattern collides with Playwright.** `attribut` matches
   `toHaveAttribute`/`getAttribute`. Assert through `toHaveURL` and `toHaveClass`.
2. **Clear ports 5170 and 5173 before e2e.** `reuseExistingServer: true` will
   serve a fully green run off a stale server. Two single-port `lsof` calls —
   `lsof -ti :5170 :5173` errors on this machine (lsof 4.91).
3. **A harness must be capable of a positive result.** Part 1 burned a round on a
   Back assertion run in a context whose only entry was the deep link, so Back
   reported `about:blank`. Test 12 navigates to `/customers` first for exactly
   this reason.
4. **Comment and string text can be bundle input — but not always.** Part 1
   skipped gate 3 on "only comments changed" and the hash *had* moved. Part 2's
   fix round genuinely did not move it, **proved by reverse-applying the patch
   and rebuilding**. Both are true: Part 1's edit must have touched emitted text.
   **Re-run the build; never reason about it.**
5. **A negative gate must have a positive control.** B2a fake-passed the
   vocabulary grep on an unquoted variable — zsh did not word-split it, the whole
   list went through as one filename, and exit 2 read as "no matches". Exit 1 is
   clean; exit 2 is broken.
6. `npm ci` never `npm install`; `node`/`npm` are not on `PATH` (use
   `~/.local/share/fnm/node-versions/v24.19.0/installation/bin`); do not
   round-trip JSON/Markdown through a parser.

## The standing prose rule — unchanged, and this phase's whole story

**Prose may quantify only over a directory the audit enumerates; anything wider
is stated as a rule, not a census.**

**Four phases running, the mechanics have been sound and the comments have been
where it slips.** Part 2 was almost entirely comment work and still shipped two
blocking prose defects in round 1 — one of them a universal my own plan
falsified without listing. The countermeasure that worked was tagging each
known-falsified comment **[falsifies]** in the plan itself, plus an explicit
instruction not to replace a universal with a universal (which is how Part 1
lost rounds 2 and 3).

## Housekeeping

- **These `feature-research/` documents are UNTRACKED in the `domain-expert`
  repo** (`?? feature-research/northwind-testbed/`). A `git clean` deletes the
  entire phase record. Consider committing them.
- **Only the `scout` agent is pinned to `qwen3.8:27b-64k`** (a local model gateway,
  `127.0.0.1:3001`), which resolves only under the `ccf` wrapper. `reviewer` and
  `implementer` are on `opus` and work under plain `claude`. If scout 404s
  naming the local model, pass an explicit `model` override — the gateway being
  up does not mean the session is pointed at it.
