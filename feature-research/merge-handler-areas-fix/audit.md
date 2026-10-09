# merge-handler-areas-fix — audit

## What changed
- `packages/extract/src/merge.ts`: `Route.handler.file` is re-prefixed with `Route.file`.
  The node graph's `entityRefs`, `calls` and `unresolvedCalls` were previously dropped
  silently; they are now carried, re-prefixed (`EntityRef.file`, `Call.from/to.file`,
  `UnresolvedCalls.file`). `extractNode` emits none of them today, so real output is
  unchanged; absent stays absent. The doc comment's exhaustive list is updated.
  The .NET side's `calls` needs no re-prefix: its paths are already in the merge root.
- `packages/graph/src/areas.ts`: component placement is now (a) call majority, tie by
  alphabetical area key, `placedBy: "calls"`; (b) with no matched call, an area key equal
  to the component file's own directory or its parent (nearer wins), `"folder"`;
  (c) unassigned. New field `Area.placedBy: Record<componentKey, "calls" | "folder">`.
  `callsByComp` indentation fixed; the header comment updated.
- Tests: `merge.test.ts` (+4 cases), `areas.test.ts` (+5 cases, one title reworded).

## Gates
- `pnpm typecheck`: pass.
- `pnpm test`: 613 passed, 58 skipped (corpus), 0 failed. No corpus env var was set
  (`env` is not permitted here), but the corpus config is absent, so the corpus tests skip.
- `pnpm test:e2e`: not run, as instructed.

## Mutants (each applied alone, then reverted; final tree is GREEN)
| # | Mutant | RED tests |
|---|---|---|
| M1 | merge: `handler` copied without `at()` | merge: "Route.handler.file moves with Route.file" |
| M2 | merge: `Call.to` not re-prefixed | merge: "node-side entityRefs, calls and unresolvedCalls are kept…" |
| M3 | merge: node `entityRefs` not re-prefixed | same test |
| M4 | merge: node `unresolvedCalls` not re-prefixed | same test |
| M5 | areas: call-majority loop disabled | 4: "homes components by most calls…", "calls win…", "calls tie…", "component in A calling a route in B is an edge" |
| M6 | areas: folder rule runs even when calls placed it (folder overrides calls) | "calls win over a folder name that disagrees" |
| M7 | areas: folder rule scans every segment | "a folder three levels up does not place it" |
| M8 | areas: nearer-of-two reversed | "the parent directory also places it, and the nearer of the two wins" |
| M9 | areas: `placedBy` always `"calls"` | "with no matched calls, the component's own directory places it as `folder`" |

Not mutation-tested: the "does not mutate the node graph's nested objects" test, and the
"no handler stays without one" test. Both guard against regressions rather than a mutant I applied.

## Open questions
- Carrying node-side `entityRefs`/`calls`/`unresolvedCalls` goes beyond the literal
  request (handler.file). I chose it over leaving a silent drop that contradicts the
  "exhaustive" claim. It is easy to remove if unwanted.
- `Area.placedBy` is a map beside `components` (not an object-per-component) so the
  `components: string[]` consumers (web, mcp, server) are unchanged. No consumer reads it yet.
- The 116/126 and 98-component figures come from a real repo I cannot read here; I did
  not re-measure the corpus effect (corpus tests skip in this worktree).
- No files outside the list were touched.
