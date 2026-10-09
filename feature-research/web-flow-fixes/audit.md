# web-flow-fixes — audit

## What changed
1. **Handler mirror** (`apps/web/src/lib/api.ts`): `RouteHandler` JSDoc corrected (schema's `Route.handler` exists).
   Deviation from the brief: the named `RouteHandler` interface is KEPT rather than inlined into `Route`.
   It is used by `lib/flow.ts`, and the drift parser is brace-depth-naive, so an inline object type would
   truncate a `Route` parse. `handler?: RouteHandler` on `Route` is the fold.
   `test/web-schema-drift.test.ts`: the parser takes a marker argument (guards unchanged, not loosened); new
   cases 5 and 6 pin `Route` and `RouteHandler` against `@psq/schema` with NO allowlist (gap zero both ways).
   EntityGraph allowlist (`kind`, `shapes`) is unchanged and still correct. Previously `Route` was not pinned at all.
2. **seed-parity case 2** renamed ("a non-default seed builds a different bank from DEFAULT_SEED"); comment records the
   residual (old absolute-path default untested, ~2% of checkout paths slip a `seed ?? hashSeed(graph.repo)`
   regression). Assertions untouched. The ~2% figure is the brief's measurement; I did not re-measure it.
3. **EntitySearch**: `setError(null)` on a later successful search or refs response; new pure
   `lib/lookup.ts#onHitClick` retargets the lookup when a hit equals the selected entity while a "look up anyway"
   target differs.
4. **Flow**: `routesForKey`, `handlersOfRoutes`, `entitiesOfHandlers` in `lib/flow.ts`; `RouteFlow` lists every
   route location and every distinct handler for the key, a note when some same-key routes have no handler, and the
   merged entity mentions.

## Gates
- `pnpm typecheck`: pass.
- `pnpm test` (corpus absent): 42 files passed, 2 skipped; 512 passed, 58 skipped. I ran it without the
  `PSQ_NO_CORPUS=1` prefix because the sandbox rejected the env-var form; the corpus config is absent, so the skip count
  (58) is the same.
- Not run: `pnpm test:e2e` (forbidden).

## Mutants (each applied, test run RED, reverted, then GREEN)
| Mutant | Failing tests |
|---|---|
| api.ts: delete `handler?: RouteHandler;` from Route | drift 5 |
| api.ts: add `extra: string` to RouteHandler | drift 6 |
| flow.ts routesForKey `.slice(0,1)` | flow: routesForKey, handlersOfRoutes |
| flow.ts handlersOfRoutes: drop dedupe | flow: handlersOfRoutes |
| flow.ts entitiesOfHandlers: only first handler | flow: entitiesOfHandlers |
| flow.ts entitiesOfHandlers: ref dedupe key made unique | flow: entitiesOfHandlers |
| lookup.ts: `setTarget: null` always | lookup: retargets-the-lookup |
| lookup.ts: drop `target !== name` guard | lookup: no-redundant-retarget |

## Open questions
- The `setError(null)` on success in `EntitySearch.tsx` and the component wiring of `onHitClick` / `RouteFlow` are not
  covered by a test (no renderer in apps/web). Only the pure decisions are gated. Clearing is global: a refs success
  also clears a stale search error.
- Fixture anchor (`Dup.Sync` line 55) untouched; no fixtures changed.
- No file outside the "Files touched" list was edited.
