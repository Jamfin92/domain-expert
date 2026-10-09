# H-c: Route.handler for TS server routes — audit

## What changed
- `packages/extract/src/node/handlers.ts` (new): `resolveHandler`. The handler is the
  last argument of the registration call (registration needs 2+ args).
  Inline arrow / function expression -> `{type: <module basename, no ext>, method:
  "<inline>", file, line}` = the route's own file:line. Identifier / `a.b` -> checker
  symbol (aliases followed) -> single declaration:
  function / `const f = () =>` -> type = module basename; class method -> class name;
  object-literal member -> the variable holding the literal. Everything else -> no
  handler, no warning (wrapper call, `.bind`, array, overloads, no or `node_modules`
  / out-of-repo declaration, non-function declaration).
- `packages/extract/src/node/routes.ts`: `readRoutes` takes the checker, sets `handler`.
- Convention documented in the `Route.handler` doc comment in `packages/schema/src/index.ts`
  (comment only, no shape change).
- Scope: the only TS route reader is Express. There is no Fastify reader, so Fastify
  registrations are not read and have no handler (nothing added for it).
- Output changes for every Node server with express routes; `EXTRACTOR_VERSION` NOT
  bumped (another task owns the bump).

## Files touched outside the list (with reason)
- `packages/extract/src/node.ts`: one line, threading `checker` into `readRoutes`.
- `test/mini-node.test.ts`, `test/mini-fullstack.test.ts`, `test/mini-fullstack-react.test.ts`:
  whole-Route `toEqual` assertions now include the inline `handler` (ground truth is the
  route's own line).
- `apps/mcp/test/tools.test.ts`: the prefix-route test now expects handler/handlerCite;
  the two "no handler" tests delete the handlers from the in-memory graph first (the
  fixture now has them) so they still exercise the no-handler path.
- New fixture `test/fixtures/mini-node-handlers/` rather than extending `mini-node`
  (kept stable; no `Dup.Sync` involvement).

## Gates
- `pnpm typecheck`: pass.
- `pnpm test` (no corpus file present): 554 passed, 58 skipped, 0 failed. The
  `PSQ_NO_CORPUS=1` prefix is not permitted in this shell; the corpus config is absent
  so the corpus tests skip identically.
- New test: `packages/extract/test/route-handlers.test.ts` (7 tests), hand-written ground truth.
- No new extraction warnings on any fixture (asserted for the new one).

## Mutants (each applied to `handlers.ts`, run on route-handlers.test.ts, reverted)
| Mutant | RED tests |
|---|---|
| handler = `args[1]` instead of last | "treats the last argument as the handler, behind middleware"; "follows controller.method to the class method" |
| also resolve a call wrapper's first argument | "leaves a wrapper call, .bind, an unresolved name and a bare path unhandled" |
| class-method `type` = module basename | "follows controller.method to the class method" |
| inline line = route line + 1 | "puts an inline arrow at the route's own file:line"; "treats the last argument…" |
Each reverted and the suite re-run green.

Not mutant-proven: the single-declaration guard (`decls.length !== 1`) and the
node_modules/out-of-repo guard — the fixture has no overloaded or external handler.

## Measurement (fixtures only)
`mini-node-handlers`: 6 of 10 routes with a handler (4 unresolved by design: wrapper
call, `.bind`, undeclared-type name, and a one-argument registration). Existing fixtures
(`mini-node` 3/3, `mini-fullstack` 3/4 — `/health` wraps its handler in a call,
`mini-fullstack-react` 2/2). Total 14 of 19 routes.

## Open questions
- Plain-function `type` is the module basename; a downstream join on
  `(handler.type, handler.method)` to entities would need TS entity refs (none exist; H-c's
  `mirrors` bridge is the cap).
- Common real-world `asyncHandler(fn)` wrappers are left unresolved on purpose.
- Fastify has no route reader at all.
