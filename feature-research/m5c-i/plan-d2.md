# Phase D2 — M5c-i (web half): render component → call → matched route — PLAN

Continues `plan.md` (read its CORRECTION section first) and
`progress.md` (D1, shipped `1f4e8a5`, record `d559b5e`, `master` at `d559b5e`,
in sync with `origin/master`, working tree clean). D1's decisions D-D-2 through
D-D-11 carry forward unchanged except where amended below.

**Goal.** A Dashboard panel that lists **component → call → matched route**,
with `openInEditor` wired for the first time under Electron; the settled
endpoint question behind it; and the three defects the D1 review carried
forward, fixed in the same pass.

---

## 1. The endpoint decision — `/graph`, and D1's projection is reverted

**Decision D-D-12: the panel reads `clientCalls` and `components` from
`/api/repos/:id/graph`. `apps/server/src/app.ts:215-220` (D1's two field lines
and their comment) is reverted, and D1's two server test cases are repointed at
`/graph` rather than deleted.**

Evidence, each measured this session rather than inherited:

1. **`/graph` already returns them.** `app.ts:136-143` is
   `res.json({ graph: repo.graph })` — the whole graph object, no projection.
   Nothing else in `apps/server/src` reads or reshapes these two fields.
2. **The client already holds the graph at render time.** `Dashboard.tsx`
   declares `graph: EntityGraph | null` (state, ~131-141), fills it from the
   existing `Promise.all` (`setGraph(g.graph)`, ~170-176) and reads it during
   render (`graph?.entities.find(...)` at 186, `graph?.relations.filter(...)`
   at 192-193). The panel therefore needs **no new fetch, no new state slot and
   no new loading branch**. Sourcing from `/shapes` would add two state slots
   for data the component is already holding.
3. **The skew window does not exist on this path.** Stated in the form that
   actually carries the argument, because the running process **has no notion
   of a ref** (the D1 audit correction): `tsx` loaded whatever was in this
   working tree at `Fri Sep 4 15:05:56`, when pid 16538 started. The last
   commit to change extraction of these fields is `1de65eb`, authored
   `2026-09-04 07:09:47` — **eight hours before that process started** — so the
   loaded extractor populates both. (`37960f2` is the commit usually quoted as
   "the Sep-4 load"; it was committed at 15:09:27, *after* the process started,
   so it is a label for that tree, not its provenance. The three commits that
   introduce and populate the fields — `b7e60e3` 2026-08-24, `37a6b44`
   2026-08-25, `1de65eb` — are each an ancestor of `37960f2` as well, re-run
   with `git merge-base --is-ancestor` by two hands.)
   So the bundle this phase builds into `apps/web/dist` renders a **working**
   panel against the already-running process, with no restart and no deploy.
   This inverts D-D-10 — described in `plan.md` as "the phase's main hazard" —
   into a non-event.
4. **No duplicated payload.** `/graph` and `/shapes` both carrying the two
   arrays doubles that section of the response for every repo the Dashboard
   opens, and the Dashboard opens both endpoints on every load.
5. **Coverage goes up, not down.** `/graph` has **no** body-shape assertion for
   these fields today (`api.test.ts:82` checks only `graph.entities` length).
   Repointing D1's two cases puts the negative control (`MINI_NODE` → `[]`) and
   the non-empty chain case onto the endpoint the feature now depends on.

**The counter-argument, stated and rejected.** `/shapes` colocates calls with
`routes`, which sounds like the natural home for a panel that renders routes.
It is not load-bearing: the join is precomputed at extraction —
`ClientCall.matches` is the matched route's raw `"METHOD path"` string, set by
`linkCalls` (`packages/extract/src/node/clients.ts:226-247`) — so **the panel
never reads the `routes` array at all**. Colocation buys nothing the panel uses.

**What the revert does and does not touch.** D1's fixture, its extract test and
`test/fixtures.ts` all stay: they are the feature's positive control and are
independent of the endpoint choice. `1f4e8a5` is not withdrawn from history;
D2 commits the revert on top. `api.shapes()`'s return type stays
`{ shapes: Shape[]; routes: Route[] }` — item 6 of `plan.md`'s Files-touched
table shrinks accordingly. Verified: the **only** consumer of `/shapes`
anywhere is `Dashboard.tsx:158`, and it reads `sh.shapes` / `sh.routes` only,
so the revert breaks no caller.

**"Repoint the two cases" is not a URL swap — the landing spots are pinned
here, not left to mid-build.** D1's coverage is in two different shapes:

- `api.test.ts:282-288` is **two assertions inside** an existing `/shapes` case
  (`it("serves the shapes and their drift, and the HTTP surface")`, `:257`)
  whose other assertions (`:262-280`) are genuinely about `/shapes`. Those two
  assertions move out into a **new sibling `it` in the same `describe`** that
  hits `/graph`; the host case keeps everything else, unmodified.
- `api.test.ts:332` `describe("the client-call chain over the API")` is a whole
  block of its own: it changes endpoint in place, `/shapes` → `/graph`, and its
  assertions move from `res.body.clientCalls` to `res.body.graph.clientCalls`.

## 2. Amendments to D1's decisions

- **D-D-1 → superseded by D-D-12.** Two new top-level keys on `/shapes`: gone.
- **D-D-10 → dissolved.** Not "no deploy of the server, and the web half
  deploys itself into a skew window", but: the web half deploys itself into a
  server that already serves what it reads (§1.3). Restarting the service
  remains James's call (D-C-8); nothing in this phase needs it. The `dist`
  discipline in D-D-9 is unchanged and still mandatory — `pnpm test:e2e` is
  `pnpm build:web && vitest run --config vitest.e2e.config.ts`, and
  `build:web` empties the directory the live server serves per request, so a
  **build** failure leaves the live service serving nothing.
- **D-D-10b → kept, with an honest reason.** The Dashboard reads
  `graph?.clientCalls ?? []`. The `??` is **not** primarily a version-skew
  guard: `graph` is `EntityGraph | null` and is `null` on every first paint, so
  `graph?.clientCalls` is `ClientCall[] | undefined` regardless of what the
  server sends. It absorbs an old server as a second-order effect, because
  `call<T>()` (`api.ts:185-212`) ends in a bare `return body as T` with no
  runtime validation. The comment states both, in that order. The fields are
  declared **required** in the interface (the server always sends arrays —
  `dotnet.ts:293` and `detect.ts:77-78` hard-set `[]`); making them optional to
  justify the `??` would be a false claim about the wire.
- **D-D-6 → unchanged** (absolute path, `isDesktop()`-gated), **D-D-6b →
  unchanged** (the e2e stub records its argument).
- **`UiComponent`, and a false because-clause retired.** `plan.md` justified the
  prefix as "per the file's `RepoSummary`/`Layout3DNode` convention". There is
  no such convention: `api.ts` restates server types under **the same name** in
  all 20 of its `export interface` declarations — `RepoSummary` and
  `Layout3DNode`, the two cited as evidence for a prefix, are themselves the
  server's own names (`apps/server/src/workspace.ts:41`,
  `packages/graph/src/layout3d.ts:25`). The real
  reason to avoid a bare `Component` is that it reads as React's component type
  at every call site in a React codebase. Keep the name `UiComponent`; state
  that reason, not the invented one. `ClientCall` keeps its server name.
- **Step 0 gate corrected.** `plan.md` says `feature-research/m5c-i/**` is
  untracked by design. It was committed in `d559b5e`. Step 0 is therefore:
  working tree clean except this file (`plan-d2.md`), which is untracked until
  the phase record.

## 3. The three carried-forward fixes

### 3a. The false comment (two sites, one claim)

`test/fixtures/mini-fullstack-react/server.ts:12-13` says the `CREATE TABLE`
literal is present "so the 'shapes but no schema' warning cannot fire". That
warning needs `shapes.length > 0`; this fixture extracts **0 shapes**, so it can
never fire. The literal is nonetheless **mandatory**, for a reason verified this
session by reading `apps/server/src/workspace.ts:115-136`: `Workspace.open`
throws `"No entities found. …"` when `graph.entities.length === 0`, so without
it `POST /api/repos` 400s and **neither the D1 API case nor D2's e2e can open
this fixture at all**.

- Fix `server.ts:12-13` **line-count-neutral** (a two-line JSDoc replacing a
  two-line JSDoc), so the pinned route lines 25 and 30 do not move.
- Fix the same false reason where the test file repeats it,
  `test/mini-fullstack-react.test.ts:23-25`. That comment lists three reasons
  `g.warnings` is `[]`; the "shapes-but-no-schema" clause is replaced by the
  real one, and the comment gains the clause it is currently missing — that
  **component attribution must also warn about nothing** (see §4, which adds a
  fourth call and could otherwise redden line 26 for a reason the comment never
  mentioned).

### 3b. The vacuous assertion

`test/mini-fullstack-react.test.ts:34`,
`expect(g.clientCalls.every((c) => c.file !== "server.ts")).toBe(true)`, passes
on an empty list. It is the one loop in the file without its own positive
control (contrast the deliberate one at 105-107). Add
`expect(g.clientCalls.length).toBeGreaterThan(0)` immediately before it, with a
one-line comment saying what it is for. Note in passing: the file is not
*currently* vacuous — `toEqual` at 58-89 pins exactly three calls — but that is
coverage in a different `it`, which is precisely the shape of gate this
project has been bitten by (`negative-gates-need-a-positive-control`).

### 3c. The missing grouping-order control

See §4.

## 4. The fourth call, specified exactly

**What is missing.** Every call in the fixture maps to 0 or exactly 1
component, and no component owns more than one call. So D2's grouping-order
rule has no fixture-level control and the e2e panel would render three
one-row groups.

**The shape.** One new fixture file,
`test/fixtures/mini-fullstack-react/src/lib/save-card.ts`, exporting a plain
(non-component) function containing one `fetch("/api/cards")`; **both** `Card`
components import it and call it from inside their existing handler arrow.

```
export function saveCard() { return fetch("/api/cards"); }
```

Why this one call and not a second `fetch` inside `admin/Card.tsx`:

| It buys | How |
|---|---|
| a **multi-component call** | the owner walk resolves the call to `saveCard` (a non-component Def), then BFS over `graph.reverse` reaches both `Card` components and returns both keys, sorted (`refs.ts:408-431`) |
| **two multi-call groups** | each `Card` group then holds its own call plus the shared one |
| the **`file` comparator** exercised | the two calls in each group are in different files (`…/Card.tsx` vs `src/lib/save-card.ts`) |
| **no new route, no ambiguity** | `GET /api/cards` is already declared at `server.ts:30`, so `linkCalls` sees exactly one candidate and the multi-candidate warning (`clients.ts:238-244`) cannot fire |
| **not a component** | `saveCard` is camelCase and contains no JSX, so `reactComponentDetector` (`refs.ts:69-70`) rejects it |

What it does **not** buy: the `line` tiebreak within one file is still
uncontrolled at fixture level. That is a pure comparator property and is
covered exhaustively in `apps/web/test/client-calls.test.ts` with hand-built
objects, which is the right place for it.

**Pre-flight probe, run and recorded BEFORE anything depends on it** (the
D-D-7 rule): print, do not derive —

- `g.warnings` is `[]`;
- the new call's `components` array has **length 2**, both keys resolving in
  `g.components`;
- `both` (matched ∧ attributed) is still ≥ 1;
- the exact `line` of every component and call, to re-pin the test.

**Already reproduced once, during plan review** — in a scratchpad copy of the
fixture, through **both** `extractNode` and `extract`, identical results:
`warnings` `[]`, `components` still 2, `both` = 2, and the new call as

```
src/lib/save-card.ts:7  GET /api/cards  matches="GET /api/cards"
components=["src/components/admin/Card.tsx#Card","src/components/shop/Card.tsx#Card"]
```

> **CORRECTED 2026-09-08, after the D2 build.** This line read
> `src/lib/save-card.ts:1` as first written. The implementer's own probe
> measured **`:7`** — the shipped file carries a four-line JSDoc and a
> multi-line body, where the review's scratchpad copy was the bare one-liner
> printed above. Every other figure in this block reproduced exactly. The pin
> in the test is re-derived from the build's probe, so nothing depended on the
> wrong number; it is corrected here so the plan does not outlive the build
> carrying it.

The extensionless-specifier variant was run too: `warnings` `[]`, call still
present, `components` `[]` — the silent failure, confirmed rather than
predicted. **This does not replace the implementer's probe.** The numbers above
are what the probe must reproduce; a mismatch is a stop (below), not a nudge.

**Stop rule.** If the new call does not come back with two component keys, the
implementer **stops and reports the measured shape** — it does not re-cut the
fixture until something passes. Two named fallbacks, in order: (i) adjust the
import specifier form (see below) and re-probe once; (ii) fall back to a second
`fetch` inside `admin/Card.tsx`'s existing handler, which is guaranteed by the
direct-owner path (`refs.ts:411`), and record that the multi-component case
remains uncontrolled. Either way the audit states which shape shipped and why.

**Import specifier — pinned, and the reason it is load-bearing.** Use
`import { saveCard } from "../../lib/save-card.js";` in **both** `Card.tsx`
files (two levels up from `src/components/<dir>/` to `src/`, then `lib/`), with
the **`.js` extension**:

- the fixture has no tsconfig (D-D-11b), so extraction takes the fallback
  `ts.createProgram(walk(root, [".ts",".tsx"]), FALLBACK_OPTIONS)`
  (`packages/extract/src/node.ts:167`), and `FALLBACK_OPTIONS`
  (`node.ts:29-41`) sets **`moduleResolution: NodeNext`** — under which a
  relative specifier must carry the `.js` extension. Extensionless is not a
  style preference here, it is a resolution failure;
- `mini-node` is the precedent and is **also tsconfig-free**, so it exercises
  this exact path — `test/fixtures/mini-node/db.ts:2` and `contracts.ts:2` both
  use `./x.js` against `.ts` files. (The fixture tsconfigs in this repo are
  three: `mini-react/`, `mini-solution-tie/` and
  `mini-fullstack-csharp/client/`. Neither `mini-node` nor
  `mini-fullstack-react` has one, and `programFor` looks only at
  `join(repoRoot, "tsconfig.json")` — `node.ts:116`, no upward walk.)
- the repo root `package.json` is `"type": "module"` and there is no
  `package.json` under `test/` or `test/fixtures/`, so the fixture is in ESM
  mode and the extension is **mandatory**, not stylistic.

**This is the fixture's first intra-fixture import, and getting it wrong fails
SILENTLY.** `refs.ts:16-19`: an identifier the checker cannot resolve produces
**no edge and no warning**. So an unresolved specifier leaves `g.warnings`
`[]` (that assertion still passes), leaves the call in `g.clientCalls`, and
merely gives it `components: []` instead of two keys. The only signal is the
probe's `components.length === 2` — which is why the probe runs first and why
its number is recorded rather than inferred.

**Line pins move, deliberately.** Adding an import line to each `Card.tsx`
shifts that file's component and call lines. The pinned numbers in
`test/mini-fullstack-react.test.ts` (43, 49, 64, 74 — components at line 6,
calls at line 8) are re-derived **from the probe output**, not by hand, and the
diff must show exactly those pin changes and no others. The `toEqual` at 58-89
pins the **whole `clientCalls` array in order**, so the fourth call's position
in it is also read off the probe, never assumed from filename order. `server.ts`'s route
pins (25, 30) must **not** move — that is what makes 3a's comment fix
line-count-neutral. `apps/server/test/api.test.ts` pins no line numbers for
this fixture — but it does carry **one positional pin**,
`expect(both[0]).toMatchObject({… admin …})` at `:351`, and the fourth call
joins `both`. It survives because `clientCalls` is sorted by file then line
(`clients.ts:215`) and `src/components/admin/Card.tsx` sorts before
`src/lib/save-card.ts` — confirmed in the review probe, and to be re-confirmed
by the implementer's own rather than assumed. A repo-wide search for
`mini-fullstack-react` / `MINI_FULLSTACK_REACT` finds no other pins outside
`feature-research/**`.

## 5. The web half

- **`api.ts`** — add `ClientCall` and `UiComponent` interfaces in the file's
  existing hand-restated style, and add `clientCalls: ClientCall[]` +
  `components: UiComponent[]` to `EntityGraph` (106-109). The interface stays a
  deliberate partial restatement (the real graph also carries `shapes` and
  `routes`, which `apps/web` reads from `/shapes`); that is pre-existing and
  out of scope, but is stated here so a reviewer does not read it as an
  omission.
- **`client-calls.ts`** (new, `apps/web/src/lib/`) — two pure exports, no React.
  **It must take its `ClientCall` / `UiComponent` imports from `@/lib/api` as
  `import type`.** Root `vitest.config.ts:7` has no `@` alias; the existing
  precedent only runs because `apps/web/src/lib/scene3d.ts:1` imports its types
  type-only and the specifier is erased at compile time. A *value* import from
  `@/lib/api` here fails to resolve when vitest runs the new unit test. The
  test file imports `../src/lib/client-calls.js`, mirroring
  `apps/web/test/scene3d.test.ts:16`. Two exports:
  - `groupCallsByComponent(components, calls)` →
    `{ component: UiComponent | null; calls: ClientCall[] }[]`.
    - groups ordered by `component.key` **ascending, plain `<`/`>` string
      comparison** (not `localeCompare`, which is locale-dependent);
    - the unattributed bucket (`component: null`, calls whose `components` is
      empty) is **last**, and is omitted entirely when no call is unattributed;
    - components owning **no** calls are **omitted** (`mini-react` has 15
      components and 5 attributed calls; 10 empty groups would be noise);
    - calls within a group sorted by `file` then `line`, both ascending; equal
      keys keep input order (`Array.prototype.sort` is stable, ES2019+);
    - **a call with two component keys appears in both groups.** This is
      intended, not a bug, and is unit-tested so that it reads as deliberate.
  - `componentLabel(component, allComponents)` → D-D-4b: the bare `name` when
    it is unique across **all** components in the graph, else `name` with its
    file. Display-only; keys remain the join.
- **`Dashboard.tsx`** — a `ClientCallList` sub-component beside `DriftView`/
  `RouteList` (pure, prop-driven, same house style: `Card`/`CardHeader`/
  `CardTitle`/`CardContent`, `Badge` for the method). Reads
  `graph?.clientCalls ?? []` / `graph?.components ?? []` (D-D-10b comment).
  Card gated on `clientCalls.length > 0` (D-D-5). Copy per D-D-4: the
  unattributed bucket is "Not attributed to a component"; a call with
  `matches: null` is tagged "no matching route" — never "no component" /
  "route missing". Row hooks `data-psq="client-call"`, group header
  `data-psq="call-component"`. Under `isDesktop()` the file:line is a button
  passing an **absolute** `` `${repo.path}/${call.file}` `` plus `call.line`
  (D-D-6); in a browser the same text renders as plain relative `file:line`.
- **e2e** — `harness.ts` gains a third fixture constant and the desktop stub
  **records** `openInEditor`'s arguments onto `window.__psqEditorCalls`
  (D-D-6b: the current stub resolves `true` unconditionally, a gate that passes
  by finding nothing). The stub has an **existing dependent**: the folder-picker
  spec at `e2e/psq.e2e.ts:47-54` also runs under `newPage({ desktop: true })`,
  so `pickFolder` and `platform` stay exactly as they are and `openInEditor`
  must still resolve `true` — recording is added alongside the return value,
  not in place of it (`harness.ts:94-100`). `psq.e2e.ts` gains one spec under
  `newPage({ desktop: true })` opening the new fixture, asserting: both `Card`
  groups render with **disambiguated** labels (the fixture's two components are
  both named `Card`), the admin row shows its matched route, the unattributed
  bucket is present, and clicking the editor button records a path that is
  absolute and ends with `src/components/admin/Card.tsx`.
  `analyzeFixture` waits on `svg g.cursor-pointer`, which needs ≥1 entity — the
  fixture measures `entities: 1` from the DDL literal (§3a). If that selector
  does not appear, that is reported, not worked around.
  Checked and clear, recorded so nobody re-derives it: adding a third fixture
  cannot disturb `list.repos[0]` at `e2e/psq.e2e.ts:61-67` wherever the new
  spec is placed — `Workspace.list()` sorts by name
  (`apps/server/src/workspace.ts:65-69`) and ids are path-derived, so
  `mini-efcore` stays first.

## 6. Build order

1. **Fixture + the three fixes.** New `save-card.ts`, both `Card.tsx` imports,
   both comment fixes, the positive control at line 34. **Probe. Record the
   numbers. Re-pin from probe output.** Unit suite green before moving on.
2. **Server revert.** Delete `app.ts:215-220`; repoint the two `api.test.ts`
   cases at `/graph`. Unit suite green.
3. **Types + helper + unit test.** `api.ts`, `client-calls.ts`,
   `apps/web/test/client-calls.test.ts`.
4. **Panel.** `Dashboard.tsx`.
5. **e2e last** (it rebuilds the served `dist`): harness constant, recording
   stub, panel spec. Verify `apps/web/dist` non-empty afterwards.

## 7. Files touched

| # | Path | Change |
|---|---|---|
| 1 | `test/fixtures/mini-fullstack-react/src/lib/save-card.ts` | **new**: the shared non-component helper holding the fourth call |
| 2 | `test/fixtures/mini-fullstack-react/src/components/admin/Card.tsx` | import + call `saveCard()` inside the existing handler |
| 3 | `test/fixtures/mini-fullstack-react/src/components/shop/Card.tsx` | same |
| 4 | `test/fixtures/mini-fullstack-react/server.ts` | comment fix only, line-count-neutral (3a) |
| 5 | `test/mini-fullstack-react.test.ts` | comment fix (3a), positive control (3b), re-pinned lines, the fourth call's expected row |
| 6 | `apps/server/src/app.ts` | **revert** D1's `clientCalls`/`components` on `/shapes` (215-220) |
| 7 | `apps/server/test/api.test.ts` | move `:282-288` out into a new sibling `/graph` case; switch the `:332` describe to `/graph` (§1, landing spots pinned) |
| 8 | `apps/web/src/lib/api.ts` | `ClientCall` + `UiComponent`; the two fields on `EntityGraph` |
| 9 | `apps/web/src/lib/client-calls.ts` | **new**: `groupCallsByComponent` + `componentLabel` |
| 10 | `apps/web/test/client-calls.test.ts` | **new**: unit tests incl. the `line` tiebreak and the two-key duplication |
| 11 | `apps/web/src/views/Dashboard.tsx` | the `ClientCallList` panel |
| 12 | `e2e/harness.ts` | third fixture constant; argument-recording desktop stub |
| 13 | `e2e/psq.e2e.ts` | the panel spec |

Nothing else. `packages/**` is not touched. `test/fixtures.ts` is **not**
touched (the constant already exists from D1).

## 8. Gates

Baselines **re-measured during plan review, not inherited**: `PSQ_NO_CORPUS=1
pnpm test` = **237 passed | 58 skipped (295)**, exit 0; `e2e/psq.e2e.ts` has
exactly **21** `it(`. Both match D1's record.

| Gate | Expected |
|---|---|
| step 0 | working tree clean except untracked `feature-research/m5c-i/plan-d2.md` |
| fixture probe | recorded **before** dependent edits: `warnings` `[]`, new call `components.length === 2`, `both` ≥ 1, every line pin printed |
| `pnpm typecheck` | clean (all four projects) — **but note what it does not cover**: `apps/web/tsconfig.json` includes only `src/**` + `vite.config.ts`, so `apps/web/test/client-calls.test.ts` is typechecked by nothing and is only ever run by vitest (the `plan.md` "Known and accepted" entry, still true) |
| `PSQ_NO_CORPUS=1 pnpm test` | 0 failed |
| `pnpm test` | ≥ 295 + new, 0 failed |
| **negative control** (one mutation, three readings) | hand-strip the two fields from `/graph`'s body → (a) the repointed server test fails, (b) the e2e panel spec fails, (c) **the dashboard still renders and does not throw** (the D-D-10b guard). Restore. Reading (c) needs a **named channel or it is a claim, not a measurement**: with the fields gone the card is absent entirely (gated on `length > 0`), so (c) is read from the other e2e specs still passing *and* `page.on("pageerror")` (`e2e/harness.ts:103-105`) not firing. |
| **editor-argument gate** | the recorded `openInEditor` path is absolute and ends with `src/components/admin/Card.tsx` (D-D-6b) |
| browser fallback | panel renders without `window.psq`; no editor buttons |
| grouping-order control | the e2e panel shows two multi-row groups, `admin` before `shop`, with disambiguated labels |
| `pnpm test:e2e` | 21 + 1, 0 failed — **runs last** |
| `apps/web/dist` non-empty | verified after the last e2e run; if the **build** failed, re-run `pnpm build:web` before ending the phase |
| `psq selftest` Northwind + fixtures | exit 0, banks byte-identical (`--out` + `diff -r` + `jq 'map(del(.prompt))'`) — a cheap regression check, not a positive gate |
| corpus-name sweep | control must hit first; file list from `git diff --cached --name-only`, **never** an unquoted shell variable (zsh does not word-split) |
| token sweep | control 2/2 first, `grep -F -f` pattern file |
| `git show --stat` | exactly the 13 paths above **on the feature commit**. `feature-research/m5c-i/audit.md` and this plan land in a **separate record commit** on top, the D1 shape (`1f4e8a5` feature, `d559b5e` record) — otherwise this gate reddens on a correct build |
| known flake | `api.test.ts:213` (`result.correct`) — re-run before calling it a regression; this phase edits that file |

## 9. Out of scope

Deploy / restarting `com.psq.server` (D-C-8, James's call — and this phase does
not need it, §1.3). Phase E's comparative generator. React Testing Library.
The `repoAClient` `not-a-member` defect. Drift-site id collisions. The
pre-existing `EntityGraph` omissions of `shapes`/`routes`.
