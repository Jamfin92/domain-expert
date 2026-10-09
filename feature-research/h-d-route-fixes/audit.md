# H-d route fixes — audit

## What changed
`packages/extract/src/csharp/routes.ts`
1. Bare verb with no template on a controller with no class `[Route]`: warns
   (`${file}:${line}: ... conventionally routed ...`), emits no route.
2. Bare verb + templated verb on one method: both selectors are emitted (bare
   verbs now go to the class route unless a method `[Route]` took them).
3. `[HttpGet("a")] [Route("b")]`: emits both. Judged unambiguous: each attribute
   contributes an attribute route, the method's verb attributes constrain the
   `[Route]` one (bare verbs if present, else the distinct templated verbs). A
   `[Route]` with no verb attribute at all still warns, with its existing, now
   accurate, message.
4. `[NonController]` classes are skipped silently.
5. A controller deriving (transitively, repo-local) from a non-abstract base that
   declares actions warns "inherited actions are not read".

`packages/extract/src/detect.ts`: `EXTRACTOR_VERSION` bumped by one.
`apps/server/test/rehydrate.test.ts`: G23 literals follow the bump (bound and
`patch` value); the stale "extractor: 2 patch" comment now points at the `patch(...)` call.
`packages/extract/test/routes.test.ts`: the "root path" test is flipped; six new cases.

No fixture was extended: every case is inline C#, and the existing
`mini-aspnet-routes` ground truth (incl. `Dup.Sync` anchors) is untouched. No file
outside the "Files touched" list was edited.

## Gates
`pnpm typecheck`: clean. `pnpm test`: 41 files passed, 2 skipped; 508 tests
passed, 58 skipped (corpus, as expected). Run without the `PSQ_NO_CORPUS=1`
prefix, which this shell does not permit; the corpus config file is absent, so
the corpus tests skip either way. No new extraction warnings on existing fixtures.

## Mutants (all reverted afterwards; each test was RED before the fix too)
| Mutant | Failing tests |
|---|---|
| fix-1 guard made dead (`false && ...`) | "warns, and emits no route, for a bare verb ..." |
| bare selector gated on `selectors.length === 0` | "emits both selectors for a bare verb plus a templated verb" |
| `[Route]` gate on `bareVerbs` instead of `verbAttrs` | "reads a templated verb together with [Route] as two routes" |
| NonController attribute name misspelled | "silently skips a [NonController] class" |
| inherited-actions warning disabled | "warns when a controller inherits actions ..." |
| `EXTRACTOR_VERSION` back to previous value | G23 in rehydrate.test.ts |

## Open questions
- `[HttpGet] [Route("b")]` is read as GET b (existing behaviour, unchanged).
- Inherited-action warning fires at the derived class even when the derived
  class has no actions of its own; psq cannot tell what the base's routes become.
