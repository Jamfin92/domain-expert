# Phase G-b1 — the store, write side — PROGRESS

**Status: SHIPPED. Two review rounds — round 1 sent back on a blocking security
regression, round 2 "Ship" with zero blocking. James accepted 2026-09-12.**

Six commits on `master`, `18b8143` → `d603f8b`:

```
c3863f3  G-b1: carry G-a's two held-back fixes, and track the rev-3 plan
4e94613  G-b1: the store, write side — envelopes written atomically on open()
db3401a  G-b1: gate the store — B5a, B12, B15, B17, B18, B19, B22, B23, B26
8432661  docs: phase record for G-b1
a0ff4d2  G-b1 review fix: DELETE was an arbitrary-file delete outside the store
d603f8b  docs: G-b1 audit through review round 1
```

**Not pushed** — `master` is **13 ahead** of `origin/master` (7 inherited plus
these 6). James's call, as in E, F and G-a.

Plan: `plan-b-rev3.md`, approved after one review round that falsified three of
its own because-clauses. Audit: `audit-b1.md`. Rev 2's G-b section in `plan.md`
is superseded **for G-b only**; D-Gb-1 … D-Gb-8 still stand as the design.

---

## What shipped

| Part | Where | What |
|---|---|---|
| The store | `apps/server/src/store.ts` | **new** — envelope type + zod schema, `defaultStateDir()`, atomic write (temp + `rename`), read/delete/list, `0700`/`0600`, the id guard |
| Persistence on open | `apps/server/src/workspace.ts` | ctor opts `{ stateDir?, log? }`; `rows` on `OpenRepo`; `extract` → `extractWithDigest`; persist at the end of `open()`; `forget(id)` |
| The seam | `apps/server/src/app.ts` | `AppOptions` gains `stateDir` and `log`; `DELETE` calls `forget` unconditionally (D-Gb-5) |
| Production wiring | `apps/server/src/index.ts` | `loadStateDir()` — resolves inside try/catch, persistence off on failure (F13). **No rehydrate call** |
| Gates | `apps/server/test/store.test.ts` | **new**, 21 tests |
| B17 | `apps/server/test/api.test.ts` | the writes-nothing assertion |
| D-Gb-0 | `packages/extract/test/digest.test.ts` | the arity fix, 3-line hunk |
| D-Gb-0 | `packages/extract/src/files.ts` | the comment fix — `node_modules` dropped, "eleven" now true |

`apps/desktop/src/main.ts` deliberately untouched — see Decisions.

**Final gates:** `pnpm test` **387 passed (387)**, 30 files, exit 0.
`PSQ_NO_CORPUS=1 pnpm test` **329 passed | 58 skipped (387)**. `pnpm typecheck`
exit 0 across all four projects. Baseline was 365.

**Skipped held at 58** at every step. A drop there means the private corpus
config vanished, not that something improved.

## The finding this phase turns on

**`DELETE /api/repos/:id` became an arbitrary-file delete, and 386 green tests
said nothing about it.**

D-Gb-5 requires DELETE to call `forget(id)` unconditionally so corrupt and
unloaded entries can be removed. That sent an unvalidated HTTP path segment
into `unlinkSync`: `app.ts:141` → `workspace.ts:227` → `store.ts`'s
`envelopePath`, which built `join(reposDir(stateDir), \`${id}.json\`)`, and
`join` eats `..`. Measured on the pre-fix tree:

```
DELETE /api/repos/..%2F..%2Fpsq-victim-<pid>
  -> 200 {"closed": true}, and the victim two directories up was gone
```

Express 5 percent-decodes `req.params`, so `%2F` arrives as a real separator.
No token needed: `config.ts:80` only *requires* a token off-loopback, so
`pnpm dev:server` on `127.0.0.1:8092` runs with `stateDir` set and no gate.
The Electron shell escaped only by accident — `createApp()` passes no
`stateDir`, so `forget()` returned false before touching disk. That is F7's
"desktop is unpersisted" decision doing security work nobody asked it to do.

Before this phase DELETE only mutated an in-memory `Map`. The regression was
introduced by the plan, sat inside the plan's own files list, and passed every
one of the 14 gates the plan specified.

**Fix:** one guard at the chokepoint, `store.ts:89`, `/^[0-9a-f]{12}$/` —
exactly what `shortId` emits. `writeEnvelope`'s destination was also routed
through `envelopePath`, so the write side sits behind the same check. **B28**
gates it; the guard-removal mutant kills B28 and nothing else.

Verified in review: 10 attack vectors (encoded and double-encoded slashes,
backslashes, absolute paths, unicode look-alike dots, case, length,
trailing-newline) all refused, victim files intact, `repos/` empty. 20,000
generated `shortId` values, 0 rejected. The trailing-newline `$`-anchor bypass
does **not** apply — JavaScript's `$` matches only at end-of-input without the
`m` flag, unlike Python's.

## The correction most worth remembering

**The plan's thesis ate its own tail, three layers deep, and each layer was
caught only by measurement.**

G-a learned: *a claim about what a gate holds is itself a claim, and cheap to
measure.* This phase added two more turns of the same screw:

1. **Rev 2 shipped a headline gate that could not run.** B4 spawned the server
   with `PSQ_PORT=0`, which `config.ts:59` rejects and `config.test.ts:67`
   *deliberately pins* as rejected. Four of rev 2's five errors were one
   command or one grep away, and it had been reviewed twice.
2. **Rev 3 stated that thesis, applied it to rev 2, and shipped three
   unmeasured reasons of its own.** The reviewer falsified all three: the
   fnm/`HOME` claim (it booted the server under an overridden `HOME` three
   ways), B12's "0500 permits writes to an existing file" (false under
   temp+rename — measured on APFS: `mkdir` EACCES, overwrite **succeeds**,
   `rename` EACCES), and B19's "assert on a rewrite" (backwards for the same
   reason). The recommendations all survived; the justifications did not.
3. **The fix for the signature failure carried the signature failure.** The id
   guard forced `store.test.ts`'s synthetic fixture ids to become hex, and the
   new comment claims "which case is which lives in the assertions rather than
   the filenames." Measured false: all four corruption cases assert
   `toMatchObject({ ok: false })` and nothing else, and deleting the
   `version: 99` fixture entirely leaves the suite green at 21 passed.

**The generalisable form: the reasons are where it hides.** Conclusions get
challenged; the because-clause attached to a correct conclusion rides along
unexamined, across revisions and hands. Every correction above was written into
the control column rather than fixed silently, so the next reader sees what was
wrong and not just what is right.

## Decisions

- **The desktop app stays unpersisted** (James, F7). `apps/desktop/src/main.ts:29`
  calls `createApp()` bare. Reasons: the desktop shell is user-launched, not
  `KeepAlive`-restarted, so it does not have the problem this phase fixes; and
  one store shared with the LaunchAgent means two processes writing the same
  envelope with no locking. One line in `main.ts` adds it later. **A decision,
  not an omission** — the same note D-Gb-7 already carries for `e2e/harness.ts`.
- **G-b ships as two phases** (James). This is the write side; G-b2 is the read
  side. G-b1 is a phase boundary, not a release — it writes files nothing reads.
- `log` is typed `(line: unknown) => void` so G-b2 can write
  `void rehydrate().catch(log)` literally.
- `DEFAULT_ROWS = 40` is a module constant in `workspace.ts`, not a new
  `@psq/quiz` export. It **does not** de-duplicate: `40` still lives at
  `packages/quiz/src/sql/seed.ts:233`, `apps/cli/src/index.ts:95` and `:212`.
  The real D-Gb-3 protection is that `open()` now *stores* the resolved `rows`,
  gated by B5a. The comment says so.
- `readEnvelope` returns a discriminated result rather than throwing (F5's shape).
- `OpenRepo` gains `rows` only, not `fingerprint`.
- `store.ts` imports `zod` without `apps/server/package.json` declaring it.
  Checked and accepted: `packages/schema` has no dependencies block at all and
  already does this, root declares zod as a runtime dep, and `app.ts` already
  pulled zod into the desktop bundle through a value import before this phase.
  Repo hygiene for later, not a fix.

## What G-b2 needs to know

- **`index.ts` is the one file in this phase that no test executes.**
  `loadStateDir()` (`index.ts:36-46`) is the only production wiring and nothing
  imports `index.ts` in the suite — a `loadStateDir` returning `undefined`
  unconditionally would be invisible to all 387 tests. B22 exercises
  `createApp`, not the entry point. **B4 and B25 are the first things that
  execute it.** Keep B25 as the `HOME`-and-`XDG_DATA_HOME`-both-absent child,
  not the softer unwritable-path variant: F13's try/catch is currently a
  negative guard with no positive control
  ([[negative-gates-need-positive-control]]).
- **`listEnvelopeIds` (`store.ts:168-180`) does not filter through `isStoreId`.**
  It filters `.json` and a leading dot only. A stray `notes.json` in
  `<stateDir>/repos` gets listed, fails `readEnvelope` safely, and then becomes
  a **permanent `failed` entry in D-Gb-8's health counter that D-Gb-4 never
  cleans up**. One `.filter(isStoreId)` makes junk invisible instead of
  alarming. Do this in G-b2's first commit.
- **The four refusal fixtures are not individually failable.**
  `store.test.ts:148-167` asserts `toMatchObject({ ok: false })` for all four
  corruption cases; three of the four could vanish without reddening anything.
  Assert `reason` — `/not JSON/`, `/version/`, `/graph/`, `/ENOENT|no such file/`
  — four lines, and B10's six cases then mean what their names say. **B10 is
  the gate that depends on this**; without it B10 can pass while testing one
  case four times.
- **Re-open + failed persist leaves a stale envelope.** `workspace.ts:139-141`
  deletes the Map entry, `:184` re-inserts, `:185` persists. If `persist()`
  fails on a re-open, the *previous* envelope survives on disk with the old
  `seed`/`rows`/`fingerprint`, and rehydrate would resurrect the superseded
  configuration. Harmless while nothing reads the store; **a bug the moment
  G-b2 lands.** The choice — unlink before re-extract, or accept it because the
  fingerprint comparison re-extracts anyway — is a G-b2 decision.
- **`store.test.ts:319` asserts `lines.length === 1` exactly.** Correct today;
  needs a thought the moment G-b2 adds a second log source in the same process.
- **Ordering nit:** `writeEnvelope` calls `mkdirSync` (`store.ts:121`) *before*
  `envelopePath` validates (`:123`), so a hostile id would create
  `<stateDir>/repos` before throwing. No impact today — write-side ids are
  always `shortId` — but the guard reads as if it were first.
- **`digestOf` is invariant under path normalization.** Measured:
  `digestOf("<p>/../mini-efcore") === digestOf(resolve(p))`, and a trailing
  slash likewise. **No fingerprint assertion can distinguish a raw path from a
  resolved one** — rev 3's B5a control note was a third wrong. What closes the
  gap is that `workspace.ts` resolves before hashing and `id = shortId(resolvedPath)`,
  so a raw-path implementation writes a different id, filename and `path` field;
  `store.test.ts:256-257` asserts both.
- **B23 is the only gate that sees digest/extract ordering.** `extract()` then
  `digestOf()` — A10's permanently-stale window — passes both B5a and B5b,
  because both sides of both are `digestOf`. Confirmed in review: the mutant
  reddens B23 alone while B5a stays green. Do not weaken B23 or fold it into B5.
- **B27 must be re-run if G-b2 touches `digest.test.ts`.** G-a: path-awareness
  lives in exactly two assertions there. They are at `:126` and `:135`
  (assertions `:132` and `:147`) and are byte-identical to G-a. Do not tidy.
- **A known flaky test, reproduced and explained — not ours.**
  `api.test.ts:119` `404s for a repo that is not open` failed once in 68
  *contended* runs with `expected 401 to be 404`; never in 30 serial, 20
  shuffled, or 10 full-suite runs. The only 401 in the server is inside
  `bearerGate`, which mounts only when a token is passed, and `api.test.ts`
  passes a token at none of its three `createApp` sites — **the app under test
  cannot emit 401.** It is ephemeral-port cross-connect between concurrently
  running supertest servers (a fresh `listen(0)` per request). Pre-existing.
  G-b1 adds four more supertest servers, so it marginally increases the churn
  that exposes it. If it ever bites `pnpm test` for real, the fix is a shared
  server per file, **not** in the store.
- Unchanged and still true: **never run `pnpm test:e2e` casually** — it runs
  `build:web`, which empties the `apps/web/dist` the live server serves from
  disk. `node`/`pnpm` are not on the default PATH; use `zsh -lc`. The private
  corpus config is the only copy of the ground truth.

## Starting G-b2

Read this file, then `plan-b-rev3.md` from `### G-b2 — rehydrate` — the files
list and gates B4, B5b, B6–B11, B13, B14, B16, B24, B25. The design is
D-Gb-4, D-Gb-6 and D-Gb-8 in `plan.md`, as corrected by rev 3's F5, F11, F12
and F13.

Before planning, re-verify against the shipped code rather than against rev 3 —
`store.ts` now exists and rev 3 was written before it did. The four carries
above (the `listEnvelopeIds` filter, the `reason` assertions, the re-open
decision, and B25's shape) belong in G-b2's first commit or its plan.
