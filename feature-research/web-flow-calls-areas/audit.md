# web-flow-calls-areas — audit

## What changed
- **Server** (`apps/server/src/app.ts`): `GET /api/repos/:id/areas` (= `areasFor`) and
  `GET /api/repos/:id/flow?method=&path=[&depth=]` (= `routeFlow` per route with that exact key).
  Repo lookup before validation; params never coerced (repeated/blank -> 400); `depth` is a plain integer
  0..20 else 400; unknown route -> 200 `known:false, flows:[]`; handlerless route -> `flow:null`.
  Token gate inherited from the `/api` mount.
- **Web api** (`lib/api.ts`): `AreasResult`/`Area`/`AreaEdge`, `Flow`/`FlowNode`/`FlowStart`,
  `RouteFlowResult`, `api.areas`, `api.flow`.
- **View-model** (`lib/areas.ts`, NEW file under `apps/web/src`): `areaGroups`, `leadsTo`, `flowRows`,
  `flowCaveat`. It imports `routeKey` relatively (`./flow`), because a value import through the `@/` alias
  does not resolve under vitest.
- **View** (`views/Flow.tsx`, `views/Dashboard.tsx` passes `repoId`): left pane groups by area with
  "shared:" entities (with owner) and "leads to: <area> (kinds)" (evidence in the tooltip); an
  "(unassigned)" group when non-empty. If `/areas` fails, it falls back to the old directory/segment grouping
  and says so. Selecting a route adds a "Call chain" section: one row per hop with depth indent, `file:line`,
  an "ambiguous" badge, "mentions: entities", unresolved-call count, and a caveat line for truncation/ambiguity.
- `EntityGraph.calls` is NOT mirrored (chain is computed server-side), so the drift allowlist is unchanged;
  only its comment in `test/web-schema-drift.test.ts` was corrected.

## Gates
- `pnpm typecheck`: pass.
- `pnpm test` (corpus config absent, so corpus tests skip; the `PSQ_NO_CORPUS=1` prefix is not permitted by my
  shell, same effect here): 49 files passed | 2 skipped; 624 tests passed | 58 skipped. Counts as printed by
  the run, not restated elsewhere.
- New tests: `apps/server/test/api.test.ts` "areas and route flow" (8), `apps/web/test/areas.test.ts` (12).

## Mutants (each applied, targeted file run, reverted, GREEN afterwards)
| Mutant | Went RED |
|---|---|
| M1 `leadsTo` drops the `from` filter | 3 web tests (leadsTo x2, areaGroups leads-to) |
| M2 `routesOf` unsorted | "resolves raw route keys ... ordered" (first attempt survived: input was already sorted; test input reordered, then RED) |
| M3 unassigned group always emitted | "omits the unassigned group ..." |
| M4 `flowRows` ambiguity dropped | "keeps the flow's order ..." |
| M5 truncation caveat removed | "names truncation with its depth" |
| M6 shared-entity owner dropped | "lists shared entities with their owner ..." |
| M7 unknown component key kept | "drops a component key the graph does not hold ..." |
| S1 `known` always true | "answers an unknown route with 200 and known:false" |
| S2 depth cap removed | "400s on missing, blank, repeated or malformed params" |
| S3 `depth` not forwarded | "honours ?depth= and reports truncation" |
| S4 method case-folded | "answers an unknown route with 200 and known:false" |
| S5 `path` validation removed | "400s on missing, blank, repeated or malformed params" |

## Not covered / open questions
- `Flow.tsx` rendering has no test (no React renderer in the repo; `pnpm test:e2e` was forbidden). It was
  typechecked only and NOT exercised in a browser. The view logic that can be tested lives in `lib/areas.ts`.
- The server fixture used for areas (`mini-aspnet-routes`) has no shared entities or cross-area edges, so
  "shared"/"leads to" are covered only by synthetic data in the web tests, not end-to-end.
- Components in an area appear only if the graph holds them; the `/flow` call is one request per selected route.
- `/flow` accepts only route mode (method+path); a `type=&method=` start mode was not added.
- Files outside the list: none (`apps/web/src/lib/areas.ts` is new but inside `apps/web/src/**`).
