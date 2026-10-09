# MCP server — audit

## What changed
- New `apps/mcp` (`@psq/mcp`, bin `psq-mcp`): stdio MCP server on
  `@modelcontextprotocol/sdk` (^1.32.1, plus `zod ^3.24.1` which the tool
  schemas use). Files: `src/tools.ts` (handlers, exported as `tools`),
  `src/brief.ts` (markdown brief), `src/common.ts` (cap/cite/blind spots),
  `src/server.ts` (SDK adapter, `brief` prompt), `src/index.ts` (`--repo`,
  stdio), `README.md`, `test/tools.test.ts`, `test/protocol.test.ts`.
- Tools: open_repo, overview, search_entities, entity, refs, routes,
  client_calls, warnings, mermaid, brief; prompt `brief`.
- `tsconfig.json`: added `apps/mcp/src/**/*.ts` to `include` (typecheck
  coverage). `vitest.config.ts` already globs `apps/*/test`; untouched.
  `pnpm-workspace.yaml` already globs `apps/*`; untouched.
- `README.md`: one short "Agent access (MCP)" section. `pnpm-lock.yaml`: the new
  package's importer.

## Decisions worth a reviewer's eye
- **Not in the Files-touched list, deliberately avoided:** `@psq/server`
  exports only `src/app.ts`, so `Workspace` is imported by relative path
  (`../../server/src/workspace.js`). Widening the server's exports map would
  have been the cleaner seam but is outside scope. Open question: do you want
  that follow-up?
- Districts come from `layout3d` (`districtBasis`, `districts`, `nodes[].district`);
  `districtKeys` is not exported and `packages/graph` was out of scope.
- `Route.handler` is read by optional access (`common.ts` `handlerOf`);
  `packages/schema` untouched. Tested with a handler injected into the graph
  and without.
- `wholeWord` is implemented in the MCP layer as a filter on `searchEntities`
  reasons (camelCase/underscore split into words); `searchEntities` has no such
  option. A hit survives only with a reason that matches as a whole word.
- Entities and relations have no line in the graph, so their cite is the file
  only; refs, routes, client calls and components cite `file:line`.
- Blind-spot text (`common.ts` `blindSpots`) is drawn from the schema's own
  catalogue and is conditioned on provider / presence of client code. It is
  static prose, not measured; the schema comment on expression-bodied methods
  is stale after b65ad3c, so that item is deliberately not repeated.
- Targets are read-only: `Workspace` is constructed without a `stateDir`, so
  nothing is persisted anywhere.
- No `Math.random`; all ordering is by count then code-unit string compare.

## Gates
- `pnpm typecheck`: clean.
- `pnpm test` (corpus file absent, so corpus tests skip): 36 files passed,
  2 skipped; 449 tests passed, 58 skipped. apps/mcp contributes 28 tests
  (24 handler, 4 over `InMemoryTransport`).
- `pnpm install --frozen-lockfile --prefer-offline`: clean after the lockfile change.
- Not run: `pnpm test:e2e` (forbidden).
- Manual: the real `src/index.ts --repo <fixture>` answered `initialize` and
  `tools/call overview` over stdio.

## Mutants (each applied to the code under test, apps/mcp tests run, then reverted)
All 13 went RED; failing tests named by their `describe > it`.

| # | Mutant | Failing tests |
| --- | --- | --- |
| M1 | `wholeWord` filter disabled | search_entities: partial vs wholeWord |
| M2 | entity `out` uses principal instead of dependent | entity: both sides of a relation |
| M3 | `refs` ignores `via` | refs: file:line and via filter |
| M4 | `cap()` keeps one extra | overview: caps its output; cap() reports what it dropped |
| M5 | client blind spots always listed | warnings: client blind spots only with client code |
| M6 | route `handler` dropped | routes: handler pass-through |
| M7 | routes grouped by full path, not first segment | overview: groups routes; overview: caps |
| M8 | `brief` prompt not registered | protocol: lists tools and prompt; serves brief as prompt |
| M9 | instruction removed from the head of the brief | brief: states the instruction before content and at the end |
| M10 | `client_calls.unmatched` forced to 0 | client_calls: filters and counts unmatched |
| M11 | ref cite drops the line | protocol: refs call; refs: file:line |
| M12 | default/only-open repo fallback removed | resolveRepo plus 18 handler tests |
| M13 | brief hot spots sorted by name, not count | brief: ranks by count |

First pass left M9 and M13 GREEN (the instruction appears twice, and
Course sorts first both ways). Two tests were added (instruction position;
ranking with Course's mentions halved) and both mutants re-run RED. The
mutant harness was a throwaway script outside the repo.

## Open questions
- Export `Workspace` from `@psq/server` (or move it to a shared package) so
  `apps/mcp` stops reaching across by relative path?
- `overview` caps are constants in `tools.ts` (`CAP`); no knob is exposed.
- Ref counts and sizes are not restated here; see the fixture-backed
  assertions in `apps/mcp/test/tools.test.ts`.
