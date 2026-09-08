# Phase D — M5c-i: serve and render `clientCalls` / `components` — PLAN

Row D of the MVP table (`../green-and-push/progress.md:264`). Previous phase
record: `../shape-label/progress.md` (Phase C, shipped `7447ce1`). Branch from
`master` at `7447ce1`.

**Goal.** `GET /api/repos/:id/shapes` returns the `clientCalls` and
`components` that extraction has been producing since M5a/M5b; `apps/web/src/lib/api.ts` types catch up; a Dashboard card
lists **component → call → matched route**; `openInEditor` is wired for the
first time under Electron. A new fixture makes the full chain real so the
panel has a positive control.

---

## CORRECTION (2026-09-08, after the D1 review) — read this first

**The premise "the server has never served these fields" was false.**
`apps/server/src/app.ts:136-143` is `res.json({ graph: repo.graph })` — the
whole graph object, `clientCalls` and `components` included — and
`Dashboard.tsx:153-155` already fetches it in the same `Promise.all` as
`api.shapes`. The fields have been on the wire since M5a/M5b. What hid them is
`apps/web/src/lib/api.ts:106-109`, where the hand-restated `EntityGraph`
interface declares only `{ repo, provider, contextName, entities, relations,
warnings }` — the silent type-level drift this plan documents at its own
"Findings" line 63-67 and then failed to apply to itself.

Consequences, all for **D2**, which must be re-planned against this:

1. D-D-1's "costs zero extra requests" was already true without a server change.
2. **D-D-10's hazard model is an artefact of the endpoint choice, not the
   feature.** A D2 bundle reading `graph.clientCalls` would work against the
   *old* server; only reading them from `/shapes` creates the skew window. With
   D-D-10b's `?? []` guard the worst case either way is a silently empty panel
   until a restart, not a crash — but the hazard is avoidable, not inherent.
3. A design nobody costed: **a type-only change in `api.ts` plus D2, with no
   server commit at all.**

D1 (`1f4e8a5`) is not withdrawn — `/shapes` is a defensible home for calls
given routes already live there, and the reviewer found no code defect in it.
But `/graph` and `/shapes` now both carry the two arrays for every repo the
Dashboard opens, which is a real doubling of that payload section on a large
client repo. D2 decides: keep `/shapes` as the source and accept the
duplication, or read from `/graph` and revert D1's two lines.

## Findings this plan is built on (measured, not assumed)

Extraction runs done during planning, `pnpm psq graph` plus a probe over
`extract()`:

| Fixture | routes | calls | matched | calls with components | **both** | components |
|---|---|---|---|---|---|---|
| `mini-fullstack` | 4 | 8 | 7 | 0 | **0** | 0 |
| `mini-react` | 0 | 24 | 0 | 5 | **0** | 15 |

**`mini-react` = 5, settled — do not re-litigate.** Two review passes have
claimed 11, the second explaining 5 as "the count of distinct files". Measured
three times over `extract("test/fixtures/mini-react")`, printing each value
rather than a derived one: total calls **24**, calls with non-empty
`components` **5**, distinct files among them **5**, distinct component keys
used **5**. The file count and the call count are the same number, so the
"distinct files" explanation cannot be what produces 11. The five are
`admin/Card.tsx:4`, `HomePage.tsx:6`, `MutatingPanel.tsx:11`,
`shop/Card.tsx:4`, `session-provider.tsx:5`. Nothing downstream turns on it —
`both` is 0 for `mini-react` either way — but the method is recorded here so
the next hand re-runs it instead of re-arguing it.
| `mini-fullstack-csharp` | 0 | 1 | 0 | 1 | **0** | 1 |
| `mini-node` (e2e + server tests) | 3 | 0 | 0 | 0 | **0** | 0 |
| `mini-efcore` (e2e) | 0 | 0 | 0 | 0 | **0** | 0 |

**No existing fixture yields one call that is both attributed to a component
and matched to a route.** Stated precisely: `mini-react` would render 11 rows
of attributed-but-unmatched calls and `mini-fullstack` 7 matched-but-
unattributed ones, so grouping, the unattributed bucket and the "no matching
route" copy *could* be tested on what exists today. What has **no control
anywhere** is the conjunction — the matched-route cell of an attributed row,
which is the one thing the panel exists to show. That narrower gap is what
D-D-7 buys.

Other load-bearing facts:

- The shapes route (`apps/server/src/app.ts:202-216`) is a hand-built body,
  `{ shapes: repo.graph.shapes.map(... + drift), routes: repo.graph.routes }`.
  `repo.graph` already carries both new fields; there is no serializer,
  whitelist type or shared response contract to update.
- The chain is precomputed at extraction, not joined at request time:
  `ClientCall` (`packages/schema/src/index.ts:253-277`) carries
  `matches: string | null` (the matched route's raw `"METHOD path"`, set by
  `linkCalls`, `packages/extract/src/node/clients.ts:226-239`) and
  `components: string[]` (`Component.key` values). `Component`
  (`packages/schema/src/index.ts:285-292`) is `{ key, name, file, line }` with
  `key = "<repo-relative file>#<name>"`.
- Both fields are **always present arrays**. `.NET`
  (`packages/extract/src/dotnet.ts:293`) and the generic provider
  (`packages/extract/src/detect.ts:77-78`) hard-set `[]`. No `undefined`
  handling is needed anywhere.
- `components: []` on a call is **ambiguous** between "this stack has no
  attribution" and "genuinely unowned" — stated at
  `packages/extract/src/merge.ts:36`. Copy must respect that (D-D-4).
- `apps/web/src/lib/api.ts` restates server shapes by hand on purpose
  ("apps/web takes no workspace deps", comment at line 33); one private
  `call<T>()` helper (185-212) does a bare `JSON.parse` + `as T` — no zod, no
  runtime validation, so a payload that grows fields fails silently at the
  type level and never at runtime.
- Dashboard fetches everything in one `Promise.all`
  (`apps/web/src/views/Dashboard.tsx:143-184`) including `api.shapes`; `<aside>`
  cards render conditionally on `data.length > 0` (425, 456). `DriftView`
  (55-88) and `RouteList` (90-101) are pure prop-driven renders with no
  fetching. Tailwind + shadcn `Card`/`Badge`/`Button`; no CSS modules.
- `openInEditor(file, line?)` exists at `apps/web/src/lib/desktop.ts:11`,
  IPC at `apps/desktop/src/preload.ts:12-13`, handler at
  `apps/desktop/src/main.ts:88-99` (spawns `code -g file:line`). **It has no
  call site anywhere in `apps/web` today.** Electron is feature-detected via
  `isDesktop()` (`desktop.ts:25-27`), never a build flag; the browser fallback
  idiom is at `App.tsx:59-62`.
- `apps/web` has no component tests and no React Testing Library — only
  `apps/web/test/scene3d.test.ts`, which imports a plain module from
  `src/lib/` and runs under the root `vitest.config.ts:7`
  (`apps/*/test/**/*.test.ts`).
- e2e is a real server + real built `dist` + headless Chromium.
  `newPage({ desktop: true })` (`e2e/harness.ts:91-100`) injects a stub
  `window.psq` whose `openInEditor` resolves `true`. Stable selectors use a
  `data-psq="..."` attribute convention.

---

## Decisions

- **D-D-1 — Same endpoint, two new top-level keys.** The body becomes
  `{ shapes, routes, clientCalls, components }`. No new route: the Dashboard
  already fetches this one inside its single `Promise.all`, so the panel costs
  zero extra requests and no new loading state.
- **D-D-2 — No join on the server.** `matches` and `components` pass through
  untouched; grouping is a UI concern. The endpoint stays a projection of the
  graph, and M5c-ii (Phase E) reads the same fields.
- **D-D-3 — The join lives in a pure helper, not in JSX.**
  `apps/web/src/lib/client-calls.ts` exports
  `groupCallsByComponent(components, calls)` returning an ordered
  `{ component: Component | null; calls: ClientCall[] }[]`, unattributed
  bucket last. Rationale: there is no RTL in this repo and adding it is out of
  scope; a pure `src/lib` module is unit-testable today with zero new
  dependencies (`scene3d.test.ts` is the precedent), so the logic worth
  testing is tested and the JSX stays trivial.
- **D-D-4 — Copy must not overclaim.** The unattributed bucket is labelled
  "Not attributed to a component"; a call with `matches: null` is tagged "no
  matching route". Never "no component" / "route missing" — `[]` and `null`
  are ambiguous per `merge.ts:36`.
- **D-D-4b — Duplicate component names must be disambiguated.** Measured
  during planning: `mini-react` extracts two distinct components both named
  `Card` (`src/components/admin/Card.tsx#Card` and
  `src/components/shop/Card.tsx#Card`). Grouping by `key` is therefore correct
  and grouping by `name` would silently merge them, but the *rendered* header
  must also disambiguate or the panel shows two identical "Card" groups. Rule,
  mirroring D-C-1 from Phase C: show the bare `name` when it is unique across
  `components`, else `name` with its file. The label is display-only; keys stay
  the join.
- **D-D-5 — Card gated on `clientCalls.length > 0`,** mirroring
  `Dashboard.tsx:425,456`. Every .NET-only repo — which is what James uses
  daily — renders exactly what it renders today.
- **D-D-6 — `openInEditor` gated by `isDesktop()`, and it gets an ABSOLUTE
  path.** `ClientCall.file` / `Component.file` are repo-relative
  (`packages/schema/src/index.ts:288`), and the Electron handler does no root
  resolution — `apps/desktop/src/main.ts:90` spawns `code -g <file>:<line>`
  from the main process's cwd, so a relative path opens the wrong file or
  nothing. The button must pass `<repo.path>/<file>`; `Dashboard` already has
  `repo` (`Dashboard.tsx:30`) and `RepoSummary.path` is absolute
  (`apps/web/src/lib/api.ts:10`). In a browser the same text renders as plain
  `file:line` (relative, for reading). This is the first call site of a bridge
  method that has been dead since the desktop shell landed, so nothing else
  pins its contract.
- **D-D-6b — the e2e stub must record its ARGUMENT.** `e2e/harness.ts:97`
  resolves `true` unconditionally, so "the button called the stub" passes
  whatever path is passed — a gate that passes by finding nothing, and the one
  that would have hidden D-D-6. The stub records its arguments (e.g. onto a
  `window.__psqEditorCalls` array) and the spec asserts the recorded path is
  absolute and ends with the expected repo-relative file.
- **D-D-7 — New fixture `test/fixtures/mini-fullstack-react/`,** because the
  table above shows the feature has no positive control otherwise: an Express
  server with routes plus React components whose calls hit those routes, so at
  least one call has a non-null `matches` **and** a non-empty `components`.
  Existing fixtures and every assertion over them are left untouched (Phase B/C
  lesson: do not disturb verified artifacts).
- **D-D-8 — e2e opens the new fixture** via a third harness constant; the
  panel spec runs under `newPage({ desktop: true })` so the injected
  `openInEditor` stub covers the Electron path without running Electron. Rows
  carry `data-psq="client-call"` and `data-psq="call-component"`.
- **D-D-9 — `pnpm test:e2e` runs this phase.** D-C-10 (skip e2e) applied only
  because Phase C could not reach the e2e fixtures; this phase changes web and
  server code, so e2e is mandatory. `apps/web/vite.config.ts` builds with
  `emptyOutDir: true` into the directory the live server serves from disk
  (`apps/server/src/index.ts:33-35`), so the served bundle is empty during the
  build and **stays empty if the build fails**. Rule: e2e is the last gate, and
  if it fails the phase ends with `pnpm build:web` re-run so the checkout is
  never left serving an empty bundle.
- **D-D-10 — No deploy of the SERVER; the WEB half deploys itself, and that
  is the phase's main hazard.** D-C-8 carried forward: restarting the service
  is James's call, and the running `com.psq.server` (pid 16538, started Fri
  Sep 4 15:05) stays on the `37960f2` load until it restarts. But
  `apps/server/src/index.ts:33-35` serves `apps/web/dist` from disk **per
  request**, and `pnpm test:e2e` runs `build:web` into that same directory. So
  the moment the mandated e2e run finishes, the live service serves the NEW UI
  against the OLD `/shapes` handler that returns only `{ shapes, routes }`.
  With no runtime validation in `call<T>()` (`api.ts:185-212`), `clientCalls`
  would be `undefined` and D-D-5's `clientCalls.length > 0` would throw — a
  blank dashboard on the live service, not a graceful degrade.
- **D-D-10b — Defensive reads are mandatory, not optional.** The Dashboard
  reads `sh.clientCalls ?? []` and `sh.components ?? []`. This is the
  version-skew guard for exactly the window above and for any future
  old-server/new-bundle pairing; it is not defensive-programming reflex, and
  the reason belongs in a comment so a later reader does not "simplify" it
  away. A gate covers it: with the two fields removed from the server
  response, the dashboard must still render (empty panel), not throw.
- **D-D-11b — The fixture carries NO tsconfig and uses relative imports
  only.** Root `tsconfig.json` includes `test/**/*.ts` and already excludes the
  three fixtures whose client TS uses `@/` path aliases it cannot resolve
  (`mini-fullstack-csharp`, `mini-react`, `mini-solution-tie`). A fixture in
  that shape would need a fourth exclude entry — a 12th file touched,
  discovered mid-build. Avoided by constraint: extraction falls back to
  `ts.createProgram(walk(root, [".ts", ".tsx"]))` with `jsx: Preserve`
  (`packages/extract/src/node.ts:167`, `:40`), so a tsconfig-free React fixture
  extracts fine. If that turns out to be wrong, `tsconfig.json` becomes a
  declared 12th path and the audit says so — it does not get edited silently.
- **D-D-11 — No quiz code is touched.** Question banks must come out
  byte-identical; that is a gate, not an expectation.

## The fixture, specified exactly (so "re-cut until it works" is not a loop)

`test/fixtures/mini-fullstack-react/` — no tsconfig, relative imports only
(D-D-11b), no miss-catalogue. It must contain, by construction, one row of
every kind the panel renders:

| Row kind | How | Proves |
|---|---|---|
| attributed **and** matched | a component calling a path the server declares | the conjunction that exists in no current fixture |
| attributed, **unmatched** | a component calling a path the server does not declare | the "no matching route" copy (D-D-4) |
| **unattributed**, matched | a module-level call outside any component | the unattributed bucket (D-D-4) |
| duplicate component names | two same-named components in different directories | the label rule (D-D-4b) |

Success is a number, checked before anything depends on it: **`both` ≥ 1**,
plus at least one row of each other kind, and `g.warnings` `toEqual([])`
(house rule 3; `linkCalls` warns on ambiguous multi-candidate matches at
`packages/extract/src/node/clients.ts:239-245`, which near-duplicate hand-cut
routes will trip). If the number is 0 the fixture is wrong — it is fixed
there, not worked around downstream.

## Build order, in two halves

Split on the reviewer's seam, because the web half carries the live-service
hazard (D-D-10) and the server half carries none:

**D1 — server.** No web change, so no `build:web`, no `dist` churn, no skew.

1. Fixture + `test/fixtures.ts` + its extract test. Probe, record `both`.
2. `apps/server/src/app.ts`: the two fields. Server tests, mutation gate.

**D2 — web.**

3. Types + `client-calls.ts` helper + its unit test.
4. `Dashboard.tsx` panel: grouping, labels, `isDesktop()` branches, defensive
   reads.
5. e2e: harness constant, argument-recording stub, panel spec. Runs last;
   `apps/web/dist` verified non-empty afterwards.

D1 is safely shippable on its own. D2 is the half that changes what the live
service serves the moment its e2e run finishes.

## Files touched

| # | Path | Change |
|---|---|---|
| 1 | `test/fixtures/mini-fullstack-react/**` | new fixture: Express server with routes, React components calling them |
| 2 | `test/fixtures.ts` | export `MINI_FULLSTACK_REACT` beside the existing constants |
| 3 | `test/mini-fullstack-react.test.ts` | new: asserts ≥1 call with `matches` non-null AND non-empty `components`; component keys resolve against `g.components` |
| 4 | `apps/server/src/app.ts` | add `clientCalls` + `components` to the shapes response body (202-216) |
| 5 | `apps/server/test/api.test.ts` | extend the Node-repo case (both keys present, `[]` on `MINI_NODE` — the negative control) and add a case over the new fixture asserting the non-empty chain |
| 6 | `apps/web/src/lib/api.ts` | hand-restated `ClientCall` + `UiComponent` interfaces (prefixed, per the file's `RepoSummary`/`Layout3DNode` convention and to avoid colliding with React's `Component`); extend `shapes()`'s return type |
| 7 | `apps/web/src/lib/client-calls.ts` | new: pure `groupCallsByComponent`, ordering pinned (component key ascending, unattributed bucket last; calls by `file` then `line`) plus the D-D-4b label helper |
| 8 | `apps/web/test/client-calls.test.ts` | new: unit tests for the helper |
| 9 | `apps/web/src/views/Dashboard.tsx` | new `ClientCallList` panel beside `DriftView`/`RouteList`; state for the two new fields; card gated on `clientCalls.length > 0`; `data-psq` hooks; `isDesktop()`-gated editor buttons |
| 10 | `e2e/harness.ts` | third fixture constant; the desktop stub records `openInEditor` arguments (D-D-6b) |
| 11 | `e2e/psq.e2e.ts` | panel spec under `desktop: true`: a component → call → matched route row is visible; the editor button calls the stub |

Nothing else. `packages/**` is not touched: extraction, schema and quiz are
already correct for this phase.

## Gates

Baselines from Phase C's record (`../shape-label/progress.md`).

| Gate | Baseline | Expected |
|---|---|---|
| `pnpm typecheck` | clean | clean |
| `PSQ_NO_CORPUS=1 pnpm test` | 230 passed \| 58 skipped (288) | +new tests, 0 failed |
| `pnpm test` | 288 passed | +new tests, 0 failed |
| fixture probe | — | **`both` ≥ 1**, number recorded in the audit |
| `pnpm test:e2e` | 21 passed | 21 + new spec, 0 failed |
| **negative control** | — | drop the two fields from the response by hand → the new server test AND the e2e panel spec must both fail; restore |
| browser fallback | — | the panel renders without `window.psq`; no editor buttons |
| `psq selftest`, Northwind + fixtures | exit 0 | unchanged, banks byte-identical — **a cheap regression check, not a positive gate**: no code path this phase touches reaches `packages/quiz`, so it cannot fail. Method as Phase C: `--out` + `diff -r` + `jq 'map(del(.prompt))'` |
| corpus-name sweep | control 10/10 first | 0 genuine hits |
| token sweep | control 2/2 first, `grep -F -f` pattern file, never a shell variable | 0 |
| `git show --stat` | — | exactly the 11 paths above |
| `apps/web/dist` non-empty at end | — | verified after the last e2e run (a *test* failure leaves it populated; only a *build* failure empties it) |
| **version-skew gate** | — | with the two fields removed from the server response, the dashboard still renders an empty panel and does not throw (D-D-10b) |
| **editor-argument gate** | — | the recorded `openInEditor` path is absolute and ends with the expected repo-relative file (D-D-6b) |
| fixture warnings | — | `g.warnings` `toEqual([])` |
| known flake | `apps/server/test/api.test.ts:213` flaked once in Phase B (~13 runs) | if it reddens, re-run before calling it a regression — this phase edits that file |

Step 0: working tree clean except `feature-research/m5c-i/**`, which is
untracked by design (the Phase C plan critique's blocking item — do not write
a gate that its own plan file fails).

**Known and accepted:** two of the three new test files land outside every
tsconfig — root `tsconfig.json` includes `apps/server/src/**` only, and
`apps/web/tsconfig.json` only `src/**` + `vite.config.ts`, so
`apps/server/test/api.test.ts` and `apps/web/test/client-calls.test.ts` are
run by vitest but never typechecked. Phase C sidestepped this by putting its
unit test under root `test/`; that escape is not available here, because both
files must sit beside the code they exercise. Recorded so the Phase C lesson
is not silently reversed. The fixture's extract test (root `test/`) and the
e2e spec (`e2e/tsconfig.json`) are both covered.

## Out of scope

M5c-ii's comparative generator (Phase E, which should use `shapeLabel` from
`@psq/quiz` for any shape it names); the `repoAClient` `not-a-member`
wrong-reference-answer defect; drift-site id collisions; per-function
complexity (roadmap Phase 2/3); adding React Testing Library; deploy.
