# H-d route fixes — plan

## Approach
Tests first in `packages/extract/test/routes.test.ts` (unit, inline C#; the
existing `mini-aspnet-routes` fixture needs no new lines, and every new case is
expressible inline). Then fix `packages/extract/src/csharp/routes.ts`; prove each
test with a mutant; bump `EXTRACTOR_VERSION`.

1. Bare verb, no class `[Route]`, no template: warn `${file}:${line}:` (action is
   conventionally routed), emit no route. Flip the existing "root path" test.
2. Bare verb + templated verb on one method: emit both selectors (bare verbs
   resolve to the class route alone).
3. `[HttpGet("a")] [Route("b")]`: ASP.NET builds one selector per attribute
   route; a verb attribute with a template is its own selector, and `[Route]`
   carries the verb constraint from the method's verb attributes. Emit GET a and
   GET b. (Not ambiguous: both attributes contribute routes; the verbs apply to
   the whole action.) A `[Route]` with no verb attribute at all still warns.
4. Fix the stale `extractor: 2 patch` comment in `rehydrate.test.ts` (point at the
   constant, no number).
5. `[NonController]` class: skipped silently (test). Action on a non-abstract
   class inheriting from a repo-local non-abstract controller base: warn, with a test.
6. Bump `EXTRACTOR_VERSION`; update the G23 literals.

## Files touched
`packages/extract/src/csharp/routes.ts`, `packages/extract/src/detect.ts`,
`packages/extract/test/routes.test.ts`, `apps/server/test/rehydrate.test.ts`,
plus this directory.

## Gates
`pnpm typecheck`, `PSQ_NO_CORPUS=1 pnpm test`; one mutant per new test (see audit).
