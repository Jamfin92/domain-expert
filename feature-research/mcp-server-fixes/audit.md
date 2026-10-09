# MCP server fixes — audit

## What changed
- `apps/mcp/src/common.ts`: `methodKey` (file + type + method); `handlerOf` now
  reads the schema's typed `Route.handler`; `blindSpots` adds (for .NET graphs) the
  attribute-routes-only statement and, at zero routes, "psq found no attribute
  routes; the API may still have endpoints psq cannot see"; and a matched/total
  line when fewer than half the client calls match a route.
  ".NET" = provider `efcore`, or `fullstack` with entity refs or a route handler.
- `apps/mcp/src/tools.ts`: `entity.refs.topMethods` keyed by file, items now carry
  `file`; `resolveRepo` throws when `repo` is omitted and more than one repo is
  open (`defaultRepo` is no longer consulted); `routes` unchanged in shape
  (`handler`, `handlerCite` already passed through).
- `apps/mcp/src/brief.ts`: hot-spot methods keyed by file, only >= 2 entities,
  citation labelled "first mention" (the graph holds no declaration line for an
  entity ref); new "Flow" section (route -> handler -> entities, joined on
  `methodKey`, capped at 15 routes x 8 entities, with "more" lines); areas capped
  (30 districts, 15 members, with counts) and calls per component capped at 10.
- `apps/mcp/README.md`: default-repo wording. `feature-research/mcp-server/audit.md`:
  zod claim corrected to `^3.25.76` (as in `apps/mcp/package.json`).
- Files outside the list: none. No fixture added; `Dup.Sync` stays at line 55.

## Gates
Counts are whatever `pnpm test` prints; not restated here. Last run:
`pnpm typecheck` clean; `pnpm test` all passing, 58 skipped (corpus absent).
Note: the `PSQ_NO_CORPUS=1` prefix is not allowed by this sandbox's command
filter, so plain `pnpm test` was run; corpus tests skip because
`test/corpus.local.json` is absent.

## Mutants (all reverted; each test file back to GREEN)
| # | Mutant | RED tests |
| --- | --- | --- |
| 1 | `methodKey` drops the file | topMethods keeps Dup.Sync in two files; brief lists each file's method |
| 2 | `isDotnet` forced false | states only attribute routes are read; does not claim 'no attribute routes' when routes exist |
| 3 | matched/total threshold never fires | reports matched/total when most client calls are unmatched |
| 4 | flow join uses wrong method name | brief joins each route's handler to its entities |
| 5 | Flow section always emitted | no Flow section without handlers |
| 6 | flow route cap removed | caps the flow list and says so |
| 7 | multi-repo guard `> 1` -> `> 5` | requires repo when several are open |
| 8 | `>= 2` filter -> `>= 1` | only methods touching at least two entities |
| 9 | per-component call cap removed | caps calls per component |

## Open questions
- The areas cap and the "stays quiet when most calls match" test are not
  mutant-proven separately (areas cap is untested; the quiet test was not mutated).
- `isDotnet` for `fullstack` is a heuristic; a node+DDL `fullstack` graph with no
  entity refs is treated as not .NET.
- Flow joins only the handler's own body; calls into services are not followed
  (stated in the brief).
- Flow join key: a route's handler is joined to entityRefs on file+type+method
  (`methodKey`), which is stricter than type+method. Both keys gave the same
  result on the reviewed .NET corpus repo (repoA-style anonymised; see
  feature-research/mcp-server-fixes-2/audit.md).
- The areas-cap gap above is closed in mcp-server-fixes-2.
