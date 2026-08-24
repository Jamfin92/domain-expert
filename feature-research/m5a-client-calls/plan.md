# M5a — client call facts

Milestone M5 is "React clients, table↔route↔component links". This plan covers
**only the first link and only as facts**: find HTTP call sites in a repo's
client code, and decide which extracted `Route` each one calls. No component
attribution, no API endpoint, no UI.

Revised once after review. The two design decisions in "Exclusions" and
"Warning policy" were added because the first draft's rules fired on code
already present on this machine.

## Why the milestone has to be split

The README row implies a three-node chain: `table ↔ route ↔ component`. That is
**two** links, and they are not comparable in difficulty.

- `component → route` is string matching between a URL literal and a known route
  table. Tractable.
- `route → table` means tracing a handler body to the SQL or ORM call it makes.
  Nothing in the repo does this today; the only `db.exec`/`prepare` occurrences
  in `packages/extract` are inside `ddl.ts` itself, which executes `CREATE TABLE`
  literals. That leg is a separate phase at minimum.

M5a takes the narrowest useful slice of the first link.

## The constraint that shapes the design

**No corpus repo exercises this milestone**, so the hermetic fixture is the only
real gate. Established by scouting, and worth restating because it will look like
an oversight later:

| repo | route facts | React client |
| --- | --- | --- |
| `corpus-repo-c` | Express, extracted | none |
| `corpus-repo-e` | Express, extracted | none |
| `corpus-repo-d` | none | ~24 `.tsx`, **client is WebSocket-only** (`web/src/lib/ws.ts`) |
| `corpus-repo-a` | C# backend, **no route facts at all** — `readRoutes` is Express-only | ~129 `.tsx`, but outside the pinned `CORPUS.corpus-repo-a` path |
| `corpus-repo-b` | C# | none first-party |
| `MINI_NODE` fixture | 3 routes | **no client code** |

Note the corpus repos' *servers* do call `fetch` — `corpus-repo-d/server/src/notify.ts:45,136`,
`corpus-repo-d/server/src/registry/hosts.ts:102,125,282`, `corpus-repo-c/src/gamma.ts:119`,
`corpus-repo-e/src/server.ts:113`. `extractNode` sees these. They are outbound calls
to external hosts, not clients of the repo's own routes, and the warning policy
below exists mainly because of them.

Two consequences:

1. **A new hermetic fixture is required.**
2. **No corpus test in M5a.** There is no repo on disk with both an Express route
   surface and an HTTP-calling client of it. Self-analysing `domain-expert` is
   the only candidate and is rejected below.

A third constraint is about *shape*, from corpus-repo-a, the one real React app
available: the URL literal sits **3 hops** from the component (component →
react-query hook → `*.service.ts` → shared axios instance carrying only
`baseURL: "/api"`). A reader that looks for `fetch()` inside a `.tsx` component
finds **zero** call sites there. So M5a does not look inside components at all —
it records call sites wherever they physically are, and leaves attribution to
M5b.

## Design

### The fact

New zod object in `packages/schema/src/index.ts`, beside `Route`:

```ts
export const ClientCall = z.object({
  method: z.string(),
  /** Normalised: ${} holes and :params both become *, query string dropped. */
  path: z.string(),
  file: z.string(),
  line: z.number().int().nonnegative(),
  /** Nearest enclosing named function, or null at module scope. */
  enclosing: z.string().nullable(),
  /** The matched route's raw "METHOD path", or null when unmatched. */
  matches: z.string().nullable(),
});
```

`matches` mirrors `Shape.mirrors` deliberately: a resolved **name**, not an index
or object reference. Routes have no `id`, so `"METHOD path"` — the route's raw
path, not its normalised form — is their identity.

The schema comment must carry a **catalogued miss list**, house style per the
block comment above `CREATE_TABLE_NAME` in `test/fixtures.ts`. Known misses:
calls through a wrapper function (`call<T>(...)` in this repo's own
`apps/web/src/lib/api.ts:172` is invisible to these rules), URLs built by string
concatenation, and non-literal URLs.

`EntityGraph` gains `clientCalls: z.array(ClientCall)`. Verified safe: nothing
calls `EntityGraph.parse`/`safeParse` anywhere — `EntityGraph` is `import type`
at every site, and the only runtime zod parses in the repo are `Section.safeParse`
(`apps/server/src/app.ts:182`, `apps/cli/src/index.ts:71`). Type-only change.

**All five `EntityGraph` construction sites** must gain the field:
`packages/extract/src/node.ts:99`, `packages/extract/src/detect.ts:44`,
`packages/extract/src/dotnet.ts:292`, `packages/extract/src/dotnet.ts:613`
(**two** literals in that file), and `packages/graph/test/layout3d.test.ts:48`.
The last is outside `pnpm typecheck`'s program (`tsconfig.json` includes only
`packages/*/src/**` and `test/**`) so omitting it fails no gate — fix it anyway
rather than leaving a silent type hole.

`apps/web/src/lib/api.ts:106` is a hand-written structural mirror of
`EntityGraph`. It will not know about the new field. That is not a break; it
drifts until M5c.

### Detection rules

In a new `packages/extract/src/node/clients.ts`, consuming the existing
`ts.SourceFile[]` from `programFor()` — same inputs as `readRoutes`
(`readRoutes(root, sources, warnings)`, `routes.ts:71`), no second `ts.Program`.
`extractNode` has `program`, `checker` and `sources` in hand at `node.ts:82-84`,
so a checker is available if ever needed; M5a does not need one.

A call site is recorded when **both** hold:

1. The callee is either the global identifier `fetch`, or a property access whose
   name is in `CLIENT_METHODS`. Any receiver qualifies — this catches
   `axios.get(…)`, `api.post(…)` and hand-rolled wrappers without having to prove
   what the receiver is.
2. The first argument is a string literal, or a template literal whose only
   dynamic parts are `${}` holes, **and** its static head starts with `/`.

`CLIENT_METHODS` is a **new module-local const** in `clients.ts`:
`get`/`post`/`put`/`patch`/`delete`/`head`/`options`. It deliberately does **not**
reuse `METHODS` from `routes.ts:20` — that const is module-local and not
exported, and it includes `"all"`, which on the client side would catch
`axios.all` (an alias for `Promise.all`). Duplicate the seven; do not export and
share.

Rule 2 is what keeps rule 1 from firing on `map.get(k)` or `params.get("id")`.
It is a heuristic and will be stated as one in the audit.

Method resolution: a property-access call takes its method from the property
name. A bare `fetch` is `GET` unless a second-argument object literal carries
`method: "…"`, in which case that wins.

Path normalisation: `${}` holes become `*`; a query string is **split off at `?`
and dropped**, so `` `/api/x?limit=${n}` `` yields `/api/x` and can still match
route `/api/x`. String concatenation (`"/api/x/" + id`) is a `BinaryExpression`,
is rejected outright, and is a **documented miss** — it is one of the two
commonest ways real code builds a URL.

`enclosing` is the nearest ancestor function with a name — a
`FunctionDeclaration`, a method, or an arrow/function expression assigned to a
named `const`. Module-scope calls get `null`. M5a does **not** judge whether the
enclosing function is a React component; that is M5b's.

### Exclusions — Express registrations (decided)

`app.get("/health", handler)` satisfies both rules. Without an exclusion, every
route in every repo is also recorded as a client call, and `linkCalls` then
matches each phantom call to the route that produced it — a fabricated fact, not
a heuristic miss. It would fire on `test/fixtures/mini-node/server.ts:10,14,18`,
on `corpus-repo-e/src/server.ts` (6 routes, pinned at `packages/extract/test/node.test.ts:127`),
and on this plan's own fixture.

Two guards, both required:

1. **Skip any source file for which `importsExpress(source)` is true.** That
   helper exists at `routes.ts:22` and is module-local; export it (and only it)
   for reuse. A file that both imports express and makes client calls is a
   documented miss.
2. **Reject any call whose second argument is a function** (arrow, function
   expression, or bare identifier reference). A client call's second argument is
   an options object or absent; a route registration's is a handler. This catches
   router files that import `Router` from a local module rather than from
   express.

### Warning policy (decided)

**The client reader emits no warnings except on ambiguous matches.**

The first draft said "anything not literal becomes a warning", following
`routes.ts:102`. That is wrong here and would break two zero-warning contracts:
`test/mini-node.test.ts:17` and `packages/extract/test/node.test.ts:93`
(corpus-repo-e). `corpus-repo-e/src/server.ts:113` alone trips it.

The reasoning: an unread *route* is a gap in the repo's HTTP surface and deserves
a warning. A `.get(` that is not a client call — `res.headers.get(…)`,
`stmts.selectOne.get(symbol)`, `jar.get(scope)` — is not an unread construct, it
is a call this reader is not about. Same for `fetch` to an absolute external URL.
Silence is correct; the miss list in the schema comment is where these are
recorded.

The one exception keeps the `pairShapes` discipline where it actually matters:
if a normalised call path matches **more than one** route, `matches` stays `null`
and a warning names the candidates, exactly as `pairShapes` does
(`"…could mirror A or B; not paired"`). This cannot fire on any corpus repo,
because no corpus repo produces a client call that matches one of its own routes.

### Matching

`linkCalls(routes, calls, warnings)` in the same module, signature-shaped after
`pairShapes(entities, shapes, warnings)` and called at extraction time from
`extractNode`, storing its decision on the returned facts. This follows the
established split exactly: `pairShapes` stores the pairing on the graph
(`node.ts:88`), while `drift` stays derived and on-demand
(`apps/server/src/app.ts:159-166`).

Both sides normalise before comparison: route `/api/repos/:id/graph` and call
`` `/api/repos/${id}/graph` `` both become `/api/repos/*/graph`. Match requires
equal method **and** equal normalised path.

No `baseURL` inference and no suffix/prefix fallback matching in M5a. A client
whose calls are relative to a configured base simply does not match. Guessing a
prefix is how a fact reader starts lying; if base resolution is wanted it should
be its own scoped change with its own tests.

### The fixture

`test/fixtures/mini-fullstack/` — and note **fixture files are inside
`pnpm typecheck`** (`tsconfig.json` include is `test/**/*.ts`, verified with
`tsc --listFilesOnly`). Consequences, all binding:

- It must compile under `tsconfig.base.json`: `strict`,
  `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, no `esModuleInterop`,
  `lib: ["ES2023"]` plus `@types/node`, **no DOM**.
- It **cannot import `axios`** — not a dependency, so TS2307. "axios-style" means
  a hand-rolled `api` object with `get`/`post` methods.
- Files are `.ts`, not `.tsx`. A `.tsx` file would escape typecheck (the include
  is `*.ts`) while still being walked by extraction. M5a needs no React, since it
  does not look inside components.
- **It must carry a `CREATE TABLE`.** `node.ts:91-96` pushes "No CREATE TABLE
  statement was found…" whenever `entities.length === 0 && shapes.length > 0`,
  which would collide with the fixture's own exact-warning assertions.

Cases the fixture must cover: a direct `fetch` (GET by default), a `fetch` with
an explicit `method` in the options object, a hand-rolled `api.get`/`api.post`, a
template-literal path that matches a `:param` route, a path with a query string,
a call that matches no route, a non-literal URL (silently ignored), an
Express registration in the server half (must **not** appear as a client call),
and a `map.get(…)`-style decoy (must not appear).

### Rejected: self-analysing `domain-expert`

It is the only repo on disk with both an Express server (`apps/server`) and an
HTTP-calling client (`apps/web/src/lib/api.ts`, 1 hop via the `call<T>()`
wrapper), so it is tempting as a corpus entry. Rejected for M5a: a corpus test
pinned against this repo's own source turns every future edit to `apps/web` into
a test failure in an unrelated phase. If ever added it should assert loose
properties, never exact lists. (Note its calls go through `call<T>()` and would
be missed by rule 1 anyway.)

## Files touched

| file | change |
| --- | --- |
| `packages/schema/src/index.ts` | add `ClientCall` with its miss list; add `clientCalls` to `EntityGraph`; update the `routes` comment, which currently says "Facts only until M5" |
| `packages/extract/src/node/clients.ts` | **new** — `CLIENT_METHODS`, `readClientCalls`, `linkCalls` |
| `packages/extract/src/node/routes.ts` | export `importsExpress` (only) for reuse |
| `packages/extract/src/node.ts` | call both inside `extractNode`; attach `clientCalls` (construction site :99) |
| `packages/extract/src/dotnet.ts` | `clientCalls: []` at **both** :292 and :613 |
| `packages/extract/src/detect.ts` | `clientCalls: []` in the `"none"` branch (:44) |
| `packages/graph/test/layout3d.test.ts` | `clientCalls: []` in the `graph()` helper (:48) — outside typecheck, fix anyway |
| `test/fixtures/mini-fullstack/**` | **new** hermetic fixture, per constraints above |
| `test/fixtures.ts` | add `MINI_FULLSTACK` |
| `test/mini-fullstack.test.ts` | **new** — exact `toEqual` on `clientCalls`, matched and unmatched, plus `warnings` empty |
| `packages/extract/test/node.test.ts` | **verify** the corpus-repo-e zero-warning contract (:93) and route count (:127) still hold; edit only if the exclusion rules require it |
| `README.md` | split the M5 row into M5a/M5b as M9 was split; renumber "Next" |

No re-export from `packages/extract/src/index.ts`: the pattern there is that
`node/` readers (`readRoutes`, `readShapes`) are **not** re-exported while
`pair.ts`'s helpers are. Tests import the normaliser by relative path if they
need it directly.

Not touched, deliberately: `apps/cli` (verified — zero references to `routes` or
`shapes`; server-only is the convention for a fact type), `apps/server`,
`apps/web`. No UI in this phase.

## Verification

Four gates, the same set M9a and M9b were held to:

- `pnpm typecheck`
- `pnpm test` ← **load-bearing here**
- `PSQ_NO_CORPUS=1 pnpm test`
- `pnpm test:e2e` (expected unchanged — no UI in this phase)

`PSQ_NO_CORPUS=1` skips exactly the tests that catch the Express-registration and
warning-policy defects. A green hermetic run proves nothing about corpus-repo-e's
zero-warning contract. The corpus-on run is the gate that matters.

Additionally, and non-negotiably: **demonstrate the matcher can fail.** M9b's
lesson was that a green test proves nothing until it has been broken on purpose.
At minimum: break the normaliser so `:id` and `${id}` stop agreeing and show the
matched assertions go red; add a colliding route and show the ambiguity warning
fires with `matches` null; and remove the Express exclusion and show the fixture's
server routes appear as phantom self-matching calls.

## Out of scope, tracked

- **`route → table`** — the second link. Needs handler-body SQL/ORM tracing.
- **M5b: component attribution** — the 3-hop problem. Following imports from a
  component through hooks and service modules to a call site is the real work of
  "React clients", and where a call-graph walk belongs. Wrapper-function calls
  (`call<T>(...)`) are the same problem and should be solved with it.
- **M5c: API + UI** — an endpoint beside `/api/repos/:id/shapes`
  (`apps/server/src/app.ts:153-166`, which already returns `routes` and is the
  obvious home for `clientCalls`), and a UI surface. `DriftView`
  (`Dashboard.tsx:55`) is the precedent for rendering a linked pair; `RouteList`
  (`Dashboard.tsx:90`) is where routes already render. `apps/web/src/lib/api.ts:106`
  needs the mirrored field then.
- A C# route reader, without which corpus-repo-a can never participate.
- `baseURL` / prefix resolution; URL-by-concatenation.
