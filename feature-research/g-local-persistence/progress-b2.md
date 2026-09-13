# Phase G-b2 — the store, read side (rehydrate) — PROGRESS

**Status: implemented, gated, review round 1 addressed. Awaiting re-review and
James's acceptance.**

Seven commits on `master`, `43d16da` → this record:

```
ee7ffd5  G-b2: store fixes — listEnvelopeIds filters, writeEnvelope validates first
cccc1f6  G-b2: the store, read side — rehydrate()
a4dc4bc  G-b2: gate rehydrate — B5b, B6–B11, B16, B24, B29
042af00  G-b2: the boot gates — B4, B13, B14, B25
025e42b  docs: audit and phase record for G-b2
42a7039  G-b2 review fix: gate the two shipped guards, and correct D-Gb2-8's comment
         docs: review round 1 corrections to the audit
```

**Review round 1 came back "Fix first"** with two blocking items, both inside
the plan's file list, both now fixed and gated — see "The finding this phase
turns on" below and the audit's Finding 6.

**Not pushed** — `master` is **19 ahead** of `origin/master`. James's call, as
in E, F, G-a and G-b1.

Plan: `plan-b2.md` (rev 2), approved as written including D-Gb2-1's four-state
`"off"`. Audit: `audit-b2.md` — the mutant table and the cost numbers live
there, not here.

---

## What shipped

| Part | Where | What |
|---|---|---|
| The read side | `apps/server/src/workspace.ts` | `RehydrateState`/`RehydrateStatus`, `rehydrateStatus()` (a copy), `rehydrate()`, `rehydrateOne()` |
| Current-or-absent | `apps/server/src/workspace.ts` | `persist()`'s catch drops the superseded envelope; `closeAll()` stops an in-flight rehydrate |
| Store fixes | `apps/server/src/store.ts` | `.filter(isStoreId)`; `envelopePath` before `mkdirSync` |
| Health | `apps/server/src/app.ts` | `GET /api/health` carries `rehydrate` |
| The call site | `apps/server/src/index.ts` | one `void workspace.rehydrate().catch(…)` in the `listen` callback; F9's two false comments corrected |
| Gates | `apps/server/test/rehydrate.test.ts` | **new**, 11 tests |
| Gates | `apps/server/test/boot.test.ts` | **new**, 4 tests, the child-process idiom |

**Final gates:** `pnpm test` **406 passed (406)**, 32 files, exit 0.
`PSQ_NO_CORPUS=1 pnpm test` **348 passed | 58 skipped (406)**. `pnpm typecheck`
exit 0 across all four projects. Baseline was 387/329+58. (Before review round
1's two added gates: 404/346+58.)

**Skipped held at 58** at every step.

`packages/extract/test/digest.test.ts` is byte-untouched, so B27 did not need
re-running.

## The finding this phase turns on

**The fix for the last phase's inert gate was itself inert, and would have
shipped that way.**

G-b1 found that `store.test.ts`'s four corruption fixtures all asserted
`toMatchObject({ ok: false })` and nothing else, so three of the four could be
deleted with the suite green. The handoff carried the fix forward: *assert
`reason`*. The plan did the responsible thing and verified the four regexes
**match the real strings**. They do — all four are pasted in the audit.

What nobody measured was whether the *assertion* discriminates. It does not.
`toMatchObject({ reason: /not JSON/ })` is inert in vitest 2.1.9: with bare
regexes, all three fixture-deletion mutants stayed green at 23 passed, and so
did a deliberately impossible `/THIS_CANNOT_MATCH/`. The repair for a gate that
meant nothing would have been a gate that meant nothing, in the same file, one
phase later. `expect.stringMatching` fixes it and all four mutants now redden.

**The same shape, twice more in one phase:**

- **B10 could not fail the mutant the plan named for it.** §4 predicted the
  `invariants` try/catch mutant would redden B10's sixth case. It stayed green
  at 11/11 — because `invariants` cannot throw, that mutant materializes the
  broken stored graph instead of re-extracting it, and produces byte-identical
  counters. B10 now counts `extractWithDigest` calls and asserts the Map holds
  the *repaired* graph.
- **B24 has the same hazard and the plan saw it.** Comparing the digest before
  the directory check also produces `missing: 1`, because the doomed re-extract
  lands in the catch and is re-classified. Only the `digestOf` call count
  separates them, which is why B24 counts calls.
- **And review round 1 found the version with no gate at all.** Two shipped
  guards — D-Gb2-8's id agreement and D-Gb2-6's `stopping` flag — could each be
  replaced with `if (false)` or deleted outright while `apps/server/test/`
  stayed at 88 passed (88). Worse, D-Gb2-8's *comment* asserted a failure mode
  that does not exist (a `repo.id` that differs from its Map key, breaking
  DELETE — measured impossible, both branches do `set(id, { id, … })`). The
  real damage is an **orphan envelope**: the re-extract branch calls `open()`,
  which writes a second envelope under the correct filename and leaves the
  wrong-named one to re-load forever under an id no DELETE can name. A correct
  guard, carried by a false reason, with nothing testing either.

**The generalisable form, sharper than G-b1's:** *a verified because-clause is
not a verified gate — and a gate list is not a coverage claim.* The plan verified the true thing (the regexes match) and
inferred the thing that mattered (the assertion therefore discriminates). Every
one of the three failures above is a correct fact standing in for an unmeasured
consequence. The mutant list is the only thing that caught them, which is why
it was run in full rather than treated as a formality.

## Decisions

- **`rehydrate()` is called from `index.ts` only** (D-Gb2-3). `createApp()`
  never calls it, so the desktop shell and `e2e/harness.ts` still never read
  the store. One call site.
- **`"off"` is a fourth state, set in the constructor** (D-Gb2-1, approved).
  It buys health-endpoint legibility and **nothing else** — under the
  unconditional-`undefined` mutant the state genuinely is `"off"`, so it is
  not a control for anything. That is written into the type's own comment so
  the next reader cannot mistake it for one. B25's control is the stderr line.
- **A bad envelope is `failed` and its file is kept, never re-extracted**
  (D-Gb2-2). D-Gb-4 step 4 is not implementable as written: `readEnvelope`
  validates the whole envelope and discards the payload, so `path` is gone. A
  stale `extractor` and a failing `invariants()` still re-extract, because both
  parse cleanly and keep `path`.
- **`rehydrateOne()` is a separate method**, so the per-entry try/catch is
  structural rather than a convention a later edit can narrow.
- **The stored-graph branch keeps the stored `openedAt`** and does **not**
  re-persist. B6 gates both.
- **B4 and B13 are one test.** Their wordings are the same assertion; running
  it twice would have been the same gate twice.
- **B29 mocks `writeEnvelope` via a hoisted flag**, off by default. A
  permissions build of that gate would pass on the bug (at `0500` the write and
  the unlink both fail EACCES), and a whole-file mock would have made the other
  ten tests synthetic.

## Cost, measured (the full table is in the audit)

The stored-graph path is **2–15 ms per repo and barely moves with repo size**;
the re-extract path costs what `open()` costs — **1.08 s** on the worst real
corpus repo, about **100×**. A five-repo restart is ~40 ms against ~1.4 s.

**Each entry is fully synchronous.** `extract`, `materialize` and `buildBank`
never yield, so one stale corpus-D entry blocks the event loop for over a
second at boot, and `"running"` is observable only *between* entries.

## Known gaps, recorded deliberately — do not treat these as covered

- **`rehydrate()` never resets its counters.** `loaded`/`failed`/`missing` are
  initialised in the constructor and only ever incremented, so a **second**
  `rehydrate()` call on the same Workspace doubles them. Not reachable today —
  `index.ts` is the single call site and calls it once — but anything that adds
  a "re-scan the store" surface must reset them first.
- **The `SeededDb` close-on-throw in `rehydrateOne`'s catch is UNTESTED.** It
  needs `materialize` to succeed and `buildBank` to then throw, and neither the
  implementer nor the reviewer found a way to force that. The code is there and
  is the right thing; it is **not** gated, and this record says so rather than
  letting the surrounding green suite imply otherwise.

## What the next phase needs to know

- **`toMatchObject` with a bare RegExp asserts nothing** in vitest 2.1.9. Use
  `expect.stringMatching`. Worth grepping the rest of the suite for — this
  phase only fixed the four sites it owned.
- **`boot.test.ts` is the new child-process idiom** and the only place
  `index.ts` is executed by a test. `spawn(process.execPath, ["--import",
  "tsx", index])` with `cwd` at `apps/server/`; `node`/`pnpm` are not on the
  default PATH. **The test must pick the port** — `PSQ_PORT=0` is refused by
  `config.ts` and pinned as refused by `config.test.ts` — which leaves a small
  unavoidable probe-to-child race, documented in the file and not observed in
  ~30 boots.
- **Readiness is the listening line AND an answered `/api/health`.** The line
  alone races the route table, and a rehydrate of several stale repos can hold
  the event loop for seconds.
- **`store.test.ts`'s B12 still asserts `lines.length === 1`.** It holds only
  because `rehydrate()` is not called from `createApp()`. Anything that wires
  rehydrate into `createApp` must reconsider that assertion rather than relax
  it by reflex.
- **D-Gb2-5 does not cover a permission failure.** At `0500` the staging write
  and the unlink both fail EACCES, so the superseded envelope survives. The
  invariant is "current or absent when the write fails for a reason that does
  not also block unlink" — ENOSPC, a read-only file. Stated in the source.
- **`apps/server/package.json` still does not declare `zod`.** Examined and
  accepted in G-b1, deliberately not smuggled into this phase. Still owed.
- **`apps/desktop/src/main.ts` is still unpersisted** (F7, James). It now
  reports `rehydrate: { state: "off", … }` rather than a permanent `"pending"`,
  which is the whole practical case for D-Gb2-1.
- **Two corpus entries (`repoC`, `repoAClient`) refuse to open** with "No
  entities found … no CREATE TABLE". Pre-existing and expected — they are
  client-only repos. Not a regression; noted so the next person measuring
  corpus costs does not chase it.
- Unchanged and still true: **never run `pnpm test:e2e` casually** — it runs
  `build:web`, which empties the `apps/web/dist` the live server serves from
  disk. It was not run in this phase. `node`/`pnpm` are not on the default
  PATH; use `zsh -lc`. The private corpus config is the only copy of the ground
  truth, and a skipped count below 58 means it vanished.
