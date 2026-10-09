# mcp-server-fixes-2 — audit

## What changed
1. **Flow ordering** (`apps/mcp/src/brief.ts`): routes whose handler method has
   entityRefs come first, sorted by distinct-entity count desc then
   `METHOD path` (code-unit `cmp`); up to the flow cap are shown, overflow keeps
   the "… N more routes with handlers not shown" line. Routes touching no entity
   are no longer listed; one line counts them: "N more routes with handlers
   touching no entity directly — they likely delegate to services, which psq does
   not follow yet". The old per-route "no entity mentioned" text is gone.
2. README `--repo` sentence fixed (`apps/mcp/README.md`).
3. `ctx.defaultRepo` removed (`index.ts`, `tools.ts`, tests). A single open repo
   may still omit `repo` (`resolveRepo` unchanged; asserted in the open_repo test).
4. **Join key**: the Flow join uses file+type+method (`methodKey`), stricter than
   type+method. Both gave the same result on the reviewed .NET corpus repo
   (measured in the earlier review; corpus tests skip here, so not re-measured).
5. New tests in `apps/mcp/test/tools.test.ts`: entity-bearing route listed
   despite 20 preceding entity-less routes; ordering by count then method/path;
   per-route flowEntities cap ("… 5 more"); areas cap and per-area member cap;
   existing flow-cap test now pads with entity-bearing routes.

Files touched beyond the list: none (`feature-research/mcp-server-fixes/audit.md`
got the join-key note).

## Gates
- `pnpm typecheck`: pass.
- `pnpm test` (corpus config absent, so corpus tests skip): 545 passed, 58 skipped,
  43 files passed. (`PSQ_NO_CORPUS=1` could not be set by the tool sandbox; with no
  corpus config the result is the same skip set.)
- apps/mcp tests: 46 pass (tools 42, protocol 4).

## Mutants (each reverted; tools.test.ts back to GREEN)
| # | mutant | failing tests |
|---|--------|---------------|
| 1 | `cap(bearing, …)` → `cap(withHandler, …)` (graph order) | "lists entity-bearing routes first…", "orders entity-bearing routes…" (2) |
| 2 | bare-route summary line suppressed (`bare > 1e9`) | "lists entity-bearing routes first…" (1) |
| 3 | per-route entity cap → 999 | "caps the entities shown per route…" (1) |
| 4 | area cap and member cap → 999 (applied together) | "caps areas and the members…" (1; both assertions in one test, not split) |

## Open questions
- Mutant 4 removes both areas caps at once; the test asserts both lines but the
  two were not proven independently.
- Routes with entity-less handlers are now only counted, not named; the agent
  must use `routes` to see them.
