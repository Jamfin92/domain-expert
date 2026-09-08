# Phase D2 — M5c-i (web half) — IMPLEMENTATION AUDIT

Plan: `plan-d2.md` (approved, followed as written). D1 record: `progress.md`,
`audit.md` — **this file does not replace either.**

Branch `m5c-i-web`, from `master` at `d559b5e`. Feature commit
**`cd54ac2`** (amended from `52df02d` after review — see "Review correction"
below; `m5c-i-web` is local and unpushed, so the one-feature-commit shape is
kept). `feature-research/**` is deliberately NOT in it.

---

## Files changed

Every path created or modified by this phase. Nothing outside it was touched.

1. `test/fixtures/mini-fullstack-react/src/lib/save-card.ts` — **new**
2. `test/fixtures/mini-fullstack-react/src/components/admin/Card.tsx`
3. `test/fixtures/mini-fullstack-react/src/components/shop/Card.tsx`
4. `test/fixtures/mini-fullstack-react/server.ts`
5. `test/mini-fullstack-react.test.ts`
6. `apps/server/src/app.ts`
7. `apps/server/test/api.test.ts`
8. `apps/web/src/lib/api.ts`
9. `apps/web/src/lib/client-calls.ts` — **new**
10. `apps/web/test/client-calls.test.ts` — **new**
11. `apps/web/src/views/Dashboard.tsx`
12. `e2e/harness.ts`
13. `e2e/psq.e2e.ts`

Plus, uncommitted and outside the feature commit by instruction: this file.
`feature-research/m5c-i/plan-d2.md` remains untracked.

---

## The pre-flight probe, as printed

Run **before** the test file was re-pinned and before any web-side edit, over
**both** `extractNode` and `extract`. The two agreed on every value; the
figures below are from the printed output, not derived from it.

```
warnings: []
entities: 1  shapes: 0  routes: 2

routes
  POST /api/admin/cards  server.ts:25
  GET  /api/cards        server.ts:30

components (line pins)
  src/components/admin/Card.tsx#Card  name=Card file=src/components/admin/Card.tsx line=11
  src/components/shop/Card.tsx#Card   name=Card file=src/components/shop/Card.tsx  line=11

clientCalls IN ARRAY ORDER (line pins)
  [0] POST /api/admin/cards  src/components/admin/Card.tsx:13
      enclosing="save"  matches="POST /api/admin/cards"
      components=["src/components/admin/Card.tsx#Card"]                      length=1
  [1] GET /api/shop/wishlist src/components/shop/Card.tsx:13
      enclosing="load"  matches=null
      components=["src/components/shop/Card.tsx#Card"]                       length=1
  [2] GET /api/cards         src/lib/boot.ts:5
      enclosing=null    matches="GET /api/cards"
      components=[]                                                          length=0
  [3] GET /api/cards         src/lib/save-card.ts:7
      enclosing="saveCard"  matches="GET /api/cards"
      components=["src/components/admin/Card.tsx#Card",
                  "src/components/shop/Card.tsx#Card"]                       length=2

new call count: 1
NEW CALL components.length = 2
  resolves in g.components?  src/components/admin/Card.tsx#Card -> true
  resolves in g.components?  src/components/shop/Card.tsx#Card -> true

both (matched AND attributed) = 2
  both[0] src/components/admin/Card.tsx:13  POST /api/admin/cards
  both[1] src/lib/save-card.ts:7            GET /api/cards
```

**The fourth call's `components` array, in full:**
`["src/components/admin/Card.tsx#Card", "src/components/shop/Card.tsx#Card"]`
— length **2**, both keys resolving.

Every number the plan said the probe must reproduce, reproduced: `warnings`
`[]`, `components.length === 2`, `both` = 2, and the new call as
`src/lib/save-card.ts:1 GET /api/cards matches="GET /api/cards"` — **with one
discrepancy in the plan's own quoted line number**, see "What the plan got
wrong" below. The stop rule was never reached; neither fallback was used.

### Re-derived line pins (from the probe output, not by hand)

| Pin | Before | After | Where |
|---|---|---|---|
| `admin/Card.tsx#Card` component | 6 | **11** | `test/mini-fullstack-react.test.ts` |
| `shop/Card.tsx#Card` component | 6 | **11** | same |
| admin call | 8 | **13** | same |
| shop call | 8 | **13** | same |
| `src/lib/boot.ts` call | 5 | **5** (unmoved) | same |
| new `save-card.ts` call | — | **7** | same, new row |
| `server.ts` routes | 25, 30 | **25, 30 (unmoved)** | same |

`git show HEAD -- test/mini-fullstack-react.test.ts | grep '^[-+].*line:'`
prints exactly `-6/+11`, `-6/+11`, `-8/+13`, `-8/+13`, `+7` — the four pin
changes §4 predicts and the new row's own pin, and nothing else. The route
pins produce no diff line at all, which is the 3a line-count-neutrality claim
measured rather than asserted.

**The positional pin `api.test.ts` `both[0]` survives, measured not assumed.**
The new call lands at array index **3** (last), so `both[0]` is still the
admin row — and the repointed case asserting
`toMatchObject({… src/components/admin/Card.tsx …})` passes.

### Import specifier that shipped

`import { saveCard } from "../../lib/save-card.js";` — the **`.js`
extension** form, in both `Card.tsx` files, exactly as §4 pins it. The
extensionless variant was **not** tried in this build; the plan review had
already measured it silently attributing nothing, and the probe's
`components.length === 2` is the positive proof that the shipped form
resolves.

---

## What changed, per file

**1. `src/lib/save-card.ts` (new).** One exported non-component function
containing `fetch("/api/cards")`. camelCase, no JSX, so
`reactComponentDetector` rejects it — confirmed by the probe: `g.components`
still has exactly 2 entries, neither of them `saveCard`.

**2, 3. Both `Card.tsx`.** One import line each and one `await saveCard();`
inside the existing handler arrow. The JSDoc gained two lines each saying why
the call is there. This is what moves the pins.

**4. `server.ts`.** Comment only, two JSDoc lines replaced by two JSDoc lines:
the "shapes but no schema" claim is gone, replaced by the real reason (with 0
entities `Workspace.open` throws "No entities found"). Diff is `2 +-`, i.e.
one line changed — line-count-neutral as required.

**5. `test/mini-fullstack-react.test.ts`.** (a) the same false reason removed
from the `warnings` case's comment and replaced with the real one, plus the
clause the plan asked for — that component attribution must also warn about
nothing; (b) `expect(g.clientCalls.length).toBeGreaterThan(0)` added
immediately before the `every()` at what was line 34, with a one-line comment
saying what it is for; (c) the re-derived pins; (d) the fourth call's expected
row, appended in probe order.

**6. `apps/server/src/app.ts`.** D1's six lines (the comment plus the two
fields) deleted from the `/shapes` literal. `git show` reports `6 -` and no
insertions on this file — a pure revert, nothing else touched.

**7. `apps/server/test/api.test.ts`.** The two `/shapes` assertions at
`:282-288` moved out of `it("serves the shapes and their drift, and the HTTP
surface")` into a **new sibling `it` in the same `describe`** hitting
`/graph`; the host case keeps everything else unmodified. The
`describe("the client-call chain over the API")` block changed endpoint in
place and its reads moved to `res.body.graph.*`. Its `it` name and two
comments were reworded from "alongside the shapes" to "on the graph", since
the old wording would have been false after the move.

**8. `apps/web/src/lib/api.ts`.** `ClientCall` and `UiComponent` added in the
file's hand-restated style; `clientCalls`/`components` added to `EntityGraph`
as **required**. The `UiComponent` doc comment states the real reason for the
prefix (a bare `Component` reads as React's own type at every call site) and
does not repeat the invented "file convention" claim.

**9. `apps/web/src/lib/client-calls.ts` (new).** `groupCallsByComponent` and
`componentLabel`, pure, no React. Types imported `import type` from
`@/lib/api`, with a comment saying why that must not become a value import.

**10. `apps/web/test/client-calls.test.ts` (new).** 12 cases, importing
`../src/lib/client-calls.js` (the `scene3d.test.ts` shape). Covers key
ordering, the code-point-vs-`localeCompare` distinction, the unattributed
bucket last and omitted when empty, empty components omitted, the `file`-then-
`line` sort, the stable tiebreak, and the two-key duplication.

**11. `apps/web/src/views/Dashboard.tsx`.** `ClientCallList` beside
`DriftView`/`RouteList`; card gated on `clientCalls.length > 0`; hooks
`data-psq="client-call"`, `data-psq="call-component"`, plus
`data-psq="open-in-editor"` on the desktop button. The `?? []` comment states
the first-paint reason first and the old-server absorption second, per D-D-10b.

**12. `e2e/harness.ts`.** `FULLSTACK_REACT_FIXTURE` constant; the desktop stub
now pushes `{file, line}` onto `window.__psqEditorCalls` **and still resolves
`true`**, with `pickFolder` and `platform` untouched — the folder-picker spec
at `psq.e2e.ts:47-54` depends on all three and still passes.

**13. `e2e/psq.e2e.ts`.** One new spec.

---

## Deviations from the plan

**One, and it is a deviation I made in order to hit the plan's own number.**

I first wrote the panel spec and the browser-fallback spec as **two** `it`
blocks, which took `e2e/psq.e2e.ts` to **23** `it(` — but §8 pins
`pnpm test:e2e` at **21 + 1**. Rather than ship a count the plan's gate table
calls red, I folded the browser-fallback reading into the tail of the same
`it`: the desktop page is closed, a second page is opened with no
`window.psq`, and the same panel is asserted to render 5 rows, 0
`data-psq="open-in-editor"` buttons, and `src/components/admin/Card.tsx:13` as
plain text. Count is **22**, exactly 21 + 1. The cost is one `it` doing two
things; the benefit is that the fallback is a permanent test rather than a
gate I ran once by hand. Flagging it because "one spec covering two shells" is
a judgement call a reviewer may want to reverse into two specs (and then also
amend the 21 + 1 number).

Nothing else departs from the plan. No file outside the Files-touched list was
modified. `packages/**` and `test/fixtures.ts` were not touched.

---

## Gates

| Gate | Expected | **Actual** |
|---|---|---|
| step 0 | clean except untracked `plan-d2.md` | **exactly that** — `git status --porcelain` showed one line, `?? feature-research/m5c-i/plan-d2.md`, on `master` at `d559b5e` |
| fixture probe | recorded first; `warnings` `[]`, new call `components.length === 2`, `both` ≥ 1, every pin printed | **PASS** — see above. `warnings` `[]`, length **2**, `both` = **2**, pins printed |
| `pnpm typecheck` | clean, all four projects | **clean** (root, e2e, `@psq/web`, `@psq/desktop`) |
| `PSQ_NO_CORPUS=1 pnpm test` | 0 failed | **250 passed \| 58 skipped (308)**, 0 failed (baseline 237 \| 58 / 295) |
| `pnpm test` | ≥ 295 + new, 0 failed | **308 passed (308)**, 0 failed |
| negative control, reading (a) | repointed server test fails | **FAILS as predicted**: `2 failed \| 25 passed`. The `MINI_NODE` control fails on `AssertionError: expected undefined to deeply equal []` — on **`undefined`**, not on a length, which is the version-skew shape. The chain case fails on `Cannot read properties of undefined (reading 'filter')` |
| negative control, reading (b) | e2e panel spec fails | **FAILS as predicted**: `1 failed \| 21 passed (22)`, at `expect.poll(() => headers.count()).toBe(3)` — **received 0**, i.e. the card is absent entirely (gated on `length > 0`), which is the shape the plan predicted |
| negative control, reading (c) | dashboard still renders, does not throw | **PASS, read from the two named channels**: (i) the other **21** e2e specs still passed in the same mutated run, including the four that render this Dashboard (`analyzes a project…`, `focuses an entity…`, `shows the drift…`, `lists the HTTP surface…`); (ii) `page.on("pageerror")` (`e2e/harness.ts`) did **not** fire — its handler throws `uncaught page error: …`, and that string appears nowhere in the run, and the one failure was the poll assertion, not a page error |
| mutation reverted | — | restored from a byte copy; `git diff --stat apps/server/src/app.ts` back to `6 -` (the revert alone), `api.test.ts` back to **27 passed** |
| editor-argument gate | recorded path absolute, ends `src/components/admin/Card.tsx` | **PASS** — 1 recorded call; `file.startsWith("/")` true, `file.endsWith("src/components/admin/Card.tsx")` true, `line` **13** (the re-derived pin, asserted end-to-end) |
| browser fallback | panel renders without `window.psq`; no editor buttons | **PASS** — 5 `data-psq="client-call"` rows, **0** `data-psq="open-in-editor"`, file:line as plain text |
| grouping-order control | two multi-row groups, `admin` before `shop`, disambiguated labels | **PASS** — 3 group headers in order: `Card (src/components/admin/Card.tsx)`, `Card (src/components/shop/Card.tsx)`, `Not attributed to a component`; **5** rows total (2 + 2 + 1), `no matching route` appears exactly once |
| `pnpm test:e2e` | 21 + 1, 0 failed | **22 passed (22)**, 0 failed. Baseline `it(` count re-counted before the change: **21** |
| `apps/web/dist` non-empty | verified after the last e2e run | **verified** — `apps/web/dist/index.html` 985 bytes, 3 files under `dist`. The build never failed, so `pnpm build:web` did not need re-running |
| `psq selftest` Northwind + fixtures | exit 0, counts stable | **exit 0 on all six roots**: Northwind full-stack **113 q**, `mini-fullstack-csharp` **16**, `mini-efcore` **51**, `mini-node` **27**, `mini-fullstack` **2**, `mini-fullstack-react` **2** — every count matches D1's record |
| corpus-name sweep | control first; list from `git diff --cached --name-only` | **PASS** — 12-term pattern file built programmatically from `test/corpus.local.json` + both Northwind spellings; control **12/12** per-term; sweep run as `git diff --cached --name-only \| xargs grep …`, `grep -c` printing **one count line per file, 13 lines**, every count **0** |
| token sweep | control 2/2 first, `grep -F -f` pattern file | **PASS** — 2 terms from `~/.config/psq/deploy.env` (`PSQ_TOKEN`, `PSQ_HOST`), never printed, never in a shell variable; control **2/2**; sweep **13 files, 0 total hits** |
| `git show --stat` | exactly the 13 paths on the feature commit | **PASS — exactly 13**, listed below (re-checked after the amend) |
| known flake `api.test.ts:213` | re-run before calling it a regression | **did not redden once** across 6 runs of that file plus 3 full-suite runs |

### `git show --stat` path list (commit `cd54ac2`)

```
 apps/server/src/app.ts                                       |   6 -
 apps/server/test/api.test.ts                                 |  34 +++--
 apps/web/src/lib/api.ts                                      |  21 +++
 apps/web/src/lib/client-calls.ts                             |  81 +++++++++
 apps/web/src/views/Dashboard.tsx                             | 108 +++++++++++-
 apps/web/test/client-calls.test.ts                           | 142 +++++++++++++++
 e2e/harness.ts                                               |  16 ++-
 e2e/psq.e2e.ts                                               |  51 ++++++-
 test/fixtures/mini-fullstack-react/server.ts                 |   2 +-
 .../mini-fullstack-react/src/components/admin/Card.tsx       |   6 +
 .../mini-fullstack-react/src/components/shop/Card.tsx        |   6 +
 .../mini-fullstack-react/src/lib/save-card.ts                |   8 ++
 test/mini-fullstack-react.test.ts                            |  47 ++++-
 13 files changed, 497 insertions(+), 31 deletions(-)
```

(`test/mini-fullstack-react.test.ts` gained 14 lines against `52df02d`: the
rewritten comment below. Every other path is byte-identical to `52df02d`, and
`git show … | grep '^[-+].*line:'` still prints the same five pin lines.)

### One gate not run as written, stated rather than glossed

§8's selftest row asks for banks **byte-identical** via `--out` + `diff -r` +
`jq 'map(del(.prompt))'`. I ran the six roots and matched every count against
D1's record, but I did **not** produce a byte-diff against a pre-change bank,
because doing so needs a second checkout state and the only cheap route
(`git stash`) is a state-changing git command this role must not run. The
structural argument D1 used still holds and is checkable from the commit
itself: `git show --stat` contains **no `packages/**` path**, so no generator
changed. Treat the byte-identity claim as **not measured this phase**; the
exit codes and counts are measured.

---

## Review correction — a THIRD false because-clause, this one mine

The review of `52df02d` returned **"Fix first — record only"**: no code defect,
one blocking record issue. **The rewritten comment at
`test/mini-fullstack-react.test.ts:23-25` planted a new false because-clause in
the exact comment this phase was chartered to de-falsify.** The shipped text
claimed `g.warnings` is `[]` partly because "every intra-fixture import
resolves (so component attribution warns about nothing either)". That is false:
attribution warns about nothing **whether or not** the import resolves.

It is worth naming plainly. This phase has now handled **three** false
because-clauses in the same neighbourhood — the fixture's original
"shapes but no schema" reason (3a), the same reason echoed in the test file
(3a), and this one, which I introduced while fixing the first two. The failure
mode is not carelessness about facts; it is writing a *plausible* third reason
to round out a list of two, without opening the file that would push. It was
caught only by review, not by any gate — no gate here can catch it, because
the assertion is green either way. That is the record's point.

### Every `warnings.push` reachable during node extraction, enumerated

Measured by reading each site, not inferred from the empty result.

| Site | Fires when | Why it cannot fire here |
|---|---|---|
| `node.ts:121` | `tsconfig.json` exists but fails to parse | **inside `if (existsSync(join(repoRoot,"tsconfig.json")))`** (`node.ts:118`); this fixture has no tsconfig, so the whole branch is skipped |
| `node.ts:145` | a referenced project contributed in-root files and was dropped | same branch, same reason |
| `node.ts:160` | a tsconfig parsed and named no files | same branch. `node.ts:155-159`'s own comment says outright: "This branch is unreachable when there is no tsconfig at all" |
| `node.ts:204` | `entities.length === 0 && shapes.length > 0` (shapes but no schema) | fails **both** conjuncts: the fixture has **1** entity and **0** shapes |
| `clients.ts:239` | a call path matches **more than one** route | the two routes differ in both method and path (`POST /api/admin/cards`, `GET /api/cards`), so `candidates.length` is never > 1 |
| `refs.ts:158` | two definitions produce the same `file#name` key | the four definitions have four distinct keys |
| `refs.ts:458` | no AST node recorded for a call | "unreachable by construction" per its own comment — `readClientCalls` records a node for every call it emits |
| `shapes.ts:205` | a declaration throws during shape reading | no shape declaration in the fixture reaches it; 0 shapes read, no throw |
| `routes.ts:102` | a route registered with a regex literal | both routes use string literals |
| `ddl.ts:57` | `CREATE TABLE` inside a template literal **with substitutions** | the fixture's `SCHEMA` is a no-substitution template literal, so it is read at `ddl.ts:52` instead |
| `ddl.ts:115` | a `CREATE TABLE` literal fails to execute | it executes — the fixture yields `entities: 1` |
| `ddl.ts:316` | an identifying column claimed by > `MAX_SHARED_KEY_CLAIMANTS` tables | one table |
| `ddl.ts:330` | two tables claim one identifying column equally | one table |

**So of the three clauses the shipped comment gave, two are supported at the
mechanism and one is not:**

1. "no tsconfig → no dropped-reference warning" — **VERIFIED**, and stronger
   than stated: it suppresses all *three* `programFor` warnings, not one.
2. "two unambiguous routes → `linkCalls` has nothing to warn about" —
   **VERIFIED**. `linkCalls`' only warning is the ambiguous match.
3. "every intra-fixture import resolves → attribution warns about nothing" —
   **FALSE, removed.** `refs.ts:16-19` is explicit that an identifier the
   checker cannot resolve produces no edge and **no warning**. A broken import
   would leave `g.warnings` `[]`, leave the call in `g.clientCalls`, and only
   hand it `components: []`.

Neither of the two surviving clauses had been checked at the mechanism by
anyone before this pass; both now have been.

### The comment as it now ships

```
  it("extracts without a single warning", () => {
    // Two reasons, each checked against the code that would push, not assumed:
    //   - no tsconfig, so `programFor` never enters the `existsSync` branch
    //     that holds all three of its warnings (node.ts:118-165) and takes
    //     the silent directory-scan fallback instead;
    //   - the two routes differ in both method and path, so no call can have
    //     more than one candidate and `linkCalls` (clients.ts:238-244), whose
    //     only warning is an ambiguous match, has nothing to say.
    //
    // Component attribution is NOT a third reason. Its only two warning sites
    // are a duplicate definition key (refs.ts:158) and a call with no recorded
    // AST node (refs.ts:454-458, unreachable by construction); neither is a
    // resolution failure. An intra-fixture import that failed to resolve is
    // SILENT — refs.ts:16-19, no edge and no warning — so it would leave this
    // assertion green and merely hand the call `components: []`. The gate for
    // that is the fourth call's two-key `components` pin in "holds one row of
    // every kind the panel renders" below, never this case.
    //
    // The CREATE TABLE literal in the server is not about warnings at all:
    // it is what gives the fixture an entity, without which Workspace.open
    // throws "No entities found" and the API/e2e cases cannot open it.
    expect(g.warnings).toEqual([]);
  });
```

The forward reference is by **case name**, not by line number, because a line
pin in a comment goes stale on the next edit — which is how this file's pins
work for facts under test and deliberately not how they work for prose.

### Echo check

`git show HEAD --name-only | xargs grep -in warn` over all 13 paths: the false
claim appears **nowhere else**. Two neighbouring claims were checked while
there and both hold — `server.ts:8-9` ("`linkCalls` warns whenever a call could
match more than one") matches `clients.ts:238-244`, and `shop/Card.tsx:5` ("no
such path, so `matches` stays null and no warning fires") matches
`candidates.length === 0` taking neither branch. **The commit message body
needed no change**: it already said an unresolved specifier "fails silently …
and no warning behind", which is the correct mechanism — the shipped comment
contradicted the commit message, not the other way round.

### Gates re-run after the fix

Comment-only, in a test file; no fixture line moved.

| Gate | Result |
|---|---|
| `pnpm typecheck` | **clean**, all four projects |
| `PSQ_NO_CORPUS=1 pnpm test` | **250 passed \| 58 skipped (308)**, 0 failed — identical to `52df02d` |
| pin diff unchanged | `git show HEAD -- test/mini-fullstack-react.test.ts \| grep '^[-+].*line:'` still prints exactly `-6/+11`, `-6/+11`, `-8/+13`, `-8/+13`, `+7` |
| `git show --stat` | still **exactly 13 paths** |
| `pnpm test:e2e` | **deliberately NOT re-run**, per the review: it rebuilds the bundle the live service serves and nothing in a comment can affect it |

## What the plan got wrong

Small, and none of it changed a decision.

1. **The plan's quoted probe line for the new call is off by six.** §4 quotes
   the review probe as `src/lib/save-card.ts:1  GET /api/cards`. Measured
   here, the call is at **`src/lib/save-card.ts:7`**. Everything else in that
   quoted block reproduced exactly. Most likely the review's scratchpad copy
   of `save-card.ts` was the bare one-liner the plan prints
   (`export function saveCard() { return fetch(...); }`, call on line 1),
   where the shipped file carries a four-line JSDoc and a multi-line body. The
   plan's own rule saved this: the pin was re-derived from **my** probe, so
   the `7` in the test and the `13` in the e2e assertion are measured, not
   copied. Flagging it because the plan presents that block as the number to
   reproduce, and a future hand comparing the two records would otherwise see
   a contradiction. **This is the only figure in §4 that did not reproduce.**
   **Now corrected in `plan-d2.md:208` itself**, with a dated CORRECTED note
   saying what it read before and why, so the plan does not outlive the build
   carrying a wrong number.
2. **`api.test.ts:282-288` needed a small rewording, not only a move.** The
   plan describes the move as assertion-level. The comment inside those lines
   says "the fixture case below", and the host case's `it` name and two
   comments in the `:332` describe said "alongside the shapes" — false once
   the source is `/graph`. I reworded those three strings. It is inside the
   plan's row-7 scope, but it is more than the plan's literal description.
3. **§8's `pnpm test:e2e` count and the "browser fallback" gate are in
   tension** — see Deviations. §5 asks for "one spec", §8 lists browser
   fallback as its own gate, and 21 + 1 admits only one new `it`. Resolved in
   favour of the number.
4. **`api.shapes()`'s return type needed no change** — the plan says so, and
   it is true: D1 never widened it, so the revert touched only `app.ts`.
   Recorded because §1 phrases it as something to check.

**Labelled as inferred, not measured:** the cause of item 1 (the review's
scratchpad file being the bare one-liner) is my inference from the plan's own
quoted source line, not something I can observe — that scratchpad is gone. The
measured fact is only that my probe printed `:7`.

---

## Open risks

- **The live `com.psq.server` now serves this bundle.** `pnpm test:e2e` ran
  `pnpm build:web`, which rewrote `apps/web/dist` — the directory the running
  service serves per request. The service was **not** restarted (out of scope,
  D-C-8), and per §1.3 it does not need to be: the loaded extractor already
  populates both fields. But the served UI changed the moment the build
  finished, which is worth knowing before review rather than after.
- **`apps/web/test/client-calls.test.ts` is typechecked by nothing.**
  `apps/web/tsconfig.json` includes only `src/**` + `vite.config.ts`. Known
  and accepted in `plan.md`; still true, now with 142 more lines behind it.
- **The `line` tiebreak within one file remains uncontrolled at fixture
  level**, by design (§4). It is covered in the unit test with hand-built
  objects.
- **`groupCallsByComponent` silently drops a component key that resolves
  against nothing.** Unit-tested as deliberate (a headerless group cannot be
  rendered, and inventing a header is a fabricated fact), but it is a *silent*
  drop with no warning channel — the same shape as the resolution failure §4
  warns about. Worth a reviewer's eye.
- **Nothing asserts that `/shapes` does NOT carry these fields.** The revert
  deleted D1's two lines and moved the coverage to `/graph`; no test anywhere
  fails if someone re-projects `clientCalls`/`components` onto `/shapes`
  tomorrow. A re-projection would pass every gate in this phase, silently
  restoring the payload duplication §1.4 rejected. **Recorded only — no test
  added, per the review.**
- Carried forward unchanged: `repoAClient` selftest exit 1; drift-site id
  collisions; no CI; the corpus config is the only copy of the ground truth.
