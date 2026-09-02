# Phase B2b Part 3 (Northwind testbed — the `useApi` universals) — progress

Status: **SHIPPED, reviewer verdict "Ship" first time, no blocking issues,
2026-09-01.** Not pushed. Not tagged. `main` untouched.

**This completes Phase B2b, and with it Phase B.** Parts 1, 2 and 3 are all
shipped and accepted. Nothing in B2b is outstanding.

- Approved plan: `plan-b2b-3.md`.
- Implementer audit: `audit-b2b-3.md`.
- Part 2's record is `progress-b2b-2.md` (read its note on the audit's three
  citation baselines); Part 1's is `progress-b2b-1.md`; B2a's is
  `progress-b2a.md`; B1's is `progress.md`.

## What shipped

Branch `b2-northwind-client`, commit **`55b5437`**, parent **`7cf5ecf`**.
One commit per part: `955a680` (P1) → `7cf5ecf` (P2) → `55b5437` (P3).

`git diff --stat 7cf5ecf..55b5437` = **3 files, +10/−10**, every changed line a
comment, a Markdown paragraph, or one string literal. **Zero code changes** —
verified line by line by the reviewer, not accepted on the audit's word.

Part 3 closed the open risk Part 2 was accepted on: `client/src/lib/useApi.ts`
claimed to be "The one data-fetching effect in this template" and that "Every
page in this app fetches through this hook rather than writing its own effect".
Both false — `useApi` has exactly **one** value-importing consumer
(`guide-page.tsx:30`, the `/api/hello` card); everything else importing from
`@/lib/useApi` takes the `ApiState` **type** only.

**The claim was restated in two other places**, which is why this was three files
and not one:

1. **`README.md:78-79`** — "the only data-fetching effect in the template" → "a
   data-fetching effect". **This text renders in the running app**:
   `guide-page.tsx:2` imports the README `?raw` and runs it through `parseGuide`.
2. **`dos-donts-page.tsx:74`** — "the hooks in `src/hooks` follow it line for
   line" → "…is this pattern in its plainest form, and the two hooks in
   `src/hooks` reach the same end by a different route."

## Verified end state (reviewer re-ran all ten gates)

- `dotnet build server --no-incremental` — 0 warnings, 0 errors.
- `npx tsc -b --force` — exit 0.
- `npm run build` — **`index-DeklVI_c.js` 660.67 kB** (gzip 210.40 kB); CSS
  **unchanged** at `index-CzVZLvxs.css` 73.20 kB. Part 2's `index-L7wpOmcH.js`
  660.59 kB is retired.
- `npm run lint` — **exactly 7**, `src/lib/useApi.ts:23:5 set-state-in-effect`
  present.
- `npm audit` — 0 vulnerabilities.
- `DEBUG=pw:webserver npm run e2e` — **12/12**, real two-port handshake.
- `git status --porcelain` — empty.
- Package/lockfile diff empty for both ranges; **positive control now 43** files
  (was 42; the increment is exactly `useApi.ts`, verified).
- Vocabulary grep — exit 1 over **22** files (see the gate-9 discovery below).
- `git diff --name-status 08f7e51..HEAD` — **exactly 24 entries.**

## The gate-9 discovery — a new false-clean, worth carrying

**A file list built from `git diff --name-status` includes DELETED files, and
grep exits 2 on them — which reads as "no matches".** The raw 24-file list
produced `exit 2` with two "No such file or directory" warnings
(`client/public/screenshots/pagination.png`,
`client/src/pages/pagination-page.tsx`, both deleted in Part 1). Restricting with
**`--diff-filter=d`** gives 22 existing files and a true `exit 1`.

This is the third distinct way gate 9 has fake-passed in this phase family — after
B2a's unquoted variable (zsh did not word-split it, the whole list went through
as one filename) and Part 1's `attribut`-matches-`toHaveAttribute` collision.
**Exit 1 is clean. Exit 2 is broken. Always check which.**

**A positive control must be scoped to the same list as the gate.** The
implementer's first control used `product` and matched nothing, which looked
alarming — `product` matches 10 of the 22 gate files. The explanation was
mundane: **the control was run against the commit's own three files**
(`README.md`, `useApi.ts`, `dos-donts-page.tsx`), where the word genuinely does
not occur. Nothing was broken; the control was pointed at the wrong list. The
control of record is `fetch` (exit 0, 7 files).

The reviewer then ran the strongest form: **the identical gate pattern with one
real token appended** (`…|analy|useApi`) over the same 22-file list → exit 0
across 7 files. That is a positive control of the same *shape* as the gate, not
merely a different word. **Prefer this form from now on.**

## Decisions and lessons — do not re-open

1. **The docblock's 10-line constraint was self-imposed and unnecessary.** The
   implementer re-cut its wording to fit exactly 10 lines so `setState` would
   stay at `useApi.ts:23`. **Gate 4 tests that the warning is present with the
   same rule set, not that it sits at a given line** — `plan-b2b-2.md:450-453`
   says so verbatim ("Line numbers may shift; the count and rule set may not").
   It cost some prose quality: the docblock dropped the pointer to where the
   other fetch mechanisms live, and the surviving sentence chains three ideas
   through two separators. **Decision: not re-opened.** The shipped text is true,
   universal-free and readable; re-cutting would move the warning to `:26` and
   re-baseline a citation for marginal gain.
2. **The plan's own suggested wording was wrong, and the shorter docblock
   accidentally dodged it.** `plan-b2b-3.md` step 1 suggested saying "other
   screens fetch through the service modules and their own effects". That would
   have been **a new false near-universal**: `order-detail-panel.tsx:21` and
   `form-page.tsx:43` call `fetch` directly and do **not** go through a service
   module. **Do not restore that sentence.** If a pointer is ever wanted, use an
   existential with a directory pointer ("other code fetches directly and through
   the modules in `src/services`"), which standing decision 6 licenses.
3. **"The two hooks in `src/hooks`" is a licensed count** — the directory holds
   exactly `use-customers.ts` and `use-products.ts`, and an audit can enumerate
   it. **It is the one new tracked claim in this commit: adding a third hook
   there makes the string false.**
4. **Rule 5 of the guide ("Reset state with a key, not an effect",
   `dos-donts-page.tsx:77-86`) was left alone deliberately**, though Part 2's 7a
   removed exactly the `key` it advocates. The entry carries **no `inThisApp`
   field**, so it asserts nothing about this app and nothing is false; both
   patterns are legitimate React. **Do not add an `inThisApp` to it** — that is
   new prose to defend for no gain.
5. **`useApi.ts:23`'s `setState` inside the effect stays.** It is what produces
   the `set-state-in-effect` warning gate 4 requires among the seven, and the
   mixed fetch style is standing decision 2 — the point of the testbed, not a
   defect.

## Open risks carried to the next phase

- **`README.md:231-233` is the last surviving member of the set Part 3 existed
  to remove.** "The rule the page teaches is the one the app is written against:
  an effect earns its place by synchronizing with a system outside React… Values
  that can be derived during render are derived during render." An app-wide
  claim, rendered in the guide page through the same `?raw` import, in tension
  with the two deliberately-retained `set-state-in-effect` sites
  (`useApi.ts:23`, `ui/carousel.tsx:96`). Pre-existing, out of Part 3's scope,
  **not fixed. Put it in the next plan.**
- `dos-donts-page.tsx:74`'s "a different route" is true but its *justification*
  is not the one the audit gives. The card teaches stale-response safety, and on
  that axis the hooks' route is nearly identical to `useApi`'s (same
  `AbortController`, same aborted-guard, same cleanup). The routes do differ
  (service module with an injected signal vs. inline `fetch`), so the sentence
  holds — but the audit cites the render-time reset, which belongs to rule 5's
  subject, not rule 4's.
- Carried from Part 2, still unfixed: `suppliers`/`shippers` fetched and read by
  nothing; the label flicker 7a introduces once a database exists; pagination
  controls focusable while visually disabled; `status.missing` easy for a fourth
  consumer to misuse.

## Phase B is done — what Phase C needs

**Nothing is tagged, deliberately.** Phase C vendors the finished testbed from a
git tag into `test/fixtures/northwind-fullstack/`, and tagging before Phase B
finished would have vendored a half-done testbed. **Phase B is now finished, so
tagging is the next decision** — along with whether to push
`b2-northwind-client` to the public repo, which is a separate call
(standing decision 5).

The shapes Phase C/D measure are intact and were re-verified at every round:
two same-named `ProductList` components in different directories
(`components/orders/` and `components/products/`, because `ClientCall.components`
holds `DefKey`s — `<file>#<name>` — not names); `useProducts` consumed by two
components; `ProductList` still fetching at its own line, so it contributes
exactly one component-attributed call site; and three deliberately different
request styles (`getJson<T>()` wrapper, literal-path fetches, `useApi`).

## The through-line, four phases running

**The mechanics have been sound and the comments have been where it slips.**
Part 3 was the smallest change in the phase — three strings — and it still turned
on getting a negative existential right where a positive universal would have
been false. The countermeasures that worked:

1. **Tag every comment a change falsifies as `[falsifies]` in the plan itself.**
   Six of the nine blocking issues on Part 2's rev-1 plan were steps that broke a
   comment without listing it.
2. **Never replace a universal with a universal.** That is how Part 1 lost rounds
   2 and 3.
3. **Every negative gate needs a positive control of the same shape, scoped to
   the same list.** Three distinct fake-passes in this phase family.
4. **Re-run the build; never reason about whether prose moved the bundle.**
   Comment text is stripped; `README.md` is `?raw` bundle input and is not.
   Part 1 got this wrong in the other direction.

## Housekeeping

- **These `feature-research/` documents are UNTRACKED in the `domain-expert`
  repo.** A `git clean` deletes the entire phase record. **Consider committing
  them — the record is now five documents across three parts.**
- **Only the `scout` agent is pinned to `qwen3.8:27b-64k`** (a local model gateway at
  `127.0.0.1:3001`), which resolves only under the `ccf` wrapper. `reviewer` and
  `implementer` are on `opus` and work under plain `claude`. If scout 404s naming
  the local model, pass an explicit `model` override — the gateway being up does
  not mean the session is pointed at it.
