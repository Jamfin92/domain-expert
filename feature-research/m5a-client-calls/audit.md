# M5a — client call facts: implementation audit

## Files changed

- `packages/schema/src/index.ts` — modified
- `packages/extract/src/node/clients.ts` — **new**
- `packages/extract/src/node/routes.ts` — modified
- `packages/extract/src/node.ts` — modified
- `packages/extract/src/dotnet.ts` — modified
- `packages/extract/src/detect.ts` — modified
- `packages/graph/test/layout3d.test.ts` — modified
- `test/fixtures/mini-fullstack/server.ts` — **new**
- `test/fixtures/mini-fullstack/client.ts` — **new**
- `test/fixtures.ts` — modified
- `test/mini-fullstack.test.ts` — **new**
- `README.md` — modified

All are on the plan's "Files touched" list. `packages/extract/test/node.test.ts`
was verify-only per the plan and needed no edit (contracts at :93 and :127 hold
under the corpus-on run). `packages/extract/src/index.ts` untouched — no
re-export, per the plan.

## What changed per file

- **`packages/schema/src/index.ts`** — added `ClientCall` beside `Route`,
  exactly the plan's zod object, with a catalogued miss list in the block
  comment (wrapper functions incl. this repo's `call<T>()`, concatenated URLs,
  non-literal URLs, baseURL-relative calls, express-importing files skipped
  whole). Added `clientCalls: z.array(ClientCall)` to `EntityGraph`. Updated
  the `routes` field comment ("Facts only until M5" → "Facts only; questions
  are M5b+") and noted `clientCalls` matches against `routes`.
- **`packages/extract/src/node/clients.ts`** (new) — module-local
  `CLIENT_METHODS` (the seven verbs, no `"all"`; comment explains the
  `axios.all` trap), `readClientCalls(root, sources, warnings)` and
  `linkCalls(routes, calls, warnings)`. Detection: callee is global `fetch`
  (GET unless an options object literal carries a string-literal `method`) or
  a property access named in `CLIENT_METHODS` with any receiver; first arg is
  a string/template literal whose result starts with `/`; `${}` holes become
  `*`; query string split at `?` and dropped; concatenation
  (BinaryExpression) rejected. Both Express guards: files where
  `importsExpress(source)` is skipped whole, and calls whose second argument
  is an arrow, function expression, or bare identifier are rejected.
  `enclosing` is the nearest named FunctionDeclaration / method / named
  function expression / arrow-or-fnexpr assigned to a named variable, else
  null. No warnings except the ambiguity case in `linkCalls`, worded after
  `pairShapes` ("… could match A or B; not matched"). Output sorted by file
  then line.
- **`packages/extract/src/node/routes.ts`** — `importsExpress` now exported.
  That one helper only; `METHODS` stays module-local.
- **`packages/extract/src/node.ts`** — `extractNode` calls
  `linkCalls(routes, readClientCalls(...), warnings)` after `readRoutes` and
  attaches `clientCalls` to the returned graph.
- **`packages/extract/src/dotnet.ts`** — `clientCalls: []` at **both**
  literals (the no-context early return and the main return).
- **`packages/extract/src/detect.ts`** — `clientCalls: []` in the `"none"`
  branch.
- **`packages/graph/test/layout3d.test.ts`** — `clientCalls: []` in the
  `graph()` helper, fixed despite being outside the typecheck program.
- **`test/fixtures/mini-fullstack/`** (new) — `server.ts`: imports express,
  carries a `CREATE TABLE items` literal (so the no-DDL warning at
  node.ts:91-96 cannot fire), registers 4 routes inside `createApp()`.
  `client.ts`: no express import, no axios, `.ts` not `.tsx`, compiles under
  the root strict config (`fetch`/`Response` come from `@types/node`). Covers
  every case the plan lists: bare `fetch` (GET default), `fetch` with explicit
  `method`, hand-rolled `api.get`/`api.post`, template-literal path matching a
  `:id` route, query-string path at module scope (also the `enclosing: null`
  case), an unmatched call, a runtime-URL `fetch(url)` (silent), a
  concatenated URL (silent), and a `Map.get`/`Map.set` decoy (silent).
- **`test/fixtures.ts`** — added `MINI_FULLSTACK` with a comment on why the
  fixture is the only gate.
- **`test/mini-fullstack.test.ts`** (new) — exact `toEqual` on all six
  `clientCalls` (matched and unmatched, enclosing names, normalised paths),
  exact `toEqual` on the 4 routes, `warnings` exactly `[]`, no call attributed
  to `server.ts`, and the `items` entity read from the DDL.
- **`README.md`** — status row split into M5a (done) / M5b (planned); "Next"
  item 1 now points at M5b.

## Deviations from the plan

None in behaviour or scope. Two notes:

1. `readClientCalls` takes the plan's `(root, sources, warnings)` signature
   but names the third parameter `_warnings`, since the reader itself never
   warns (only `linkCalls` does). Signature parity kept, unused-param intent
   made visible.
2. Like `readRoutes` and `collectDdl`, `readClientCalls` skips
   `isTestFile(rel)` sources. The plan says "same inputs as `readRoutes`";
   I read that as including the same test-file skip, and a call site in a
   target repo's test file is not a fact about its client. Flagging it in
   case the orchestrator reads "same inputs" more narrowly.

## Gate results (final code, falsifications reverted)

- `pnpm typecheck` — **pass** (root tsc, e2e tsc, @psq/web, @psq/desktop all
  clean; re-run after the falsification reverts, still clean).
- `pnpm test` (corpus on) — **pass**: `Test Files 14 passed (14)`,
  `Tests 211 passed (211)`. Includes `test/mini-fullstack.test.ts (4 tests)`,
  `test/mini-node.test.ts (24)`, `packages/extract/test/node.test.ts (15)` —
  the corpus repo E zero-warning contract and 6-route count ran and held.
- `PSQ_NO_CORPUS=1 pnpm test` — **pass**:
  `Tests 156 passed | 55 skipped (211)`, `10 passed | 4 skipped` files.
- `pnpm test:e2e` — **pass**, unchanged: `Tests 19 passed (19)`, ~23s.

## Falsification exercises (all performed, all reverted)

1. **Broken normaliser** — `normaliseRoutePath` changed to the identity so
   `:id` and `${id}` stop agreeing. Observed:
   `× records each call site, matched or not, and nothing else` went red
   (`AssertionError: expected [...] to deeply equal [...]`; the diff shows the
   `itemById` call's `matches` dropping to null because `/api/items/*` no
   longer equals `/api/items/:id`). Reverted; test green again.
2. **Colliding route** — added `app.get("/api/items/:slug", ...)` to the
   fixture server. Observed 3 of 4 tests red, including the zero-warning
   contract, with exactly the predicted warning:
   `client.ts:32: GET /api/items/* could match GET /api/items/:id or GET /api/items/:slug; not matched`
   and the `itemById` call left with `matches: null`. Reverted.
3. **Express exclusion removed** — two-step finding:
   - Removing **guard 1 only** (the `importsExpress` file skip) left the
     fixture **green**: every registration in `server.ts` has an arrow
     handler as its second argument, so guard 2 rejects them all. On this
     fixture the guards are redundant; guard 1 is still doing real work for
     registrations guard 2 cannot see (e.g. `app.get("/x", handlers[0])`, or
     any second argument that is neither a function literal nor a bare
     identifier), and the plan requires both.
   - Removing **both guards** produced the predicted red: 10 client calls
     instead of 6, with phantom self-matching facts from `server.ts` —
     e.g. `{ file: "server.ts", line: 22, method: "GET", path: "/health",
     matches: "GET /health", enclosing: "createApp" }` — and both the
     "never as client calls" and exact-list assertions failing.
   Both edits reverted; full suite re-run green (211/211).

## Open risks / things the plan got wrong

- Nothing the plan asserts turned out wrong. One nuance worth recording: the
  plan's falsification 3 predicts phantom calls from removing "the Express
  exclusion"; on this fixture that requires removing **both** guards, because
  the handler-argument guard independently covers arrow-handler
  registrations (see above). The fixture therefore does not pin guard 1 in
  isolation.
- Rule 2 remains a stated heuristic: `params.get("/anything")` on a
  non-HTTP receiver whose argument starts with `/` would be recorded. No such
  construct exists in the fixture or corpus today.
- `apps/web/src/lib/api.ts`'s hand-written graph mirror drifts until M5c, as
  the plan accepts.
- The working tree also carries pre-existing uncommitted M9a/M9b work; I did
  not touch it and made no git state changes.

## Review fixes (B1, B2, B3)

All files touched by the fixes were already on the "Files changed" list above:
`packages/extract/src/node/clients.ts`, `packages/schema/src/index.ts`,
`test/fixtures/mini-fullstack/server.ts`,
`test/fixtures/mini-fullstack/client.ts`, `test/mini-fullstack.test.ts`.
No new files; no other files modified.

### B1 — guard 1 now pinned in isolation

`server.ts` gained a `wrap(handler)` helper and `/health` is now registered as
`app.get("/health", wrap((_req, res) => {...}))` — the second argument is a
CallExpression, the shape psq's own `apps/server/src/app.ts` uses, which
guard 2 cannot reject. `readRoutes` never inspects the handler argument, so
the route facts are unchanged apart from line numbers (route lines in the
test updated: /health 33, /api/items 37, /api/items/:id 41, POST /api/items
45). A comment in the test names the pin.

### B2 — guard 2 narrowed to the reviewer's rules

- Property-access calls (`api.post`, `axios.get`): recorded regardless of the
  second argument — the method comes from the property name — EXCEPT when
  that argument is an inline ArrowFunction/FunctionExpression or an array
  literal containing one (middleware chain). New `isRegistration()` helper;
  the bare-identifier rejection is gone.
- Bare `fetch(url)`: GET, as before.
- `fetch(url, {object literal})`: literal `method` wins; GET when no `method`
  key; **skipped** when the literal has a spread or a non-literal `method`
  value (`fetchMethod` now returns `string | null`; null = skip). The
  non-literal-`method`-value skip is a small extension of the reviewer's
  rules in the same spirit: `{ method: m }` is as unknowable as `init`.
- `fetch(url, X)` for any non-object-literal X: skipped, never defaulted.

New fixture cases in `client.ts`, all pinned by the exact-list test:
- `replaceItems`: `api.post("/api/items", body)` with an identifier body —
  recorded, POST, matches `POST /api/items` (client.ts:63).
- `withInit`: `fetch("/api/orders", init)` with an identifier init — absent
  from the list, with a comment in the test naming the deliberate absence
  (client.ts:71).
- `registerLocal`: a `bus.get("/local/route", () => {})` registration-shaped
  call in a file with no express import — absent; this is the case that pins
  guard 2 in isolation, which the fixture previously could not do at all
  (the old guard-2 pin rode on the identifier rejection that B2 removed).

The skipped-fetch case was added to the catalogued miss list on the
`ClientCall` schema comment.

### B3 — `path` doc comment corrected

Now reads: "The call's path as written, with ${} holes as * and any query
string dropped. Route :params are normalised to * at match time only; a
literal `:id` in a call path is stored verbatim."

Nothing else the review raised was touched — trailing slashes, fragments,
`enclosing` edges, mount prefixes, type-only-import widening all deferred to
M5b per the orchestrator.

### Gates (final code, all falsifications reverted)

- `pnpm typecheck` — pass (root, e2e, @psq/web, @psq/desktop).
- `pnpm test` (corpus ON) — pass: `Test Files 14 passed (14)`,
  `Tests 211 passed (211)`; mini-fullstack, mini-node, and the corpus repo E
  contracts all ran.
- `PSQ_NO_CORPUS=1 pnpm test` — pass: `Tests 156 passed | 55 skipped (211)`.
- `pnpm test:e2e` — pass: `Tests 19 passed (19)`.

### Falsifications re-run

1. **Normaliser → identity**: `records each call site…` red
   (1 failed | 3 passed); `itemById`'s match dropped. Reverted.
2. **Colliding `/api/items/:slug` route**: 3 failed | 1 passed, with exactly
   `client.ts:32: GET /api/items/* could match GET /api/items/:id or GET /api/items/:slug; not matched`.
   Reverted.
3. **Two independent parts, each guard removed ALONE:**
   - **Guard 1 removed alone** (the `importsExpress` file skip): 2 failed |
     2 passed — the wrapped `/health` registration surfaced as the phantom
     `{ file: "server.ts", line: 33, method: "GET", path: "/health",
     enclosing: "createApp", matches: "GET /health" }`. This is the B1 fix
     working: the suite previously stayed green here.
   - **Guard 2 removed alone** (`isRegistration`): 1 failed | 3 passed —
     phantom `GET /local/route` from the `bus.get` registration decoy.
   Both reverted; all four gates re-run green afterwards.

### corpus repo A probe (not a test)

`extractNode` over corpus repo A's client now finds **50 client calls**
(previously the service-module calls with identifier bodies were dropped).
Spot-checked examples: a POST recorded from a service module — the reviewer's
exact counter-example, now recorded — plus a login POST, a PUT with one
wildcard segment, and a GET whose path nests two wildcard segments, each read
from a service module three hops from the component that uses it.

All `matches: null`, as expected — corpus repo A's backend is C# and produces
no route facts. The extraction's single warning is the pre-existing
no-CREATE-TABLE notice, not from the client reader. No corpus test added,
per instruction.

## Review fixes, round 2 (fetchMethod key forms + parenthesis unwrap)

Files touched this round (all already on the "Files changed" list above):
`packages/extract/src/node/clients.ts`, `packages/schema/src/index.ts`,
`test/fixtures/mini-fullstack/client.ts`, `test/mini-fullstack.test.ts`.

### BLOCKING — `fetchMethod` no longer fabricates GET on non-identifier keys

The loop previously recognised `method` only under `ts.isIdentifier(prop.name)`;
every other key form fell through to the trailing `return "GET"`. Rewritten so
the loop classifies each property before deciding:

- Spread: null (unchanged).
- Any `ComputedPropertyName`: null — the key could be "method" for all the
  reader can prove, so the whole literal is unknowable. (This is slightly
  broader than "a computed `method` key": a computed non-literal key such as
  `[k]: v` cannot be ruled out as `method` either, so any computed key skips.)
- Key text is read from an identifier OR a string-literal name, so
  `{ "method": "POST" }` now correctly returns POST.
- A `method` key whose property is not a PropertyAssignment with a
  string/no-substitution-template literal value returns null. This covers the
  shorthand `{ method, body }` wrapper-forwarding case, non-literal values
  (unchanged), and the degenerate `{ method() {} }` member.
- Anything else (`headers:`, `body:`, a numeric key) continues; no `method`
  key at all is still GET.

Verified against a throwaway probe repo: `{ method, body }` skipped,
`{ ["method"]: "POST" }` skipped, `{ "method": "POST" }` recorded as POST,
`{ method() {} }` skipped.

New fixture cases appended to `client.ts` (appended, so no existing line
numbers moved): `forward` at client.ts:99 (`{ method, body }` shorthand —
ABSENT from the exact-list test, with a comment naming the absence) and
`quotedKey` at client.ts:104 (`{ "method": "POST" }` — recorded, matches
`POST /api/items`, now the last entry in the expected list).

### Cheap item 1 — `isRegistration` unwraps parentheses

`inlineFn` now strips `ParenthesizedExpression` layers before testing for an
arrow/function expression, so `router.get("/wrapped", (() => {}))` is rejected
as a registration. Doc comment updated. Verified in the same probe repo: the
parenthesized-handler call is absent.

### Cheap item 2 — two `ClientCall` miss-list additions (schema)

- The `fetch(url, init)` bullet now also names the computed-property-key skip
  and the shorthand `{ method, body }` skip, so the bullet is exhaustive again.
- A new paragraph catalogues the false-positive class guard 2's narrowing
  opened: in a file with no express import, a router-shaped registration with
  identifier extra arguments (`router.get("/users", authenticate, listUsers)`,
  `router.get("/things", ctrl.list)`) is recorded as a client call; it can
  only ever sit unmatched because `readRoutes` skips the same shapes, but the
  record is a guessed fact and the comment now says so.

### Deviations

None beyond those noted inline: the computed-key skip applies to ANY computed
key rather than only a provably-"method" one (strictly more conservative —
never fabricates), and only the two fixture cases the reviewer named were
added (the computed-key and method-member cases are pinned by the probe, not
the fixture, to keep the fixture noise down).

### Gates (final code, all falsifications reverted)

- `pnpm typecheck` — pass (root, e2e, @psq/web, @psq/desktop).
- `pnpm test` (corpus ON) — pass: `Test Files 14 passed (14)`,
  `Tests 211 passed (211)`.
- `PSQ_NO_CORPUS=1 pnpm test` — pass: `Tests 156 passed | 55 skipped (211)`.
- `pnpm test:e2e` — pass: `Tests 19 passed (19)`.

### Falsifications re-run (all red, all reverted, gates green after)

1. Normaliser → identity: 1 failed | 3 passed; `itemById`'s match dropped.
2. Colliding `/api/items/:slug` route: 3 failed | 1 passed, with exactly
   `client.ts:32: GET /api/items/* could match GET /api/items/:id or GET /api/items/:slug; not matched`.
3. Guard 1 removed ALONE (`importsExpress` skip): 2 failed | 2 passed —
   phantom self-matching `GET /health` from server.ts surfaced.
   Guard 2 removed ALONE (`isRegistration` short-circuited to false):
   1 failed | 3 passed — phantom `GET /local/route` from the `bus.get` decoy.
   The parenthesis unwrap unpinned neither guard.
4. NEW — shorthand skip reverted (shorthand properties made to fall through
   to the GET default): 1 failed | 3 passed — the fabricated
   `GET /api/orders` from `forward` appeared in the diff. The fixture is
   failable.

### Corpus probes re-run (not tests)

- `corpus repo A/client`: still **50 client calls** — unchanged, as the
  spot-checked service-module calls use `api.<verb>` property access, not
  bare fetch, so the fetchMethod rewrite does not touch them. All
  `matches: null`; the single warning is the pre-existing no-CREATE-TABLE
  notice.
- domain-expert, corpus repo D, corpus repo C, corpus repo E: 0 client calls each and
  0 client-reader warnings (the only warning `linkCalls` can emit is the
  ambiguous-match "could match"; none present). Each repo's total warnings
  are the pre-existing schema/DDL notices (8 / 2 / 1 / 0), untouched by this
  round.

Not committed.

## Review fixes, round 3 (M5a final — spread/computed guard hoisted)

### Files changed this round

- `packages/extract/src/node/clients.ts` — modified
- `test/fixtures/mini-fullstack/client.ts` — modified (appended only)
- `test/mini-fullstack.test.ts` — modified (comments only)

### BLOCKING — spread-last / computed-last no longer fabricate GET

`fetchMethod` returned at the first `method` key reached, so its per-property
spread and computed-key guards never examined anything positioned after it:
`{ method: "GET", ...opts }` and `{ method: "GET", [k]: v }` were both
recorded as GET — a fabricated method that even matched the real
`GET /api/items` route.

Fix, per the reviewer's exact prescription — the check hoisted above the loop
in `fetchMethod` (`clients.ts:88`):

```ts
if (opts.properties.some((p) => ts.isSpreadAssignment(p) || (p.name && ts.isComputedPropertyName(p.name)))) return null;
```

and the two now-redundant per-property guards deleted from the loop body. No
comment amendments: the function doc at :74-82 and the schema miss list were
already written as if the check were positional-independent; the hoist makes
them true as written.

### Deviation (type-level only)

Deleting `if (ts.isSpreadAssignment(prop)) return null;` also deleted the
narrowing that made `prop.name` non-optional for the rest of the loop, so
`pnpm typecheck` failed (TS2345 at :91: `PropertyName | undefined` not
assignable to `Node`). Minimal accommodation: the `key` computation now reads

```ts
prop.name && (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name))
```

This is type-only, not a behavior guard — the sole nameless member kind is a
spread, which the hoist has already returned null on before the loop runs.

### Fixture + pin

- `test/fixtures/mini-fullstack/client.ts` — two cases APPENDED (no existing
  line moved): `spreadLast` at :113 (`{ method: "GET", ...opts }`) and
  `computedLast` at :122 (`{ method: "GET", [k]: v }`).
- `test/mini-fullstack.test.ts` — two ABSENT-on-purpose comments added beside
  the existing ones in the `records each call site` assertion. The `toEqual`
  is exhaustive, so the appended calls appearing in `clientCalls` turns the
  test red — no new expected entries needed.

### Falsification (performed, reverted)

Hoist reverted to the old in-loop guards: `pnpm vitest run
test/mini-fullstack.test.ts` went red — the diff showed the two fabricated
entries, `spreadLast` (client.ts:113) and `computedLast` (client.ts:122),
both `method: "GET"` and both `matches: "GET /api/items"`. Hoist restored.

### Gates (final code, falsification reverted)

- `pnpm typecheck` — clean (all four tsconfig passes).
- `pnpm test` with corpus ON — 14 files, 211 tests, all green.

### Corpus probes re-run (not tests)

- `corpus repo A/client`: still exactly **50 client calls**, all
  `matches: null`, 1 warning (the pre-existing no-CREATE-TABLE notice) —
  identical to round 2.
- domain-expert / corpus repo D / corpus repo C / corpus repo E: **0 client calls**
  each; warnings 8 / 2 / 1 / 0 — identical to round 2.

Not committed.
