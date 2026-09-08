# Phase D — M5c-i, half **D1 (server)** — AUDIT

Branch `m5c-i-server`, cut from `master` at `7447ce1`. Plan: `plan.md`,
followed verbatim. Scope was D1 only — the plan's "Build order, in two halves"
steps 1 and 2. Nothing under `apps/web`, `apps/desktop` or `e2e/` was opened,
`pnpm test:e2e` was not run, and `com.psq.server` was not deployed or
restarted.

## Files changed

| # (plan) | Path | New? |
|---|---|---|
| 1 | `test/fixtures/mini-fullstack-react/server.ts` | new |
| 1 | `test/fixtures/mini-fullstack-react/src/components/admin/Card.tsx` | new |
| 1 | `test/fixtures/mini-fullstack-react/src/components/shop/Card.tsx` | new |
| 1 | `test/fixtures/mini-fullstack-react/src/lib/boot.ts` | new |
| 2 | `test/fixtures.ts` | modified |
| 3 | `test/mini-fullstack-react.test.ts` | new |
| 4 | `apps/server/src/app.ts` | modified |
| 5 | `apps/server/test/api.test.ts` | modified |

Eight paths, all inside the plan's Files-touched rows 1–5. **`tsconfig.json`
(row 12) was NOT needed** — see "Was tsconfig.json needed?" below.

## What changed, per file

**`test/fixtures/mini-fullstack-react/**` (new, 4 files).** Built to the
plan's "The fixture, specified exactly" table. No tsconfig, relative imports
only, no miss-catalogue (D-D-11b).

- `server.ts` — imports express (so the client-call reader's file skip keeps
  every registration out of `clientCalls`), declares two unambiguous routes
  (`POST /api/admin/cards`, `GET /api/cards`), and carries a `CREATE TABLE`
  literal so the "shapes but no schema" warning cannot fire.
- `src/components/admin/Card.tsx` — `export function Card()` calling
  `POST /api/admin/cards`: the **attributed AND matched** row, the conjunction
  that exists in no other fixture.
- `src/components/shop/Card.tsx` — `export function Card()` calling
  `GET /api/shop/wishlist`, a path the server does not declare: the
  **attributed, unmatched** row. Same component name as the admin one, in a
  different directory, so the duplicate-name label rule (D-D-4b) has a control.
- `src/lib/boot.ts` — a module-scope `fetch("/api/cards")` in a file no
  component reaches: the **unattributed, matched** row.

**`test/fixtures.ts`** — one `export const MINI_FULLSTACK_REACT` beside the
existing constants, with a doc comment stating what the fixture is the only
control for and why it carries no tsconfig. No other line touched.

**`test/mini-fullstack-react.test.ts` (new)** — six cases: `g.warnings`
`toEqual([])`; the express half read as routes and never as client calls; the
two same-named components pinned by key (plus `new Set(names).size === 1`, so
the fixture cannot silently stop being a duplicate-name control); the full
`clientCalls` list pinned exactly, one row of each kind; `both.length >= 1` as
a floor; and every attributed key resolving against `g.components` — that last
loop carries its own positive control (`some(c => c.components.length > 0)`),
because a run with no attribution at all would pass it by iterating nothing.

**`apps/server/src/app.ts`** — two lines added to the `/api/repos/:id/shapes`
response body, `clientCalls: repo.graph.clientCalls` and
`components: repo.graph.components`, with a comment recording D-D-2 (the join
is precomputed at extraction; grouping is a UI concern and is not done here).
Nothing else in the handler changed; there is still no serializer or whitelist
type anywhere to update.

**`apps/server/test/api.test.ts`** — two changes.
1. The existing Node-repo shapes case gains
   `expect(res.body.clientCalls).toEqual([])` and the same for `components` —
   the negative control on `MINI_NODE`, which has a server half and no client
   half. The comment says explicitly that this pair is only meaningful because
   the new fixture case proves the same two keys carry real content.
2. A new `describe("the client-call chain over the API")` block over
   `MINI_FULLSTACK_REACT`: at least one served call is both attributed and
   matched (with that row's fields pinned), every attributed key resolves
   against the `components` served in the *same* body, two components share
   one name, and the calls arrive as a flat unjoined list including an
   unattributed row.

## Fixture probe — the positive control, run before anything depended on it

Measured with `extract()` over the built fixture, before the server was
touched:

| Number | Value |
|---|---|
| total client calls | **3** |
| matched (`matches !== null`) | **2** |
| attributed (`components.length > 0`) | **2** |
| **both (matched AND attributed)** | **1** |
| components | **2** |
| routes | **2** |
| `g.warnings` | **`[]`** |

Row kinds present, all four required by the plan's table:

- attributed **and** matched — `src/components/admin/Card.tsx:8`,
  `POST /api/admin/cards` → `matches: "POST /api/admin/cards"`,
  `components: ["src/components/admin/Card.tsx#Card"]`
- attributed, **unmatched** — `src/components/shop/Card.tsx:8`,
  `GET /api/shop/wishlist` → `matches: null`, one component
- **unattributed**, matched — `src/lib/boot.ts:5`, `GET /api/cards` →
  `matches: "GET /api/cards"`, `components: []`, `enclosing: null`
- duplicate component names — `src/components/admin/Card.tsx#Card` and
  `src/components/shop/Card.tsx#Card`, both named `Card`

`both` = 1 ≥ 1, so the plan's success number was met on the first cut; the
fixture was not re-cut.

## Gates

| Gate | Baseline | Result |
|---|---|---|
| `pnpm typecheck` | clean | **clean** |
| `PSQ_NO_CORPUS=1 pnpm test` | 230 passed \| 58 skipped (288) | **237 passed \| 58 skipped (295)**, 0 failed |
| `pnpm test` | 288 passed | **295 passed**, 0 failed |
| fixture probe | — | **`both` = 1**, numbers above |
| mutation gate | — | **passed**, both observations below |
| `psq selftest`, Northwind + fixtures | exit 0 | **exit 0 everywhere**, counts unchanged |
| corpus-name sweep | control first | **control 12/12; 0 genuine hits** |
| token/host sweep | control first, `grep -F -f` file | **control 2/2; 0 hits** |
| `git show --stat` | — | **exactly the 8 paths above** |
| known flake `api.test.ts:213` | flaked once in Phase B | **did not redden** across 4 runs of that file |

Test-count arithmetic: +7 in both runs (6 new fixture extract cases + 1 new
server case). Neither run has a skipped-count change, so the new cases are
hermetic, as intended.

### Mutation gate — both observations

The plan calls this out as what makes the `toEqual([])` MINI_NODE assertion a
real control rather than a gate that passes by finding nothing.

1. **Mutated.** The two new lines were deleted from the shapes response body
   by hand. `npx vitest run apps/server/test/api.test.ts` →
   **2 failed | 24 passed (26)**. Both new assertions reddened:
   - `a Node repo over the API > serves the shapes and their drift, and the
     HTTP surface` — `AssertionError: expected undefined to deeply equal []`.
     The control fails on `undefined`, not on a length, which is exactly the
     failure mode it exists to catch.
   - `the client-call chain over the API > serves calls and components
     alongside the shapes, unjoined`.
2. **Restored.** The file was restored from a pre-mutation copy;
   `git diff --stat apps/server/src/app.ts` reads `1 file changed,
   6 insertions(+)` (the two field lines plus their four-line comment), and
   the same run is **26 passed**.

### `psq selftest` — cheap regression check

Nothing in this diff reaches `packages/quiz`, and the structural proof is
stronger than the run: `git show --stat` contains **no `packages/**` path at
all**, so no bank can differ byte-wise. Run anyway, per the plan:

| Root | Result |
|---|---|
| Northwind full-stack | ok, **113 questions** (Phase C record: 113) |
| fixture `mini-fullstack-csharp` | ok, **16** (Phase C record: 16) |
| fixture `mini-efcore` | ok, 51 |
| fixture `mini-node` | ok, 27 |
| fixture `mini-fullstack` | ok, 2 |
| fixture `mini-fullstack-react` (new) | ok, 2 |

Every root exits 0. The two roots with a Phase C baseline match it exactly.

### Sweeps — positive control first, both times

**Corpus-name sweep.** Pattern file built programmatically from
`test/corpus.local.json` path segments plus the Northwind root name; 12 terms,
never held in a shell variable. Control: `grep -F -i -f` against a file
containing every term returned **12/12**. Swept over all 8 changed files.
Classification by dictionary check, never by quoting a term:

- every **non-dictionary** term (the genuinely private ones): **0 hits**.
- three terms are ordinary dictionary words. Two are 6 letters (29 and 14
  hits) and one is 9 letters (1 hit). Every one of those hits is generic
  English prose or a psq identifier — `clientCalls`, `client-call`, "the
  server half", "the developer's machine" (a pre-existing line in
  `test/fixtures.ts` I did not touch). **0 genuine hits.**

**Token/host sweep.** Pattern file written from `~/.config/psq/deploy.env`
(`PSQ_TOKEN`, `PSQ_HOST`) by a script, never through a shell variable and
never echoed. Control **2/2** against a file containing both values. Swept
over the 8 changed files: **0 hits** (counted, not printed).

**One near-miss worth recording.** The first attempt at the corpus sweep put
the file list in an unquoted shell variable and reported "NO HITS". Under zsh
that variable does not word-split, so `grep` was handed one nonexistent
path and the gate passed by finding nothing — the exact negative-gate failure
mode the house rules warn about. It was caught because the run also printed
`ugrep: ... No such file or directory`, and every sweep above was redone with
an explicit `git diff --cached --name-only` file list and a positive control
that must hit before the negative one is believed.

## Was `tsconfig.json` needed?

**No.** D-D-11b holds as written. `pnpm typecheck` is clean with no exclude
entry added, and the reason is mechanical: the root `tsconfig.json` include
glob is `test/**/*.ts`, which does not match `.tsx`, so the fixture's two
component files are never in the program. Its two `.ts` files (`server.ts`,
`src/lib/boot.ts`) *are* included and typecheck fine, because neither uses a
path alias — which is the constraint D-D-11b imposed. Extraction reads the
fixture through the fallback `ts.createProgram(walk(root, [".ts", ".tsx"]))`
with `jsx: Preserve`, and attributed both components on the first run.

## Deviations from the plan

**None.** The eight changed paths are all inside plan rows 1–5; row 12
(`tsconfig.json`) was not needed and was not touched. No file outside the
plan's Files-touched list was modified.

Two things worth flagging that are *not* deviations:

- The corpus-name sweep control is **12/12** where the plan's gate table says
  "control 10/10 first". The 10 was Phase C's term count; the pattern file is
  regenerated from the corpus config each time and now yields 12 terms
  (the config gained an entry since, and I added both Northwind spellings).
  The gate's substance — a control that hits before the sweep is believed — is
  met.
- The plan's Gates table also lists `pnpm test:e2e`, the browser-fallback,
  version-skew, editor-argument and `apps/web/dist` gates. All five belong to
  D2 and were deliberately **not** run; `apps/web/dist` was not rebuilt, so
  the live service still serves the bundle it served before this branch
  existed.

## Open risks

- **D2 has not run.** The server now returns two fields no client reads. That
  is harmless in the other direction (an old bundle ignores unknown keys), and
  it is the safe half to ship first, which is why the plan split here. The
  dangerous pairing is the reverse — a new bundle against an old server — and
  D-D-10b's defensive reads are what cover it. Nothing in D1 creates that
  pairing.
- **The live service is untouched, but it is NOT pinned to `master`.**
  `com.psq.server` was not deployed or restarted, so it is still executing the
  load it started on Fri Sep 4 (`37960f2`). **Correction, made during the D1
  review — the original sentence here was wrong and inverted the mechanism:**
  the LaunchAgent has `WorkingDirectory` = this checkout and runs
  `apps/server/src/index.ts` through `tsx`. It has no notion of a ref. This
  working tree is checked out on `m5c-i-server`, so a crash, a reboot or a
  `kickstart` **right now loads `1f4e8a5`**, not `7447ce1`. The consequence is
  benign here (two extra keys an old bundle ignores), but the claim itself was
  the dangerous kind: a false safety because-clause that D2 would have
  inherited — see the house note that gating the fix is not gating the reason,
  and the inherited-records-go-stale rule. Whatever is checked out is what a
  restart runs.
- **The fixture's line numbers are pinned exactly** in both new test files
  (routes at `server.ts:25,30`, components at line 6, calls at line 8/8/5).
  Editing a comment in a fixture file will redden them. That is the usual
  house trade — an exact `toEqual` is what makes the fixture a control — but a
  later hand should expect it rather than read it as a reader regression.
- **`apps/server/test/api.test.ts` is outside every tsconfig**, as the plan's
  "Known and accepted" note records. The new case in it is run by vitest and
  never typechecked; its `res.body` accesses are `any`. Recorded, not fixed —
  fixing it is out of scope.
