# MCP: flow + areas tools, call-following brief — audit

## What changed (all under `apps/mcp/`, plus this record)
- `src/flow.ts` (new): `findFlow`, `flowView`, `reachedEntities`, `areasView`, caps in `FLOW_CAP`.
  Shared by the tools and the brief.
- `src/tools.ts`: tools `flow {repo, route? | handler?{type,method}, maxDepth?}` and `areas {repo}`.
  `flow` takes exactly one of route/handler, and errors on none, both, an unknown route,
  an unknown method, or a method declared in several files (then pass `route`).
  Each hop carries the declaration `file:line`, the call-site line (`calledAt`, from `graph.calls`),
  the path, entities mentioned, `ambiguous`, and the per-method unresolved count. `truncated` covers
  depth and the 200-hop cap; `truncatedByDepth` and `omittedNodes` say which.
- `src/brief.ts`: Flow section rebuilt on `routeFlow`: entities with depth and via-method,
  ambiguous marked, entity-bearing routes first (count desc, then method+path), counted summary lines
  worded by handler kind (`<inline>` vs named; no "likely delegate" claim), the call-resolution
  blind-spot line with the unresolved count, and a "no call edges" line for graphs without `calls`.
  New "Feature areas" section (areas, shared entities, cross-area edges with citations, unassigned
  counts). It sits after Client-call wiring, so the existing Flow slices stay clean.
  `renderBrief` renders at scale 1 and re-renders with every cap scaled (0.5, 0.25, 0.1) until it is
  within `BRIEF_BUDGET` (20,000 chars), saying so in the brief.
- `src/common.ts`: `blindSpots` gains the call-resolution line when the graph has `calls` (shows in
  the `warnings` tool too).
- Tests: new `apps/mcp/test/flow.test.ts` (12 tests). `tools.test.ts`: three assertions' wording
  updated (the old "touching no entity directly — they likely delegate to services" and "no handler
  mentions an entity directly" strings are intentionally gone).
- Outside "Files touched": only `feature-research/mcp-flow-areas/*`, as the task requires.

## Gates
- `pnpm typecheck`: pass.
- `pnpm test`: 49 files passed, 2 skipped; 616 passed, 58 skipped (corpus; `test/corpus.local.json`
  absent, so this equals the `PSQ_NO_CORPUS=1` run). apps/mcp: 60 tests (was 48).
- No new extraction warnings: no extractor was touched.

## Mutants (each applied alone, run `pnpm test apps/mcp`, reverted; revert confirmed by the full green run)
| # | Mutant | RED tests |
|---|---|---|
| M1 | brief calls `routeFlow(..., {maxDepth: 0})` (call-following off) | brief Flow: entity reached only through a service call |
| M2 | `reachedEntities` always `ambiguous: false` | flow tool: ambiguous edges and truncation; brief Flow: entity via service call |
| M3 | budget loop breaks after the first render | brief Flow: stays under the character budget |
| M4 | `flowView` `truncated: false` | flow tool: ambiguous/truncation; flow tool: caps hops |
| M5 | `touches-entity` evidence cites dropped | areas: cross-area edges with citations; brief Feature areas section |
| M6 | inline-handler count forced to 0 | brief Flow: words routes by handler kind |
| M7 | hop cap 200 -> 2000 | flow tool: caps hops |
| M8 | `calledAt` always null | flow tool: chain with file:line per hop |
| M9 | Feature areas section never rendered | brief Feature areas section |

## Open questions / limits
- `areasFor` joins entities to areas by DIRECT handler mentions only (graph package, out of scope). A
  service-only entity (Gadget) therefore does not appear under the gadgets area and no cross-area
  edge is drawn for it. The brief and tool both say so. Feeding flow-reached entities into areas would
  mean synthesising refs; I did not, to keep derived facts marked as derived. Worth a graph-level option.
- The 20k budget was proven on a synthetic 400-route / 300-entity fixture, not on a real large repo
  (no corpus here). The trimmed brief's hot-spot and warning lists scale by count, not length.
- `flow` by `handler` cannot disambiguate a same-named type+method in two files; it errors and asks for `route`.
- Per-route `routeFlow` is recomputed for every handler route on each brief render (it rebuilds the
  call index each time); fine at fixture scale, unmeasured on a large repo.
