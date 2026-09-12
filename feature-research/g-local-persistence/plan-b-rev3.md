# G-b rev 3 — the store and rehydrate, split in two

Supersedes the `# G-b — the store and rehydrate` section of `plan.md` (rev 2).
D-Gb-1 … D-Gb-8 stand except where corrected below.

Reviewed once before presentation. The reviewer falsified three of this
document's own because-clauses (F2's toolchain claim, B12's and B19's control
notes) and found four further gaps; all are folded in below and recorded at the
end. Every fact here was measured against `18b8143`, and the ones the reviewer
re-measured are marked **[v]**.

Baseline **[v]**: `pnpm test` → **365 passed (365), 29 files, exit 0**.
`master` is **7 ahead** of `origin/master` (rev 2's note said 6; the G-a record
commit `18b8143` is the seventh).

---

## Findings that change rev 2

### F1 (blocking) **[v]**. B4 cannot use `PSQ_PORT=0` — 0 is rejected, deliberately

`config.ts:59-60` throws when `parsed < 1`. `"0"` passes the `/^\d+$/` digit
test, then fails the range check, so a child spawned with `PSQ_PORT=0` never
reaches `server.listen` — `loadConfig` (`index.ts:18-25`) catches, logs, and
exits 1. Reproduced end to end: `PSQ_PORT=0 npx tsx apps/server/src/index.ts`
→ `PSQ_PORT=0 is not a port number (expected 1..65535).`, **exit 1**. B4 and
B13 both spawn that child, so **both fail for a reason with nothing to do with
the store.**

Widening the bound is not the fix. `config.test.ts:67` pins the rejection with
`"0"` first of eight values:

```
67	    for (const port of ["0", "-1", "65536", "http", "8092.5", "0x2360", "1e3", " 94 51"]) {
68	      expect(() => resolveServerConfig({ PSQ_PORT: port })).toThrow(/PSQ_PORT/);
```

and the `1..65535` contract is restated in both error strings and three
`feature-research/deploy-personal` records. (Rev 3 also cited `README.md:131`;
**wrong** — that row is `| PSQ_PORT | 8092 | the port to listen on |` and
`grep -n 65535 README.md` finds nothing. Citation dropped.)

**Fix:** the test asks the OS for a free port.

```ts
const freePort = async (): Promise<number> => {
  const s = createServer();
  await new Promise<void>((d) => s.listen(0, "127.0.0.1", d));
  const port = (s.address() as AddressInfo).port;
  await new Promise<void>((d) => s.close(() => d()));
  return port;
};
```

There is a race between `close` and the child's `listen`. Handle it: on a
non-zero exit with `EADDRINUSE` on stderr, re-probe and retry once. Never
hard-code a port — `8092` and `9451` are the dev and live servers.

`index.ts:44-54` logs the **real** bound port (`server.address()`, not
`config.port`), so wait on that line rather than sleeping — a fixed sleep is
the other way this gate goes flaky.

Measured timings **[v]**, so the implementer does not have to guess: boot to
the listening line **556ms**; `POST /api/repos` of `test/fixtures/mini-node`
**384ms → 201**; SIGTERM to exit 0 **47ms**; full round trip ~**1.6s**, inside
vitest's 5s default. The retry branch is reachable and detectable: holding the
port and spawning gives **exit 1 with `EADDRINUSE` on stderr in 576ms**.

### F2 (blocking). B4's "temp state dir" has no mechanism — use `XDG_DATA_HOME`

B4 says "spawn `index.ts` … with a temp state dir". Rev 2 offers no way to do
it: D-Gb-7 removes `PSQ_STATE_DIR` on purpose, and `index.ts` resolves the
directory itself. Constructor injection — rev 2's whole answer to "how do tests
avoid the live store" — **cannot reach a child process.**

Left unwritten, an implementer either reinvents `PSQ_STATE_DIR` (contradicting
D-Gb-7) or lets the child write into `~/.local/share/psq` — rev 1's rejected
hazard, arriving through the one gate that exists to prove production works,
and which the LaunchAgent would then rehydrate.

**Fix:** spawn the child with `XDG_DATA_HOME=<tmp>`, and `defaultStateDir()`
**must read the environment at call time, not at module load**, or the override
silently does nothing.

Override `XDG_DATA_HOME`, not `HOME`. **The reason rev 3 first gave for this
was false and the reviewer broke it three ways** — `PATH` carries the absolute
fnm multishell bin directory and is inherited independently of `HOME`, so
`env HOME=<tmp> npx tsx apps/server/src/index.ts` boots and serves. The true
reasons are narrower and sufficient: `XDG_DATA_HOME` is the branch production
actually takes, so B4 exercises the real resolver path and B18 gates it;
`HOME` is a bigger hammer that redirects every other tool's state as a side
effect.

Assert `<tmp>/psq/repos/<id>.json` **exists and parses** — not merely that
`<tmp>` is non-empty, which `mkdirSync` alone satisfies. Also assert
`~/.local/share/psq` is untouched; that half is a real control for "read env at
call time".

### F3 (blocking). There is no logger to capture **[v]**

B12 requires "the failure is visible in the captured logger", D-Gb-6 requires
failures "logged and swallowed", D-Gb-4's call site is
`void rehydrate().catch(log)`. **No logger exists anywhere in `apps` or
`packages`.** `apps/server/src` has `console.*` at exactly `index.ts:22,48,50,52`;
`app.ts` constructs none. No capture pattern exists in any `apps/server/test`
file.

**Fix:** the `Workspace` options object gains `log`, and `AppOptions` gains
both `stateDir` and `log` so the seam is reachable through `createApp`:

```ts
constructor(
  private readonly now: () => string = () => new Date().toISOString(),
  opts: { stateDir?: string; log?: (line: string) => void } = {},
) {
  this.stateDir = opts.stateDir;
  this.log = opts.log ?? ((line) => console.error(line));
}
```

Two corrections to rev 3's first draft of this snippet, both caught in review:
the body was `{}`, which silently discards both options (and `tsconfig.base.json`
sets neither `noUnusedParameters` nor `noUnusedLocals`, so B1 would have passed
on it) — hence the assignments are shown. And `log` must accept `unknown`, or
`void rehydrate().catch(log)` pushes an `Error` into a string-typed collector
through `.catch`'s `any`: type it `(line: unknown) => void`, or keep the string
type and write `.catch((e) => log(String(e)))`. Pick one in the first commit.

`now` stays **positional and first**, so `api.test.ts:14` and `auth.test.ts:16`
keep compiling unchanged **[v]**. Tests pass `log: (l) => lines.push(String(l))`
and assert on `lines` — deterministic, no global `console` mutation, and it
does not capture unrelated output the way `vi.spyOn(console, …)` would.

### F4 (blocking). `open()` must use `extractWithDigest` — and that needs its own gate

`workspace.ts:4` imports `extract`; `open()` calls `extract(path)` at line 108.
The envelope needs a `fingerprint`, so `open()` must produce a digest. Change
the import to `extractWithDigest` and destructure `{ graph, digest }`.
`extract()` keeps exactly four other call sites **[v]** (`apps/cli/src/index.ts:43`,
`test/mini-node.test.ts:225`, `test/mini-fullstack-csharp.test.ts:15`,
`test/seed-parity.test.ts:26`) and stays exported. Cost: one extra walk+hash
per `open()`, a fraction of the extraction beside it.

**The review found this rule had no gate, and the failure it prevents is
G-a's A10 race.** `detect.ts:83-84` takes the digest *before* extraction with a
comment saying the order is load-bearing. An `open()` written
`const graph = extract(path); const fp = digestOf(path);` is
digest-*after*-extract — the permanently-stale window A10 exists to close — and
it **passes B5a and B5b**, because both sides of both gates are `digestOf(path)`.
A10 gates `extractWithDigest`; nothing gates `open()`. New gate **B23**.

### F5 (blocking, corrected). `invariants` is in `@psq/graph`, returns `string[]`, cannot throw **[v]**

D-Gb-2 cites `packages/schema/src/index.ts:294` for the schema — right, that is
`export const EntityGraph = z.object({...})`. But `invariants` is not there. It
is `packages/graph/src/index.ts:27`,
`export function invariants(g: EntityGraph): string[]`, and its body (27-61)
only builds a `Map`/`Set` over already-parsed data and pushes strings —
**nothing in it can throw.** Empty array means clean.

`workspace.ts:5` already imports it, so the load path adds no dependency. The
check must be `invariants(graph).length > 0 → stale`, **not** a try/catch. A
try/catch around a function that never throws is a gate that passes by finding
nothing, and it would let a graph that fails its invariants load and then be
asserted about as fact. B10's sixth case is what measures this.

For contrast, `open()` throws on the same condition at `workspace.ts:111`; the
rehydrate path must mark the entry stale instead.

### F6 **[v]**. D-Gb-0's comment fix resolves to (b): drop `node_modules`, keep "eleven"

Rev 2 leaves the fix ambiguous — correct the count, or the list? Measured:
`node_modules` is singled out in its own paragraph immediately above, so it is
not one of "the other entries".

```
87	 * Stated limit, deliberately not closed: `ts.createProgram` resolves `.d.ts`
88	 * and lib files inside `node_modules`, which `walk` skips. A change to a
89	 * dependency's types will not move this digest. Repo source changes will.
90	 *
91	 * The rest of `SKIP` carries the same risk and the same cost. All eleven of the
92	 * other entries are skipped: `node_modules`, `bin`, `obj`, `.git`, `dist`,
93	 * `build`, `.next`, `.vs`, `TestResults`, `coverage`, `.venv`, `__pycache__`.
```

**Fix:** delete `` `node_modules`, `` from **line 92**. The list spans 92-93;
the remaining eleven — `bin`, `obj`, `.git`, `dist`, `build`, `.next`, `.vs`,
`TestResults`, `coverage`, `.venv`, `__pycache__` — then match both the word
"eleven" and the phrase "the rest of `SKIP`". Do **not** change "eleven" to
"twelve"; that keeps the sentence contradicting its own antecedent. `SKIP`
itself (`files.ts:9-12`, twelve entries) is correct and untouched.

### F7 (decision needed) **[v]**. `createApp` has five callers, four without a `stateDir`

Rev 2 enumerates two that pass no `stateDir` and derives D-Gb-7 from the pair.
Rev 3 said "two of three". Both are wrong — there are **five callers, four
without one**:

```
apps/server/src/index.ts:29      createApp(undefined, { token: config.token })
apps/desktop/src/main.ts:29      createApp()                       ← production
e2e/harness.ts:60                createApp(undefined, …)
apps/server/test/api.test.ts:14  createApp(new Workspace(clock))
apps/server/test/auth.test.ts:18 createApp(w, …)
```

So under D-Gb-7 as written, **the Electron app never persists and never
rehydrates.** That may be right — the motivating failure was the LaunchAgent
restarting with `repos: 0` — but rev 2 records it as neither decision nor
omission, because it never saw the caller.

**DECISION (James, 2026-09-12): the desktop app stays unpersisted in G-b.**
Reasons, recorded so this is a decision and not the omission rev 2 made: the
desktop shell is user-launched, not `KeepAlive`-restarted, so it does not have
the problem this phase fixes; and sharing one store between the LaunchAgent and
the desktop app means two processes writing the same
`~/.local/share/psq/repos/<id>.json` with no locking, which would pull a
two-writer design into a phase that has no gate for it. One line in `main.ts`
adds it later if wanted.

`apps/desktop/src/main.ts` is therefore **not** in either files-touched list.
That is the decision above, not an oversight — the same note D-Gb-7 already
carries for `e2e/harness.ts`.

`createApp` already takes a second parameter (`app.ts:91-93`,
`options: AppOptions = {}`); G-b adds fields to `AppOptions`, so every caller
keeps compiling. `apps/desktop` is covered by B1 only because `package.json:11`
runs four separate projects and `apps/server/package.json` exports
`./src/app.ts` with no `dist/` — desktop and e2e typecheck against live source.
The root `tsconfig.json` **excludes** `apps/desktop` and `e2e`, so B1's "all
four projects" phrasing is load-bearing; a bare "typecheck clean" would not
cover the desktop caller.

### F8 **[v]**. Three test patterns G-b needs do not exist in `apps/server/test`

Measured across `api.test.ts`, `auth.test.ts`, `config.test.ts`: zero
`mkdtemp`/`tmpdir`, zero `spawn`, zero `vi.spyOn`/`console`. Every existing test
is in-process `createApp` + `supertest` against static fixtures under
`test/fixtures/`.

F3 removes the need for the logger one. Copy the other two rather than
inventing them:

- temp dir — `packages/extract/test/digest.test.ts:3-4` (`mkdtempSync`,
  `tmpdir`, `rmSync`). Use `rmSync(dir, { recursive: true, force: true })` in
  `afterEach` so a failed test does not leak a store into `/tmp`.
- child spawn — `scripts/dev-all.mjs:46`, whose header comment is about
  precisely the signal handling B4 and B13 need.

### F9 **[v]**. `index.ts:11-12` and `:47` are false prose

```
11	 * local services parked on 8080–8091. Pass 0 to take any free port, which is
12	 * what Electron does so two copies never clash.
47	  // Electron reads this line to learn which port to open.
```

Both wrong. Port 0 is rejected (F1). Electron does not spawn `index.ts` and
does not parse stdout — it embeds `createApp()` in-process (`main.ts:29`) and
calls `listen(0, …)` on its own `http.Server` (`:36`), reading the port off
`server.address()`. The only `spawn` in `apps/desktop` is `:94`, launching
`code`. There is no out-of-process handshake anywhere, and no test of one.

**Nothing is broken** — 0 never reaches `config.ts` because it is never sent.
This is inaccurate documentation only. But it is a false because-clause sitting
on the file G-b edits, and F1 means the implementer will read it while
disbelieving it. Fix both comments in G-b2's `index.ts` commit; no behaviour
change.

### F10 **[v]**. `rows` already flows in from the API; only storage is missing

D-Gb-3 is accurate and narrower than it looks. `open()` is already
`open(rawPath: string, opts: { seed?: number; rows?: number } = {})` and
`POST /api/repos` (`app.ts:114-125`) already forwards both. What is missing is
that `rows` is defaulted inline and then forgotten:

```
138	    const seed = opts.seed ?? DEFAULT_SEED;
139	    const seeded = materialize(graph, { seed, rows: opts.rows ?? 40 });
```

Resolve `rows` into a `const` beside `seed`, put both on `OpenRepo`, store
both. B6 proves it.

### F11 (corrected in review). `open()` has **four** throw paths, not two

Rev 3 named two. There are four, and **the omitted pair is exactly the
vanished-repo case G-a told G-b to classify as `missing`**:

```
 98	    if (!existsSync(path)) throw new Error(`No such directory: ${path}`);
 99	    if (!statSync(path).isDirectory()) throw new Error(`Not a directory: ${path}`);
111	      throw new Error(`The extracted graph failed its invariants, …`)
131	      throw new Error(`No entities found. ${reason} …`)
```

Reusing `open()` for D-Gb-4 step 4 is otherwise attractive — one code path, it
rewrites the envelope for free, and it already handles the already-open case by
closing and replacing (`102-106`). But if the repo disappears between step 2
and step 4, the throw is at `:98`, and a blanket per-entry try/catch books it
as `failed` when G-a's record says it must read `missing`. **Map each of the
four to a health counter**, and wrap every entry regardless of which path is
reused, logging the entry id with the error.

### F12 (new, from review). `missing` vs `failed` has no control — and G-a asked for one

G-a's "What G-b needs to know" is explicit: *`digestOf("/gone")` returns the
empty-tree sha256 rather than throwing … this is exactly why D-Gb-4 step 2's
path-is-a-directory check must stay strictly before the fingerprint
comparison.* Rev 2 carries the instruction; rev 3 added nothing to measure it.

B10's "missing `path`" case and B11's "files are kept" both pass whether the
entry was classified `missing` or `failed`, and whether or not a doomed
re-extract ran. So an implementation with the comparison in the wrong order is
green in both phases — the one outcome G-a specifically warned about. D-Gb-8
already exposes `{loaded, failed, missing}`, so the control is cheap. New gate
**B24**.

### F13 (new, from review). `index.ts` must not let the resolver throw before `listen()`

D-Gb-1 has `defaultStateDir()` **throw** when `HOME` is unset, and B18 gates
that throw. G-b1 then calls it at module scope in `index.ts`, above
`server.listen`. D-Gb-4's own first sentence forbids exactly this:
*`KeepAlive` + `ThrottleInterval 30` means anything throwing before the socket
binds becomes a silent 30-second restart loop.*

Verified in `scripts/deploy.sh` **[v]**: `KeepAlive` true, `ThrottleInterval`
30, and the plist's `EnvironmentVariables` supplies only
`PSQ_HOST`/`PSQ_PORT`/`PSQ_TOKEN`/`PATH` — `HOME` comes from the launchd
session, one plist edit or session change from absent.

**Decision:** `index.ts` wraps the resolver in try/catch, logs, and runs with
**persistence off** — never throws before `listen`. That is D-Gb-6's rule
("the store never fails a request") applied to startup. New gate **B25**.

---

## The split

**DECISION (James, 2026-09-12): approved — G-b ships as two phases.**

Rev 2's G-b is 11 files, 4 new, 21 gates, and three absent test patterns. G-a
needed three review rounds for two source files and one test file. One context
window will not hold this honestly, so it ships as two phases with a review and
an accept between them.

The seam is **write side / read side**. B4 — the Goal paragraph, the only gate
touching the production entry point — lands in G-b2, so **G-b1 is not the
deliverable and must not be described as one.** G-b1 ships code that writes
files nothing reads, deliberately the same shape as the `entity.graph.json` bug
this phase exists to fix. It is a phase boundary, not a release.

### G-b1 — the store, write side

Files touched:

1. `apps/server/src/store.ts` — **new**: envelope type and zod schema,
   `defaultStateDir()` (env read at call time, F2), atomic
   read/write/delete/list, `0700`/`0600`
2. `apps/server/src/workspace.ts` — ctor options `{ stateDir?, log? }` (F3),
   `rows` on `OpenRepo` (F10), `extractWithDigest` (F4), persist at the end of
   `open()`, `forget(id)`
3. `apps/server/src/app.ts` — `AppOptions` gains `stateDir` and `log`,
   forwarded to the default Workspace; `DELETE /api/repos/:id` calls `forget`
   unconditionally (D-Gb-5)
4. `apps/server/src/index.ts` — resolve `defaultStateDir()` inside try/catch
   (F13) and pass it; **no rehydrate call yet**
5. `apps/server/test/store.test.ts` — **new**
6. `apps/server/test/api.test.ts` — the writes-nothing assertion
7. `packages/extract/test/digest.test.ts` — D-Gb-0 arity fix
8. `packages/extract/src/files.ts` — D-Gb-0 comment fix (F6)
9. `feature-research/g-local-persistence/audit-b1.md`, `progress-b1.md`, and
   **`plan-b-rev3.md` itself** — it is currently untracked, and D-Gb-1 reason 2
   is that this repo has already lost a plan to a `git clean`

Gates. Baseline **365**; state the exact new total.

| # | Gate | Control that proves it can fail |
|---|---|---|
| B1 | `pnpm typecheck` clean, **all four projects** | the phrasing is load-bearing: root `tsconfig.json` excludes `apps/desktop` and `e2e`, so only the four-project script covers the desktop caller (F7) |
| B2 | `PSQ_NO_CORPUS=1 pnpm test`, 0 failed | **skipped stays 58** |
| B3 | `pnpm test` = 365 + new, 0 failed | — |
| B5a | The `fingerprint` written at `open()` equals `digestOf(resolvedPath)` computed independently in the test | fails on `""`, on a digest of the raw rather than resolved path, and on a missing field. It cannot see digest/extract **ordering** — that is B23, and B23 is why this gate is not enough |
| B12 | `chmod 0500` the state dir **before the first open**; `POST /api/repos` still 201, and the failure appears in the injected `log` | the `log` assertion is the mechanism — without it the gate passes on a store that does nothing. (Rev 3's stated reason — "0500 blocks creation, not writes to an existing file" — is **false** under D-Gb-2's temp+rename: measured on APFS at 0500, `mkdir` EACCES, overwriting an existing file **succeeds**, `rename` **EACCES**. The gate is right; chmod-after-open would also bite. Reason corrected.) |
| B15 | Plant a corrupt envelope by hand, `DELETE /api/repos/:id` for its id → 200 and the file is gone | the D-Gb-5 hole; `workspace.ts:149-151` is the 404 path. Needs no rehydrate — `forget` and the unconditional DELETE both land in this phase |
| B17 | `new Workspace(clock)` with no `stateDir` opens a repo and writes **nothing** | point `XDG_DATA_HOME` at a temp dir and assert nothing appears under `<tmp>/psq`. Do **not** assert on the real `~/.local/share/psq`: it does not exist today **[v]**, so the gate is failable now and stops being failable the first time James runs the real server — [[negative-gates-need-positive-control]] on a delay |
| B18 | `defaultStateDir()` for `XDG_DATA_HOME` set, unset, and `HOME` absent (throws, actionably) | read env at **call time** or F2's child override silently does nothing |
| B19 | dir `0700`, files `0600` | assert the **first** write, not a rewrite. (Rev 3 said the reverse; under temp+rename every rewrite creates a fresh file, so the real hazard is omitting `{ mode: 0o600 }`, which the first write catches — measured mode 600 under umask 022.) |
| B20 | Diff swept for corpus paths and the tailnet host/token | sweep with the env file as positive control, or the sweep proves nothing |
| B21 | `git show --stat` is exactly the paths above plus the phase records | — |
| **B22** | **The `AppOptions` seam**: `createApp(undefined, { stateDir: tmp })`, POST a fixture, assert `<tmp>/repos/<id>.json` exists | new. D-Gb-7 notes there is *currently no seam through which a stateDir could reach the Workspace*; G-b1 adds it and every other G-b1 gate constructs `Workspace` directly, so without this the new production wiring is unproven until B4 a phase later |
| **B23** | **Digest ordering in `open()`**: spy the `@psq/extract` bindings and assert `extractWithDigest` is called **once** and `digestOf` is **not** called from `open()` | new, and F4 is why. `extract(path)` then `digestOf(path)` is digest-after-extract — A10's stale window — and passes B5a and B5b because both sides are `digestOf`. Use the `vi.mock` technique already at `packages/extract/test/digest.test.ts:16-25` |
| **B26** | **Atomicity**: no `*.tmp` residue after a success and after a forced failure, and the temp file is created in the **destination** directory | new, residual. D-Gb-2's headline atomicity claim is otherwise ungated in both phases; `os.tmpdir()` would make `rename` EXDEV across devices, and D-Gb-6 swallows the failure |
| **B27** | `git diff packages/extract/test/digest.test.ts` shows **only** the `vi.mock` wrapper at :20-23 | new. G-a: *path-awareness lives in exactly two assertions … do not "tidy" that file.* G-b1 opens it. B3 counts tests and B21 checks paths — neither notices an assertion weakened inside an existing `it` (the renames sit at :121-152) |

### G-b2 — rehydrate

Files touched:

1. `apps/server/src/workspace.ts` — `rehydrate()` (D-Gb-4)
2. `apps/server/src/app.ts` — health reports `rehydrate` (D-Gb-8)
3. `apps/server/src/index.ts` — `void rehydrate().catch(…)` inside the
   `listen()` callback; the two false comments (F9)
4. `apps/server/test/rehydrate.test.ts` — **new**
5. `apps/server/test/boot.test.ts` — **new**, the child-process gate
6. `apps/server/test/api.test.ts` — health shape. The breaking assertions are
   `:239` and `:241`, `toEqual({ ok: true, repos: N })` — exact matches.
   Extend them; do **not** relax to `toMatchObject`, which deletes the only
   assertion that the health body is exactly what it claims
7. `feature-research/g-local-persistence/audit-b2.md`, `progress-b2.md`

`apps/web` is deliberately **not** touched: `apps/web/src/lib/api.ts:236` types
health as `call<{ ok: boolean; repos: number }>`, a cast, so D-Gb-8's extra
field is ignored at runtime and the web client needs no change. A decision, not
an omission.

Gates. B1, B2, B3, B20, B21 re-run as above, plus:

| # | Gate | Control that proves it can fail |
|---|---|---|
| B4 | **Boot round trip**: spawn `index.ts` as a child on an **OS-assigned free port** (F1) with `XDG_DATA_HOME=<tmp>` (F2), wait for the listening line, POST a fixture, SIGTERM, restart, `GET /api/repos` returns the repo | the Goal paragraph. Every other gate calls `Workspace` directly and stays green whether the entry point is wired at all. Spawn with an **explicit env** — `PATH`, `HOME`, `XDG_DATA_HOME`, `PSQ_PORT` and nothing else: an exported `PSQ_TOKEN` or `PSQ_HOST` makes the child demand a bearer token and 401 the POST, the F1 shape again. Also assert the real store is untouched |
| B5b | **Cross-time parity**: the stored fingerprint still equals `digestOf(path)` at rehydrate on an unchanged repo | pairs with B5a; neither sees ordering, hence B23 |
| B6 | **Fidelity**: open with a **non-default seed and non-default rows**, capture the full ordered list of question ids, rehydrate in a new Workspace, ids identical | subsumes seed, rows and graph fidelity. Strictly stronger than "one question grades correctly", which passes with the stored seed ignored |
| B7 | **Grading**: a rehydrated repo grades a correct answer right **and a wrong answer wrong** | the wrong-answer half is the control; an always-correct grader passes without it |
| B8 | **Stale detection**: mutate a source file so the graph changes **observably** (add a column to a `CREATE TABLE`), rehydrate, the new fact appears and the envelope was rewritten | pair with the unmutated case asserting it was **not** re-extracted. Without an observable change, an implementation that rewrites the fingerprint and keeps the old graph passes |
| B9 | **Extractor version**: a stale `extractor` forces re-extract | pair with a matching one asserting it does not. This is what makes `EXTRACTOR_VERSION` observable at all |
| B10 | **Corrupt store**: garbage JSON, `version: 99`, stale `extractor`, missing `path`, a well-formed envelope whose `graph` fails `EntityGraph.parse`, and — sixth — a graph that **parses but fails `invariants()`** — all alongside **one good entry** | the good entry must load in the same run or "everything skipped" reads as success. The bad-graph case is the only thing testing D-Gb-2's headline claim; the sixth case is the only thing that can catch F5's try/catch mistake, since `invariants` returns an array and never throws |
| B11 | **Files are kept**: after B10 the corrupt and missing entries still exist on disk | D-Gb-4 says keep; a cleanup-happy implementation passes B10 |
| B13 | **Shutdown safety**: SIGTERM the real child from B4, restart, the repo comes back | in-process `closeAll()` would still pass if `forget()` were hooked into the shutdown handler |
| B14 | **Forget really forgets**: DELETE, restart, the repo does **not** come back | the positive control for B13 |
| B16 | **`running` is observable**: with two entries, poll `/api/health` during rehydrate and catch `state: "running"` | if the `setImmediate` yield is missing this can never be observed and D-Gb-8's tri-state is decoration |
| **B24** | **`missing` is not `failed`**: an entry whose `path` no longer exists increments **`missing`**, not `failed`, and `digestOf` was **never called** for it | new, and G-a asked for it by name (F12). B10 and B11 both pass either way, so without this the wrong step order — the one outcome G-a warned about — is green in both phases. The `digestOf`-not-called half is what pins step 2 strictly before step 4 |
| **B25** | **A resolver throw does not stop the boot**: spawn with `HOME` and `XDG_DATA_HOME` both absent; the server still reaches the listening line and answers `/api/health` with persistence off | new (F13). `KeepAlive` + `ThrottleInterval 30` turns a pre-`listen` throw into a silent 30s restart loop. If a `HOME`-less child proves unreliable for unrelated reasons, force the failure instead by pointing `XDG_DATA_HOME` at an unwritable path |

Also measure and record, per rev 2's Risks: **rehydrate cost per repo**, load
path versus re-extract path. Rev 2 assumes it is well under the 1.3s pipeline
and says to measure rather than assume.

---

## What rev 2 got wrong, and what rev 3 got wrong

Rev 1's post-mortem is in `plan.md`. Rev 2's:

1. **Its headline gate could not run.** B4 spawns a child with `PSQ_PORT=0`,
   which `config.ts` rejects and `config.test.ts` pins as rejected. Rev 1 had
   thirteen gates and none touched the entry point; rev 2 added the gate that
   does and never ran the command.
2. **It removed the only mechanism that gate needed.** D-Gb-7 deletes
   `PSQ_STATE_DIR` because constructor injection covers the tests — correct for
   in-process tests, and unable to reach the child process B4 spawns. Both
   decisions are in the same document, two pages apart.
3. **Three gates named a logger that does not exist.** The server has `console`
   and no seam.
4. **It derived a design decision from two of five `createApp` callers**,
   missing the production one (`apps/desktop/src/main.ts:29`) — so "persistence
   is off when `stateDir` is undefined" silently means the desktop app never
   remembers.
5. **It cited `invariants()` to the wrong package and treated it as throwing.**
   It returns `string[]` from `@psq/graph`. A try/catch around it cannot fail.

And rev 3's own, because the shape is the point:

6. **Three of its gate-control notes were unverified because-clauses** — F2's
   fnm/`HOME` claim (false; the reviewer booted the server under an overridden
   `HOME` three ways), B12's "0500 permits writes to an existing file" (false
   under temp+rename), and B19's "assert on a rewrite" (backwards for the same
   reason). It also cited `README.md:131` for a string that is not in the file,
   undercounted `open()`'s throw paths two-for-four, and miscounted the
   `createApp` callers it was itself correcting.
7. **It carried G-a's `missing`-vs-`failed` instruction without adding anything
   that measures it**, which is how an instruction survives three documents and
   still ships broken.

The generalisable form is G-a's lesson one level up. G-a learned that *a claim
about what a gate holds is itself a claim, and cheap to measure.* Rev 2 shows
the prior claim is cheaper still — **whether the gate can run at all**; four of
its five errors were one command or one grep away. Rev 3 then shows the third
layer: **a plan can state that thesis, apply it to its predecessor, and still
ship its own reasons unmeasured.** The reasons are where it hides, every time —
which is why the corrections above are written into the control column rather
than fixed silently.
