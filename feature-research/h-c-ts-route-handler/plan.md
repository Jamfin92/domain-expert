# H-c: Route.handler for TS server routes — plan

## Approach
- The only TS route reader is the Express one (`packages/extract/src/node/routes.ts`);
  there is no Fastify reader, so Fastify is out of scope ("exactly that set").
- New `packages/extract/src/node/handlers.ts`: `resolveHandler(checker, root, args)`.
  The handler is the LAST argument of the registration call.
  - arrow / function expression -> inline: `{type: <module basename, no extension>, method: "<inline>", file, line}` at the route's own file:line.
  - identifier / property access -> checker symbol (aliases followed) -> its single
    declaration. Method -> enclosing class; function / `const f = () =>` -> module
    basename; object-literal member -> the variable holding the literal.
  - anything else (call wrapper, `.bind`, array, overloads, no declaration, a declaration
    in `node_modules` / outside the repo) -> no handler, no warning. Counted in the audit.
- `readRoutes` gains a `checker` parameter; `node.ts` passes it (one-line change, outside
  `src/node/` — needed to thread the checker).
- Schema: doc comment on `Route.handler` only.
- No EXTRACTOR_VERSION bump (owned by another task); output changes.

## Files touched
- packages/extract/src/node/routes.ts, packages/extract/src/node/handlers.ts (new)
- packages/extract/src/node.ts (checker threading)
- packages/schema/src/index.ts (doc comment)
- new fixture test/fixtures/mini-node-handlers/ (new, so existing fixtures stay stable)
- packages/extract/test/route-handlers.test.ts
- Existing tests that `toEqual` whole Route objects for inline-handler fixtures will gain
  a `handler` field; they are updated and listed in the audit.

## Gates
- `pnpm typecheck`, `PSQ_NO_CORPUS=1 pnpm test`.
- Mutants on the resolver, each proven RED then reverted (see audit).
