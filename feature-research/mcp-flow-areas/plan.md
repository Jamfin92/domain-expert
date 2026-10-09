# MCP: flow + areas tools, call-following brief — plan

## Approach
- New `apps/mcp/src/flow.ts`: shared views over `routeFlow`/`flowFor`/`areasFor`
  (hop citations, reached-entity depths, capped area summary, evidence citations).
  Tools and brief both call it, so the two cannot disagree.
- Tools `flow {repo, route? | handler?, maxDepth?}` and `areas {repo}` in `tools.ts`.
  Both capped, with `truncated`/`omitted` flags. Nothing is invented: a hop's
  cite is the declaration `file:line` the graph holds, plus the call-site line
  from `graph.calls`.
- Brief: Flow section re-rendered from `routeFlow` (entities with call depth,
  ambiguous edges marked, entity-bearing routes first, counted summary line,
  wording by handler kind: `<inline>` vs named). New "Feature areas" section from
  `areasFor` incl. cross-area edges. Blind-spot lines extended.
- Size: `renderBrief` renders at scale 1 and, if over ~20k chars, re-renders with
  all caps scaled down (deterministic), noting that it did.
- `areasFor` joins refs on handlers directly (no call-following); the section
  says so rather than synthesising refs.

## Files touched
`apps/mcp/src/{flow,tools,brief,common}.ts`, `apps/mcp/test/tools.test.ts`,
`apps/mcp/test/protocol.test.ts` (tool list, if it asserts one),
`feature-research/mcp-flow-areas/{plan,audit}.md`.

## Gates
`pnpm typecheck`; `PSQ_NO_CORPUS=1 pnpm test`. New tests, each proven by mutant:
flow tool returns controller→service→repository chain; brief Flow shows entity
reached only via a call; areas section/tool present; inline wording; size cap;
truncation and ambiguity flags.
