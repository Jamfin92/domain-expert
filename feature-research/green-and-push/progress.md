# Phase A — green and push — PROGRESS

**Status: implemented; history rewritten; awaiting re-review, then push.
The unpushed range has been scrubbed and rebuilt — branch
`m5b-component-attribution` now tips at `2a4aacf` (was `4e2b7d6`). The phase's
own test changes remain UNCOMMITTED in the working tree on top of that new tip.
James commits and pushes. A5 (the push) is no longer blocked on a leak: see
"History rewrite" below.**

Plan: `plan.md` (verbatim copy of the approved plan). Audit: `audit.md`.
Previous phase record: `../complexity-facts/progress-1b.md`.

The plan's premise that e2e was red was **stale**. There were no e2e failures.
`pnpm test:e2e` was 19/19 before this phase and is 19/19 after it. What was red
was the corpus-backed suite, two tests, both in the repoD block of
`packages/extract/test/node.test.ts`, both from ground truth pinned against a
private repo that grew on 2026-09-03.

---

## What shipped

**The corpus suite is green again, and this class of failure cannot recur.**
Full `pnpm test` went from `2 failed | 260 passed` to `262 passed (262)`,
without re-pinning a single ground-truth value upward.

**Four assertions changed from exact to floor**, each one an aggregate over a
live repo:

| Site | Was | Is |
|---|---|---|
| `node.test.ts` repoD relations | ordered `toEqual(relationIds)` | `arrayContaining` + length floor |
| `node.test.ts` repoE relations | ordered `toEqual(relationIds)` | `arrayContaining` + length floor |
| `node.test.ts` repoD house style | `toContain(houseStyleWarning)` | `some(w => w.startsWith(prefix))` |
| `dotnet.test.ts` fluent cascades | `length toBe(count)` | `length toBeGreaterThanOrEqual(count)` |

repoE's relations assertion was **not** failing yet. It was the same defect and
was fixed in the same pass, which is the point of the sweep.

**The pinned warning string lost its embedded table count.** The stored value in
`corpus.local.json` now stops immediately before the number that
`packages/extract/src/node/ddl.ts:317` interpolates, and the test matches by
prefix. `corpus.local.example.json` mirrors the shape with its fake value, and
the three affected keys in `test/fixtures.ts` now carry docblocks saying what
kind of value they hold.

**Nothing else moved.** Hermetic `PSQ_NO_CORPUS=1 pnpm test` is
`204 passed | 58 skipped (262)`, byte-identical to the baseline — the control
that proves only corpus-gated assertions were touched. No `src/`, no fixture,
no `tsconfig.json`, no `README.md`, no `MINI_*` test.

### Gates

| Gate | Result |
|---|---|
| `PSQ_NO_CORPUS=1 pnpm test` | `204 passed \| 58 skipped (262)` |
| `pnpm test` | `262 passed (262)`, 0 failed |
| `pnpm typecheck` | clean |
| `pnpm test:e2e` | `19 passed (19)` |
| A3 leak sweep | Found 8 Class 1 lines across three committed M5b records, plus 1 in each new record. Resolved by rewording the records and rewriting the committed range. **Re-swept: 0.** |

---

## The push was blocked — resolved

A5 was out of this session's scope by instruction, and the A3 sweep then found
an independent reason it must not happen yet. That reason has since been
removed by the history rewrite recorded below; this section is kept as the
record of what was found and why.

The sweep's positive control fired first (10 matching lines against
`test/corpus.local.json`), so the sweep is known to work. It then found **62
matching lines in `git diff origin/master..HEAD`**. Commit messages: 0. The
uncommitted working tree: 0. The new records in this directory: **1 line each**
— see below.

That last count was reported as 0 when this file was first written, and it was
wrong. The reviewer found the miss: `plan.md` and `progress.md` each carried
one Class 1 line — the approved plan's own Deploy row, whose LaunchAgent
sentence named a label prefix that is also the basename of corpus repo D's
path, and whose port note named two other local services beside their ports.
Both files have since been reworded identically (the LaunchAgent clause now
says only that the prefix is unused elsewhere on this Mac; the port note says
only that 9450 and 9444 are taken by two existing tailnet services). A
re-sweep of `plan.md`, `progress.md` and `audit.md` against the full
private-name set now returns 0 matching lines in each. **Resolved.**

Three committed files in the unpushed range carried names taken from
`test/corpus.local.json` — one of them a **full private absolute corpus path**:

- `feature-research/m5b-component-attribution/plan.md`
- `feature-research/m5b-component-attribution/audit.md`
- `feature-research/m5b-component-attribution/roadmap.md`

**This is now resolved.** James chose to rewrite the unpushed commits, and the
rewrite has been executed and verified — the range holds 0 Class 1 hits and 0
absolute-path hits. See "History rewrite" below. Nothing was ever pushed, so
rewriting the unpushed range was sufficient; once pushed it would not have been
(deleting and recreating the GitHub repo becomes the only real remedy).

A second, weaker class (local project directory names that are **not** corpus
repos — public testbed repos) appears across 22 phase-record files. **James's
decision: these stay as-is.** They are not private, and the records quote
measurements taken on a named local repo.

---

## History rewrite

Executed 2026-09-04, on James's decision to **rewrite the unpushed commits**
(the alternative — leave them and never push — was rejected).

**Method.** `git filter-branch --tree-filter` over `origin/master..HEAD`, with
the filter restricted to `feature-research/m5b-component-attribution/*.md`.
It replaced each private corpus repo basename (case-insensitive, word-bounded)
with its `repoA`..`repoE` key, and each absolute corpus path with
`<repoX path>`. The replacement map existed only in the session scratchpad and
was never written to the repo.

**Result — all verified, not assumed:**

| Check | Result |
|---|---|
| Commits in range, before / after | 7 / 7 |
| Commit subjects | identical, in order |
| Positive control (backup ref, `git log -p`) | **8** Class 1 hits — the sweep works |
| Rewritten range, Class 1 hits in `git log -p` | **0** |
| Rewritten range, absolute-path hits | **0** |
| `git diff --stat backup/pre-scrub-2026-09-04 HEAD` | only `m5b-component-attribution/{audit,plan,roadmap}.md`, 8 insertions / 8 deletions |
| `master` still an ancestor of HEAD | yes |
| New tip | `2a4aacf` |

Only the three leaking files changed, and only by 8 lines. No code, no test, no
other record was touched by the rewrite.

**Old → new SHA map.** Older phase records cite pre-rewrite SHAs; resolve them
here. All 7 pair up by subject.

| Old | New | Subject |
|---|---|---|
| `37a6b44` | `37a6b44` | feat(extract): attribute client calls to the components that cause them |
| `1bb9a8a` | `c3b76ce` | docs: milestone row and phase record for M5b |
| `5e1f0ab` | `13f5f48` | docs: phase records for the Northwind testbed and the template refresh |
| `a064d80` | `bd4963f` | docs: complexity-facts roadmap, and a silent C# truncation the testbed found |
| `b6daee3` | `4136543` | fix(extract): a base constructor argument list no longer truncates C# parsing |
| `9b5a4f9` | `1de65eb` | feat(extract): read a full-stack repo as both stacks in one graph |
| `4e2b7d6` | `2a4aacf` | docs: record the sibling corpus assertion that went stale the next day |

The first commit is unchanged — it touched no record file, so the filter was a
no-op and its SHA survived. Every commit after it is rewritten.

**Backups kept locally — NEVER PUSH THESE:**

- branch `backup/pre-scrub-2026-09-04` (the original tip, `4e2b7d6`)
- `refs/original/refs/heads/m5b-component-attribution` (filter-branch's own)
- branch `wip/backup-2026-09-01` — a working-tree snapshot from before Phase 1,
  created off the old HEAD: **3 commits beyond `origin/master`, 12 leaking lines
  in `git log -p`**

**All three still contain the private corpus names in full**, and all three are
local-only — none exists on the remote. Pushing any one of them undoes the
entire scrub and puts the names on a public GitHub repo. Delete all three only
once the push of the rewritten branch is verified — **subject to James's word on
the wip snapshot**, which holds 46 lines HEAD does not.

---

## Decisions

**D-A-1. Aggregate vs declaration — the rule for every future ground-truth
assertion.** An assertion over a **whole-repo aggregate** — all relations, all
routes, all cascades, a table count, a warning that embeds a count — drifts
whenever the live repo grows, and must be **subset + floor**. An assertion over
**one named declaration** — the keys of a specific table, the precision of a
specific property, the attributes of a specific class — only changes when that
declaration changes, which is a legitimate re-pin, and stays **exact**.

A permanently-red gate verifies nothing at all, which is why a weaker assertion
beats a stale exact one. A floor is still failable: deleting a pinned relation
still reddens it through `arrayContaining` (verified, see audit NC-1b).

Left exact under this rule: wide-table keys, utility-shape fields, .NET key
arrays, the precision tuple, `structure.test.ts` attribute arrays, every scalar
`toBe`.

**D-A-2. `tsconfig.json` exclude stays as-is** (James, 2026-09-04): the whole
`test/fixtures/mini-fullstack-csharp` directory, matching the `mini-react` /
`mini-solution-tie` precedent. This closes the OPEN item in `progress-1b.md`,
which stays intact as the historical record. No code change.

**D-A-3. Push shape**: fast-forward `master` to HEAD and push `master`; push the
branch too. GitHub's default branch is `master`. `master` is an ancestor of
HEAD, so the fast-forward is safe. Re-verified after the rewrite: `master` is
still an ancestor of HEAD (`2a4aacf`). **No longer gated — the A3 leak is
resolved.**

**D-A-4. Deploy shape**: a LaunchAgent on a tailnet port for personal use, AND
keep the door open to packaging the app cross-platform (Windows/Mac/Linux) so
anyone can run it locally against their own code, with their own cloud or
self-hosted agents optional.

**D-A-5. Phase order after the push**: Deploy → 1b-ii → M5c.

---

## What the next phase needs to know

Carried forward, not addressed in this phase:

- **`psq selftest` exits 1 on any full-stack repo** (2 findings, shape-name
  ambiguity). Rule 5 stands: full-stack banks are **formally untrusted** until
  phase C (1b-ii).
- **`clientCalls` / `components` are extracted (M5b) but never surfaced.**
  Nothing serves them, nothing renders them, no question generator consumes
  them. That is phases D and E (M5c-i / M5c-ii).
- **`apps/server/test/api.test.ts:213` flaked once in ~13 runs.** Scout found no
  nondeterminism in the grading path (seeded rng, sorted row comparison), so the
  cause is in the harness (`openMini()` / the shared workspace), not the grader.
  Not seen in any of this session's runs. Left alone; recorded so it is not
  rediscovered as new.
- **No Dockerfile, no CI, no hosting config anywhere.**
- **The corpus config is the only copy of the ground truth.** It is gitignored;
  a dropped test count is the only signal it has gone missing.
- **Three backup refs exist locally and MUST NEVER BE PUSHED**:
  `backup/pre-scrub-2026-09-04`,
  `refs/original/refs/heads/m5b-component-attribution`, and
  `wip/backup-2026-09-01` (a working-tree snapshot from before Phase 1, created
  off the old HEAD: **3 commits beyond `origin/master`, 12 leaking lines in
  `git log -p`**). All three hold the pre-scrub commits with the private corpus
  names and one full absolute corpus path; all three are local-only and exist
  nowhere on the remote. Pushing any one defeats the rewrite. **Delete all three
  once the push of the rewritten branch is verified** (`git push` succeeded and
  `origin/master` matches HEAD), and not before — until then the first two are
  the only rollback. Deleting `wip/backup-2026-09-01` is **subject to James's
  word**: it holds 46 lines HEAD does not.
- **Sweep every new phase record against the corpus basenames before it is
  committed.** This leak was not in the original publish scrub; it was
  *introduced afterwards*, by records written later that quoted corpus repo
  names and a path while describing measurements. The original scrub was
  correct and still went stale. So the sweep is not a one-time cleanup, it is a
  per-commit gate: derive the basename set programmatically from
  `test/corpus.local.json` (never hand-type it — it drifts), sweep every new or
  edited `feature-research/**/*.md` case-insensitively and word-bounded, and
  require 0 hits. Always run the positive control first (sweep the corpus file
  itself, or a backup ref) — a sweep that passes by being broken looks exactly
  like a sweep that passes by being clean.

---

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
