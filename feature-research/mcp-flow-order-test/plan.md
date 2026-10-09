# MCP: gate Flow count ordering, empty-Flow wording

## Goal

Small test-and-wording fix in `apps/mcp` (records `feature-research/mcp-server-fixes-2/`).

1. **Gate the Flow count term.** The test `orders entity-bearing routes by entity count
   desc, then method and path` does not gate `entsOf(b).length - entsOf(a).length ||`:
   both routes it builds share one handler, so their counts tie and only the method+path
   tie-break is exercised. Deleting the count term leaves every mcp test green. Add a
   case with two routes of DIFFERENT entity counts where the higher-count route sorts
   LATER by method+path, and prove it RED under exactly that mutant.
2. **Empty-Flow wording.** When no route's handler touches an entity, the Flow section
   shows only the `N more routes…` line with nothing above it. Add one line — `no handler
   mentions an entity directly` — and a test.
3. **Restore an explicit-repo-id assertion** in the warnings test where
   `repo: ctx.defaultRepo` was removed (the `defaultRepo` field no longer exists). Use an
   explicit id captured from `openRefs()`.

## Approach

- `apps/mcp/src/brief.ts`: in the Flow block, when `bearing.length === 0` push
  `- no handler mentions an entity directly` (above the `N more routes…` line).
- `apps/mcp/test/tools.test.ts`:
  - New flow test: give the `POST`/`Create` handler two extra entities (count 3) and add a
    `List`-handler route `GET /api/aaa` (count 1). Assert `POST /api/zzz` (3) renders
    before `GET /api/aaa` (1). Without the count term, alphabetical puts `GET` first → RED.
  - New flow test: clear `g.entityRefs`, assert the Flow section contains the new line.
  - Warnings test: capture `const refsId = openRefs()`, pass `repo: refsId` where the
    `ctx.defaultRepo` assertion was removed.

## Files touched

- `apps/mcp/src/brief.ts`
- `apps/mcp/test/tools.test.ts`

## Gates

- `pnpm typecheck`
- `PSQ_NO_CORPUS=1 pnpm test`

Each new test is proven with a mutant of the code under test (count term removed; new line
removed): RED, revert, GREEN.
