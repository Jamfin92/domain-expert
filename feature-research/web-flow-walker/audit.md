# Web: Flow walker — audit

## What changed

- `apps/web/src/lib/flow.ts` (new, pure): component/route areas, call -> route
  resolution, reverse index, handler -> entities join on exactly `(type, method)`.
- `apps/web/src/lib/refs.ts` (new, pure): refs grouped file -> `type.method`;
  `refsState` keeps `known:false` (unknown), known-with-zero (none) and some as
  three distinct states.
- `apps/web/src/views/Flow.tsx` (new): areas list on the left; component view
  (calls -> routes, each a link) or route view (reached-from components/calls,
  handler, entities). Every hop shows `file:line` (editor-openable on desktop).
- `apps/web/src/components/EntitySearch.tsx` (new): the dashboard had NO search
  or refs UI. Search box -> hit -> refs panel. Refs follow the current selection,
  so diagram, search and flow clicks all drive it. "No hits" offers an explicit
  exact lookup, which is the path that can show `known:false`.
- `apps/web/src/views/Dashboard.tsx`: Overview / Flow tabs; search card at the
  top of the aside; "Show in graph" in the entity panel while on Flow. An entity
  click in the flow selects it in the existing side panel; the city/diagram
  highlight lives on the Overview tab, reached by that button (the overview card
  is unmounted, not hidden, on the Flow tab, to avoid zero-size WebGL/layout).
- `apps/web/src/lib/api.ts`: `EntityGraph` mirrors `routes` and `entityRefs`;
  new `EntityRef`, `RouteHandler`, `EntitySearchHit`, `EntityRefsResult`;
  `api.search`, `api.refs`; `Route.handler?` optional.
- `test/web-schema-drift.test.ts`: allowlist shrinks from four to two
  (`kind`, `shapes`); `WEB_FIELDS` gains `entityRefs`, `routes`. Parser untouched.
- `apps/web/test/{flow,refs}.test.ts` (new).

No file outside the "Files touched" list was edited.

## Route.handler and the pin

The pin parses only `export interface EntityGraph`'s top-level members, so it
does not inspect `Route` at all: `handler?` on the client `Route` is a
client-only, unpinned field (documented at its declaration). It is not forbidden
by the pin and it neither reddens nor is covered by it. When the schema gains
`Route.handler`, nothing will force a comparison of its shape; a follow-up could
extend the pin to `Route`. Not done here (would mean changing the parser).

## Gates

- `pnpm typecheck`: exit 0.
- `pnpm test` (no corpus config in this worktree, so corpus tests skip):
  433 passed, 58 skipped, 1 failed (492 total). New tests: 10 (flow) + 3 (refs).
  The 1 failure is `test/seed-parity.test.ts` case 2 ("old repo-path default
  really did build a different bank"). It compares `hashSeed(g.repo)` where
  `g.repo` is the absolute fixture path, so I believe it is path-dependent and
  collides in this worktree's path. My diff touches no extract/quiz code or
  fixture. I could NOT confirm it on a clean `master` (my shell may not stash or
  check out), so this is unverified. Please re-run on master.
- `PSQ_NO_CORPUS=1 pnpm test` could not be run as written: the env-var prefix is
  not on my permitted command list. The corpus config is absent, so the corpus
  tests skip identically (58 skipped).
- `pnpm test:e2e` never run.

## Mutants (each applied, suite run on apps/web/test + the drift pin, reverted)

Harness lived outside the repo. All 13 went RED:

| # | mutant | failing tests |
|---|---|---|
| M1 | handler join drops `method` | entitiesOfHandler: exact join; absent-handler |
| M2 | handler join drops `type` | entitiesOfHandler: exact join |
| M3 | absent handler returns `[]` not `null` | entitiesOfHandler: absent handler |
| M4 | route resolution by path only | resolveRoutes exact key; callsOfComponent |
| M5 | reverse index owners not deduped | buildReverseIndex deduped owners |
| M6 | reverse index calls unsorted | buildReverseIndex deduped owners |
| M7 | root dir label `""` | componentAreas |
| M8 | first segment = last segment | routeAreas |
| M9 | `known:false` reads as none | refsState three states |
| M10 | group refs ignoring type | groupRefs same-named methods |
| M11 | web mirror drops `routes` | pin 2, pin 3 |
| M12 | web mirror adds phantom field | pin 2, pin 4 |
| M13 | web mirror adds `shapes` (gap narrows) | pin 2, pin 3 |

## Not covered / open questions

- No component render tests: the repo has no DOM environment or testing library
  (vitest runs `node`) and adding one is a dependency change. The components are
  thin renderers over the tested modules; their behaviour is typechecked but not
  rendered by any test. Not browser-verified (e2e forbidden).
- `ClientCall.matches` can point at a route key two routes share; both are shown.
- Entities shown for a handler are mentions, not calls (labelled as such).
- Real graphs: per prior records, no corpus graph yet has both routes and calls,
  so the call -> route hop and the handler hop are exercised only by unit tests.
- Search results for a Node repo carry no refs (refs are C# only today); the
  panel then reads "known entity, zero mentions".
