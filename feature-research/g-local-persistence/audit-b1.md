# Phase G-b1 — the store, write side — AUDIT

Plan: `plan-b-rev3.md`, the **G-b1** section only. Baseline `18b8143`.
Commits, not pushed: `c3863f3` → `4e94613` → `db3401a` → `8432661`, plus the
review-fix commit below. First review verdict was **Send back**, one blocking
finding (a path traversal this phase introduced); fixed and re-gated here.

**G-b1 is not a deliverable.** It ships code that writes files nothing reads —
deliberately the same shape as the `entity.graph.json` bug this phase exists to
fix. The gate that touches the production entry point (B4) is in G-b2.

## Files changed

| File | |
|---|---|
| `apps/server/src/store.ts` | **new** |
| `apps/server/src/workspace.ts` | modified |
| `apps/server/src/app.ts` | modified |
| `apps/server/src/index.ts` | modified |
| `apps/server/test/store.test.ts` | **new** |
| `apps/server/test/api.test.ts` | modified |
| `packages/extract/test/digest.test.ts` | modified (D-Gb-0) |
| `packages/extract/src/files.ts` | modified (D-Gb-0 / F6) |
| `feature-research/g-local-persistence/plan-b-rev3.md` | **new** (was untracked) |
| `feature-research/g-local-persistence/audit-b1.md` | **new**, this file |

Nothing else. `apps/desktop/src/main.ts` is untouched, per the recorded
decision in F7. No `rehydrate()`, no health `rehydrate` field, no `index.ts`
rehydrate call, no `rehydrate.test.ts`, no `boot.test.ts` — all G-b2.

## What changed, per file

**`apps/server/src/store.ts`** (new, 166 lines). `STORE_VERSION = 1`; the
`StoredRepo` zod envelope (`version, extractor, id, path, seed, rows, openedAt,
fingerprint, graph`, the graph validated with the real `EntityGraph` schema);
`defaultStateDir(env = process.env)`; `reposDir`, `envelopePath`,
`tempPathFor`; `writeEnvelope` (mkdir `0700` recursive, stage into the
destination directory at `0600`, `rename`, unlink the stage on any failure and
rethrow); `readEnvelope` returning a discriminated `ReadResult` rather than
throwing; `listEnvelopeIds`; `deleteEnvelope`.

**`apps/server/src/workspace.ts`**. Import switched from `extract` to
`extractWithDigest` (F4) and `EXTRACTOR_VERSION` added. `OpenRepo` gains
`rows`. The constructor gains a second, optional `opts: { stateDir?, log? }`;
`now` stays positional and first, so `api.test.ts:14` and `auth.test.ts:18`
compile unchanged. `DEFAULT_ROWS = 40` hoisted out of the single inline literal
at the old `:139`. `open()` destructures `{ graph, digest }` and calls the new
private `persist()` after inserting into the Map. New `forget(id)`, separate
from `close()`.

**`apps/server/src/app.ts`**. `AppOptions` gains `stateDir` and `log`. The
first parameter changed from `workspace: Workspace = new Workspace()` to
`provided?: Workspace`, with the Workspace built in the body — a default
parameter value is evaluated before `options` is in scope, so there is
otherwise no seam. `DELETE /api/repos/:id` calls `close` and `forget`
unconditionally and 404s only when neither found anything.

**`apps/server/src/index.ts`**. `loadStateDir()` wraps `defaultStateDir()` in
try/catch, logs, and returns `undefined`; its result is passed through
`AppOptions.stateDir`. Nothing new can throw before `listen`.

**`apps/server/test/store.test.ts`** (new, 21 tests). B5a, B12, B15, B18, B19,
B22, B23, B26, B28 plus the envelope round trip, the read-path refusals, and
five controls.

**`apps/server/test/api.test.ts`** (+1 test). B17 and its positive control.

**`packages/extract/test/digest.test.ts`**, **`packages/extract/src/files.ts`**.
The two D-Gb-0 carry-overs, nothing else.

## Gates

Baseline measured today at `18b8143`: `pnpm test` → **365 passed (365)**,
29 files, exit 0. New total **387** (+22: 21 in `store.test.ts`, 1 in
`api.test.ts`), 30 files.

| # | Result | What was run, and what came back |
|---|---|---|
| B1 | **PASS** | `pnpm typecheck` → exit 0, no diagnostics, all four projects. **Control, run:** changing `provided?: Workspace` to `provided: Workspace \| undefined` leaves `tsc -p tsconfig.json --noEmit` at **exit 0** and makes the four-project script fail at `apps/desktop/src/main.ts(29,35): error TS2554: Expected 1-2 arguments, but got 0`. The root project excludes `apps/desktop`; the phrasing is load-bearing and is now measured, not asserted. Reverted. |
| B2 | **PASS** | `PSQ_NO_CORPUS=1 pnpm test` → **329 passed \| 58 skipped (387)**, 0 failed, exit 0. **Skipped held at 58**, matching G-a. The private corpus config is intact. |
| B3 | **PASS** | `pnpm test` → **387 passed (387)**, 30 files, 0 failed, exit 0. |
| B5a | **PASS** | `store.test.ts` "B5a: stores a fingerprint equal to an independently computed digest". Opens `mini-efcore` with `seed: 99, rows: 7` through an unnormalized path; asserts the stored `fingerprint` matches `/^[0-9a-f]{64}$/` **and** equals `digestOf(resolve(MINI_EFCORE))` computed in the test, plus `path`, `id`, `seed`, `rows`, `extractor` and the entity count. **Mutant:** writing `fingerprint: ""` → 1 failed, B5a only. See "Plan corrections" for the raw-vs-resolved half. |
| B12 | **PASS** | `chmod 0500` on the state dir **before the first open**, so the store cannot even create `repos/`. `POST /api/repos` → **201**, and exactly one line arrives in the injected `log`, containing `psq store` and the repo id. **Control 1** (the mechanism): removing the `this.log(...)` call → 1 failed, B12 only. **Control 2** (paired test): a writable store logs **nothing**, so "the log is non-empty" is a statement about the failure and not about noise. |
| B15 | **PASS** | A hand-planted corrupt envelope (`{not json`) at `deadbeef0001.json`, never loaded into the Map. `DELETE /api/repos/deadbeef0001` → **200**, file gone. **Control 1:** making DELETE conditional on `close()` alone → 1 failed, B15 only. **Control 2** (paired test): an id that is neither open nor on disk still **404**s, so DELETE did not simply become an unconditional 200. |
| B17 | **PASS** | `api.test.ts` "writes nothing anywhere, and the assertion is not vacuous". `XDG_DATA_HOME` redirected to a fresh temp dir (**not** asserted against the real `~/.local/share/psq`, per the plan's note); `new Workspace(clock)` opens `mini-efcore` through `createApp`, 201, and `<tmp>/psq` does not exist. **Control** (same test): a Workspace given `stateDir: <tmp>/psq` opens the same fixture and `<tmp>/psq/repos` **does** exist. **Mutant:** `this.stateDir = opts.stateDir ?? defaultStateDir()` → 1 failed, B17 only. |
| B18 | **PASS** | Four tests. `XDG_DATA_HOME` set → `/data/psq`; unset **and** empty-string → `$HOME/.local/share/psq`; neither set → throws, message naming both `XDG_DATA_HOME` and `HOME`. **Control** (the F2 half): a fourth test mutates `process.env.XDG_DATA_HOME` twice between calls and gets two different answers, so a value captured at module load would redden it. |
| B19 | **PASS** | Asserted on the **first** write, per rev 3's correction: `repos/` is `0700` and the envelope is `0600` immediately after one `writeEnvelope`. **Mutant:** dropping `{ mode: 0o600 }` → **2 failed** (first write and rewrite), nothing else; measured mode was `0644` under umask 022. A second test pins `0600` across a rewrite as a cheap extra, not as the gate. |
| B20 | **PASS (clean)** | Patterns built from `test/corpus.local.json` (every repo path, every path segment ≥5 chars that is not a generic directory name, every `tableFloor` name ≥5 chars) and from `~/.config/psq/deploy.env` (every value ≥8 chars). Swept `git diff 18b8143 HEAD`: **3 hits, all false positives from 5-character English words** — `rejected…parsing` on an unchanged context line of `app.ts`, and the plan's own `audit-b1.md` / `audit-b2.md` file-list lines. No corpus path, no host, no token. **Controls, both live:** the same pattern file matches `~/.config/psq/deploy.env` and matches `test/corpus.local.json`, so the sweep is finding things and its silence on the diff means something. |
| B21 | **PASS** | `git diff --name-status 18b8143 HEAD` is exactly: `M apps/server/src/app.ts`, `M apps/server/src/index.ts`, `A apps/server/src/store.ts`, `M apps/server/src/workspace.ts`, `M apps/server/test/api.test.ts`, `A apps/server/test/store.test.ts`, `A feature-research/g-local-persistence/plan-b-rev3.md`, `M packages/extract/src/files.ts`, `M packages/extract/test/digest.test.ts` — the G-b1 files list, plus this audit in the record commit, minus `progress-b1.md` (James writes it after review) and minus `apps/desktop/src/main.ts` (F7's decision). |
| B22 | **PASS** | `createApp(undefined, { stateDir: tmp })`, POST `mini-efcore` → 201, `<tmp>/repos/<id>.json` exists and its `id` field parses back equal to the response id. **Mutant:** dropping `stateDir` from the Workspace `createApp` builds → **3 failed** (B22, B15, B12 — all three go through the seam). **Control** (paired test): `createApp(w, { stateDir })` with a caller-supplied Workspace writes **nothing**, so the option is forwarded to the default Workspace only. |
| B23 | **PASS** | `vi.mock("@psq/extract")` with delegating wrappers that count calls (the `digest.test.ts:16-25` technique). After one `open()`: `extractWithDigest` called **1**, `digestOf` called **0**. **Control:** the test then calls `digestOf` itself and asserts the counter reaches 1 — without it, `digestOf === 0` would be equally satisfied by a mock that intercepts nothing. **Mutant:** rewriting `open()` as `extract(path)` then `digestOf(path)` → 1 failed, B23 only, while B5a stays green. That is the whole reason this gate exists. |
| B26 | **PASS** | Three tests. (a) no `*.tmp` in `repos/` after two successful writes; (b) a **forced failure** — a directory planted where the envelope belongs, so staging succeeds and `rename` cannot — throws and leaves no `*.tmp`; (c) with `repos/` at `0500`, the thrown error is `EACCES` and its `path` is a `*.tmp` file whose **dirname is the repos directory**, which is what tells "staged in the destination" from "staged in `os.tmpdir()`". **Mutant:** staging in `os.tmpdir()` → 1 failed, (c) only. |
| **B28** | **PASS** | New, from review. `DELETE /api/repos/..%2F..%2Fpsq-victim-<pid>` against a store whose parent directory holds `psq-victim-<pid>.json`: the victim **survives**, the response is **404**, and the injected log carries `Not a repo id`. **Measured before the guard existed** (same request, same setup): **200 `{"closed": true}`** and the victim was gone. **Mutant:** deleting the four-line guard from `envelopePath` → 1 failed, B28 only. **Control** (paired test): `nosuchid00000` (not an id) and `0f0f0f0f0f0f` (a well-formed id naming nothing) both still 404, so B28 is not passing because DELETE stopped working. |
| B27 | **PASS** | `git diff 18b8143 HEAD -- packages/extract/test/digest.test.ts` is a single 3-line hunk at `@@ -17,9 +17,9 @@`, replacing **lines 20-22** with the `Parameters<typeof actual.digestOf>` wrapper. Nothing else. The two A6 rename tests are still at `:126` and `:135`, their assertions at `:132` and `:147`, verbatim; G-a's "path-awareness lives in exactly two assertions" holds. (The plan predicted lines 20-**23**; the change is 20-22. Cosmetic, recorded for honesty.) |

### Mutation summary

Each mutant was applied to the source, run against `apps/server/test`
(baseline **70 passed**), then reverted:

```
drop { mode: 0o600 }                 -> 2 failed | 68 passed   (B19, both halves)
stage the temp in os.tmpdir()        -> 1 failed | 69 passed   (B26c)
extract() then digestOf()            -> 1 failed | 69 passed   (B23)
swallow the store failure silently   -> 1 failed | 69 passed   (B12)
DELETE conditional on close() only   -> 1 failed | 69 passed   (B15)
write an empty fingerprint           -> 1 failed | 69 passed   (B5a)
createApp drops stateDir             -> 3 failed | 67 passed   (B22, B15, B12)
undefined stateDir falls back        -> 1 failed | 69 passed   (B17)
remove the envelopePath id guard     -> 1 failed | 70 passed   (B28, post-fix baseline 71)
```

## The cost of `open()` now that it computes a digest

Median of 5, warm, this machine. `open(+persist)` is the full
`extractWithDigest` + `materialize` + `buildBank` + envelope write.

| repo | `digestOf` | `extract` | `extractWithDigest` | `open(+persist)` |
|---|---|---|---|---|
| `mini-efcore` | 0.2ms | 0.8ms | 0.7ms | 2.3ms |
| `mini-node` | 0.1ms | 226.3ms | 207.3ms | 203.9ms |
| `mini-fullstack-react` | 0.2ms | 169.7ms | 154.0ms | 155.6ms |

The fixtures are too small for `digestOf` to be separable from noise — the
`extract` vs `extractWithDigest` columns differ by less than the run-to-run
spread, in the wrong direction on two of three rows. So the digest was measured
against a real tree instead: **`digestOf` over this repo (`domain-expert`, with
`SKIP` applied) is a median of 4.9ms** (min 4.5, max 7.7). Against the 1.3s
pipeline G-a measured, the extra walk+hash is well under 1%. F4's "a fraction
of the extraction beside it" holds.

## Decisions the plan left open

1. **`log` is typed `(line: unknown) => void`**, not `(line: string) => void`.
   F3 offered either, asking for a choice in the first commit. `unknown` lets
   G-b2 write `void rehydrate().catch(log)` literally, which is what D-Gb-4
   specifies; the string type would need a `.catch((e) => log(String(e)))`
   wrapper at the one call site that matters. Tests push `String(l)` into a
   collector, so assertions are on strings either way.
2. **`DEFAULT_ROWS = 40` is a module constant in `workspace.ts`**, not a new
   export from `@psq/quiz`. F10 says to resolve `rows` into a const beside
   `seed`; it does not say where the default lives, and `packages/quiz` is not
   in the files list. The literal `40` is preserved exactly.
3. **`readEnvelope` returns a discriminated result rather than throwing.**
   Every caller in D-Gb-4 classifies the failure into a health counter, so a
   throw would be immediately re-caught. It also keeps F5's shape: "this entry
   is bad" is an ordinary outcome, not an exception.
4. **`OpenRepo` gains `rows` but not `fingerprint`.** The plan lists only
   `rows`. The digest is a local in `open()` and reaches the envelope directly.
   G-b2 may want it on `OpenRepo` to decide whether to rewrite; that is a G-b2
   call, noted not pre-empted.
5. **`store.ts` imports `zod` without `apps/server/package.json` declaring it.**
   Resolution walks up to the root `node_modules`, exactly as
   `packages/schema/src/index.ts:1` already does with no zod dependency of its
   own. Typecheck and both test runs are clean. Adding the dependency would
   have meant editing a file outside the list.
6. The `open()`-reuse question (D-Gb-4 step 4) is untouched, as the plan
   directs — it belongs to G-b2.

## Plan corrections found

1. **B5a's control note is one-third wrong.** It says the gate "fails on a
   digest of the raw rather than resolved path". Measured: `digestOf` is
   invariant under normalization of its root — `digestOf("<p>/../<p>")` equals
   `digestOf(resolve("<p>"))`, because the walk produces the same relative
   paths and the same bytes either way. **No assertion about the fingerprint
   can distinguish raw from resolved.** The stored `path` and `id` can, and are
   asserted instead (`id` is `shortId(resolvedPath)`, and the envelope's
   filename is derived from it). The other two thirds — `""` and a missing
   field — are real and mutation-confirmed. A first attempt at this test used
   `join(p, "..", "mini-efcore")` as the "unnormalized" path; `join` collapses
   the `..` itself, so the test was not testing what its comment claimed. Both
   the code and the comment are corrected in the tree.
2. **B27's line range is 20-22, not 20-23.** Cosmetic.
3. **B26's temp-file-location half needed a mechanism the plan did not name.**
   "The temp file is created in the destination directory" is invisible from
   outside a successful write and invisible after a failed one, because the
   cleanup removes it. The observation used is an unwritable destination
   directory: the `EACCES` error's `path` is the staging path, and asserting
   its dirname is the repos directory pins the location. The EXDEV failure the
   rule exists to prevent is **not** reproducible on this machine — `/tmp` and
   `$HOME` are the same APFS volume — so a cross-device test would have been a
   gate that cannot fail here.

Everything else in the G-b1 section was measured as written, including the
`createApp` caller list, `now` staying positional, F5's `invariants` location
(not exercised in G-b1), and F6's comment resolution.

## Review round 1 — Send back, and what changed

### Blocking: `DELETE /api/repos/:id` was an arbitrary-file delete

Found by the reviewer, reproduced here before fixing. The id went from HTTP
into `unlinkSync` with no validation anywhere on the path:

```
app.ts   DELETE /api/repos/:id   String(req.params["id"])
workspace.ts  forget(id)         deleteEnvelope(this.stateDir, id)
store.ts      envelopePath()     join(reposDir(stateDir), `${id}.json`)   <- join eats ".."
store.ts      deleteEnvelope()   unlinkSync(...)
```

**Measured on the pre-fix tree**: `DELETE /api/repos/..%2F..%2Fpsq-victim-<pid>`
returned **200 `{"closed": true}`** and deleted `psq-victim-<pid>.json` two
directories above the state directory. Express 5 percent-decodes `req.params`,
so `%2F` arrives as a real separator; the target only has to end in `.json` and
be writable by the server user. Reachable with no token, because `config.ts:80`
only *requires* a token off-loopback — `pnpm dev:server` on `127.0.0.1:8092`
runs with `stateDir` set and no gate.

This is a **regression introduced by G-b1**: before this phase DELETE only
mutated an in-memory Map. The Electron shell escaped by accident only, because
`createApp()` passes no `stateDir` and `forget()` returns `false` before
touching disk — F7's "desktop is unpersisted" decision doing security work
nobody designed it to do, which is not a property to rely on.

**Fix**: a `/^[0-9a-f]{12}$/` check — exactly what `shortId` produces — in
`store.ts` at `envelopePath`, which is the chokepoint every path-building
caller goes through, rather than at the route. `writeEnvelope` was also routed
through `envelopePath` instead of building its own destination, so the write
path is behind the same guard. A non-id makes `envelopePath` throw;
`Workspace.forget` already catches, logs and returns `false`, so a hostile
DELETE takes the ordinary 404 path and the refusal is visible in the log.
`readEnvelope` calls `envelopePath` inside its own try, so an invalid id there
is an ordinary `ok: false`.

Gated by **B28** above, with the pre-fix measurement as its "can fail" evidence
and a guard-removal mutant as the repeatable one. Both existing DELETE gates
were confirmed green under the guard rather than assumed: B15's `deadbeef0001`
is twelve hex and is accepted, and the 404 control's `nosuchid00000` is
rejected and 404s exactly as before.

Two consequences worth naming. The synthetic ids in `store.test.ts`'s
read-path test (`garbage`, `version`, `badgraph`, `absent`) and one
`tempPathFor` argument were not store ids and had to become hex; which case is
which now lives in the assertions rather than in the filenames. And the two
tests that now exercise the refusal inject a `log` collector, so the suite does
not print to stderr — the guard itself stayed a single check in `store.ts`, so
the B28 mutant still reddens.

### Three record corrections

1. **`workspace.ts`'s `DEFAULT_ROWS` comment claimed a de-duplication it did
   not perform.** It said the hoist was because "a default that lives in two
   places is a default the two shells can disagree about". After the hoist,
   `40` lives in **four** places: `packages/quiz/src/sql/seed.ts:233`,
   `workspace.ts` itself, `apps/cli/src/index.ts:95`, and that file's help text
   at `:212` — all four confirmed by grep. The hoist is fine; it just needed a
   name for `open()` to resolve from. The comment now says what the real
   D-Gb-3 protection is: `open()` resolves `rows` once and **stores** the
   resolved value, gated by B5a. Given this phase's whole thesis is unmeasured
   because-clauses, leaving that one standing would have been the joke telling
   itself.
2. **B27's rename-assertion citations were wrong** in this audit's first
   version (`:126` and `:141`). The two A6 rename `it(`s are at `:126` and
   `:135`; their assertions are at `:132` and `:147`. Corrected above.
3. **`files.ts:92` was left short and ragged** by the `node_modules` deletion.
   Reflowed 92-93; content unchanged, and the eleven entries still match the
   word "eleven".

### Not fixed, by review agreement

The undeclared `zod` import in `store.ts` stands. The reviewer checked the
precedent and it is safer than this audit first argued: `packages/schema` has
no dependencies block at all, the root declares `zod` as a runtime dependency,
and `app.ts` already pulled zod into the desktop bundle through a value import
before this phase. Recorded as hygiene for a later pass, not a fix.

### One transient, not reproduced

During the fix cycle, a single full `apps/server/test` run showed
`graph endpoints > 404s for a repo that is not open` (`api.test.ts:119`)
failing. That test is six `GET`s against an unopened repo id and touches no
store code. It has not reproduced in eight subsequent runs (five of
`api.test.ts` alone, three of the whole server suite) or in any full
`pnpm test`. Recorded rather than buried; if it reappears it is not new to
G-b1, but somebody should catch it in the act.

## What the reviewer and G-b2 need to know

- **A mutation run wrote into the live store, and I cleaned it up.** The
  "undefined stateDir falls back to the default" mutant (the B17 control) made
  every Workspace in `apps/server/test` use the real resolver, and
  `~/.local/share/psq/repos/` was created at 13:29 with three envelopes —
  `mini-node`, `mini-fullstack-react`, `mini-efcore`, all committed fixtures,
  no corpus path. Verified by reading each envelope's `path`, then
  `rm -rf ~/.local/share/psq`. The directory is absent again, as B17's comment
  claims. **This is the D-Gb-7 failure mode happening for real**, and the same
  mutant run with corpus tests in scope would have deposited private repo paths
  and entity names there. Any future mutation of that line should be run with
  `XDG_DATA_HOME` pointed at a temp directory.
- **B17's comment will go stale.** It says `~/.local/share/psq` "does not exist
  on this machine today". That stops being true the first time James runs the
  real server, which is precisely why the gate redirects `XDG_DATA_HOME`
  instead of asserting on the real path. Do not "improve" it into an assertion
  about the real directory.
- **B23 is the only gate that sees ordering, and it sees it through one seam.**
  It counts calls to the `@psq/extract` bindings `workspace.ts` imports. An
  `open()` that reached past the package into `packages/extract/src/files.js`
  would evade it. That is not a shape this monorepo uses anywhere, but the
  limit is real and the gate should not be weakened further.
- **`store.test.ts` mocks `@psq/extract` file-wide**, the same hazard G-a
  recorded for `digest.test.ts`. The wrappers use
  `Parameters<typeof actual.…>`, so a widened signature will not be silently
  dropped — but the mock is still file-wide, and any new test in that file runs
  through it.
- **`readEnvelope`, `listEnvelopeIds` and `deleteEnvelope`'s non-ENOENT branch
  are written but barely exercised.** `readEnvelope` has a round-trip test and
  four refusal cases; `listEnvelopeIds` has one. G-b2's B10 is what really
  exercises them, and B10's sixth case (a graph that parses but fails
  `invariants()`) has no counterpart here — `readEnvelope` deliberately does
  **not** run `invariants()`, because F5 makes that a caller's classification
  step, not a parse step.
- **`EXTRACTOR_VERSION` is now written into every envelope but still nothing
  reads it.** B9 in G-b2 is what makes it observable.
- **Health is unchanged.** `api.test.ts:239,241`'s `toEqual({ ok: true, repos: N })`
  still hold exactly; G-b2 must extend them rather than relaxing to
  `toMatchObject`.
- **F9's two false comments in `index.ts` are still there**, untouched, as the
  plan directs — they belong to G-b2's `index.ts` commit. A reader of
  `index.ts` today will find "Pass 0 to take any free port" and "Electron reads
  this line", and both are false.
- **`store.test.ts`'s B12 asserts `lines.length === 1` exactly.** That is
  deliberate today — it pins "one failure, one line" — but G-b2 adds a second
  in-process log source (`void rehydrate().catch(log)`), and any test that runs
  both paths through one collector will need the assertion reconsidered rather
  than relaxed by reflex.
- **A failed `persist()` on a RE-open leaves a stale envelope on disk.**
  `open()` deletes the existing Map entry (`workspace.ts:139-141`), re-inserts
  (`:184`) and persists (`:185`). If that persist fails — D-Gb-6 says log and
  swallow — the **previous** envelope survives with the old seed, rows and
  fingerprint, and G-b2's rehydrate would resurrect the superseded repo after a
  restart. Not a G-b1 bug: nothing reads the store yet. It becomes one the
  moment rehydrate lands, and G-b2 should decide deliberately between
  "unlink before re-extract" and "accept the stale entry because the
  fingerprint comparison will re-extract it anyway".
- No temp directories were left behind: `/tmp/psq-store-*` and `/tmp/psq-xdg-*`
  are empty sets after the full run. The worktree is clean and nothing was
  pushed.
