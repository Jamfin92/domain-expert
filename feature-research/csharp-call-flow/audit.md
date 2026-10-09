# C# call graph for flow — audit

## What changed

- `packages/extract/src/csharp/structure.ts`: `TypeDecl` gains `fields`, `signatures`
  (bodiless members: interface/abstract); `MethodDecl` gains `params`. `methods`
  is untouched, so the route and entity-ref readers see exactly what they saw.
- `packages/extract/src/csharp/calls.ts` (new): `collectCalls(parses)`. The doc
  comment at the top is the contract: what resolves, what is only counted,
  overloads keyed by type + method name. Wired in `dotnet.ts`; computed even when
  no DbContext exists.
- `packages/schema/src/index.ts`: optional `EntityGraph.calls` (`Call`:
  from/to/line/ambiguous?) and optional `unresolvedCalls` (per-method count).
- `packages/graph/src/flow.ts` (new, exported from the index): `flowFor`,
  `routeFlow`, `DEFAULT_FLOW_DEPTH` (4). BFS, visited-set cycle guard,
  `truncated` only when the cap left a method unreached, per-node `ambiguous`
  (true when the path crosses an ambiguous edge), entities per node and union.
- `EXTRACTOR_VERSION` 6 -> 7; G23 literals in `apps/server/test/rehydrate.test.ts`
  moved to 6 (`toBeGreaterThan(6)`, stale envelope `extractor: 6`).
- Fixture `test/fixtures/mini-aspnet-routes/` (appended): Gadgets controller ->
  `IGadgetService` -> `GadgetService` -> `IGadgetRepository` ->
  `GadgetRepository` (DbContext); `INotifier` with two implementations; a
  `Rebalance`/`Settle` cycle; a static `Chain` six calls deep; a trivially typed
  local (`var calc = new Calculator()`); an opaque handler. Three entities
  (`Gadget`, `Sprocket`, `Part`) added as DbSets.

## Deviations from "Files touched" (each with its reason)

- `packages/extract/src/merge.ts`: `mergeGraphs` builds the fullstack graph field
  by field, so without two lines it would drop `calls` on exactly the repos this
  is for. Gate: merge test + mutant M11.
- `test/mini-aspnet-routes.test.ts`: five new route rows in `EXPECTED` (new
  controller; routes are sorted by file). No existing row changed.
- The fixture's `Data/RoutesDbContext.cs` gained three DbSet lines (closing brace
  moved down; nothing anchors to it). The `Dup.Sync` line-55 anchor is in another
  fixture and untouched.
- `apps/web/src/lib/api.ts` untouched. `test/web-schema-drift.test.ts`: allowlist
  only (`calls`, `unresolvedCalls` are new known gaps, "two" -> "four" in prose).
- `apps/mcp` untouched; its tests still pass because the new fixture routes use
  GET/PUT (the MCP tests pick "the first POST"). Its brief still says psq does not
  follow services; wiring `routeFlow` into it is a follow-up.

## Gates

- `pnpm typecheck`: pass.
- `pnpm test` (corpus absent): 46 files passed, 2 skipped; 585 passed, 58 skipped.
  `PSQ_NO_CORPUS=1` could not be set through the sandboxed shell, but the corpus
  config is absent so the skip count is identical (58).
- New tests: `packages/extract/test/calls.test.ts` (17), `packages/graph/test/flow.test.ts`
  (12), `packages/schema/test/calls.test.ts` (4), additions to `structure.test.ts`
  (3), `merge.test.ts` (2). Ground truth for the fixture was derived by hand from
  the source files before the first run; it matched on the first run.
- No new extraction warning on any fixture: the fixture warning list in
  `test/mini-aspnet-routes.test.ts` is unchanged (11).

## Mutants (applied, suite run, reverted; harness not committed)

All were run on `packages/extract/test`, `packages/graph/test`, `packages/schema/test`
and `test/mini-aspnet-routes.test.ts`; baseline had no failures.

| # | Mutant | RED tests |
|---|--------|-----------|
| M1 | interface resolution: implementers never linked | 7 (calls: hand-derived set, ambiguous/lone, generic iface, derived iface; flow: Gadgets route, retire route, file narrowing) |
| M2 | field/property typing disabled (ctor-assigned DI field) | 12 |
| M3 | flow cycle guard (`seen`) removed | 3 (flow: Gadgets route, cycle, file narrowing) |
| M4 | flow depth cap removed | 2 (depth cap, depth 0) |
| M5 | `ambiguous` never set | 3 |
| M6 | chained-receiver guard removed (first run GREEN; test added) | 1 after fix |
| M7 | untyped local no longer shadows a field | 1 |
| M8 | static call without a `static` check | 1 |
| M9 | `truncated` never set | 2 |
| M10 | lone implementer also marked ambiguous | 6 |
| M11 | merge drops `calls` | 1 |
| M12 | ambiguity not inherited along the path (first run GREEN; test added) | 1 after fix |
| M13 | structure reader drops bodiless signatures | 9 |
| M14 | bare call does not walk repo base classes | 1 |
| G23 | `EXTRACTOR_VERSION` back to 6 | 1 (`G23`) |
| drift | `unresolvedCalls` removed from the not-mirrored allowlist | 1 (case 3) |

M6 and M12 were GREEN on the first pass: the tests then in place did not
exercise them. Two tests were added and both mutants rerun RED; that is the only
reason those tests exist.

## Measured on the hermetic fixture (`mini-aspnet-routes`)

Measured with a throwaway script over `extractDotnet`; not pinned as totals in a
test (per-method counts are pinned in `calls.test.ts`).

- `calls`: 22 edges, all in the Gadgets chain (the older controllers call nothing
  repo-declared). 2 are `ambiguous` (the two `INotifier` implementers).
- Resolved vs unresolved: 22 resolved edges against 41 unresolved call sites in 39
  methods. Nearly all unresolved are `Ok(...)` and other framework calls; the
  five Gadgets routes account for 7 of them (`Ok(` x5, `_log.LogInformation(`,
  `Helpers.Format(`) plus the two chained `_db.Gadgets.*` calls in the repository.
- Flow, default depth 4, from the five new routes: 0 of 5 handlers mention an
  entity directly; 3 reach one by following calls (`Get` -> `Gadget`; `Retire` ->
  `Gadget`, `Sprocket`, `Widget`; `Calc` -> `Widget`); `Deep` reaches `Part` only at
  `maxDepth` 6 and reports `truncated` at 4; `Opaque` reaches nothing and reports 3
  unresolved calls.
- The corpus is not in this worktree, so the "32 of 44 routes show no entity"
  figure is not re-measured here.

## Known limits (stated, not hidden)

- Constructor and property-accessor bodies are not read, so calls made there do not
  appear. Virtual dispatch to a subclass is not followed (only interface -> implementer).
- Implementers come from `: IFoo` declarations only. DI registrations
  (`AddScoped<IFoo, Foo>`) are not read, so a type registered but not declaring the
  interface is missed, and a declared-but-unregistered implementer is included
  (flagged `ambiguous` when there are several).
- Generic interfaces match by exact text (`IRepo<Widget>`); an open-generic
  implementer `Repo<T> : IRepo<T>` therefore links only the interface edge.
- A type name declared twice outside `partial` (two namespaces) resolves nothing.
- Shadowing by a lambda parameter or a generically typed local named like a field
  is not detected; that would resolve to the field. Rare; not measured.
- Overloads are one node (type + method name), as with `EntityRef`; `flowFor`'s
  `file` narrows the start only.
- Extension methods, delegates, `base.M(`, and chained calls are counted, not resolved.

## Open questions

- Should the MCP brief/`routes` tool and the web Flow view call `routeFlow`? Out of
  scope here (files off the list); the data and the helper are in place.
- Should `ambiguous` implementers be filtered by DI registration when one is
  readable? Needs a registration reader; not attempted.
