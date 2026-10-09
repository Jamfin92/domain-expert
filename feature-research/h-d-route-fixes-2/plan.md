# h-d-route-fixes-2 — plan

## Approach
1. `[Route("b")]` on an action takes verbs only from template-LESS verb attributes
   (ASP.NET `CreateSelectors`). With only templated verb attributes it has no verb
   restriction. `Route.method` is a plain string with no any-verb value, so psq
   warns (`file:line: ...`) and emits no route for it; the templated verb routes still emit.
2. `[NonController]` is inherited: skip any class with a repo-local ancestor carrying it.
3. Bump `EXTRACTOR_VERSION` by one and update literal pins.

## Files touched
- packages/extract/src/csharp/routes.ts
- packages/extract/src/detect.ts
- packages/extract/test/routes.test.ts
- apps/server/test/rehydrate.test.ts (only if a literal pin exists)

## Gates
- Flip "templated verb together with [Route]" test; add `[HttpGet] [Route]` test; add
  inherited `[NonController]` test. Each proven with a mutant (see audit.md).
- `pnpm typecheck`, `PSQ_NO_CORPUS=1 pnpm test`.
