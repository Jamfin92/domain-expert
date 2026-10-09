# app-areas — plan

## Approach
`areasFor(graph)` in `packages/graph/src/areas.ts`: pure, deterministic, graph-only
(no re-parsing, no inference beyond joins on fields the graph already holds).

Precedence:
1. Route -> area by the first path segment that is not `api`, a version (`v1`, `v2.0`)
   or a parameter (`:id`, `{id}`, `*`). Key is lowercased. basis `route`.
2. A route with no such segment but with a `handler` -> area `dir:<handler dir>`,
   basis `handler-dir`. Neither -> `unassigned.routes`.
3. Handlers ride their route's area (deduped on type+method+file).
4. Components: home area = an area key that equals a directory segment of the
   component file (last match wins), else the area of most matched client calls
   (ties: alphabetical key), else `unassigned.components`.
5. Entities: touched by an area when an `entityRef` joins a handler of that area on
   type+method+file. Touched by 2+ areas -> `sharedEntities` in each. Owner = area
   with most refs (ties: alphabetical key); owner decides cross-area edges.

Cross-area edges (aggregated per kind/from/to, evidence sorted):
- `calls-route`: component homed in A has a client call matching a route in B != A.
- `touches-entity`: handler in A mentions an entity owned by B != A.

Ordering: areas by key, every list sorted. Caps are the caller's job.
No extraction or schema changes; no Math.random.

## Files touched
- packages/graph/src/areas.ts (new)
- packages/graph/src/index.ts (export line)
- packages/graph/test/areas.test.ts (new)
- feature-research/app-areas/{plan,audit}.md

## Gates
`pnpm typecheck`; `PSQ_NO_CORPUS=1 pnpm test`; mutants proven RED for segment
skipping, cross-area edge detection, shared-entity detection (see audit.md).
