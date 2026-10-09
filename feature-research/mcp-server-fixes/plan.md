# MCP server fixes — plan

## Approach
1. **Per-file method keys.** `common.ts` gains `methodKey(ref)` (file + type + method).
   `entity.refs.topMethods` and the brief's "Methods touching the most entities"
   group by it, so `Dup.Sync` in two files is two methods. topMethods items carry
   `file`; the brief names the file in each line.
2. **Route blind spots.** `blindSpots()` (shared by the `warnings` tool and the
   brief) states that only ASP.NET attribute routes are read (conventional routing
   and minimal APIs are not, they surface as warnings), says so explicitly when a
   .NET repo has zero routes, and reports matched/total when most client calls are
   unmatched.
3. **Flow.** `routes` and the brief show handler `Type.method` + file:line (already
   partly there; made typed via the schema's `Route.handler`). The brief gains a
   "Flow" section: per route with a handler, the entities that handler touches
   (join `entityRefs` on file+type+method), capped.
4. **Non-blocking.** `resolveRepo` requires `repo` when more than one repo is open;
   README reworded. Per-component call lists and areas capped with truncated
   flags in the brief. Hot-spot method citations: the graph has no method
   declaration for plain refs, so the line is labelled "first mention". Methods
   listed only when touching >= 2 entities. Audit's zod version claim corrected.

## Files touched
`apps/mcp/src/{common,tools,brief}.ts`, `apps/mcp/test/tools.test.ts`,
`apps/mcp/README.md`, `feature-research/mcp-server/audit.md`, and these two
records. No fixture is added; the Dup.Sync anchor (line 55) is untouched.

## Gates
`pnpm typecheck`, `PSQ_NO_CORPUS=1 pnpm test`; each new test proven RED with a
mutant (recorded in audit.md).
