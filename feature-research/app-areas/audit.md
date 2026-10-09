# app-areas — audit

## What changed
- `packages/graph/src/areas.ts` (new): `areasFor(graph)` and `areaSegment(path)`.
  Precedence and edge definitions are in the file's header comment and plan.md.
- `packages/graph/src/index.ts`: one export line.
- `packages/graph/test/areas.test.ts` (new): hand-built graphs plus one extracted
  fixture (`mini-aspnet-routes`).
- No extraction, schema, or other-file changes. No new warnings (no extraction touched).

## Decisions worth a reviewer's eye
- Parameter-looking segments (`:id`, `{id}`, `*`) are skipped like `api`/versions,
  so `/api/{id}/orders` is "orders". `/health` and `/api/ping` therefore become
  areas "health" and "ping" — single-route areas; caps/merging are the caller's job.
- Component home: directory-name match against an existing route-basis area key
  first, else plurality of matched calls. The directory match is a name join, not a
  graph fact; a component homed by it is not marked as such in the output (open question).
- Entity owner = area with most joined refs, ties alphabetical key. Refs are
  mentions, not calls (see `EntityRef` docs), so "touches" means "mentions".
- `unassigned` has routes, components, entities. There is no unassigned-handlers
  bucket: a handler is only reachable through a route, and a route with a handler
  always gets an area via the dir fallback.

## Gates
- `pnpm typecheck`: clean.
- `pnpm test` (corpus tests skip regardless; 58 skipped): 44 files passed, 2 skipped,
  557 passed, 58 skipped. One earlier run showed an unrelated 5s timeout in
  `apps/server/test/api.test.ts` under machine load; the re-run passed.
  (The `PSQ_NO_CORPUS=1` prefix was refused by the sandbox in this session;
  the local corpus file is absent, so the result is the same.)
- `pnpm test:e2e` not run (forbidden).

## Mutants (applied to areas.ts, reverted, full suite re-run)
| mutant | result | failing tests |
|---|---|---|
| drop the `api` skip in `areaSegment` | RED, 8 failed | segment test, partition x3, shared, both edge tests, fixture |
| drop the version skip | RED, 8 failed | same set |
| calls-route edge loop iterates nothing | RED, 1 failed | "component in A calling a route in B is an edge" |
| touches-entity edge condition never true | RED, 1 failed | "handler in A touching an entity owned by B is an edge" |
| shared threshold `> 1` -> `> 9` | RED, 1 failed | "an entity touched by two areas is shared in both..." |

All reverted; final tree GREEN.

## Open questions
- Should `Area` carry per-component basis (dir vs calls)? Not added: spec fixes the shape.
- Express routes have no `handler`, so entity/handler content is .NET-only today.
