# web-flow-calls-areas — plan

## Approach
Option (a): the logic stays in `@psq/graph`; the server exposes it; `apps/web` (no workspace deps) consumes it.

- `GET /api/repos/:id/areas` -> `areasFor(graph)` as-is.
- `GET /api/repos/:id/flow?method=&path=[&depth=]` -> `routeFlow` for every route with that exact method+path.
  Guard order copies /refs: repo lookup (404) before validation (400); params never coerced (repeated -> 400);
  unknown route is a 200 with `known:false`, never a 404. `depth` must be a plain non-negative integer
  string (<= 20) or 400. Body: `{ method, path, known, flows: [{ route:{file,line}, flow: Flow|null }] }`;
  `flow: null` = the route has no handler (unknown, not "touches nothing").
- Web: `api.areas` / `api.flow` + mirrored types (`AreasResult`, `Flow`...). `EntityGraph.calls` is NOT
  mirrored (flow is computed server-side), so the drift allowlist stays; only its comment is corrected.
- `lib/flow.ts` gains pure view-model helpers: `areaView` (area list with shared entities, "leads to"
  from edges, route lookup by raw key) and `flowRows` (depth indent, loc, ambiguous mark, entities).
  `Flow.tsx` left pane groups by areas; right pane shows the call chain for a selected route.

## Files touched
apps/server/src/app.ts, apps/server/test/api.test.ts, apps/web/src/lib/api.ts, apps/web/src/lib/flow.ts,
apps/web/src/views/Flow.tsx (+ App.tsx only if the props need it), apps/web/test/flow.test.ts,
test/web-schema-drift.test.ts (comment only), feature-research/web-flow-calls-areas/*.

## Gates
`pnpm typecheck`, `PSQ_NO_CORPUS=1 pnpm test`; new tests each proven RED by a mutant (recorded in audit.md).
