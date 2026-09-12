# Phase G — the server remembers what was open

**Plan rev 2.** Rev 1 was reviewed and sent back. Its central technical premise
was false; see "What rev 1 got wrong" at the end. Rev 2 splits the work at the
package boundary into **G-a** (the digest) and **G-b** (the store + rehydrate).

**Amendment 1 (2026-09-12, approved by James), G-a only.** Gate A1 halted the
build as designed: widening `include` surfaced **two pre-existing `TS2769`
errors**, both in `apps/server/test/auth.test.ts:61,66`. `@types/supertest`
^7.2.1 permits a `string[]` header value only for `Cookie`; the test passes an
array to `Authorization` **deliberately**, to prove Node keeps the first header
line and discards the second. The runtime behaviour is intended; only the
declaration disallows it.

Measured by the implementer against an otherwise unmodified config:
`packages/*/test/**/*.ts` alone → **0 errors**; `apps/*/test/**/*.ts` → **2**.

The full widening is kept and `auth.test.ts` joins the file list. Narrowing to
`packages/*/test` would leave `apps/*/test` blind, and G-b adds three new test
files under exactly that glob — deferring the collision, not removing it.

The suppression must be **`@ts-expect-error` with a comment naming the reason**,
never `@ts-ignore` and never a widening cast. `@ts-expect-error` fails if
`@types/supertest` ever allows the array, so the suppression invalidates itself
instead of outliving its reason — the shape this repo has already been bitten by.

**Amendment 2 (2026-09-12, approved by James), G-a follow-ups.** The G-a review
returned **Ship, no blocking issues**, having re-run every gate and mutation-tested
the controls. Four non-blocking items are folded back in rather than deferred,
because two of them weaken the property G-b is built on.

- **The digest must be taken BEFORE extraction.** `detect.ts:71` returns
  `{ graph: extractGraph(root), digest: digestOf(root) }`, and object-literal
  properties evaluate in source order — so the graph is built from the bytes at
  T0 and stamped with a fingerprint of the bytes at T0+1.3s. A file edited during
  that window yields an old graph carrying a current digest: **permanently stale,
  the exact class D-Ga-1 exists to prevent.** Digest-first inverts the race into
  a fingerprint mismatch, i.e. a re-extract, which is the safe direction.
- **A6's control does not hold the property it claims.** Mutation-tested by the
  reviewer: a `digestOf` that hashes contents only, dropping the relpath
  entirely, **passes all 15 tests**. A6's add and delete cases both move the
  content stream, so neither separates the two designs. The digest as written is
  correct; the gate is not holding it there. A6 gains a **rename with
  byte-identical contents**, which is load-bearing because moving `tsconfig.json`
  one directory down re-roots the whole TS half via `nodeRootFor` (`merge.ts:50,67`).
- The `DIGEST_EXTENSIONS` comment records only the `node_modules` limit; the rest
  of `walk`'s `SKIP` list (`files.ts:9-12` — `dist`, `build`, `bin`, `obj`,
  `.next`, `coverage`) carries the same risk and is undocumented. A tsconfig whose
  `include` reaches generated sources under `build/` or `.next/` gives a program
  file set the digest cannot see.
- `DIGEST_EXTENSIONS` is exported from the package index (`index.ts:12`) with no
  consumer outside the package. `merge.test.ts:9` carries an explicit note
  declining to widen public surface for an internal; this does the opposite, and
  it is one more symbol a later phase can accidentally depend on. Unexport it.

Also corrected for the record: the audit's A1 line overstates the widening's
reach. `tsconfig.json` already excludes `apps/web`, so `apps/web/test/*` is
typechecked by **nothing**, before or after. `tsc --listFiles` shows 13 test
files entered the program, all under `packages/*/test` and `apps/server/test`.
No regression, and G-b's three new files land in covered territory.

## Goal

After any restart of `com.psq.server`, `GET /api/repos` returns the repos that
were open before it went down, with a working graph, quiz bank and SQL grading,
without anyone re-typing a path into the UI.

The graph is read from disk. The seeded database and question bank are **rebuilt**
on load.

## Non-goals (chosen by James, 2026-09-11)

- **No export / query-without-a-server surface.** M7 `psq export` stays deferred.
- **No seeded-DB file.** `materialize()`'s `opts.path` stays unused in production.
- **No question-bank persistence.**
- **No speed goal.** Measured: the whole pipeline is 0.6–1.9s per root (`psq help`
  alone is 0.57s of tsx/pnpm startup), so recompute costs ~1.3s at worst. This
  phase buys durability, not latency.
- **No CLI change.** The CLI is stateless per invocation and stays that way.
- **No `PSQ_STATE_DIR` env var.** Narrowed out on review — see D-G-7.

## Context measured today

| Root | files | `graph` | `questions` | walk+stat | walk+sha256 |
|---|---|---|---|---|---|
| repoA | 102 | 0.61s | 0.62s | 1.5ms | 6.9ms |
| repoB | 40 | — | — | 0.4ms | 4.3ms |
| repoC | 9 | — | — | 0.2ms | 1.3ms |
| repoD | 125 | 1.85s | 1.86s | 2.1ms | 5.3ms |
| repoE | 28 | — | — | 0.3ms | 3.6ms |
| repoAClient | 260 | 1.08s | 1.06s | 2.5ms | 11.3ms |

Content hashing the whole walked set costs 1–11ms — cheap enough that an mtime
heuristic buys nothing and lies after a `git checkout`. The fingerprint hashes
**contents**.

Live service facts this plan depends on
(`~/Library/LaunchAgents/com.psq.server.plist`, read today): `KeepAlive = True`,
`ThrottleInterval = 30`, `WorkingDirectory` is the production checkout, and the
process environment provides `HOME=/Users/james`, `PATH`, `PSQ_HOST/PORT/TOKEN`
and **no `XDG_DATA_HOME`**. `~/.local/share` exists and is writable;
`~/.local/share/psq` does not exist yet.

Baseline at `e7adccd`: `pnpm test` **342** (`284 passed | 58 skipped`),
typecheck clean.

---

# G-a — the digest

Self-contained in `packages/extract`. Ships and is reviewed before G-b starts,
so G-b builds on a fingerprint whose sensitivity is already proven.

### D-Ga-1. `digestOf` owns its own extension list

Extraction does **not** walk once. It walks three times, and the walks are not
the whole story:

- `detectProvider()` → `walk(root, [".csproj",".cs",".ts",".tsx"])` (`detect.ts:32`)
- the C# reader → `walk(root, [".cs"])` (`dotnet.ts:262`), then `readFileSync` each
- the TS reader → `walk(root, [".ts",".tsx"])` (`node.ts:167`) **only as a
  fallback**. The primary path is `ts.createProgram(parsed.fileNames, …)`
  (`node.ts:127-134`) or a referenced project's file set (`node.ts:149`), both
  driven by a `tsconfig.json` read at `node.ts:119`.

So the file set is decided by files that appear in no walk:

- `tsconfig.json` decides both the file list and the compiler options overlay.
- Referenced configs are read at `node.ts:82`, and `nodeRootFor`
  (`merge.ts:50,67`) scans one level down for a nested `tsconfig.json` to pick
  the node root — adding one re-roots the whole TS half of a fullstack graph.
- `detectProvider` branches on `existsSync(package.json | tsconfig.json)`
  (`detect.ts:41-43`), so the **provider itself** can flip.
- `ownSources` (`node.ts:175-186`) filters only declaration files,
  `node_modules` and the root prefix, so with `allowJs` the program reads
  `.js`/`.jsx`; `.mts`/`.cts` are read by the program but never match `walk`'s
  `endsWith(".ts")` (`files.ts:35`).

`walk`'s matcher is `endsWith`, so whole filenames work as suffixes. `digestOf`
therefore declares its own list and **`detect.ts:32`'s list is documented as a
subset, not the source of truth**:

```
[".cs", ".csproj", ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx",
 "tsconfig.json", "package.json"]
```

`.js`/`.jsx`/`package.json` are read only under some configurations. Hashing
them unconditionally over-invalidates, which costs 1.3s of re-extract and is the
safe direction. Missing them does not over-invalidate — it serves a **permanently
stale graph** with no user-visible escape short of DELETE and re-add, and makes
psq assert facts about a repo that are no longer true (CLAUDE.md rule 2).

**Stated limit, deliberately not closed:** `ts.createProgram` resolves `.d.ts`
and lib files inside `node_modules`, which `walk` skips. A change to a
dependency's types will not invalidate the store. Repo source changes will.

### D-Ga-2. One digest function, two callers

- `digestOf(root): string` in `files.ts` — walk with the list above, then
  `sha256` over the sorted result. Each entry contributes
  `relpath + NUL + byteLength + NUL + contents` so that `"a.tsX"+"Y"` cannot
  collide with `"a.ts"+"XY"`.
- `extractWithDigest(root): {graph, digest}` in `detect.ts`, calling `digestOf` —
  never an inlined second hash.
- `extract(root)` stays exactly as it is, a wrapper returning `.graph`. Its two
  production call sites (`apps/cli/src/index.ts:43`,
  `apps/server/src/workspace.ts:108`) and three test sites are untouched, and
  `entity.graph.json` does not change a byte.

Rehydration needs a digest **without** paying for extraction, which is why
`digestOf` is public rather than private.

### D-Ga-3. `EXTRACTOR_VERSION`

A hand-maintained integer exported from `packages/extract`, bumped when
extraction semantics change. It goes in the stored envelope in G-b; a mismatch
means stale.

Without it, `scripts/deploy.sh` rebuilding from the production checkout leaves
every stored digest valid while the extractor that produced those graphs is
gone — the store would serve old-extractor graphs indefinitely. The envelope's
own `version` guards the envelope shape, not the producer.

**This is a discipline control and it can be forgotten.** An auto-derived digest
of the extractor's own sources was considered and rejected as too clever for the
gain; the cost of the manual version is one stale-graph class of bug, and it is
recorded in `progress.md` rather than hidden here.

### G-a files touched

1. `packages/extract/src/files.ts` — add `digestOf(root)`
2. `packages/extract/src/detect.ts` — add `extractWithDigest()`; `extract()` becomes a wrapper
3. `packages/extract/src/index.ts` — export `digestOf`, `extractWithDigest`, `EXTRACTOR_VERSION` (package entry confirmed, `index.ts:1-8`)
4. `tsconfig.json` — add `apps/*/test` and `packages/*/test` to `include`
5. `apps/server/test/auth.test.ts` — **Amendment 1**: two `@ts-expect-error`
   lines with reasons, at `:61` and `:66`. Added to the list because file 4
   causes the errors; no behavioural change to the test
6. `packages/extract/test/digest.test.ts` — new
7. `feature-research/g-local-persistence/plan.md` — this file
8. `feature-research/g-local-persistence/audit-a.md`, `progress-a.md`

**On file 4:** the root `tsconfig.json` `include` is `packages/*/src`, `apps/*/src`,
`test/**`, so package- and app-level test directories are **never typechecked** —
gate 1 is blind to half the files this work adds. If widening `include` surfaces
pre-existing errors, the implementer **stops and reports them** rather than
fixing them inside this phase.

### G-a gates

| # | Gate | Control that proves it can fail |
|---|---|---|
| A1 | `pnpm typecheck` clean, all four projects, **with test dirs now included** | the widened `include` is itself the control. Per Amendment 1 the only permitted fix is the two `@ts-expect-error` lines in `auth.test.ts`; **any third error is a stop-and-report**, not a third suppression |
| A2 | `PSQ_NO_CORPUS=1 pnpm test` = 284 + new, 0 failed | **skipped stays 58** — a drop means the corpus config vanished, not that something improved |
| A3 | `pnpm test` = 342 + new (state the exact number), 0 failed | — |
| A4 | **Determinism**: `digestOf(root)` twice on an unchanged fixture is identical | without this, every "it changed" assertion below passes on a nondeterministic hash |
| A5 | **Sensitivity, per extension**: in a temp copy, mutate one byte of a `.cs`, `.ts`, `.tsx`, `.csproj`, `tsconfig.json` and `package.json` in turn; the digest moves for each | A4 is the control — a hash that always changes passes A5 and fails A4 |
| A6 | **Add, delete, and rename**: adding a new `.ts`, deleting an existing one, and **renaming one to byte-identical contents** each move the digest | **Amendment 2**: the add/delete pair alone does NOT catch a contents-only digest — it passes all 15 tests. The rename is the case that separates them, and the property is load-bearing via `nodeRootFor` |
| A7 | **Negative**: editing `README.md`, and adding a file under `node_modules/`, do **not** move the digest | without it an over-broad walk passes A5 and thrashes re-extract forever |
| A8 | **Framing**: assert the **naive** `relpath + contents` concat collides on the pair below, and that `digestOf` does **not** | the naive-collides half is the control; without it A8 passes whether or not the framing does anything. Concrete pair found by the implementer: one file `a.ts` containing `"b.tsZ"`, versus two files `a.ts` (empty) + `b.ts` containing `"Z"` |
| A9 | `git show --stat` is exactly the code/test paths above **plus the phase records** | wording carried from Phase F, where "exactly 18 paths" left a shipped plan untracked |

Note there is deliberately **no** `digestOf(root) === extractWithDigest(root).digest`
gate. Rev 1 had one; it compares a function against itself and can only fail if
`extractWithDigest` mutates state between calls. The parity that matters is
cross-time, and it lives in G-b as gate B5.

---

# G-b — the store and rehydrate

Starts only after G-a is reviewed and accepted.

### D-Gb-1. The store lives outside the checkout

`~/.local/share/psq/repos/` — `${XDG_DATA_HOME:-$HOME/.local/share}/psq`,
resolved by a pure function so it can be tested directly. Directory `0700`,
files `0600`, matching `~/.config/psq/deploy.env`.

Three reasons it is not inside the repo:

1. The repo is **public**; the store holds absolute paths to private corpus
   repos and their extracted entity and table names.
2. `runs/` is gitignored, and an untracked directory is one `git clean` from
   gone — this repo has already lost a shipped plan that way.
3. CLAUDE.md rule 8: target repos are read-only. The store is psq-owned state.

If `HOME` is unset the resolver throws with an actionable message; `deploy.sh`
supplies only `PSQ_HOST/PORT/TOKEN/PATH`, but launchd supplies `HOME` (verified
today on pid 1608).

### D-Gb-2. One file per repo, written atomically

```
<state>/repos/<id>.json      # id = shortId(resolvedPath), workspace.ts:55-56
```

Envelope: `{ version: 1, extractor: EXTRACTOR_VERSION, id, path, seed, rows, openedAt, fingerprint, graph }`.

Written to a temp file in the same directory and `rename`d into place — atomic,
one line, and strictly better than tolerating half-written files. One file per
repo so a corrupt entry costs one repo, not the store. `shortId` is already the
Map key; do not invent a second id scheme.

`graph` is validated on load with the existing `EntityGraph` zod schema
(`packages/schema/src/index.ts:294`) **and then passed through `invariants()`**,
which `open()` enforces at `workspace.ts:109-115` and which CLAUDE.md requires
before questions are trusted. A loaded graph gets the same treatment as an
extracted one.

### D-Gb-3. `rows` does not exist yet and must be added

`OpenRepo` (`workspace.ts:23-31`) has **no `rows` field**, and `workspace.ts:139`
passes a literal `40`. Both `seed` and `rows` must be resolved **before**
storage and stored, then used on load — not re-defaulted. Phase F spent itself
on seed parity; this is the one place the two shells can silently diverge again.

### D-Gb-4. Rehydrate after `listen()`, yielding between entries

`KeepAlive` + `ThrottleInterval 30` means anything throwing before the socket
binds becomes a silent 30-second restart loop. Bind first.

`extract`, `materialize` and `buildBank` are all **synchronous**. Six roots at
~1.5s each would block the event loop for ~9s with the socket bound and nothing
accepted — `/api/health` could not answer, and a SIGTERM arriving mid-rehydrate
would not be serviced (handlers are registered at `index.ts:56-63`). So
`rehydrate()` awaits a `setImmediate` turn **between entries**, and the call
site is `void rehydrate().catch(log)` — an unhandled rejection at top level
terminates the process under Node 24, which is the exact restart loop this
design exists to avoid.

Per entry, tiebroken by id (rev 1 said `openedAt` order, which buys nothing:
`list()` re-sorts by name at `workspace.ts:67-69`, and the injected test clock
makes every entry tie):

1. Parse the envelope. Bad JSON, wrong `version`, wrong `extractor`, a failed
   `EntityGraph.parse`, or a failed `invariants()` → stale; **keep the file**.
2. `path` no longer a directory → skip, mark `missing`, **keep the file**.
   **This check must stay strictly before the fingerprint comparison.**
   `digestOf` on a missing root returns the empty-tree sha256 rather than
   throwing (see Risks), so comparing first would read a vanished repo as "a
   repo that changed" and trigger a doomed re-extract instead of `missing`.
3. `id` already in `this.repos` → skip; a `POST /api/repos` beat us.
4. `digestOf(path)` ≠ stored fingerprint, or stale from step 1 → re-extract and
   rewrite the envelope.
5. Otherwise use the stored graph.
6. `materialize()` + `buildBank()` with the **stored** `seed` and `rows`, insert.

Every failure is per-entry, logged, and never stops the remaining entries.

### D-Gb-5. Shutdown must not erase the store, and DELETE must always reach it

`closeAll()` (`workspace.ts:278-280`) runs on SIGINT/SIGTERM and calls
`close(id)` per repo. Hooking store deletion into `close()` would make a clean
shutdown delete exactly the state this phase preserves. So `forget(id)` is
separate, and `close()`/`closeAll()` never touch the store.

But `DELETE /api/repos/:id` (`app.ts:127-134`) calls `close(id)`, which returns
`false` when the repo is not in the Map (`workspace.ts:149-151`) and 404s. Steps
1 and 2 above deliberately keep files for entries that are *not* in the Map, so
an unmounted volume or corrupt envelope would produce a record that **cannot be
deleted through any surface** and is retried on every restart forever.

Fix: DELETE calls `forget(id)` **unconditionally**, and returns 200 if either
`close()` or `forget()` found something.

### D-Gb-6. The store never fails a request

A write failure after a successful `open()` is logged and swallowed. The store
is a restart convenience, not the source of truth. `POST /api/repos` must still
return 201 when the state directory is unwritable.

### D-Gb-7. `stateDir === undefined` means persistence is OFF

Not "fall back to the default". `apps/server/test/api.test.ts:14` constructs
`new Workspace(clock)` and `e2e/harness.ts:60` calls `createApp(undefined, …)`,
both opening fixture repos through the real API. If undefined fell back to the
real default, **`pnpm test` and `pnpm test:e2e` would write live store entries
for test fixtures, and the production LaunchAgent would rehydrate them.**

So: only `apps/server/src/index.ts` resolves and supplies the real directory.
Tests inject a temp dir explicitly. `e2e/harness.ts` needs no change, which is
why it is not in the files list — that is a decision, not an omission.

This is also why there is **no `PSQ_STATE_DIR`**: it would exist only so tests
could inject, and constructor injection already does that. Dropping it removes
`config.ts` and `config.test.ts` from the list, and with them the question of
which of the three incompatible empty-string conventions in `config.ts` to
follow (`PSQ_HOST` at `:34-39` rejects empty as an error, `PSQ_TOKEN` at `:68-70`
treats it as unset, `rawPort` at `:48-63` has no empty branch at all).

`createApp` builds its own Workspace by default (`app.ts:91-97`) and `index.ts:29`
calls `createApp(undefined, {token})`, so there is currently **no seam** through
which a stateDir could reach the Workspace. G-b adds `AppOptions.stateDir`.

### D-Gb-8. Health reports rehydration

`GET /api/health` gains
`rehydrate: { state: "pending"|"running"|"done", loaded, failed, missing }`.
Given D-Gb-4 keeps startup from crashing, this is the only way to see a broken
store from outside. The `setImmediate` yield is what makes `running` actually
observable rather than a state that exists only on paper.

### G-b files touched

1. `apps/server/src/store.ts` — **new**: envelope schema, default-dir resolver, atomic read/write/delete/list, permissions
2. `apps/server/src/workspace.ts` — `stateDir` ctor option; `rows` on `OpenRepo`; persist on `open()`; `forget(id)`; `rehydrate()`
3. `apps/server/src/app.ts` — `AppOptions.stateDir`; DELETE calls `forget` unconditionally; health reports rehydrate status
4. `apps/server/src/index.ts` — resolve the default dir, pass it, `void rehydrate().catch(log)` inside the `listen()` callback
5. `apps/server/test/store.test.ts` — **new**
6. `apps/server/test/rehydrate.test.ts` — **new**
7. `apps/server/test/boot.test.ts` — **new**, the child-process gate
8. `apps/server/test/api.test.ts` — ctor signature, health shape, the writes-nothing assertion
9. `feature-research/g-local-persistence/audit-b.md`, `progress.md`

### G-b gates

| # | Gate | Control that proves it can fail |
|---|---|---|
| B1 | `pnpm typecheck` clean | — |
| B2 | `PSQ_NO_CORPUS=1 pnpm test` rises by the new tests, 0 failed | **skipped stays 58** |
| B3 | `pnpm test` = the G-a total + new (state the exact number), 0 failed | — |
| B4 | **Boot round trip**: spawn `apps/server/src/index.ts` as a child with `PSQ_PORT=0` and a temp state dir, `POST` a fixture, SIGTERM, restart, `GET /api/repos` returns the repo | this is the Goal paragraph. Every other gate calls `Workspace` directly and stays green whether or not the production entry point is wired at all |
| B5 | **Cross-time digest parity**: the fingerprint written at `open()` equals `digestOf(path)` recomputed at rehydrate on an unchanged repo | the parity that matters; replaces rev 1's tautological same-call comparison |
| B6 | **Fidelity**: open with a **non-default seed and non-default rows**, capture the full ordered list of question ids; rehydrate in a new Workspace; the id lists are identical | subsumes seed, rows, graph fidelity and CLAUDE.md rule 7. Strictly stronger than "one question grades correctly", which passes even if the stored seed is ignored |
| B7 | **Grading works**: a rehydrated repo grades a correct answer right **and a wrong answer wrong** | the wrong-answer half is the control; an always-correct grader passes without it |
| B8 | **Stale detection**: mutate a source file so the **graph changes observably** (add a column to a `CREATE TABLE`), rehydrate, assert the new fact appears and the envelope was rewritten | pair with the unmutated case asserting it was **not** re-extracted. Without the observable change, an implementation that rewrites the fingerprint and keeps the old graph passes |
| B9 | **Extractor version**: an envelope with a stale `extractor` forces re-extract | pair with a matching `extractor` asserting it does not |
| B10 | **Corrupt store**: garbage JSON, `version: 99`, a stale `extractor`, a missing `path`, and a **well-formed envelope whose `graph` fails `EntityGraph.parse`** — alongside **one good entry** | the good entry must load in the same run, or "everything skipped" reads as success. The bad-graph case is the only thing that tests D-Gb-2's headline claim; without it an implementation that never calls the schema passes |
| B11 | **Files are kept**: after B10, the corrupt and missing entries still exist on disk | D-Gb-4 says "keep"; nothing else checks it, and a cleanup-happy implementation passes B10 |
| B12 | **Never fails a request**: `chmod 0500` the state dir **before the first open**, `POST /api/repos` still returns 201, and the failure is visible in the captured logger | chmod-after-open is vacuous — 0500 blocks creation, not writes to an existing file. The logger assertion is the mechanism; without it the gate passes on a no-op store |
| B13 | **Shutdown safety**: drive the real SIGTERM path from B4's child process, restart, the repo comes back | `closeAll()` in-process would still pass if a future `forget()` were hooked into the shutdown handler instead of `close()` |
| B14 | **Forget really forgets**: `DELETE /api/repos/:id`, restart, the repo does **not** come back | the positive control for B13 |
| B15 | **DELETE reaches unloaded entries**: plant a corrupt envelope, DELETE its id, assert 200 and the file is gone | the B4/B14 path only covers loaded repos; this is the D-Gb-5 hole |
| B16 | **`running` is observable**: with two entries, poll `/api/health` during rehydrate and catch `state: "running"` | if the yield is missing this can never be observed, and D-Gb-8's tri-state is decoration |
| B17 | **Persistence off by default**: `new Workspace(clock)` with no stateDir opens a repo and writes **nothing** anywhere; assert the default dir is untouched | without it, `pnpm test` silently populates the real store |
| B18 | **Default resolver**: pure-function test for `XDG_DATA_HOME` set, unset, and `HOME` absent | "resolves outside the repo root" is vacuous when every other test injects a temp dir |
| B19 | Store dir `0700`, files `0600` | note `writeFileSync` does not re-chmod an existing file — assert on a rewrite, not only a first write |
| B20 | Diff swept for corpus paths and the tailnet host/token, with the env file as the sweep's positive control | the Phase F lesson applied |
| B21 | `git show --stat` is exactly the code/test paths above **plus the phase records** | — |

---

## Risks and known limits

- **Dependency-type changes do not invalidate** (D-Ga-1). Bounded, recorded.
- **`EXTRACTOR_VERSION` is discipline** (D-Ga-3). Forgetting to bump it serves
  old-extractor graphs after a deploy. No gate can catch a forgotten bump.
- **`walk`'s 20,000-file cap now binds sooner.** `digestOf` passes a list ~2.5×
  broader than `detect.ts:32`'s, so the digest truncates before any extraction
  walk does. Past the cap, changes never move the digest, and because truncation
  follows `readdirSync` order the "two identical trees digest equal" property A4
  proves stops being guaranteed. Unreachable on the measured corpus (max 260
  files); recorded, not fixed.
- **Unreadable is indistinguishable from absent.** `files.ts:114-117` drops an
  unreadable entry entirely, so a `chmod 000` file hashes the same as a deleted
  one, and `walk` swallows a failed `readdirSync` — `digestOf("/gone")` returns
  the empty-tree sha256 rather than throwing. Safe in G-a; see D-Gb-4 step 2.
- **Rehydrate is unbounded in repo count.** Six roots cost ~6 × materialize+bank.
  Worth a cap if the store ever grows; out of scope now.
- **Rehydrate cost per repo is unmeasured.** Extraction dominates the 1.3s
  pipeline, so the rebuild-only path should be well under it, but the implementer
  should measure and record it rather than assume.
- `psq doctor` is referenced by `package.json:15` and **does not exist** — the CLI
  switch falls through to help and exits 2. Pre-existing, surfaced by this survey,
  not fixed here. It is the natural home for a future "show me the store" readout.

## What rev 1 got wrong

Recorded because the shape repeats.

1. **The superset claim was false.** Rev 1 said detect's walk covers everything
   the readers read, so one digest over that list was sufficient. It is not:
   the TS reader's walk is a *fallback*, and the real file set comes from
   `tsconfig.json`. The plan had built its central correctness argument on a
   survey answer rather than on the code, and the failure mode it produced was
   not the conservative one it claimed — it was a permanently stale graph.
2. **Its headline gate was a tautology.** `digestOf(root) === extractWithDigest(root).digest`
   compares a function with itself. An inlined-but-correct duplicate — exactly
   the drift the gate existed to catch — passes it.
3. **No gate touched the production entry point.** Thirteen gates, and the
   sentence in the Goal paragraph was tested by none of them.
4. **The default state dir would have written into the live store from
   `pnpm test`.** Rev 1 never asked what `stateDir === undefined` meant.
5. **Three of its controls could not control**: the seed/rows risk cited a gate
   that opens at the default seed, `chmod 0500` after the first open permits the
   write it claims to block, and "resolves outside the repo root" is trivially
   true when the test injects a temp dir.
