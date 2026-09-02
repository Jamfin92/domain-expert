# Phase B2b PART 3 — AUDIT (the `useApi` universals)

Plan: `plan-b2b-3.md`. Branch `b2-northwind-client`.
Parent `7cf5ecf` (Part 2, accepted) — verified clean before starting.
**New commit: `55b5437`.** Part 2 was NOT amended. No push, no tag, `main` untouched.

All line numbers below are relative to **`55b5437`** unless marked `@7cf5ecf`.

---

## Files changed

1. `README.md` — prose only, Step 4 paragraph
2. `client/src/lib/useApi.ts` — docblock only, `:8-17`
3. `client/src/pages/dos-donts-page.tsx` — the `inThisApp` string on rule 4, `:74`

**Three files. Zero code changes.** `git diff --stat` for `7cf5ecf..55b5437`:

```
 README.md                           |  4 ++--
 client/src/lib/useApi.ts            | 14 +++++++-------
 client/src/pages/dos-donts-page.tsx |  2 +-
 3 files changed, 10 insertions(+), 10 deletions(-)
```

Every changed line is inside a block comment, a Markdown paragraph, or a single
string literal. No file outside the plan's "Files touched" list was opened for
writing.

---

## Before / after — all three strings

### 1. `client/src/lib/useApi.ts` docblock (`:8-17`)

**Before** (`@7cf5ecf`, `:8-17`):

```
/**
 * The one data-fetching effect in this template.
 *
 * Fetching in an effect is legitimate — the network is an external system —
 * but it must handle the race where the component re-renders (or unmounts)
 * before the response lands. AbortController does that: the cleanup function
 * cancels the in-flight request, so a stale response can never overwrite a
 * newer one. Every page in this app fetches through this hook rather than
 * writing its own effect.
 */
```

**After** (`:8-17`):

```
/**
 * An abort-safe fetch hook — the guide page's `/api/hello` card uses it.
 *
 * Fetching in an effect is legitimate (the network is an external system) but
 * must handle the race where the component re-renders or unmounts before the
 * response lands. AbortController does that: the cleanup cancels the in-flight
 * request, so a stale response can never overwrite a newer one. This is not
 * the app's only fetching mechanism, though — what travels is the rule, not
 * this hook: abort the request, or ignore an answer you no longer want.
 */
```

Both false universals are gone. What replaces them is a **negative existential**
("this is not the app's only fetching mechanism") plus a **rule stated as a
rule** ("what travels is the rule … abort the request, or ignore an answer you
no longer want"). No new positive universal: the screens are not counted, the
five call sites are not enumerated in prose, and the words "each", "every",
"all" and "the only" do not appear in the new text.

**Line-count note — deliberate.** The replacement docblock is written to occupy
**exactly the same 10 lines (`:8-17`)** as the original. A first draft ran four
lines longer, which would have pushed `setState({ status: 'loading' })` from
`:23` to `:27` and moved the address of the gate-4 warning. The docblock was
re-cut to the original length so `setState` stays on `:23`. Verified after the
edit:

```
$ grep -n "setState({ status: 'loading' })" client/src/lib/useApi.ts
23:    setState({ status: 'loading' })
```

### 2. `README.md` (Step 4 paragraph)

**Before** (`@7cf5ecf`, `:78-80`):

```
relative URLs and never deals with ports or CORS. This commit also adds the only
data-fetching effect in the template: a `useApi` hook whose cleanup aborts in-flight
requests, so a stale response can never overwrite a fresh one.
```

**After:**

```
relative URLs and never deals with ports or CORS. This commit also adds a
data-fetching effect: a `useApi` hook whose cleanup aborts in-flight
requests, so a stale response can never overwrite a fresh one.
```

"the only data-fetching effect in the template" → "a data-fetching effect".
The Vite proxy, the relative-URL point and the abort-on-cleanup behaviour are
all kept; the commit-by-commit build-narrative tense and voice are unchanged.
`README.md:90` ("the abort-safe fetch pattern", a label) and `README.md:217`
(`useCustomers`, still true) were left alone as the plan directs.

### 3. `client/src/pages/dos-donts-page.tsx` — rule 4 `inThisApp` (`:74`)

**Before** (`@7cf5ecf`, `:74`):

> This is src/lib/useApi.ts, and the hooks in src/hooks follow it line for line:
> a fetch effect has to abort its request or ignore the answer it no longer
> wants, so the older response can never win.

**After** (`:74`):

> src/lib/useApi.ts is this pattern in its plainest form, and the two hooks in
> src/hooks reach the same end by a different route. What has to travel is the
> rule, not the implementation: a fetch effect has to abort its request or
> ignore the answer it no longer wants, so the older response can never win.

"follow it line for line" is gone — it was false read literally, because
`useApi:23` resets inside the effect while both hooks reset during render and
carry an `argumentKey`/`renderedFor` mechanism `useApi` has no equivalent of.
The new text says the opposite of what was false ("a different route") and
keeps the rule, which is what the entry is actually for.

**On "the two hooks in src/hooks".** This is a count, so under standing decision
6 it is licensed only by an enumeration in this audit. Enumerated:

```
$ ls client/src/hooks
use-customers.ts
use-products.ts
```

Two files, no others. Both construct an `AbortController`, both guard with
`if (controller.signal.aborted) return`, and both return `() => controller.abort()`
from the effect (`use-customers.ts:32,37,41`; `use-products.ts:32,37,41`) — so
both do "abort its request or ignore the answer", which is all the sentence
claims of them. The quantifier's extension is one directory of two files listed
here, not the whole tree.

No `dont` or `do_` field was touched. The `rules` array still holds **exactly 6**
entries:

```
$ grep -c "    title: '"  client/src/pages/dos-donts-page.tsx   -> 6
$ grep -c "    dont: \`"  client/src/pages/dos-donts-page.tsx   -> 6
$ grep -c "    do_: \`"   client/src/pages/dos-donts-page.tsx   -> 6
```

---

## What `parseGuide` keys on (checked before editing `README.md`)

`client/src/lib/markdown.ts:25-96`. It is a hand-rolled line scanner. In
priority order per line:

1. **inside a fence** — everything is code until the next line starting with
   ` ``` `
2. **` ``` `** at line start — opens a fence, `lang` is the rest of the line
3. **`## `** at line start — **starts a new section, i.e. a new card.** The
   heading is matched against `/^Step (\d+) — (.*)$/`; on a match the card gets
   a numeric `step` chip and the remainder as its title, otherwise `step: null`
   and the whole heading as the title
4. **`# `** at line start — sets the guide title
5. **`![`** at line start — image block, `/^!\[([^\]]*)\]\(([^)]+)\)/`, with a
   `client/public` prefix stripped from the path
6. **`- `** at line start — list item
7. **blank line** — flushes the open paragraph/list
8. **anything else** — appended to the current paragraph (or continues the last
   list item if a list is open)

**Therefore the card set is determined entirely by `## ` headings.** My edit
changes only words inside an existing paragraph body of the `## Step 4 — Wire
client to server` section. It adds no line, removes no line, and introduces no
line that begins with `#`, ` ``` `, `- ` or `![`; it changes no blank line. Both
edited lines still start with ordinary prose, so they still fall through to
case 8 and join the same paragraph. No card can be added or dropped by it.

Confirmed empirically by gate 6: e2e test 1
(`pages.spec.ts:4` — "renders the parsed README as cards and proves the server
pipe", which asserts the `vite-react-webapi-template` heading, the `Step 1` chip,
the `Init the repo` heading and the live `/api/hello` round-trip) **passes**.

---

## Step 4 decision — rule 5 left alone, on purpose

**Rule 5, "Reset state with a key, not an effect" (`dos-donts-page.tsx:77-86`),
was not touched, and no `inThisApp` was added to it.**

Part 2's 7a removed exactly the `key` this rule advocates, replacing it with a
render-time reset. That does not make the entry false: **the entry carries no
`inThisApp` field**, so it asserts nothing whatsoever about this app. It states
a general React preference, and both patterns are legitimate React — the rule
teaches one, the app happens to demonstrate the other. Adding an `inThisApp`
would manufacture a new app-scoped claim that would then have to be defended,
for no gain; this phase has already lost rounds to exactly that move.

**Recorded so the next phase does not re-derive it: leave rule 5 alone. The
absence of `inThisApp` is the reason it is safe, not an oversight.**

---

## Gates — all ten

**Which gates were actually run, and when.** Gates 1-6 were run on the working
tree immediately before the commit; the tree at that point contained exactly the
three edits and nothing else (gate 7 pre-commit output below proves it), so the
tree measured is byte-identical to `55b5437`. Gates 7-10 were run after the
commit, since 8 and 10 need the commit to exist. Gate 7 was run twice, pre- and
post-commit. **Nothing was carried over from Part 2 — every gate below was
executed this round**, including gate 3, whose figures the plan explicitly
forbade reasoning about.

`node`/`npm` were invoked with
`PATH=~/.local/share/fnm/node-versions/v24.19.0/installation/bin:$PATH`.
No `npm install` was run (no dependency change was needed, so no `npm ci`
either). Ports were cleared with two single-port `lsof` calls.

### Gate 1 — `dotnet build server --no-incremental`: PASS (0 warnings, 0 errors)

```
  Determining projects to restore...
  All projects are up-to-date for restore.
  Server -> ~/Developer/northwind-fullstack/server/bin/Debug/net10.0/Server.dll

Build succeeded.
    0 Warning(s)
    0 Error(s)

Time Elapsed 00:00:01.72
```

No server file was touched this round, and it stayed clean.

### Gate 2 — `npx tsc -b --force` in `client/`: PASS (exit 0)

```
tsc exit: 0
```

No output. (Expected: the only changes are a comment, a Markdown file and a
string literal.)

### Gate 3 — `npm run build`: PASS. **The bundle hash moved, as predicted.**

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
dist/assets/index-DeklVI_c.js                              660.67 kB │ gzip: 210.40 kB

✓ built in 209ms
```

The size warning about chunks >500 kB is the same pre-existing advisory as prior
rounds, not a build failure.

**New figures — this is the record:**

| asset | before (Part 2) | after (`55b5437`) |
|---|---|---|
| JS | `index-L7wpOmcH.js` 660.59 kB | **`index-DeklVI_c.js` 660.67 kB** (gzip 210.40 kB) |
| CSS | `index-CzVZLvxs.css` 73.20 kB | **`index-CzVZLvxs.css` 73.20 kB** (unchanged) |

The JS hash and size moved (+0.08 kB) because `README.md` is imported `?raw`
into `guide-page.tsx` and is therefore genuine emitted bundle input — the
`dos-donts-page.tsx` string literal is emitted too. The CSS is byte-identical,
correctly, since no style changed. This is the resolution of Part 1's trap 4 and
the contrast with Part 2's fix round, which moved nothing because it touched
only comments that get stripped. Measured, not reasoned about.

### Gate 4 — `npm run lint` (oxlint): PASS — **exactly 7 warnings**

```
src/components/ui/navigation-menu.tsx:163:3: warning react(only-export-components)
src/components/ui/button.tsx:67:18: warning react(only-export-components)
src/lib/markdown.ts:83:7: warning eslint(no-unused-expressions)
src/lib/useApi.ts:23:5: warning react(set-state-in-effect)
src/pages/form-page.tsx:82:22: warning react(incompatible-library)
src/components/ui/carousel.tsx:239:3: warning react(only-export-components)
src/components/ui/carousel.tsx:96:5: warning react(set-state-in-effect)
```

7 warnings, same rule set and same seven `file:line` pairs as the Part 1
baseline. **`src/lib/useApi.ts:23:5 react(set-state-in-effect)` is present, and
still at line 23** — the docblock was length-matched precisely so this address
would not move. Constraint 2 held: no line of code in `useApi.ts` was touched,
and the `setState({ status: 'loading' })` inside the effect is untouched and
still deliberate (standing decision 2).

### Gate 5 — `npm audit` in `client/`: PASS

```
found 0 vulnerabilities
```

### Gate 6 — `DEBUG=pw:webserver npm run e2e`: PASS — **12/12**

Both ports were confirmed free before the run (two single-port `lsof` calls,
both `(none)`), so `reuseExistingServer` could not have served a stale run.
The handshake proves both servers were genuinely started by this run:

```
pw:webserver Error while checking if http://localhost:5170/api/hello is available: connect ECONNREFUSED ::1:5170
pw:webserver Error while checking if http://localhost:5170/api/hello is available: connect ECONNREFUSED ::1:5170
pw:webserver Error while checking if http://localhost:5170/api/hello is available: connect ECONNREFUSED ::1:5170
pw:webserver HTTP Status: 200
pw:webserver Error while checking if http://localhost:5173/ is available: connect ECONNREFUSED ::1:5173
pw:webserver Error while checking if http://localhost:5173/ is available: connect ECONNREFUSED ::1:5173
pw:webserver HTTP Status: 200
```

**Provenance of the block below — reformatted, not verbatim.** The run passed
12/12 and the per-test lines and timings are the real ones, but this block is
**not** literal reporter output: `playwright.config.ts:10` defines a named
project (`projects: [{ name: 'chromium' … }]`), so the `list` reporter prefixes
every result line with `[chromium] ›`, and those prefixes are absent here. The
block was tidied when it was transcribed and the original terminal output is no
longer available, so it is labelled rather than repaired — the prefixes are
deliberately **not** pasted back on, because a reconstructed line must not be
presented as verbatim. The reviewer's independent re-run of this gate shows the
prefixes and also passed 12/12. In an audit whose value is verbatim output,
tidying a transcript is the wrong habit even when the content is correct; later
rounds should paste reporter output unedited.

```
  ✓   4 e2e/pages.spec.ts:4:3   › guide (bento README) › renders the parsed README as cards and proves the server pipe (537ms)
  ✓   6 e2e/pages.spec.ts:140:3 › customers search history › the first search pushes and later edits replace (556ms)
  ✓   3 e2e/pages.spec.ts:27:3  › form › shows zod errors for invalid input (617ms)
  ✓   2 e2e/pages.spec.ts:35:3  › form › submits a valid form to the server (779ms)
  ✓  10 e2e/pages.spec.ts:83:3  › dos & don'ts › renders every rule with a Don't/Do pair (882ms)
  ✓   9 e2e/pages.spec.ts:58:3  › customers › deep-links to a page via the URL (936ms)
  ✓  11 e2e/pages.spec.ts:16:3  › carousel › advances slides and updates the counter (974ms)
  ✓  12 e2e/pages.spec.ts:94:3  › products › mounts and reports the failed catalogue request (1.0s)
  ✓   5 e2e/pages.spec.ts:102:3 › orders › mounts and reports the failed orders request (1.1s)
  ✓   8 e2e/pages.spec.ts:120:3 › products pagination › pages by clicking a link and honours a ?page deep link (1.1s)
  ✓   7 e2e/pages.spec.ts:49:3  › customers › mounts, reports the failed request and pages by clicking a link (1.2s)
  ✓   1 e2e/pages.spec.ts:110:3 › categories › mounts and reports the failed reference-data request (1.4s)

  12 passed (4.3s)
```

exit 0. **The two tests the plan flagged as at risk both pass:** test 1, the
guide page (step 2's README edit), and `pages.spec.ts:83` whose assertions at
`:86-87` require `"Don't"` and `"Do"` to appear exactly 6 times each (step 3's
`inThisApp` edit). No test file was edited.

The `Failed executing DbCommand` / `SQLite Error 1: 'no such table: …'` lines
in the `[WebServer]` output are expected under standing decision 1 (no
database); the Northwind screens are asserted to reach their error state.

### Gate 7 — `git status --porcelain`: PASS

**Pre-commit** — exactly the three planned files, nothing else:

```
 M README.md
 M client/src/lib/useApi.ts
 M client/src/pages/dos-donts-page.tsx
```

**Post-commit** — empty:

```
(no output)
```

No stray `*.db` / `-shm` / `-wal` in porcelain. `server/northwind.db` exists on
disk but is pre-existing, untracked and gitignored, so it is not a stray from
this round:

```
$ git check-ignore -v server/northwind.db
.gitignore:27:*.db	server/northwind.db
$ git ls-files --error-unmatch server/northwind.db  -> not tracked
```

### Gate 8 — package/lockfile diff empty, **with positive control**: PASS

```
--- main..HEAD, package/lockfile pathspec (must be EMPTY) ---
(empty)
--- 08f7e51..HEAD, package/lockfile pathspec (must be EMPTY) ---
(empty)
--- POSITIVE CONTROL: same command shape, no pathspec, main..HEAD ---
43
```

The control returns 43 files from the identical command shape, so the two empty
results mean "no package or lockfile changed", not "the command silently did
nothing". (43, up from Part 2's 42, because `client/src/lib/useApi.ts` is newly
changed against `main` as of this commit — the increment is itself a check.)

### Gate 9 — vocabulary grep, **with positive control**: PASS

Standing decision 3 was honoured: domain-expert's `clients.ts`, `refs.ts` and
every extractor/attribution source went unread this round.

Run over the full changed set for `08f7e51..HEAD`, restricted with
`--diff-filter=d` to the **22 files that still exist** (the raw 24-entry set
includes two deletions, `client/src/pages/pagination-page.tsx` and
`client/public/screenshots/pagination.png`; passing those to grep produced
`No such file or directory` warnings and **exit 2**, which is exactly the
false-clean failure mode — exit 2 is not "no matches"). File paths were passed
from a file list, never through an unquoted variable.

```
--- GATE 9 (22 existing changed files) ---
grep exit: 1   (1 = clean, no matches)

--- POSITIVE CONTROL, same command shape, same file list: 'fetch' ---
README.md:4
client/src/components/orders/order-table.tsx:1
client/src/components/orders/order-detail-panel.tsx:1
client/src/pages/dos-donts-page.tsx:5
client/src/lib/useApi.ts:4
client/src/services/customers.ts:1
client/src/services/reference.ts:2
control exit: 0   (0 = matched)
```

Pattern: `extract|attribut|walker|fixture|testbed|domain-expert|psq|analy`,
case-insensitive. Zero matches.

**Control honesty note — corrected after review.** The first control attempt
used `product` and matched nothing, so it was **not** accepted as a control and
the run was repeated with `fetch`, which is genuinely present and returned
exit 0 with per-file counts. `fetch` remains the control of record.

The reason the `product` attempt matched nothing was **operator error in the
file list, not a weakness in the word.** That first attempt was scoped to the
commit's own three files (`README.md`, `client/src/lib/useApi.ts`,
`client/src/pages/dos-donts-page.tsx`), where `grep -ic product` returns
`0/0/0` — the word genuinely does not occur in any of the three, and the README
never uses it. Over the gate's actual 22-file list, `product` matches **10
files**, including `client/src/components/products/product-list.tsx` and
`client/src/pages/products-page.tsx`. So the control was run against the wrong
list; nothing was broken, and the earlier wording here wrongly left the
impression that `product` is absent from the changed set.

**`product` is a perfectly good control against the right list.** A later round
should not read this note as a reason to avoid it.

### Gate 10 — `git diff --name-status 08f7e51..HEAD`: PASS — **exactly 24 entries**

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
M	client/src/lib/useApi.ts
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
```

count = **24**. Part 2's 23 plus `client/src/lib/useApi.ts`, exactly as the plan
predicted; `README.md` and `client/src/pages/dos-donts-page.tsx` were already
among the 23 and did not increase the count. **Scope did not grow.**

---

## Review outcome (independent — not my own runs)

**Verdict: Ship at `55b5437`. No blocking issues.** The reviewer independently
re-ran all ten gates. Everything in this section is the reviewer's work and is
recorded here on the reviewer's authority, not mine; I re-ran nothing for it.

Three checks where the review went deeper than this audit did, kept because
they are worth having in the record:

- **Gate 3 — explained, not merely observed.** The built JS contains the new
  README text and `"plainest form"` once each, and does **not** contain
  `"abort-safe fetch hook"` (the docblock is stripped from the bundle). The
  README lost 22 characters and the `inThisApp` literal gained about 97 — net
  ≈ +75 bytes, which is exactly the +0.08 kB this audit reported.
- **Gate 6 — proved structurally, not just by a passing test.** `README.md` at
  `7cf5ecf` and at `55b5437` have identical counts of `## ` headings (17),
  lines (306), blank lines (73), fence lines (50), `- ` lines (4) and `![`
  lines (4). Since `markdown.ts:57-91` derives the card set solely from `## `,
  the guide page's card set provably cannot have changed — a stronger result
  than "the test still passes".
- **Gate 9 — given a stronger control than mine.** The reviewer ran the gate's
  identical pattern with one real token appended (`…|analy|useApi`) over the
  same 22-file list: exit 0 across 7 files. That is a positive control of the
  same *shape* as the gate, not merely a different word, and it is the better
  pattern for future rounds.

### Correction of substance: the plan's suggested wording was wrong

The reviewer found that the approved plan's own suggested phrasing for step 1 —
"other screens fetch through the service modules and their own effects" — would
itself have introduced **a new false near-universal**: `order-detail-panel.tsx:21`
and `form-page.tsx:43` call `fetch` directly and do not go through a service
module. The shipped docblock is shorter and avoids that claim, though not for
that stated reason at the time.

**It is the plan that was wrong here, not the implementation.** A later phase
must not restore that sentence.

### The length-matched docblock: self-imposed, and left alone deliberately

The 10-line constraint recorded under "Deviations" below was **self-imposed and
unnecessary**. Gate 4 tests that the `set-state-in-effect` warning is present
with the same rule set — not that it sits at `:23`. `plan-b2b-2.md:450-453` is
explicit: "Line numbers may shift; the count and rule set may not."

The decision after review was **not** to re-open the wording: the shipped text
is true, free of universals and readable, and re-cutting it would move the
warning to `:26` and re-baseline a citation for marginal gain. Recorded so the
next phase does not re-litigate it.

---

## Deviations from the plan

**One, and it is a tightening rather than a widening:** the plan did not specify
that the new `useApi.ts` docblock must be the same number of lines as the old
one. I made it so deliberately, because a longer docblock would have shifted
`setState` off `:23` and changed the address of the warning gate 4 names
explicitly (`src/lib/useApi.ts:23 set-state-in-effect`). This constrained my
wording but changed no file, line or claim beyond the plan's `:8-17`.

**Corrected by review:** that constraint was unnecessary — gate 4 checks the
warning's presence and rule set, not its line number. See "The length-matched
docblock" under **Review outcome** above for why it was nonetheless left as
shipped.

Nothing else. Three files, comment/prose/string only, no fourth file needed, no
code touched, no test file edited, one commit.

---

## Open risks

**The risk Part 2 logged and the user accepted Part 2 on — the two false
`useApi` universals — is now closed.** All three prose sites that stated or
restated them are corrected, and the correction is prose-only, so nothing about
the testbed's deliberate variety was reduced (standing decision 2 intact: the
mixed request styles are all still there, the comments merely stop denying it).

Carried forward from Part 2, still open, still deliberately unfixed:

- `suppliers` and `shippers` are fetched by the provider and read by nothing.
- 7a's label flicker with a real database: `totalPages` goes null on each page
  turn, so a real deployment would show "Page 3 of 12" → "Page 3" → "Page 4 of 12".
  Invisible here because there is no database.
- Pagination controls stay focusable when visually disabled (`ui/pagination.tsx`
  sets no `tabIndex={-1}`).

New, minor, from this round:

- `README.md` is bundle input via `?raw`. Any future prose edit to it moves the
  JS hash, and any future edit that introduces a line starting with `## `,
  ` ``` `, `- ` or `![` changes the guide page's card structure. Worth stating
  once so a later round does not rediscover it as a surprise.
- The phrase "the two hooks in `src/hooks`" in `dos-donts-page.tsx:74` is a
  count, licensed by the enumeration in this audit. **If a third hook is added
  to `client/src/hooks`, that string becomes false.** This is the one new
  quantified claim introduced this round and it is the only one to track.
