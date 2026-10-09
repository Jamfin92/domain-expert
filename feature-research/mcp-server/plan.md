# MCP server — plan

## Goal
Let an agent (Claude Code / Desktop) discuss a repo's areas, wiring and
optimisation opportunities while grounded in psq's deterministic graph. No
model grades anything (rule 1); every tool returns facts read from
`EntityGraph` (rule 2) and says what psq could not see (rule 3).

## Approach
- New package `apps/mcp` (`@psq/mcp`, bin `psq-mcp`), stdio transport, official
  `@modelcontextprotocol/sdk`. Run like the CLI: `tsx apps/mcp/src/index.ts`.
- Reuse, not reimplement: `Workspace` (open/extract/id/layout3d/mermaid) is
  imported from the server source by relative path (`@psq/server` only exports
  `app.ts`; widening its exports map is outside the files-touched list), and
  `searchEntities`/`refsFor`/`layout3d` from `@psq/graph`.
- `src/tools.ts` — pure handlers `(ctx, args) => JSON-able`, exported and
  unit-tested directly. `src/brief.ts` — markdown renderer. `src/server.ts` —
  registers tools + `brief` prompt; `src/index.ts` — arg parsing + stdio.
- Areas = `layout3d` districts (`districtBasis`, members by node.district);
  `districtKeys` is not exported and `packages/graph` is out of scope.
- `Route.handler` read by optional access (another task adds it).
- Responses capped (`truncated` flag) so they fit an agent context.
- Determinism: no `Math.random`; all ordering by code unit / counts.

## Files touched
`apps/mcp/**` (new), `pnpm-lock.yaml`, root `tsconfig.json` (include
`apps/mcp/src`), `README.md` (short section), this directory.
`vitest.config.ts` already globs `apps/*/test`.

## Gates
- `pnpm typecheck`, `PSQ_NO_CORPUS=1 pnpm test` green.
- apps/mcp tests: handlers on `mini-efcore-refs`, brief content, and one
  end-to-end test over `InMemoryTransport`.
- Each new test proven with a mutant (recorded in audit.md).
