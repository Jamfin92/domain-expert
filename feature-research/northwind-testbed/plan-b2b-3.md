# Phase B2b PART 3 (Northwind testbed — the `useApi` universals) — PLAN

Small, comment-only. Closes the open risk Part 2 logged and the user accepted
Part 2 on. **No behaviour change anywhere.**

Branch `b2-northwind-client`, parent **`7cf5ecf`** (Part 2, accepted).
**One new commit** — do not amend Part 2. No push, no tag, `main` untouched.
Base for gate 10 is still `08f7e51..HEAD`.

**Standing decision 3 applies: do not read domain-expert's `clients.ts`, `refs.ts`
or any extractor/attribution source. Gate 9 checks it.**

---

## The problem

`client/src/lib/useApi.ts` makes two universal claims, both false, verified at
`7cf5ecf`:

- **`:9`** — "The one data-fetching effect in this template."
- **`:15-16`** — "Every page in this app fetches through this hook rather than
  writing its own effect."

**Five hand-rolled fetch effects contradict them:** `orders-page.tsx:19`,
`order-detail-panel.tsx:16`, `reference-data-provider.tsx:30`,
`use-products.ts:31`, `use-customers.ts:31`. Plus four service modules with raw
`fetch`, and `form-page.tsx:43` fetching from an event handler.

**`useApi` has exactly one real consumer: `guide-page.tsx:30`** (`/api/hello`,
the "Live wire" card). Everything else importing from `@/lib/useApi` takes the
`ApiState` **type only** — `orders-page.tsx:3`, `use-customers.ts:3`,
`use-products.ts:3`, `order-detail-panel.tsx:3`.

## Two restatements elsewhere — fixing `useApi.ts` alone leaves contradictions

1. **`README.md:78-80`** — "This commit also adds the only data-fetching effect
   in the template: a `useApi` hook whose cleanup aborts in-flight requests…"
   **This is rendered live in the app**: `guide-page.tsx:2` imports the README
   raw and runs it through `parseGuide`, so it is user-visible text, not just
   documentation. (`README.md:90` — "the abort-safe fetch pattern" — is a label,
   not a universal. Leave it. `README.md:217` about `useCustomers` is still
   true. Leave it.)
2. **`dos-donts-page.tsx:74`**, the `inThisApp` string on rule 4 — "This is
   `src/lib/useApi.ts`, and the hooks in `src/hooks` follow it **line for line**:
   a fetch effect has to abort its request or ignore the answer it no longer
   wants…"

   Part 2's reviewer rated this "thinner but surviving" because the colon scopes
   the claim to the abort-or-ignore rule. That reading is a stretch and it is now
   weaker still: **the hooks diverged from `useApi` in Part 2.** `useApi:23`
   resets to `loading` *inside the effect*; `use-products.ts:20-29` and
   `use-customers.ts:20-29` reset *during render* and have an
   `argumentKey`/`renderedFor` mechanism `useApi` has no equivalent of. "Line for
   line" is false read literally. Fix it while the file is open.

---

## Steps

**1. `client/src/lib/useApi.ts` — rewrite the docblock (`:8-17`). Comments only.**

Say what is true: an abort-safe fetch hook, used by the guide page for its
`/api/hello` card; the cleanup cancels the in-flight request so a stale response
cannot overwrite a newer one (that part is true today and stays). Then state
plainly that this is **not** the app's single fetching mechanism — other screens
fetch through the service modules and their own effects.

A negative existential ("this is not the only one") is safe: five counterexamples
exist. **Do not replace one universal with another** — do not write "every other
screen uses a service", do not count the screens, do not enumerate the five call
sites in prose. Standing decision 6: a claim whose extension is the whole tree
cannot be kept true by prose discipline.

> **CRITICAL — do not touch a line of code in this file.** `useApi.ts:23`'s
> `setState({ status: 'loading' })` inside the effect is what produces the
> `src/lib/useApi.ts:23 react(set-state-in-effect)` warning, and **gate 4
> requires that exact warning to still be among the seven.** "Fixing" it fails
> the gate. The mixed style is deliberate (standing decision 2).

**2. `README.md:78-80` — remove the "only data-fetching effect" claim.**

Keep the section's real content: the Vite proxy, relative URLs, and the
abort-on-cleanup behaviour. Drop "the only". This is a commit-by-commit build
narrative, so keep the tense and voice of the surrounding steps.

> **This text renders in the app** through `guide-page.tsx:2` → `parseGuide`.
> **Before editing, check what `parseGuide` keys on** (headings, step markers,
> code fences) so a reworded line does not silently drop a card from the guide
> page. **After editing, confirm e2e test 1 still passes** — it exercises the
> guide page.

**3. `client/src/pages/dos-donts-page.tsx:74` — retarget the `inThisApp` string
on rule 4.**

Drop "follow it line for line". The true shared property is the one the rule
teaches: each of these fetch effects either aborts its request or ignores the
answer it no longer wants. Name `useApi.ts` as the example if useful, without
claiming the hooks are copies of it.

> **Structural constraints — do not break the tests.** The `rules` array must
> keep **exactly 6 entries**; `pages.spec.ts:86-87` asserts `"Don't"` and `"Do"`
> each appear exactly 6 times. Do not add or remove an entry, and do not touch
> any `dont`/`do_` field. `inThisApp` is optional on the `Rule` type
> (`dos-donts-page.tsx:8`), so editing this one string is structurally safe.

**4. Rule 5 (`:77-86`), "Reset state with a key, not an effect" — leave it, and
say so in the audit.**

Part 2's 7a removed exactly the `key` this rule advocates, in favour of a
render-time reset. The entry carries **no `inThisApp` field**, so it asserts
nothing about this app and nothing is false. Both patterns are legitimate React;
the rule teaches one, the app demonstrates the other. **Do not add an
`inThisApp` to it** — that is new prose to defend for no gain, and this phase
has lost rounds to exactly that. Record the decision in the audit so the next
phase does not re-derive it.

---

## Files touched

**Modified — 3**

1. `client/src/lib/useApi.ts` — docblock only, `:8-17`
2. `README.md` — `:78-80` only
3. `client/src/pages/dos-donts-page.tsx` — the `inThisApp` string at `:74` only

Nothing else. No new files. No code changes in any file. Specifically: no
`guide-page.tsx`, no `orders-page.tsx`, no `order-detail-panel.tsx`, no
`reference-data-provider.tsx`, no hooks, no services, no e2e file, no server
file, no `ui/*`.

---

## Gates — all ten, from a clean tree

Unchanged from Part 2 except:

- **Gate 3 — the bundle hash WILL move this time.** `README.md` is imported
  `?raw` into `guide-page.tsx`, so its text is genuine bundle input. Part 2's
  fix round did not move the hash because it touched only stripped comments;
  **this round touches emitted text, so expect movement and record the new
  figures.** Current: `index-L7wpOmcH.js` 660.59 kB, CSS `index-CzVZLvxs.css`
  73.20 kB. **Do not reason about this — re-run the build.** (This is also the
  resolution of Part 1's trap 4: Part 1 edited `README.md`, which is why its
  "comment-only" edit moved the hash.)
- **Gate 4 — exactly 7 warnings, and `src/lib/useApi.ts:23 set-state-in-effect`
  MUST still be present.** Its absence means step 1 changed code it should not
  have.
- **Gate 6 — 12/12.** No test file is edited. Test 1 (guide page) and the
  `dos-donts` count assertions at `pages.spec.ts:86-87` are the ones at risk from
  steps 2 and 3.
- **Gate 10 — `git diff --name-status 08f7e51..HEAD` is now exactly 24 entries**
  (Part 2's 23 plus `client/src/lib/useApi.ts`; `README.md` and
  `dos-donts-page.tsx` are already among the 23).

All other gates and both positive controls (8 and 9) as in `plan-b2b-2.md`.
Environment traps unchanged: `node`/`npm` not on `PATH`
(`~/.local/share/fnm/node-versions/v24.19.0/installation/bin`), `npm ci` never
`npm install`, two single-port `lsof` calls, clear 5170 and 5173 before e2e.

---

## Deliverable

`feature-research/northwind-testbed/audit-b2b-3.md` — all ten gates with full
output including both positive controls, a before/after for each of the three
strings, the new bundle figures, and the step 4 decision recorded. One commit.

---

## Standing decisions — unchanged, do not re-open

1. **No database.** Every Northwind route 500s.
2. **Request wrapper: mixed, deliberately** — `reference.ts` uses a shared
   `getJson<T>()`; the other services spell out literal-path fetches; `useApi`
   is a third style. **This is the point.** Wrapper-style calls extract as
   nothing, and that weak spot is what the testbed must contain in order to
   detect it. **Part 3 makes the comments match that reality — it does not
   reduce the variety.**
3. **Write the testbed as an app, not a fixture.**
4. **`useApi.ts` survives** — the guide page's `/api/hello` card, e2e test 1.
5. **No commits on `main`; do not tag; `npm run shots` barred.**
6. **Prose may quantify only over a directory the audit enumerates; anything
   wider is stated as a rule, not a census.**
