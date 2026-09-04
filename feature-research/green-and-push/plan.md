# domain-expert (psq): state, green-and-push, MVP estimate

## Context

James wants to start using psq daily: point it at his own repos (React + .NET
full-stack, some worked on by agents), take the quiz, and rebuild a mental map of
the client-side React/shadcn component arrangement and the .NET backend choices.
Before that: establish where the repo actually is, clear the remaining test
failures, push, and estimate what stands between today and daily use.

This plan's **build scope is Phase A only** (green and push). The MVP estimate
at the bottom is the deliverable for "estimate MVP deployment" and seeds the
next phases; each of those gets its own plan in its own context window.

## State, measured 2026-09-04

| | |
|---|---|
| Branch / HEAD | `m5b-component-attribution` @ `4e2b7d6`, working tree clean |
| Unpushed | 7 commits, 106 files vs `origin/master` (`9133e25`, the publish-scrub). `master` is an ancestor of HEAD; fast-forward is safe. GitHub default branch is `master` |
| Hermetic `PSQ_NO_CORPUS=1 pnpm test` | **204 passed / 58 skipped (262)**, exit 0 |
| Full `pnpm test` (corpus present) | **2 failed / 260 passed**, both in `packages/extract/test/node.test.ts` repo-D block |
| `pnpm typecheck` | clean |
| `pnpm test:e2e` | **19 / 19 green** (real Chromium, real bundle, real API) |
| README test counts | already say 204 / 262, correct |

**The e2e premise is stale.** There are no e2e failures to fix. What is red is
the corpus-backed suite, and only because a private corpus repo (repo-D) gained
two tables on 2026-09-03 after its ground truth was pinned.

Both failures are the defect class the last phase record predicted (progress-1b
item 4a):

1. `node.test.ts:50` — `expect(g.relations.map(r => r.id)).toEqual(exp.relationIds!)`:
   a full ordered list over a live repo. Received 7 ids, pinned 5.
   **The same assertion is repeated for repo-E at `:113`** and will break the
   same way the day that repo grows.
2. `node.test.ts:60` — `expect(g.warnings).toContain(exp.houseStyleWarning!)`:
   the pinned string embeds a table count ("…identifying column of N tables");
   N grew.

Decisions already taken by James (2026-09-04):

- **tsconfig.json exclude stays as-is** (whole `test/fixtures/mini-fullstack-csharp`,
  matching the `mini-react` / `mini-solution-tie` precedent). Closes the OPEN
  item in progress-1b. No code change.
- **Push = fast-forward `master` to HEAD, push `master`** (branch pushed too).
- **Deploy shape**: LaunchAgent on a tailnet port for personal use, **and** keep
  the door open to package the app cross-platform (Windows/Mac/Linux) so anyone
  can run it locally on their own code, with their own cloud or self-hosted
  agents optional.
- **Phase order after push**: Deploy → 1b-ii → M5c.

Carried items not in this phase (recorded in A6 so they are not lost):

- `psq selftest` exits 1 on any full-stack repo (2 findings, shape-name
  ambiguity). Rule 5: full-stack banks are formally untrusted until 1b-ii.
- `clientCalls` / `components` are extracted (M5b) but not served or rendered;
  no question generator consumes them (M5c).
- `apps/server/test/api.test.ts:213` flaked once in ~13 runs; scout found no
  nondeterminism in the grading path (seeded rng, sorted row comparison), so the
  cause is in the harness (`openMini()` / shared workspace), not the grader.
  Not seen in today's 3 runs. Leave it; record it.
- No Dockerfile, no CI, no hosting config anywhere.

## Phase A — green and push (this session)

One implementer pass, one reviewer pass. Small.

### A1. Make corpus-aggregate assertions robust; never re-pin (Phase 1 D-2 stands)

**Rule for the sweep.** An assertion over a **whole-repo aggregate** (all
relations, all routes, all cascades, table count, a warning that embeds a
count) drifts whenever the live repo grows and must become subset + floor. An
assertion over **one named declaration** (keys of a specific table, precision of
a specific property, attributes of a specific class) only changes when that
declaration changes, which is a legitimate re-pin; those stay exact.

`packages/extract/test/node.test.ts`:

- `:50` (repo-D) and `:113` (repo-E) relations → the routes pattern at `:88-92`:
  ```ts
  const ids = g.relations.map((r) => r.id);
  expect(ids).toEqual(expect.arrayContaining(exp.relationIds!));
  expect(ids.length).toBeGreaterThanOrEqual(exp.relationIds!.length);
  ```
  Keep the existing `not.toContain(absentForeignKey)` and `every(source ===
  "inferred")` lines. A deleted pinned relation still fails via
  `arrayContaining`, which answers progress-1b's "deletion is the interesting
  failure" concern without pinning the live list. Keep the key name
  `relationIds`; its meaning becomes "the hand-verified subset", say so in the
  `CorpusNodeExpect` docblock in `test/fixtures.ts` (~`:129`).
- `:60` house-style warning → match by stable prefix, count-agnostic:
  ```ts
  expect(g.warnings.some((w) => w.startsWith(exp.houseStyleWarning!))).toBe(true);
  ```
  and trim the trailing count off the value in `test/corpus.local.json`
  (gitignored) so the stored value is the prefix. Mirror the shape in
  `test/corpus.local.example.json` with its fake value.
- `packages/extract/test/dotnet.test.ts:134` `cascades.length` vs
  `exp.cascade!.count` → `toBeGreaterThanOrEqual`. Aggregate count.
- Leave exact (single-declaration): `node.test.ts:46` wide-table keys, `:128`
  utility-shape fields, `dotnet.test.ts:61,63` key arrays, `:83` precision
  tuple, `structure.test.ts:54,55` attribute arrays, and every scalar `toBe`.

Do not touch any hermetic `MINI_*` fixture test.

### A2. tsconfig.json — closed, no change

Record James's sign-off in A6. Delete the OPEN block's premise from nothing;
progress-1b stays intact as the historical record.

### A3. Pre-push leak sweep

The repo is public. The publish-scrub check is a documented manual grep, not a
script, and its term list was deliberately never committed. Reconstruct it and
run it over the unpushed range:

1. Terms = every corpus repo directory basename and absolute path in
   `test/corpus.local.json`, plus every sibling directory name under
   `~/Developer` (the memory rule: sweep all siblings, not just the expected
   ones). Keep the term list in the scratchpad only.
2. `git diff origin/master..HEAD | grep -iE '<terms>'` over content, and
   `git log origin/master..HEAD --format=%B | grep -iE '<terms>'` over messages.
3. Positive control first: grep the term list against `test/corpus.local.json`
   itself and confirm hits, so an empty result on the diff means clean rather
   than broken.

Any hit blocks the push until scrubbed.

### A4. README

Counts already correct (204 / 262). If A1 changes the hermetic count it will
not, since only corpus-gated tests are touched. No edit expected.

### A5. Push

```
git checkout master && git merge --ff-only m5b-component-attribution
git push origin master
git push origin m5b-component-attribution
```
Gate before the push: full `pnpm test` 0 failed, hermetic 204 / 58, typecheck
clean, e2e 19 / 19, A3 clean.

### A6. Record

`feature-research/green-and-push/progress.md`: what shipped, the aggregate-vs-
declaration rule from A1, James's four decisions, the carried items above, and
the MVP estimate below verbatim so the Deploy phase starts from it.

### Files touched (Phase A)

1. `packages/extract/test/node.test.ts`
2. `packages/extract/test/dotnet.test.ts`
3. `test/fixtures.ts` (docblock only)
4. `test/corpus.local.json` (gitignored, value trim)
5. `test/corpus.local.example.json`
6. `feature-research/green-and-push/progress.md` (new)

Not touched: any `src/`, any fixture, `tsconfig.json`, `README.md`.

### Verification (Phase A)

```
export PATH=/Users/james/.local/share/fnm/node-versions/v24.19.0/installation/bin:$PATH
PSQ_NO_CORPUS=1 pnpm test      # 204 passed / 58 skipped, unchanged
pnpm test                      # 0 failed
pnpm typecheck
pnpm test:e2e                  # 19 / 19
git log --oneline origin/master..master   # empty after push
```

Negative controls (memory rule: a gate that passes by finding nothing needs a
positive control):

- Temporarily remove one id from `relationIds` in `corpus.local.json` → `:50`
  must go red. Restore.
- Temporarily set `houseStyleWarning` to a wrong prefix → `:60` must go red.
  Restore.
- A3 positive control as written above.

The reviewer re-derives every gate from the commands, not from the audit.

## MVP estimate — from "pushed" to "James uses it daily"

What James's two learning goals map to, today:

| Goal | Available now | Missing |
|---|---|---|
| .NET backend choices | entities, relations, delete behaviour with `fluent`/`convention` provenance, DTO shapes, entity↔DTO drift, SQL over a seeded DB | controller / minimal-API routes for .NET (`dotnet.ts` hardcodes `routes: []`), so "which endpoint touches which table" has no .NET half |
| React / shadcn component arrangement | 77 components + 5 attributed client calls are **extracted** on Northwind (M5b) | nothing serves or renders them, and no question asks about them (M5c); per-function complexity (roadmap Phase 2/3) |

Phases, in James's chosen order. "Phase" = one plan-build-review context
window under the orchestrator workflow.

| # | Phase | Ends with | Size |
|---|---|---|---|
| A | Green and push (this plan) | `origin/master` == HEAD, full suite 0 failed | small |
| B | **Deploy, personal**: LaunchAgent (`com.psq.server`, a label prefix no other service on this Mac uses) running the fnm `node` by absolute path, `pnpm build:web` output served by Express, `PSQ_HOST`/`PSQ_PORT` on a free port in **9440-9460** (9450 and 9444 are taken by two existing tailnet services; bind-test with a throwaway socket, root `tailscale serve` sockets are invisible to `lsof`). **Auth first** (house rule): a `PSQ_TOKEN` gate on every `/api/*` route, because `POST /api/repos {path}` opens any path on the Mac and the SQL grader runs typed input. UI sends the token. `scripts/deploy.sh` = build + `launchctl kickstart -k`. README "Hosting" section | medium |
| C | **1b-ii**: `shapeLabel(g, shape)` helper at the five prompt sites; `psq selftest` passes on `mini-fullstack-csharp` and Northwind | small, already specified at the bottom of `plan-phase1b.md` |
| D | **M5c-i**: server returns `clientCalls` + `components` from `/api/repos/:id/shapes` (`app.ts:153-166`), `apps/web/src/lib/api.ts` types catch up, a Dashboard panel (precedent: `DriftView` / `RouteList` in `Dashboard.tsx`) listing component → call → matched route, with `openInEditor` links in Electron | medium |
| E | **M5c-ii**: one comparative question generator over components/calls (the `mostConnected` idiom: graded answer is a name, count in the rationale), registered in `bank.ts`, passes `selftest` both ways | medium |

**James can start daily use after A + B** on .NET-only and Node repos with
trusted banks, and on full-stack repos with banks that are formally untrusted
until C. Everything up to E is roughly five context windows.

**Kept open, not MVP** (James's answer 3):

- **F — Package for anyone, cross-platform.** Electron shell already runs the
  same server in-process; add `electron-builder` targets for mac/win/linux.
  Default is fully local: the user's own code, no network, no Tailscale.
  Risk to verify in that phase's plan: the extractor's SQLite path goes through
  `node:sqlite` via `packages/extract/src/sqlite/driver.ts`, and whether
  Electron's bundled Node is new enough is checked below.
- **G — Optional agents (M6/M7).** psq never grades with a model (rule 1).
  Agents only write question prose (M6) or consume the JSON export (M7). The
  provider must be a user setting: Anthropic API key, or any OpenAI-compatible
  self-hosted endpoint. Not needed for James's own use.
- Quiz history / weak-area persistence (server-side JSON keyed by repo id).
  Nice for daily use, not blocking.
- .NET route reader (M5b's remaining half): the piece that would complete
  "backend choices" for the .NET side.

### Electron / node:sqlite check (for phase F, verified 2026-09-04)

- `apps/desktop` pins `electron ^43.4.1`, runs `createApp()` from `@psq/server`
  **in-process** in Electron's main process, so the extractor's SQLite path
  executes under Electron's bundled Node.
- `packages/extract/src/sqlite/driver.ts` does a runtime
  `createRequire(...)("node:sqlite")` with **no fallback and no capability
  check**; root `engines` is `node >= 24`.
- Nothing in the repo asserts Electron's bundled Node satisfies that. The e2e
  "desktop bridge" test mocks the bridge in a browser; real Electron is never
  exercised by any gate. No packaging config exists (no electron-builder/forge).
- **Phase F's first gate** therefore: `pnpm desktop`, open a fixture, confirm an
  extraction and a SQL-graded answer succeed under the bundled Node, before any
  packaging work. If it fails, the fix is a driver fallback (e.g. `better-sqlite3`
  or sql.js) behind the same `driver.ts` seam, never a second `node:sqlite` import
  (CLAUDE.md rule 2a).
