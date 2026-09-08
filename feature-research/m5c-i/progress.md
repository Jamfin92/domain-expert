# Phase D1 — M5c-i (server half): serve `clientCalls` / `components` — PROGRESS

**Status: SHIPPED at `1f4e8a5` (2026-09-08); reviewer "Fix first — record only,
do not re-cut"; the two record fixes are made; James accepted 2026-09-08.**
Feature commit on `m5c-i-server`, branched from `master` at `7447ce1` (the
Phase C close-out). This record is committed on top of it and `master` is
fast-forwarded to the record commit (the D-A-3 / D-C-9 shape).

Plan: `plan.md` — **read its CORRECTION section first.** Audit: `audit.md`.
Previous phase record: `../shape-label/progress.md`. Spec: row D of the MVP
table, `../green-and-push/progress.md:264`.

---

## What shipped

`GET /api/repos/:id/shapes` now returns `clientCalls` and `components`
alongside `shapes` and `routes`, passed through untouched from `repo.graph`
(no join, no filter — D-D-2). Plus the fixture that makes the feature
testable at all.

| Part | Where | What |
|---|---|---|
| Server | `apps/server/src/app.ts` | two field lines appended to the same hand-built literal as `routes` |
| Fixture | `test/fixtures/mini-fullstack-react/` (`server.ts`, `src/components/admin/Card.tsx`, `src/components/shop/Card.tsx`, `src/lib/boot.ts`) | no tsconfig, relative imports only (D-D-11b) |
| Fixture constant | `test/fixtures.ts` | `MINI_FULLSTACK_REACT` |
| Extract test | `test/mini-fullstack-react.test.ts` | the chain, pinned exactly |
| Server tests | `apps/server/test/api.test.ts` | `MINI_NODE` `[]` control + the non-empty case over the new fixture |

**Fixture probe, run before anything depended on it:** 3 calls, 2 matched,
2 attributed, **`both` = 1**, 2 components, 2 routes, `warnings` `[]`. All four
required row kinds present on the first cut — attributed+matched
(`admin/Card.tsx:8` → `POST /api/admin/cards`), attributed+unmatched
(`shop/Card.tsx:8`), unattributed+matched (`src/lib/boot.ts:5`, module scope),
and two components both named `Card`. The reviewer re-measured through both
`extractNode` and `extract` and confirmed every number, and swept every other
fixture: **`mini-fullstack-react` is the only fixture in the repo with
`both` ≥ 1.**

### Gates

| Gate | Baseline (`7447ce1`) | Result |
|---|---|---|
| `pnpm typecheck` | clean | clean (all four projects) |
| `PSQ_NO_CORPUS=1 pnpm test` | 230 \| 58 (288) | **237 \| 58 (295)**, 0 failed |
| `pnpm test` | 288 | **295**, 0 failed |
| mutation gate (drop the two server lines) | — | `2 failed | 24 passed`; the `MINI_NODE` control fails on **`expected undefined to deeply equal []`** — on `undefined`, not on a length, which is the version-skew shape. Reviewer reproduced it independently |
| extra mutations (reviewer) | — | `call.components = []` in `refs.ts:462` reddens 3 fixture tests incl. the loop's positive control; `call.matches = null` in `clients.ts:234` reddens 2 |
| `psq selftest` Northwind + fixtures | exit 0 | exit 0 everywhere; Northwind 113 q, `mini-fullstack-csharp` 16 q — match the Phase C record |
| corpus sweep | control first | implementer 12/12 then 0; **reviewer redid it independently**: 172-term pattern file built programmatically from `test/corpus.local.json`, control 172/172, **0 genuine hits** |
| secret sweep | control 2/2 | 0 hits, both passes |
| `git show --stat` | — | exactly the 8 paths |
| `tsconfig.json` needed? | — | **no** — `tsc --listFiles` shows neither `.tsx` file enters the program (root include is `test/**/*.ts`) |
| flake `api.test.ts:213` | 1 in ~13 runs (Phase B) | did not redden in 8 runs across implementer + reviewer |

## Review history

1. **Plan critique**: four blocking (relative path to `openInEditor`; the
   live-dashboard skew window; the `tsconfig.json` contingency; an overstated
   fixture justification) and twelve non-blocking, all folded in before
   approval. It also proposed the D1/D2 split this phase follows.
2. **Implementation review**: no code defect found. Two blocking **record**
   corrections (below) and seven non-blocking. Verdict "Fix first — record
   only. Do not re-cut `1f4e8a5`." James accepted.

## Corrections made to the records (both were false because-clauses)

- **The audit claimed a restart today would load `7447ce1` "because the work
  is on a branch and `master` is unchanged".** Wrong, and inverted the
  mechanism: the LaunchAgent has `WorkingDirectory` = this checkout and runs
  `apps/server/src/index.ts` through `tsx`. **It has no notion of a ref.**
  Whatever is checked out is what a restart runs. Fixed in `audit.md`.
- **The plan claimed the server "has never served" these fields.** Also wrong
  — see the next section. Fixed at the top of `plan.md`.

## The correction D2 must be planned against

`apps/server/src/app.ts:136-143` is `res.json({ graph: repo.graph })` — the
**whole graph object**, `clientCalls` and `components` included — and
`Dashboard.tsx:153-155` already fetches it in the same `Promise.all` as
`api.shapes`. **These fields have been on the wire since M5a/M5b.** What hid
them is `apps/web/src/lib/api.ts:106-109`, where the hand-restated
`EntityGraph` interface declares only `{ repo, provider, contextName,
entities, relations, warnings }`.

So:

1. D-D-1's "costs zero extra requests" was already true without D1.
2. **D-D-10's skew hazard is an artefact of the endpoint choice.** A D2 bundle
   reading `graph.clientCalls` works against the *old* server; only reading
   from `/shapes` opens the window. With D-D-10b's `?? []` guard the worst case
   either way is a silently empty panel until a restart, not a crash.
3. `/graph` and `/shapes` now both carry the arrays for every repo the
   Dashboard opens — a real doubling of that payload section on a large client
   repo.

**The open decision for D2:** read the calls from `/graph` (already there,
no skew window, no duplication, and revert D1's two lines) or keep `/shapes`
as the source (colocated with `routes`, already built and green, accept the
duplication). Decide it in the D2 plan, not mid-build.

## What the next phase needs to know

- **Carried forward from the D1 review, to fold into D2:**
  - **`test/fixtures/mini-fullstack-react/server.ts:12` carries a false
    comment.** It says the `CREATE TABLE` literal is there so the "shapes but
    no schema" warning cannot fire; that warning needs `shapes.length > 0` and
    this fixture extracts **0 shapes**, so it can never fire. The literal is
    nonetheless **mandatory** for a different reason: without entities,
    `Workspace.open` throws "No entities found"
    (`apps/server/src/workspace.ts:118-134`), the new API case would 400, and
    D2's e2e could not open the fixture at all. `test/mini-fullstack-react.test.ts:23-25`
    repeats the false reason. Fix the comment to state the real one.
  - **The fixture has no multi-call group and no multi-component call.** Every
    call maps to 0 or exactly 1 component and no component owns more than one
    call, so D2's grouping-order rule (component key ascending; calls by `file`
    then `line`) has **no fixture-level control** and the e2e panel would
    render three one-row groups. Add a fourth call.
  - `test/mini-fullstack-react.test.ts:34`'s `every(...)` assertion passes on
    an empty list — covered in aggregate two cases later, but it is the one
    loop in the file without its own positive control.
- **The fixture's line numbers are pinned exactly** in both new test files
  (routes `server.ts:25,30`; components line 6; calls 8/8/5). Editing a comment
  in a fixture file reddens them. House style — 66 such pins already exist
  across five fixture test files — and it is what makes the fixture a control.
  Not a trap, but know it before editing the fixture.
- **D2's five deferred gates were deliberately not run**: e2e, browser
  fallback, version skew, editor argument, `dist` non-empty. `apps/web/dist`
  was never rebuilt and still holds what it held before this branch.
- **`pnpm test:e2e` is not harmless** and D2 must run it: `apps/web/vite.config.ts`
  builds with `emptyOutDir: true` into the directory the live server serves
  from disk (`apps/server/src/index.ts:33-35`). Run it as the last gate, and if
  the *build* fails re-run `pnpm build:web` so the checkout is never left
  serving an empty bundle. A *test* failure leaves `dist` populated.
- **The live service is still on its Sep 4 (`37960f2`) load** and was never
  restarted. It is not pinned to `master` — see the correction above. Deploy
  stays James's call (D-C-8).
- **`mini-react` has 5 attributed calls, not 11.** Two review passes claimed
  11; measured three times, printing each value rather than a derived one:
  24 calls, 5 with non-empty `components`, 5 distinct files, 5 distinct
  component keys. Recorded with the method in `plan.md` so the next hand
  re-runs it instead of re-arguing it.
- **A sweep can pass by never reading a file.** The implementer's first corpus
  sweep put the file list in an unquoted shell variable; zsh does not
  word-split, so `grep` got one nonexistent path and the gate reported "NO
  HITS". It surfaced only because `ugrep` also printed `No such file or
  directory` — plain `grep` with stderr redirected would have been silent.
  Every sweep here was redone with an explicit `git diff --cached --name-only`
  list and a control that must hit first. If the sweep is ever scripted, the
  control is the script's first assertion.
- Carried forward, unchanged by this phase: `repoAClient` exits 1 on selftest
  (one `not-a-member` with a wrong reference answer); drift-site id collisions;
  no Dockerfile, no CI; the corpus config is the only copy of the ground truth;
  `packages/*/test/**` is outside every tsconfig, and so are
  `apps/server/test/api.test.ts` and (in D2) `apps/web/test/*` — vitest runs
  them, `pnpm typecheck` does not.
- **Next: D2** — `api.ts` types, the `client-calls.ts` grouping helper and its
  unit test, the Dashboard panel with `isDesktop()`-gated `openInEditor`
  (absolute path, D-D-6), the harness stub that records its argument (D-D-6b),
  and the e2e panel spec. Start by reading this file and `plan.md`'s CORRECTION
  section, then settle the `/graph` vs `/shapes` question above.
