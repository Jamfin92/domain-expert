# M5a — progress

Status: **shipped and reviewed (verdict: ship, after three fix rounds).**
Uncommitted. HEAD is still 3fc3f8d, so the tree now carries M9a, M9b **and**
M5a together.

## What shipped

A repo's client-side HTTP calls are now extracted as facts and matched to the
Express routes the route reader already found. Facts only — no component
attribution, no endpoint, no UI.

- `packages/schema/src/index.ts` — new `ClientCall` (`method`, `path`, `file`,
  `line`, `enclosing`, `matches`) plus `clientCalls` on `EntityGraph`. `matches`
  mirrors `Shape.mirrors`: a resolved `"METHOD path"` name, not an index. The
  comment carries a **catalogued miss list**, house style.
- `packages/extract/src/node/clients.ts` — new. Module-local `CLIENT_METHODS`
  (seven verbs, deliberately **not** `routes.ts`'s `METHODS`, which contains
  `"all"` — `axios.all` is `Promise.all`), `readClientCalls`, `linkCalls`.
- `packages/extract/src/node/routes.ts` — one word: `export` on
  `importsExpress`. `METHODS` untouched and still unexported.
- `packages/extract/src/node.ts` — wired into `extractNode`; `clientCalls`
  attached at the construction site.
- `clientCalls: []` at all five `EntityGraph` construction sites: `node.ts:99`,
  `detect.ts:44`, `dotnet.ts:292` **and** `:613` (two literals in that file),
  and `packages/graph/test/layout3d.test.ts:48` (outside typecheck's program —
  fixed anyway rather than left a silent type hole).
- `test/fixtures/mini-fullstack/` — new hermetic fixture, `.ts` not `.tsx`, no
  axios (not a dependency), carries a `CREATE TABLE`. `test/mini-fullstack.test.ts`
  pins every call with one exhaustive `toEqual`.
- `README.md` — M5 row split into M5a/M5b, "Next" renumbered.

## Verification

`pnpm typecheck` pass · `pnpm test` **211 passed** (corpus ON) ·
`PSQ_NO_CORPUS=1 pnpm test` 156 passed / 55 skipped · `pnpm test:e2e` 19 passed,
unchanged.

`PSQ_NO_CORPUS=1` **skips exactly the tests that catch this phase's defects.**
The corpus-on run is the load-bearing gate. A green hermetic run proves nothing
about corpus-repo-e's zero-warning contract.

PATH note, superseding M9a's advice: `export PATH="$HOME/.local/share/fnm/node-versions/v24.19.0/installation/bin:$PATH"`.

## The lesson worth carrying forward

**Every one of the three review rounds found a fabricated fact, and each was
"one AST node over" from the last.**

1. Guard 2 rejected any call whose second argument was a bare identifier, which
   killed `api.post("/licenses", data)` — *the* axios signature, present verbatim
   in corpus-repo-a. Silent, undocumented.
2. `fetchMethod` returned an unconditional `GET` whenever it failed to
   *recognise* a key form. `{ "method": "POST" }` — answer in the source — was
   reported as GET.
3. The spread/computed guards ran per-property but the loop returned on the
   first `method` key, so `{ method: "GET", ...opts }` never saw the spread that
   could override it.

The pattern: **a default is a guess wearing a default's clothes.** Each defect
was a fall-through that produced a confident wrong answer rather than a skip,
and each could then *match* a real route, turning one bad fact into a bad link.
The fix that finally held was structural, not another special case — invert the
function so `return "GET"` is reachable only when every key is provably not
`method`, and hoist whole-literal checks above the loop.

**None of the three was caught by the suite being green.** All were caught by
falsification and by running the reader over real repos on disk. M9b's habit
held up; keep it.

## Decisions made

- **The reader does not look inside components**, despite "React clients". The
  one real React app available (corpus-repo-a) puts the URL literal **3 hops**
  from the component — component → react-query hook → `*.service.ts` → axios
  instance holding only `baseURL: "/api"`. A component-local search finds zero
  call sites there. M5a records calls where they physically are; attribution is
  M5b's problem.
- **No warnings except on ambiguous matches.** The first plan said "warn on
  anything non-literal", following `routes.ts:102`. That would have broken two
  zero-warning contracts (`test/mini-node.test.ts:17`,
  `packages/extract/test/node.test.ts:93`) — `res.headers.get(…)`,
  `stmts.selectOne.get(symbol)` and dozens more. An unread *route* is a gap in
  the HTTP surface and deserves a warning; a `.get(` that isn't a client call is
  simply not this reader's business. Silence plus a catalogued miss list.
- **Two Express guards, both now independently pinned.** Guard 1 skips files
  where `importsExpress` is true; guard 2 rejects calls whose second argument is
  an inline function (parens unwrapped, arrays checked). Guard 1 is load-bearing:
  this repo's own `apps/server/src/app.ts` registers 12 of 14 routes as
  `app.get(path, handler(...))` — a CallExpression guard 2 never sees.
- **Computed keys are skipped blanket**, not just literal `["method"]`. `[k]`
  can't be ruled out as `method` without a checker. Drops calls rather than
  inventing methods; costs nothing measurable (corpus-repo-a unaffected).
- **Corpus test rejected.** No repo on disk has both an Express route surface and
  an HTTP-calling client of it. Self-analysing `domain-expert` would turn every
  future `apps/web` edit into a failure in an unrelated phase.

## Known limitations

- **`enclosing: null` is documented as "module scope" but is also returned for
  object-literal arrow properties, class property arrows, constructors,
  get-accessors and anonymous default exports.** A small fabricated fact.
  **M5b depends on this field** — tighten it there. corpus-repo-a's services use
  object-literal *methods*, which do resolve correctly.
- Trailing slashes and `#fragments` are not normalised: `fetch("/api/items/")`
  never matches route `/api/items`. Silent, uncatalogued.
- `importsExpress` matches **type-only** imports, so `import type { Request }
  from "express"` in a shared file skips that whole file's client calls.
- Server-side mount prefixes are the mirror of the client baseURL miss and are
  uncatalogued: a router's `router.get("/items")` is stored as `/items` while the
  client calls `/api/items`. Two routers on the same path also produce duplicate
  route facts and the odd warning `… could match GET / or GET /; not matched`.
- The one false-*positive* path: a literal `*` in a call path
  (`fetch("/api/*")`) normalises to itself and can match route `GET /api/:id`.
- `router.get("/users", authenticate, listUsers)` in a file with **no** express
  import is recorded as a client call. Catalogued. Bounded — `readRoutes` skips
  the same files, so it can only ever be an orphan with `matches: null`.
- Test count is **not** a signal for this fixture: new cases land inside the one
  exhaustive `toEqual`, not as new `it` blocks. 211 looks identical either way.

## What the next phase needs to know

**M5b is component attribution — the 3-hop problem, and it is the real work of
"React clients".** Following imports from a component through hooks and service
modules to a call site. The wrapper-function miss is the same problem: this
repo's own `call<T>(…)` at `apps/web/src/lib/api.ts:172` is invisible to the
current rules. Solve them together. Tighten `enclosing` while you are there.

**M5c is API + UI.** `apps/server/src/app.ts:153-166` (`/api/repos/:id/shapes`)
already returns `routes` and is the obvious home for `clientCalls`. `DriftView`
(`Dashboard.tsx:55`) is the precedent for rendering a linked pair; `RouteList`
(`Dashboard.tsx:90`) is where routes already render. `apps/web/src/lib/api.ts:106`
is a hand-written structural mirror of `EntityGraph` and does **not** know about
`clientCalls` — it drifts until M5c adds the field.

**`route → table` is still unbuilt** — the second half of the README's
"table↔route↔component". It needs handler-body SQL/ORM tracing; nothing in the
repo does this today. Scope it deliberately.

Also still open, unchanged from M9b: **3D picking** (raycast against building
meshes; `selected` is treated two ways in 3D — header badge hidden, aside still
shows the stale 2D selection) and orbit controls. Neither is a README milestone.

A C# route reader would let corpus-repo-a participate — it is the only real React
client on disk, and its 50 extracted calls all sit at `matches: null` purely
because its backend is C# and produces no route facts.

**Nothing in any of these three phases has been committed.**
