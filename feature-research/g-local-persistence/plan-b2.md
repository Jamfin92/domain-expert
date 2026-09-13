# Phase G-b2 — the store, read side (rehydrate) — PLAN (rev 2)

Written against the **shipped** tree at `43d16da`, not against `plan-b-rev3.md`.
Rev 3 predates `store.ts`; every store API reference below was re-verified by
reading the shipped file.

**Rev 1 of this plan was sent back by review.** Its §0 claimed to correct six
inherited errors; **two of those "corrections" were themselves false**, and one
of them was about to be written into a source comment. Both are now measured and
recorded in §0 as the plan's own errors, not quietly deleted. Rev 1 also shipped
three unsound gates (B25, B29, B10). The history of this phase line is that
*conclusions get challenged and because-clauses ride along unexamined* — rev 1
stated that lesson in its own §0 and then repeated it. Treat every claim below
as measured or marked unverified; there is no third category.

Design authority: `plan.md` D-Gb-4, D-Gb-6, D-Gb-8, as corrected by rev 3's F5,
F11, F12, F13, and as further corrected here.

---

## §0. The inherited record, measured

### 0A. Claims rev 1 of this plan got WRONG

**0A.1 — `readEnvelope` does NOT throw for a non-store id. Rev 1 said it did.**
Rev 1 called this its headline "changes the design" correction. It is false.
`envelopePath` is called at `store.ts:151`, which is **inside** the `try` opened
at `:150`; the `Not a repo id` throw is caught at `:152` and returned normally.
Measured:

```
readEnvelope(dir, "notes") -> { ok: false, reason: "Not a repo id: \"notes\"" }
```

The G-b1 handoff's original claim — junk "gets listed, fails `readEnvelope`
safely, and then becomes a permanent `failed` entry" — was **correct**.
Consequences: `.filter(isStoreId)` is a cosmetic fix (junk should be invisible,
not a permanent alarming counter), **not** a crash guard; one junk file cannot
abort the loop. **No source comment may state otherwise.**

**0A.2 — `api.test.ts` has three `createApp` sites, not one. Rev 1 said one.**
Measured: `grep -n createApp apps/server/test/api.test.ts` → `:16`, `:433`,
`:441` (plus the import at `:8`). None passes a token. The handoff was right
both about the count and about its conclusion on the flaky 401.

Both false claims came from confident scout reports that were not measured.

### 0B. Inherited claims that ARE wrong (verified)

**0B.1 — D-Gb-4 step 4 is not implementable as written.** *(changes the design)*
Step 1 marks bad JSON / wrong `version` / failed `EntityGraph.parse` as *stale*;
step 4 says stale entries are *re-extracted*. Re-extraction needs `path`, but
`readEnvelope` validates the whole envelope with `StoredRepo.safeParse`
(`store.ts:162`) and returns only `{ok:false, reason}` — **the payload,
including `path`, is discarded.** Measured. See D-Gb2-2.

**0B.2 — F11's four throw-path line numbers have rotted.** F11 cites `:98`,
`:99`, `:111`, `:131`. Shipped: exists / is-a-directory throws at
`workspace.ts:141-142`; invariants / no-entities throws inside `:152-179`.
F11's *reasoning* survives — the vanished-repo throw is one of the four and must
book as `missing`, not `failed`.

**0B.3 — Four more handoff line numbers have drifted.** Re-open delete-block is
`workspace.ts:145-149` (handoff: `139-141`); Map insert `:189` (handoff: `184`);
persist call `:190` (handoff: `185`); the `lines.length === 1` assertion is
`store.test.ts:322` (handoff: `319`).

**0B.4 — The health assertions are at `api.test.ts:241` and `:243`.** Rev 3
cites `:239`/`:241`; `:239` is the `describe` header and `:240` the `it`. Both
are `toEqual({ok:true, repos:N})` exact matches and both break.

### 0C. Inherited claims CONFIRMED

- `listEnvelopeIds` (`store.ts:169-180`) filters `.json` and a leading dot only;
  no `isStoreId`.
- `writeEnvelope` calls `mkdirSync` (`:121`) before `envelopePath` (`:122`).
- `digestOf` on a vanished root returns the empty-input sha256
  (`e3b0c44298fc…`) without throwing — `walk` swallows the `readdirSync` failure
  and yields `[]`. Measured. This is what makes D-Gb-4 step 4's ordering
  load-bearing.
- HEAD is `43d16da`, `master` is **14** ahead of `origin/master` (handoff says
  `d603f8b`/13 — it predates its own commit). `git cherry` shows all 14 as `+`.
  Tree clean.

---

## §1. Design decisions

**D-Gb2-1. `rehydrate` state gains a fourth value, `"off"`, set in the
constructor.** *A deviation from D-Gb-8's `"pending"|"running"|"done"`.*

The status field is initialised from `stateDir`: **`undefined` → `"off"`,
otherwise `"pending"`.** Doing this in the constructor rather than inside
`rehydrate()` is what makes the shape honest — under D-Gb2-3 `rehydrate()` is
never called from `createApp()`, so a state initialised to `"pending"`
unconditionally would leave the desktop shell and `e2e/harness.ts` reporting
`rehydrate: pending` **forever**, which is a worse shape than the one this
decision exists to improve.

**What `"off"` buys:** at the health endpoint it separates *persistence is off*
from *persistence is on and rehydrate finished with an empty store*. For a
LaunchAgent observable only over HTTP, that is a real operational distinction.

**What it does NOT buy — correcting rev 1:** it is **not** a positive control
for B25. The mutant B25 exists to kill is the handoff's own: *"a `loadStateDir`
returning `undefined` unconditionally would be invisible to all 387 tests."*
Under that mutant `stateDir` is `undefined`, so the state is `"off"` and a
B25 that asserts `"off"` **passes green**. Rev 1 overrode a signed-off design
decision to buy a control that does not discriminate. B25's real control is in
D-Gb2-7.

**Flagged for James:** this is the one place the plan overrides a signed-off
design decision, and it is now justified only by health-endpoint legibility, not
by any gate. Say the word and it reverts to three states with `"pending"`
initialised only when `stateDir` is set.

**D-Gb2-2. An envelope that fails `StoredRepo.safeParse` is `failed`, not
re-extracted. The file is kept.** Forced by 0B.1. The split:

| B10 case | `readEnvelope` | `path` recoverable? | Outcome |
|---|---|---|---|
| garbage JSON | `{ok:false}` | no | `failed`, file kept |
| `version: 99` | `{ok:false}` | no | `failed`, file kept |
| `graph` fails `EntityGraph.parse` | `{ok:false}` | no | `failed`, file kept |
| stale `extractor` | `{ok:true}` | yes | **re-extract** → `loaded` |
| `graph` fails `invariants()` | `{ok:true}` | yes | **re-extract** → `loaded` |
| `path` no longer a directory | `{ok:true}` | yes | `missing`, file kept |

This works because `StoredRepo` types `extractor` as `z.number().int()`
(`store.ts:26`) rather than pinning it to `EXTRACTOR_VERSION`, so a stale
extractor parses cleanly and the staleness check runs in `workspace.ts` with the
whole envelope in hand. Same for `invariants()`, which runs on a parsed graph.
**B9 and B10's sixth case therefore still measure a real re-extract.**

*Rejected:* widening `ReadResult` to carry a best-effort `path` recovered from
raw JSON — it feeds a string out of a file that just failed validation into
`extract()`, one phase after G-b1's finding was an unvalidated path reaching the
filesystem. The three unrepairable cases are repaired by the user re-opening the
repo; a `version: 99` envelope was written by a *newer* psq and must not be
silently downgraded.

**D-Gb2-3. `rehydrate()` is called from `index.ts` only — never from
`createApp()`.** Preserves D-Gb-7 and F7 exactly: the desktop shell
(`main.ts:29`), `e2e/harness.ts`, and every test that does not ask for it never
read the store. One call site, minimal blast radius.

**D-Gb2-4. `rehydrate()` sets `state = "running"` synchronously, before its
first `await`.** This makes **B16** deterministic instead of a polling race:
the test calls `void w.rehydrate()`, reads `w.rehydrateStatus()` on the next
synchronous line and sees `"running"`, then awaits and sees `"done"`.
**B16 is only sound with a non-empty store** — the `await setImmediate` lives
inside the per-entry loop, so with zero entries the async body runs to
completion synchronously and the next line reads `"done"`. B16 seeds **two**
envelopes.

**D-Gb2-5. `persist()` deletes the superseded envelope when its write fails.**
Resolves the handoff's "a bug the moment G-b2 lands": if a re-open's persist
fails, the **previous** envelope survives with the old `seed`/`rows`, and
rehydrate resurrects a configuration the user already replaced.

The fix goes in `persist()`'s `catch` (`workspace.ts:212`), **not** as a delete
before re-extraction. Rev 1 proposed delete-first; that trades a narrow bug for a
wider one — any re-open whose extraction then fails (invariants, zero entities,
vanished path) would destroy a working cache entry, and `:146-149` has already
dropped the in-memory repo, so the user loses both.

**Stated limitation, because it is real:** this does **not** cover a
directory-permission failure. At `0500` the staging write and the `unlink` both
fail EACCES (G-b1 measured exactly this), so the superseded envelope survives.
No permission state separates the two operations. The invariant is therefore
"current or absent **when the write fails for a reason that does not also block
unlink**" — e.g. ENOSPC. Documented, gated for the reachable case (B29), not
claimed more broadly.

**D-Gb2-6. `closeAll()` stops an in-flight rehydrate.** `index.ts:79-86` runs
`workspace.closeAll()` on SIGTERM; a rehydrate still yielding would keep
materializing repos into a just-cleared Map, leaking `SeededDb` handles past
shutdown. A `stopping` flag checked at each yield, three lines.

**D-Gb2-7. B25's control is the stderr line, not the health state.** F13's
try/catch at `index.ts:41-45` logs `persistence off: Cannot resolve the psq
state directory: …` when the resolver throws. That line proves the catch **ran**
— which `"off"` alone does not (D-Gb2-1). Measured: spawning `index.ts` with
`HOME` and `XDG_DATA_HOME` both deleted produces the listening line on stdout
and that exact message on stderr. B25 asserts **both**.

**D-Gb2-8. The filename id, the envelope's `id`, and `shortId(resolve(path))`
must all agree, or the entry is `failed`.** `rehydrate` keys the Map by the
filename id from `listEnvelopeIds`, but the re-extract branch calls
`this.open(env.path, …)`, which keys by `shortId(resolve(path))`
(`workspace.ts:144`). Nothing currently forces them to match. Two failures if
unchecked: a hand-edited envelope produces a Map entry whose `repo.id` differs
from its key, so `DELETE /api/repos/<reported id>` cannot remove it; and — worse
— **B10 silently collapses** (see §4).

---

## §2. Implementation

### 2.1 `apps/server/src/store.ts` — two small fixes, first commit

1. **`listEnvelopeIds` (`:169-180`)**: add `.filter(isStoreId)`. Junk should be
   invisible rather than a permanent `failed` counter that D-Gb-4 never cleans
   up. **The comment must not claim this prevents a crash** — `readEnvelope`
   returns `{ok:false}` for a bad id (0A.1).
2. **`writeEnvelope` (`:119-132`)**: move `envelopePath(stateDir, envelope.id)`
   **above** `mkdirSync`, so a hostile id cannot create `<stateDir>/repos`
   before being refused. No reachable bug today — write-side ids are always
   `shortId` — but the guard should read as first because it is.

### 2.2 `apps/server/src/workspace.ts` — the read side

```ts
export type RehydrateState = "off" | "pending" | "running" | "done";
export interface RehydrateStatus {
  state: RehydrateState;
  loaded: number;
  failed: number;
  missing: number;
}
```

Private field initialised **in the constructor** to
`{ state: this.stateDir === undefined ? "off" : "pending", loaded: 0, failed: 0,
missing: 0 }` (D-Gb2-1), plus `rehydrateStatus(): RehydrateStatus` returning a
**copy** — a live reference would let a caller mutate counters through the
health route.

`async rehydrate(): Promise<void>`:

- `stateDir === undefined` → leave `state` at `"off"`, return. Do not touch disk.
- Set `state = "running"` **synchronously** (D-Gb2-4); `stopping = false`.
- `const ids = listEnvelopeIds(this.stateDir)` — sorted, filtered after 2.1.
- Per id: `await new Promise(r => setImmediate(r))` **first**, then
  `if (this.stopping) break;`.
- Then, **in this order — the order is the contract**:
  1. `readEnvelope`. `!ok` → `failed++`, log id + reason, keep file, next.
  2. `env.id !== id` **or** `shortId(resolve(env.path)) !== id` → `failed++`,
     log, keep file, next (D-Gb2-8). `shortId` is module-private at
     `workspace.ts:77-78` and available here.
  3. `env.extractor !== EXTRACTOR_VERSION` → mark for re-extract.
  4. `invariants(env.graph).length > 0` → mark for re-extract. **A length check,
     never a try/catch** — `invariants` (`packages/graph/src/index.ts:27`)
     returns `string[]` and cannot throw on a *parsed* graph, because
     `keys`/`properties`/`indexes` are required `z.array` at
     `packages/schema/src/index.ts:102-104`, so no loop can hit `undefined`.
     (Rev 1 justified this with "no non-null assertions, every `Map.get`
     guarded" — true but not the guarantee.) A try/catch here is a gate that
     passes by finding nothing (F5).
  5. **`existsSync(env.path) && statSync(env.path).isDirectory()`** → false →
     `missing++`, log, keep file, next. **Strictly before any `digestOf` call**
     — `digestOf` returns the empty-input sha256 for a vanished root rather than
     throwing (0C), so comparing first reads a deleted repo as "a repo that
     changed" and fires a doomed re-extract. **B24 is the control.**
  6. `this.repos.has(id)` → skip silently, uncounted. A `POST` beat us.
  7. Not already marked → `digestOf(env.path) !== env.fingerprint` → mark for
     re-extract.
  8. **Re-extract branch**: `this.open(env.path, {seed: env.seed, rows:
     env.rows})` — re-extracts, rebuilds, inserts, and rewrites the envelope in
     one call. `loaded++`.
  9. **Stored-graph branch**: apply the **same zero-entities refusal `open()`
     makes at `:159-179`** — a graph with no entities must be `failed`, not
     materialized into a 0-question repo. (`store.test.ts`'s `envelope()` helper
     produces exactly that shape, so the fixture is one copy-paste away.) Then
     `materialize(env.graph, {seed: env.seed, rows: env.rows})` →
     `buildBank(env.graph, seeded, env.seed)` → `OpenRepo` with the **stored**
     `openedAt` → `this.repos.set(id, repo)` → `loaded++`. **Do not re-persist**
     — nothing changed.
- Wrap **every** entry in try/catch regardless of branch (F11). In the catch:
  re-test `existsSync(path) && isDirectory(path)` — now false → `missing++`
  (the TOCTOU window between steps 5 and 8); otherwise `failed++`. Log the entry
  id with the error. **Close any `SeededDb` the entry opened before throwing**
  (`materialize` succeeding then `buildBank` throwing leaks a handle). Never
  rethrow — one bad entry must not stop the rest.
- Finally `state = "done"`, including on an early `break`.

Signatures, verified: `materialize(g, opts)` with `rows` **inside** the opts
object (`packages/quiz/src/sql/seed.ts:230`, `SeedOptions {seed?, rows?, path?}`);
`buildBank(g, seeded, seed?, sections?)` with `seed` a bare third positional
(`packages/quiz/src/bank.ts:21`). Both synchronous. Easy to get wrong — B6 catches it.

Also in this file:
- `persist()` catch (`:212`): delete the superseded envelope (D-Gb2-5), guarded
  so a delete failure only logs.
- `closeAll()`: set `this.stopping = true` (D-Gb2-6).

### 2.3 `apps/server/src/app.ts` — health

`GET /api/health` (`:119-121`) becomes
`{ ok: true, repos: workspace.list().length, rehydrate: workspace.rehydrateStatus() }`.
No other route changes. `DELETE /api/repos/:id` (`:140-154`) already calls
`close` **and** `forget` unconditionally with the store-orphan comment — correct
as shipped, do not touch.

### 2.4 `apps/server/src/index.ts` — the call site

Inside the `server.listen(port, host, …)` callback (`listen` is at `index.ts:67`;
`:66` is `createServer`), **after** the listening line is printed:

```ts
void workspace.rehydrate().catch((err) => console.error(`psq rehydrate: ${err}`));
```

Bind first, print first, then rehydrate (D-Gb-4: `KeepAlive` +
`ThrottleInterval 30` turns a pre-bind throw into a silent 30-second restart
loop). `loadStateDir()` (`:38-47`) already has F13's try/catch and needs no
change — but **B25 is the first test that ever executes it**. F9's "two false
comments" cite `index.ts:47`, which has itself rotted (now `}`); **locate the
comments by content, and if they are already gone, say so in the audit rather
than inventing an edit.**

### 2.5 Tests

**`apps/server/test/rehydrate.test.ts`** — new. Follows `store.test.ts`'s idiom:
`mkdtempSync` per test via a `stateDir()` helper, `made[]` + `afterEach` cleanup
with the `chmodSync` restore, `MINI_EFCORE` from `../../../test/fixtures.js`,
`new Workspace(() => "<fixed ISO>", { stateDir: dir })`. Gates B5b, B6, B7, B8,
B9, B10, B11, B16, B24, B29.

- **B10 needs three distinct fixture directories** for its three loadable cases
  (stale `extractor`, failing `invariants()`, the good entry). If they all point
  at `MINI_EFCORE` they share one `shortId`, collapse into **one** Map entry
  while `loaded++` fires three times, and the gate passes over a broken outcome.
  Copy the fixture to three temp dirs.
- **B24** needs the call-counter mock — `store.test.ts:29-42` already has the
  `vi.hoisted` + `vi.mock("@psq/extract")` wrapper for `digestOf`; copy that
  idiom and assert the count is **0** for the missing entry.
- **B29** cannot be built with permissions (D-Gb2-5's limitation): at `0500`
  both the write and the unlink fail. Build it by mocking `../src/store.js`
  (partial, via `importOriginal`) so `writeEnvelope` throws while
  `deleteEnvelope` works. The `vi.mock` idiom is already in `store.test.ts`.
- **B8** must mutate a source file so the graph changes *observably* — add a
  column to a `CREATE TABLE`, assert the new fact appears, not merely that the
  digest differs. Mutate a **copy** under the temp dir; never `MINI_EFCORE`
  in place.

**`apps/server/test/boot.test.ts`** — new, and the expensive part. **No test in
`apps/server/test/` spawns a child process today** — all four existing files use
supertest in-process. This file invents the idiom. Gates B4, B13, B14, B25.

The idiom is **verified working**, not proposed: Node v24.19.0, tsx 4.23.12,
and `spawn(process.execPath, ["--import", "tsx", indexPath], { env, cwd })`
booted twice in review, answered `/api/health` with `{"ok":true,"repos":0}`, and
exited 0 on SIGTERM.

- **`cwd` must be `apps/server/`** so `--import tsx` resolves. Do not shell out;
  `node`/`pnpm` are not on the default PATH on this machine, so use
  `process.execPath`.
- **Port**: `PSQ_PORT=0` is rejected by `config.ts:59` and *deliberately pinned*
  as rejected by `config.test.ts:66-67` — this is what made rev 2's B4
  unrunnable. The test picks the port: `net.createServer().listen(0, "127.0.0.1")`
  → read `address().port` → `close()` → pass as `PSQ_PORT`. Bind the probe to
  `127.0.0.1` explicitly. One helper, one place; note the inherent small race.
- **Readiness**: match the listening line on stdout **and** poll
  `GET /api/health` until it answers, with a timeout.
- **Env**: `XDG_DATA_HOME=<tmp>` (F2) for B4/B13/B14. For **B25**, delete
  **both `HOME` and `XDG_DATA_HOME`** from the child env — keep this shape, not
  the softer unwritable-path variant.
- **Lifecycle**: SIGTERM, await exit, restart on the same `XDG_DATA_HOME`.
- Explicit per-test timeouts (two boots plus a real extract each; 60s is not
  excessive) and always kill the child in `afterEach`, including on failure.

**`apps/server/test/store.test.ts`** — three edits:
- The four refusal fixtures at `:148-165` assert `toMatchObject({ok:false})` and
  nothing else, so three of the four could vanish without reddening anything.
  Add a distinct `reason` assertion to each. **All four regexes are verified to
  match** against the real strings:
  `not JSON: Expected property name or '}' in JSON at position 1 …` → `/not JSON/`;
  `version: Invalid literal value, expected 1` → `/version/`;
  `graph.repo: Required; graph.provider: Required; …` → `/graph/`;
  `ENOENT: no such file or directory, open '…/repos/0d0d0d0d0d0d.json'` →
  `/ENOENT|no such file/`. All four are mutually distinct. **B10 depends on
  this**: without it B10 can pass while testing one case four times.
- **B30**: `notes.json`, `.hidden.json` and one valid envelope in the same
  `repos/`. `listEnvelopeIds` returns exactly the valid id — and assert the valid
  one **is** returned, as the positive control that the filter did not break
  listing outright.
- **B31**: a hostile id to `writeEnvelope` throws **and** leaves
  `<stateDir>/repos` non-existent.

**`apps/server/test/api.test.ts`** — extend the two exact matches at `:241` and
`:243` to include `rehydrate`. Keep `toEqual`; **do not relax to
`toMatchObject`** — the exact match is the only thing standing between this
endpoint and silent shape drift. The Workspace at `:16` has no `stateDir`, so
under D-Gb2-1 the expected value is
`{ state: "off", loaded: 0, failed: 0, missing: 0 }`. **Check `:433`/`:441`
too** — they are the other two `createApp` sites (0A.2) and may assert on health.

### 2.6 Not touched, on purpose

- **`apps/web/src/lib/api.ts:236`** — health is `call<{ok: boolean; repos:
  number}>`, a compile-time cast with no runtime validation (verified: no zod
  parse around it), so the extra field is ignored at runtime. A decision.
- **`apps/desktop/src/main.ts`** — stays unpersisted (F7, James). D-Gb2-3 means
  it never reaches the read side; D-Gb2-1 means it reports `"off"`, not a
  permanent `"pending"`.
- **`e2e/`** — no `/api/health` assertion exists anywhere in it. Do **not** run
  `pnpm test:e2e`; it runs `build:web`, which empties the `apps/web/dist` the
  live server serves from.
- **`apps/server/package.json`** — still does not declare `zod` (no
  `devDependencies` block at all); `store.ts:4` resolves through root hoisting.
  G-b1 examined and accepted this. Unchanged here so the phase does not smuggle
  in a packaging change; still owed as repo hygiene.

---

## §3. Files touched

| # | File | Change |
|---|---|---|
| 1 | `apps/server/src/store.ts` | `.filter(isStoreId)` in `listEnvelopeIds`; validate before `mkdirSync` in `writeEnvelope` |
| 2 | `apps/server/src/workspace.ts` | `RehydrateState`/`RehydrateStatus`, `rehydrateStatus()`, `async rehydrate()`; `persist()` catch deletes superseded envelope; `closeAll()` sets `stopping` |
| 3 | `apps/server/src/app.ts` | `GET /api/health` reports `rehydrate` |
| 4 | `apps/server/src/index.ts` | `void workspace.rehydrate().catch(…)` inside the `listen` callback; F9 comment fixes **if the comments still exist** |
| 5 | `apps/server/test/rehydrate.test.ts` | **new** — B5b, B6–B11, B16, B24, B29 |
| 6 | `apps/server/test/boot.test.ts` | **new** — B4, B13, B14, B25; invents the child-process idiom |
| 7 | `apps/server/test/store.test.ts` | four `reason` assertions; B30, B31 |
| 8 | `apps/server/test/api.test.ts` | health shape at `:241`, `:243`; check `:433`/`:441` |
| 9 | `feature-research/g-local-persistence/audit-b2.md` | **new** |
| 10 | `feature-research/g-local-persistence/progress-b2.md` | **new** |

---

## §4. Gates

**Re-run from G-b1, must stay green:** B1, B2, B3, B5a, B12, B15, B17, B18,
B19, B20, B21, B22, B23, B26, B28.

| Gate | Asserts |
|---|---|
| B4 | Boot round trip: spawn `index.ts` on a test-chosen free port with `XDG_DATA_HOME=<tmp>`, wait for the listening line, POST a fixture, SIGTERM, restart, `GET /api/repos` returns the repo |
| B5b | The stored fingerprint still equals `digestOf(path)` at rehydrate on an unchanged repo |
| B6 | Fidelity: open with a non-default seed **and** non-default rows, capture the full ordered list of question ids, rehydrate in a new Workspace, ids identical |
| B7 | A rehydrated repo grades a correct answer right **and a wrong answer wrong** |
| B8 | Stale detection: mutate a source file so the graph changes observably, rehydrate, the new fact appears and the envelope was rewritten |
| B9 | A stale `extractor` forces re-extract |
| B10 | Corrupt store: garbage JSON, `version: 99`, stale `extractor`, vanished `path`, a graph failing `EntityGraph.parse`, and a graph that parses but fails `invariants()` — **each loadable case in its own fixture dir** — alongside one good entry that still loads |
| B11 | After B10 the corrupt and missing entries still exist on disk |
| B13 | SIGTERM the real child from B4, restart, the repo comes back |
| B14 | DELETE, restart, the repo does **not** come back |
| B16 | With **two** envelopes: `void rehydrate()` then a synchronous `rehydrateStatus()` reads `"running"`; after the await, `"done"` |
| B24 | A vanished `path` increments `missing`, not `failed`, **and `digestOf` was never called for it** |
| B25 | Spawn with `HOME` **and** `XDG_DATA_HOME` both absent: the server reaches the listening line, answers `/api/health`, **and logs `persistence off: Cannot resolve the psq state directory…` on stderr** (D-Gb2-7 — the stderr line is the control, `"off"` is not) |
| B29 | With `writeEnvelope` mocked to throw and `deleteEnvelope` live, a failed re-open persist leaves **no** envelope, never the superseded one |
| B30 | `notes.json` and `.hidden.json` in `repos/` are invisible to `listEnvelopeIds`, **and** a valid id in the same directory is still returned |
| B31 | A hostile id to `writeEnvelope` throws and leaves `<stateDir>/repos` non-existent |

**Mutants to run** (a gate nobody can fail is not a gate):
- Move the step-5 directory check *after* the digest comparison → **B24 reddens**, and only B24.
- Replace step 4's length check with a try/catch around `invariants` → **B10's sixth case reddens**.
- Set `state = "running"` after the first yield → **B16 reddens**.
- Remove `.filter(isStoreId)` → **B30 reddens**.
- Make `loadStateDir()` return `undefined` unconditionally → **B25 reddens**
  (this is the handoff's named mutant, and the whole reason B25 asserts stderr).
- Point B10's three loadable fixtures at one directory → **B10 reddens**.
- Delete the `version: 99`, garbage-JSON, or bad-graph fixture → the matching
  `reason` assertion reddens. (Not applicable to the ENOENT case: it has no
  fixture — its absence *is* the case. Rev 1's mutant list said otherwise.)

**Baseline:** `pnpm test` is currently **387 passed (387)**, 30 files;
`PSQ_NO_CORPUS=1 pnpm test` is **329 passed | 58 skipped**. **Confirm both
before the first edit** — they are inherited numbers and were not re-measured
for this plan. **Skipped must stay at 58** at every step; a drop means the
private corpus config vanished, not that something improved. `pnpm typecheck`
must exit 0 across all four projects.

**Also measure and record:** rehydrate cost per repo, stored-graph path versus
re-extract path (rev 2's Risks asked for it and assumed, without measuring, that
it is well under the 1.3s pipeline).

---

## §5. Risks

- **`boot.test.ts` is the schedule risk.** Four gates, a brand-new idiom, two
  boots and a real extract per test. The spawn invocation itself is verified, so
  the risk is now lifecycle flake (zombie children, timeout tuning), not
  feasibility. If it fights the toolchain, stop and report — B4/B13/B14/B25 can
  ship as a follow-on with the in-process gates landing first.
- **Each entry is fully synchronous.** `extract`, `materialize` and `buildBank`
  never yield, so the server is unresponsive for the whole of each entry and
  `"running"` is observable only *between* entries. Size B4/B25's health-poll
  timeouts accordingly.
- **A known flaky test, pre-existing and not ours.** `api.test.ts:119` failed
  once in 68 *contended* runs with `expected 401 to be 404`; no token is passed
  at any of the file's three `createApp` sites, so the app under test cannot
  emit 401 — it is ephemeral-port cross-connect between concurrent supertest
  servers. This phase adds more servers and marginally increases that churn. If
  it bites for real the fix is a shared server per file, not the store.
- **B27 must be re-run if anything touches `digest.test.ts`.** G-a's
  path-awareness lives in exactly two assertions there, at `:126`/`:135`
  (assertions `:132`/`:147`), byte-identical to G-a. Do not tidy that file.
- **`digestOf` is invariant under path normalization**, so no fingerprint
  assertion can distinguish a raw path from a resolved one. What closes the gap
  is that `workspace.ts` resolves before hashing and `id = shortId(resolvedPath)`
  — which D-Gb2-8 now also checks on the read side.

---

## §6. Commit shape

1. `G-b2: store fixes — listEnvelopeIds filters, writeEnvelope validates first` (B30, B31 + the four `reason` assertions)
2. `G-b2: the store, read side — rehydrate()` (workspace + app + index)
3. `G-b2: gate rehydrate — B5b, B6–B11, B16, B24, B29`
4. `G-b2: the boot gates — B4, B13, B14, B25`
5. `docs: audit and phase record for G-b2`

Commit 1 stands alone and is worth landing even if the phase stalls later.
