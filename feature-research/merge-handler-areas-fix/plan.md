# merge-handler-areas-fix — plan

(Written after the first implementation pass rather than before it; the approach below is what was done.)

## Approach
1. `packages/extract/src/merge.ts`: re-prefix `Route.handler.file`. Carry the node
   graph's `entityRefs`, `calls`, `unresolvedCalls` (the node reader emits none today)
   re-prefixed, instead of silently dropping them. The .NET side is already in the merge root.
2. `packages/graph/src/areas.ts`: component placement precedence becomes
   (a) majority area of matched client calls (tie: alphabetical area key), `placedBy: "calls"`;
   (b) only without matched calls, an area key equal to the component file's own directory
   or its parent (nearer wins), `placedBy: "folder"`; (c) unassigned.
   `Area.placedBy: Record<componentKey, "calls" | "folder">`. Fix the mis-indented `callsByComp`.

## Files touched
packages/extract/src/merge.ts, packages/extract/test/merge.test.ts,
packages/graph/src/areas.ts, packages/graph/test/areas.test.ts, this directory.

## Gates
`pnpm typecheck`, `PSQ_NO_CORPUS=1 pnpm test`; every new test proven RED by a mutant (see audit.md).
