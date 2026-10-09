# C# call graph for flow — plan

## Approach

1. **Structure reader** (`csharp/structure.ts`): additionally record, per type, fields
   (`name`, `type`), constructors (parameters), bodiless method signatures
   (interface members), and, per method, its parameters. None of these feed
   `methods` for routes/entity-refs, so route and entity-ref output is unchanged.
2. **Call reader** (new `csharp/calls.ts`): token scan of each method body; resolve
   only these receivers, syntactically:
   `this.M(` / bare `M(` (same type + partial parts + repo base classes),
   field / property / primary-ctor-param / method-param / trivially typed local
   (`var x = new T(`, `T x`) whose declared type is repo-declared,
   static `T.M(` (method must be `static`).
   Interface receivers link the interface method and every repo implementer that
   declares the method; several implementers -> `ambiguous: true` on those edges.
   A name shadowed by a local we cannot type is not resolved. A type name declared
   twice (non-partial) is not resolved. Everything else only increments the
   per-method unresolved count; no per-call warnings. Overloads are keyed by
   type+method name.
3. **Schema**: optional `calls` and `unresolvedCalls` on `EntityGraph`.
4. **Graph helper** (`packages/graph/src/flow.ts`): `flowFor` (BFS, depth cap,
   cycle guard, `truncated`, entities per node + union) and `routeFlow`.
5. `EXTRACTOR_VERSION` 6 -> 7 and the G23 literals.
6. **Fixture**: append a Gadgets chain to `test/fixtures/mini-aspnet-routes`;
   hand-derived ground truth in `packages/extract/test/calls.test.ts` and
   `packages/graph/test/flow.test.ts`.

## Files touched

Listed set, plus (reasons in audit): `packages/extract/src/merge.ts` (carry
`calls` through the fullstack merge, otherwise the main target loses them),
`test/mini-aspnet-routes.test.ts` and `apps/mcp/test/tools.test.ts` only if the
fixture growth requires it.

## Gates

`pnpm typecheck`; `PSQ_NO_CORPUS=1 pnpm test`; mutants for interface resolution,
field typing, cycle guard, depth cap, ambiguous flag (each proven RED, then
reverted) recorded in audit.md.
