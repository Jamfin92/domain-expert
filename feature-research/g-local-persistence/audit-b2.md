# Phase G-b2 — the store, read side (rehydrate) — AUDIT

Plan: `plan-b2.md` (rev 2), approved as written including D-Gb2-1's four-state
`"off"`. Branch `master`, base `43d16da`, four commits `ee7ffd5` → `042af00`
plus this record. **Not pushed** — `master` is now 19 ahead of `origin/master` (the five above, plus the previously-untracked `plan-b2.md` landed with the last).

---

## Files changed

Every file created or modified by this phase, complete:

| # | File | New? | Change |
|---|---|---|---|
| 1 | `apps/server/src/store.ts` | | `.filter(isStoreId)` in `listEnvelopeIds`; `envelopePath` before `mkdirSync` in `writeEnvelope` |
| 2 | `apps/server/src/workspace.ts` | | `RehydrateState`/`RehydrateStatus`, `rehydrateStatus()`, `rehydrate()`, `rehydrateOne()`; `persist()` catch deletes the superseded envelope; `closeAll()` sets `stopping` |
| 3 | `apps/server/src/app.ts` | | `GET /api/health` reports `rehydrate` |
| 4 | `apps/server/src/index.ts` | | `void workspace.rehydrate().catch(…)` in the `listen` callback; F9's two false comments corrected |
| 5 | `apps/server/test/rehydrate.test.ts` | **new** | B5b, B6–B11, B16, B24, B29 — 11 tests |
| 6 | `apps/server/test/boot.test.ts` | **new** | B4, B13, B14, B25 — 4 tests, the child-process idiom |
| 7 | `apps/server/test/store.test.ts` | | four `reason` assertions; B30, B31 |
| 8 | `apps/server/test/api.test.ts` | | health shape at the two `toEqual` sites |
| 9 | `feature-research/g-local-persistence/audit-b2.md` | **new** | this file |
| 10 | `feature-research/g-local-persistence/progress-b2.md` | **new** | phase record |

Exactly the plan's §3 list, nothing else. `git diff --stat 43d16da HEAD`
confirms 8 source/test files. **`packages/extract/test/digest.test.ts` is
byte-untouched** (`git diff … -- digest.test.ts` is empty), so B27 did not need
re-running; its four cited lines were re-read and are intact.

---

## Baseline, confirmed before the first edit

All three inherited numbers matched exactly. Nothing was adapted to.

| | Expected | Measured |
|---|---|---|
| `pnpm test` | 387 passed (387), 30 files | **387 passed (387), 30 files** |
| `PSQ_NO_CORPUS=1 pnpm test` | 329 passed / 58 skipped (387) | **329 passed / 58 skipped (387)** |
| `pnpm typecheck` | exit 0, four projects | **exit 0, four projects** |
| HEAD / ahead / tree | `43d16da`, 14 ahead, clean | **all three confirmed** |

## Final numbers

| | Result |
|---|---|
| `pnpm test` | **404 passed (404)**, 32 files, exit 0 — run 3× consecutively, 404/404 each time |
| `PSQ_NO_CORPUS=1 pnpm test` | **346 passed / 58 skipped (404)**, 29 passed / 3 skipped files |
| `pnpm typecheck` | exit 0 across all four projects |

**Skipped held at 58** at every checkpoint (after commit 1, after commit 2,
after commit 3, after commit 4, final). Net +17 tests: +2 store, +11 rehydrate,
+4 boot.

---

## Findings — where the plan predicted and the measurement disagreed

### 1. The `reason` assertion form the plan specified does not assert anything

*The headline finding. This is the same failure the phase line keeps finding,
one layer further in.*

The plan's §2.5 verified that the four regexes **match the real strings** —
they do, and all four actual strings are pasted below. What was never measured
is whether the *assertion* using them discriminates. It does not.

`toMatchObject({ ok: false, reason: /not JSON/ })` is **inert** in vitest
2.1.9. Measured three ways on the shipped tree:

- With bare regexes, deleting each of the three corruption fixtures in turn
  left the suite at **23 passed (23)** — all three of the plan's fixture-
  deletion mutants passed green.
- Replacing `/not JSON/` with `/THIS_CANNOT_MATCH/`, which matches none of the
  four strings, also left the suite at **23 passed (23)**.
- Switching to `expect.stringMatching(/…/)`: the `/THIS_CANNOT_MATCH/` control
  reddens, and all three fixture-deletion mutants redden.

So the handoff's carry — "assert `reason` and B10's six cases then mean what
their names say" — would have shipped a gate that still meant nothing, in the
exact place the previous phase identified as a gate that meant nothing. Fixed
with `expect.stringMatching`, and the reason is written into the test's
comment rather than fixed silently.

**The four actual reason strings**, measured against the shipped `store.ts`:

| id | reason |
|---|---|
| garbage JSON | `not JSON: Expected property name or '}' in JSON at position 1 (line 1 column 2)` |
| `version: 99` | `version: Invalid literal value, expected 1` |
| bad graph | `graph.repo: Required; graph.provider: Required; graph.contextName: Required; graph.entities: Required; graph.relations: Required; graph.shapes: Required; graph.routes: Required; graph.clientCalls: Required; graph.components: Required; graph.warnings: Required` |
| no file | `ENOENT: no such file or directory, open '<stateDir>/repos/0d0d0d0d0d0d.json'` |

All four are mutually distinct and each matches only its own regex.

### 2. B10 as specified could not fail the mutant the plan named for it

§4 predicts: *"Replace step 4's length check with a try/catch around
`invariants` → B10's sixth case reddens."*

**Measured: it stayed green at 11 passed (11).**

The reason is the plan's own argument turned around. `invariants` cannot throw
on a parsed graph — that is precisely why the length check is right. Under the
try/catch mutant `reExtract` therefore stays false for the bad-invariants
entry, which is then **materialized straight from the broken stored graph**
rather than re-extracted. `materialize` and `buildBank` both succeed on a graph
whose first entity has `keys: []`, so the outcome is `loaded: 3, failed: 3,
missing: 1` — *identical* to the correct implementation. B10's counters cannot
see the difference the case exists to test.

B10 was strengthened with two assertions the counters cannot express:

- `calls.extractWithDigest` is exactly **2** — the stale extractor and the bad
  invariants, and *not* the good entry, which must use its stored graph.
- `invariants(w.get(badInvId)!.graph)` is `[]` and the entity has its primary
  key back, so the graph in the Map is demonstrably the re-extracted one.

With those, the mutant reddens (`expected 1 to be 2`). Reported here rather
than worked around; the strengthening stays inside the plan's file list and
serves the plan's own stated intent for B10.

### 3. F9's two false comments were still present — both corrected

The plan warned the cited line had rotted and told me to locate by content and
say so if they were gone. **They were not gone.** Both located by content, both
re-verified false against the shipped tree before editing:

- `index.ts:11-12` (shipped): *"Pass 0 to take any free port, which is what
  Electron does so two copies never clash."* — `config.ts:55-60` rejects `0`
  (the `^\d+$` regex accepts the string, then `parsed < 1` refuses it), and
  `config.test.ts:66-67` pins that refusal.
- `index.ts:70` (shipped): *"Electron reads this line to learn which port to
  open."* — `apps/desktop/src/main.ts:29` calls `createApp()` in-process and
  `:36` calls `listen(0, "127.0.0.1")` on its own server, reading the port off
  `server.address()`. The only `spawn` in `apps/desktop` is `:94`, launching
  `code`. There is no out-of-process handshake anywhere.

Both rewritten to say what is true, including why the boot gates have to pick
their own port.

### 4. `api.test.ts:433`/`:441` do not assert on health

Checked as instructed. They are B17's writes-nothing gate — a `plain` Workspace
and a `wired` one, asserting on `existsSync(join(tmp, "psq"))`. Neither touches
`/api/health`. No change needed there; only the two `toEqual` sites at `:241`
and `:243` were extended, and they were confirmed to be at those exact lines.

### 5. Mutant 5 reddens more than the plan predicted

The plan says the unconditional-`undefined` `loadStateDir()` reddens B25.
Measured: it reddens **B25, B4/B13 and B14** — three of the four boot tests.
Better than predicted, and B25 still reddens for exactly the stated reason
(the stderr line is absent because the catch never runs). D-Gb2-7's argument
holds: under that mutant the health state genuinely *is* `"off"`, so an
assertion on `"off"` alone passes green over the bug.

---

## Every mutant, and its result

The plan's seven, plus three controls I added.

| # | Mutant | Predicted | Measured | |
|---|---|---|---|---|
| 1 | Directory check moved *after* the digest comparison | B24 reddens, and only B24 | **B24 only**, 1 failed / 10 passed | ✅ as predicted |
| 2 | Step 4's length check → try/catch around `invariants` | B10's sixth case reddens | **green at 11/11** — see Finding 2. After strengthening B10: **reddens**, `expected 1 to be 2` | ⚠️ finding, then fixed |
| 3 | `state = "running"` set after the first yield | B16 reddens | **B16 only**, `expected 'pending' to be 'running'` | ✅ as predicted |
| 4 | Remove `.filter(isStoreId)` | B30 reddens | **B30 only**, 1 failed / 22 passed | ✅ as predicted |
| 5 | `loadStateDir()` returns `undefined` unconditionally | B25 reddens | **B25 + B4/B13 + B14**, 3 failed / 1 passed | ✅ B25 reddens; wider than predicted |
| 6 | B10's three loadable fixtures point at one directory | B10 reddens | **B10**, `loaded: 1` vs `loaded: 3` | ✅ as predicted |
| 7a | Delete the garbage-JSON fixture | its `reason` line reddens | bare regex: **green**. `stringMatching`: **reddens** | ⚠️ finding, then fixed |
| 7b | Delete the `version: 99` fixture | its `reason` line reddens | bare regex: **green**. `stringMatching`: **reddens** | ⚠️ finding, then fixed |
| 7c | Delete the bad-graph fixture | its `reason` line reddens | bare regex: **green**. `stringMatching`: **reddens** | ⚠️ finding, then fixed |
| — | *(the ENOENT case has no fixture — its absence IS the case, so no mutant exists. The plan says so.)* | | | |
| C1 | **Added.** `/not JSON/` → `/THIS_CANNOT_MATCH/` | — | bare regex: **green** (proves the form is inert). `stringMatching`: **reddens** | control |
| C2 | **Added.** Restore `mkdirSync` *before* `envelopePath` in `writeEnvelope` | — | **B31 only**, 1 failed / 22 passed | control |
| C3 | **Added.** B25's own in-test control: a boot *with* the environment must not print `persistence off:` | — | **green** — the line is genuinely conditional | control |

Every gate the phase added has now been shown to fail for the reason it names.

---

## What changed, per file

### `apps/server/src/store.ts`

`listEnvelopeIds` gains `.filter(isStoreId)`. The comment states plainly that
this is **legibility, not a crash guard** — 0A.1's correction is written into
the source so no future reader re-derives the false version. Re-measured here:
`readEnvelope(dir, "notes")` returns `{ ok: false, reason: 'Not a repo id:
"notes"' }` and does not throw, because `envelopePath` is called inside the
`try`.

`writeEnvelope` calls `envelopePath` before `mkdirSync`. No reachable bug
today; C2 shows B31 is a real gate on it.

### `apps/server/src/workspace.ts`

`RehydrateState = "off" | "pending" | "running" | "done"` and
`RehydrateStatus`. The status object is built **in the constructor** from
`stateDir`, and `rehydrateStatus()` returns a copy (gated: a caller mutating
`.loaded = 99` does not move the real counter).

`rehydrate()` sets `state = "running"` synchronously before its first `await`,
then loops `listEnvelopeIds`, yielding *before* each `stopping` check, and sets
`"done"` in a `finally` so an early `break` still lands there.

`rehydrateOne()` was split out of the loop deliberately, so the try/catch
covers every branch and cannot be narrowed later by an edit to one branch
(F11). Order as specified: read → id agreement → extractor → invariants (by
length) → directory check → `repos.has` → digest → re-extract or stored-graph.
The zero-entities refusal is applied on the stored-graph branch. The catch
closes a `SeededDb` the entry opened before throwing, re-tests the directory to
separate a TOCTOU `missing` from a `failed`, and never rethrows.

`persist()`'s catch drops the superseded envelope, with D-Gb2-5's permission
limitation stated in the comment rather than implied. `closeAll()` sets
`stopping`.

### `apps/server/src/app.ts`

One line, plus a comment saying why `repos: 0` alone is not enough for a
LaunchAgent observable only over HTTP.

### `apps/server/src/index.ts`

The single `void workspace.rehydrate().catch(…)`, inside the `listen` callback
and **after** the listening lines print. F9's two comments corrected
(Finding 3).

### Tests

`rehydrate.test.ts` (11) and `boot.test.ts` (4) are new; `store.test.ts` gains
B30, B31 and the four working `reason` assertions; `api.test.ts`'s two health
`toEqual`s gain `rehydrate`, kept as `toEqual` with a comment saying why they
must not be relaxed.

---

## Rehydrate cost per repo — measured

The plan asked for this and noted rev 2 assumed it without measuring. Median of
5 on the fixtures; single run on the five real corpus repos (paths withheld —
this repo is public).

| Repo | entities | questions | `open()` cold | **stored-graph** | **re-extract** |
|---|---|---|---|---|---|
| `mini-efcore` | — | — | — | **1.8 ms** | 2.8 ms |
| `mini-node` | — | — | — | **1.7 ms** | 157 ms |
| corpus A | 17 | 213 | 49 ms | **15 ms** | 24 ms |
| corpus B | 9 | 107 | 11 ms | **6 ms** | 9 ms |
| corpus D | 13 | 136 | 1180 ms | **10 ms** | 1078 ms |
| corpus E | 5 | 56 | 171 ms | **3 ms** | 155 ms |

**The stored-graph path is 2–15 ms per repo and barely moves with repo size**;
what it costs is `materialize` + `buildBank`, not reading source. The
re-extract path costs essentially what `open()` costs, which on the worst real
repo measured is **1.08 s — about 100× the stored path**, and does sit at the
1.3 s pipeline figure rev 2 guessed at.

Two consequences worth carrying forward:

- The store earns its keep. A five-repo restart is roughly **40 ms** on the
  stored path versus **1.4 s** re-extracting.
- **Each entry is fully synchronous**, so the server is unresponsive for the
  whole of it. One stale corpus-D entry blocks the event loop for over a
  second at boot. This is why `boot.test.ts` polls `/api/health` rather than
  trusting the listening line, and why a future phase that rehydrates many
  stale repos should think about the ordering.

Two corpus entries (`repoC`, `repoAClient`) refuse to open with "No entities
found … no CREATE TABLE" — **pre-existing and expected**, they are client-only
repos used by the client-quiz tests. Not caused by this phase.

---

## Decisions the plan did not settle

1. **`rehydrateOne()` is a separate private method**, not an inline loop body.
   The plan says "wrap every entry in try/catch regardless of branch". A
   method makes that structural instead of a convention a later edit can
   narrow. No behaviour difference.
2. **The catch re-reads the envelope** to recover `path` for the TOCTOU
   re-classification. The plan says "re-test `existsSync(path)`" without
   saying where `path` comes from in a catch that may have fired before `env`
   was bound. Re-reading is cheap and cannot itself throw (`readEnvelope`
   returns a result).
3. **The stored-graph branch keeps the stored `openedAt`**, asserted in B6. The
   plan says this; recording it because it is the kind of thing a later edit
   "tidies" into `this.now()`.
4. **B7 uses `selftestOf(id)` → `[]`** as its primary assertion, plus a direct
   right/wrong answer through the session surface. `selftest` grades every
   question with its reference (must pass) and a mutation (must fail), which is
   CLAUDE.md rule 5 and a strictly stronger form of B7's wording.
5. **B29's `writeEnvelope` mock is a hoisted flag**, off by default, so the
   other ten tests in the file use the real store. A whole-file mock would have
   made every other gate synthetic.
6. **`boot.test.ts` merges B4 and B13** into one test. B4's wording ("SIGTERM,
   restart, `GET /api/repos` returns the repo") and B13's ("SIGTERM the real
   child from B4, restart, the repo comes back") are the same assertion; one
   test running it once is honest, two would have been the same gate twice.
   B14 and B25 are separate, and B25 carries its own negative control.
7. **The `boot.test.ts` child env is replaced, not extended**, carrying only
   `PATH`. B25 needs `HOME` and `XDG_DATA_HOME` genuinely absent, and an
   extend-then-delete shape is one forgotten `delete` from a silently passing
   test.
8. **A dead `shortId` helper was removed** from `rehydrate.test.ts` before
   commit. It became unnecessary once every B10 fixture was opened for real
   (which gets the id right by construction) instead of hand-computed.

## Not touched, as the plan directs

`apps/web/src/lib/api.ts` (the health type is a compile-time cast with no
runtime validation, so the extra field is ignored), `apps/desktop/src/main.ts`
(stays unpersisted; it now reports `"off"` rather than a permanent
`"pending"`), `e2e/` (**`pnpm test:e2e` was never run** — it runs `build:web`,
which empties the `apps/web/dist` the live server serves from disk),
`apps/server/package.json` (the undeclared `zod` is still owed as repo
hygiene), and `packages/extract/test/digest.test.ts`.

## Open risks

- **`boot.test.ts` picks its own port and races.** Between the probe closing
  and the child binding, something else could take it. Unavoidable while
  `PSQ_PORT=0` is refused, documented in the file, and not observed in ~30
  boots across development and the three repeat suite runs.
- **The known `api.test.ts:119` flake is untouched and still latent.** Not
  reproduced here (404/404 three times, plus every targeted run). This phase
  adds four child processes rather than four more supertest servers, so it
  adds little to the ephemeral-port churn that causes it.
- **`store.test.ts`'s `lines.length === 1`** (B12) still holds, because
  `rehydrate()` is never called from `createApp()`. The moment anything wires
  rehydrate into `createApp`, that assertion needs a thought, not a reflex
  relaxation.
- **D-Gb2-5 does not cover a permission failure**, by measurement, not by
  oversight. At `0500` the write and the unlink both fail EACCES and the
  superseded envelope survives. Stated in the source comment and in B29's.
- **`master` is 19 ahead of `origin/master` and unpushed**, as in E, F, G-a and
  G-b1. James's call.
