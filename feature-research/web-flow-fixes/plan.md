# web-flow-fixes — plan

## Approach
1. **Handler mirror.** `RouteHandler` stays a named interface in `apps/web/src/lib/api.ts`
   (flow.ts uses it, and the drift parser is brace-depth-naive so an inline nested
   object type would truncate a parse). Its JSDoc is corrected: `@psq/schema` Route
   now has `handler`. The drift pin grows from `EntityGraph` only to also pin
   `Route` and `RouteHandler` against the schema (`Route.shape`, handler shape). The
   parser is parameterised on its marker, not loosened; the same
   unparsed/markerCount guards apply to each interface.
2. **seed-parity case 2.** Rename; record measured residual in the comment. Assertions unchanged.
3. **EntitySearch.** Pure module `apps/web/src/lib/lookup.ts`: `nextTarget` decides whether a
   hit click should re-trigger a lookup (target state vs selected prop) and a request
   token/`clearOnSuccess` logic is trivial inline (`setError(null)` on success).
4. **Flow multi-handler.** `routesForKey(routes, key)` in `lib/flow.ts`; RouteFlow shows
   every route/handler for the key; entities are the union per handler.

## Files touched
apps/web/src/lib/api.ts, lib/flow.ts, lib/lookup.ts (new), components/EntitySearch.tsx,
views/Flow.tsx, apps/web/test/flow.test.ts, apps/web/test/lookup.test.ts (new),
test/web-schema-drift.test.ts, test/seed-parity.test.ts, this directory.

## Gates
`pnpm typecheck`, `PSQ_NO_CORPUS=1 pnpm test`; each new test proven RED by a mutant (see audit.md).
