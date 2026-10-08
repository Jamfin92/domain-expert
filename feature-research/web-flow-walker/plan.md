# Web: Flow walker — plan

## Approach

A "Flow" tab on the dashboard: area -> client call -> route -> handler -> entities.
Every join is made client-side from facts the graph already carries; nothing is
inferred.

- `ClientCall.matches` is `"${route.method} ${route.path}"` (`clients.ts`), so
  call -> route is an exact string key. A `matches` that resolves to no route is
  shown as unresolved, never guessed.
- Reverse index: route key -> the calls (and their components) that match it.
- Handler -> entities: `Route.handler` is OPTIONAL (another task adds it for
  .NET). Entities are `entityRefs` joined on exactly `(type, method)`. Absent
  handler renders "handler unknown (psq cannot see this route's handler)".
  A handler with no matching refs reads differently from an unknown handler.
- Search + refs: the dashboard has neither. Add a search box (`/search`), select
  a hit, refs panel (`/refs`) grouped by file then method. `known:false`
  renders as "not an entity psq knows", distinct from zero refs.
- Entity click in the flow selects the entity in the existing side panel; a
  "show in graph" button flips to the Overview tab where the city/diagram
  highlight already lives.

## api.ts mirrors

- `EntityGraph` gains `routes` and `entityRefs` (both are on the `/graph` wire).
  The drift pin's allowlist shrinks from four to two (`kind`, `shapes`).
- `Route.handler?` declared optional on the client `Route`. The pin parses only
  `interface EntityGraph`, so `Route` is not pinned; the client-only field is
  recorded in the audit. Parser untouched.
- New `EntityRef`, `RouteHandler`, search/refs response types.

## Files touched

- `apps/web/src/lib/api.ts`, new `apps/web/src/lib/flow.ts` (pure joins),
  new `apps/web/src/lib/refs.ts` (pure grouping)
- new `apps/web/src/views/Flow.tsx`, `apps/web/src/components/EntitySearch.tsx`,
  edit `apps/web/src/views/Dashboard.tsx`
- `apps/web/test/flow.test.ts`, `apps/web/test/refs.test.ts`
- `test/web-schema-drift.test.ts`
- `feature-research/web-flow-walker/{plan,audit}.md`

## Gates

- flow.test.ts / refs.test.ts: unit tests of the pure logic, each with a mutant.
- web-schema-drift: allowlist updated; mutants = drop a mirrored field, add a
  phantom one.
- No DOM harness exists in the repo (node env, no jsdom/testing-library) and
  adding a dependency is out of scope, so "component tests" are the pure
  view-model modules the components render from. Recorded in the audit.
- `pnpm typecheck`, `PSQ_NO_CORPUS=1 pnpm test`.
