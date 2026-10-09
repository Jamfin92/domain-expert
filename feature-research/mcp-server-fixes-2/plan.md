# mcp-server-fixes-2 — plan

## Approach
1. Brief Flow section: partition routes-with-handler by whether the handler's
   method (file+type+method) has entityRefs. Entity-bearing routes first, sorted
   by distinct-entity count desc, then `method path` (code-unit order); show up to
   the flow cap; the rest of the entity-bearing routes keep the existing
   "… N more routes with handlers not shown" line. Routes touching no entity are
   not listed; one counted line summarises them.
2. Fix the garbled README sentence about `--repo`.
3. Remove `ctx.defaultRepo` (index.ts, tools.ts, tests). Behaviour unchanged: a
   single open repo may still be omitted (resolveRepo already does this).
4. Audit records the join key (file+type+method, stricter than type+method) and
   that both agreed on the reviewed .NET corpus repo (stated as repoA-style, no names).
5. Tests for the areas cap (districts, members) and per-route flowEntities cap.

## Files touched
apps/mcp/src/brief.ts, apps/mcp/src/index.ts, apps/mcp/src/tools.ts,
apps/mcp/README.md, apps/mcp/test/tools.test.ts,
feature-research/mcp-server-fixes/audit.md (join-key note),
feature-research/mcp-server-fixes-2/{plan,audit}.md.

## Gates
- `pnpm typecheck`, `PSQ_NO_CORPUS=1 pnpm test`.
- New tests, each proven with a mutant (recorded in audit.md): flow ordering
  (revert to graph order), flow summary line, areas cap, flowEntities cap.
