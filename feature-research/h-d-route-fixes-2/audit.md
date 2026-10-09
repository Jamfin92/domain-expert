# h-d-route-fixes-2 — audit

## What changed
- `routes.ts`: a method `[Route]` takes verbs only from template-less verb attributes
  (`[HttpGet] [Route("b")]` = `GET b`). With only templated verb attributes
  (`[HttpGet("a")] [Route("b")]`) it emits `GET a` and a warning
  `file:line: ... [Route] with no HTTP-method restriction ... route not read` for `b`.
  `Route.method` is a plain `z.string()` with no any-verb value, so a warning is the
  only honest output (same stance as the existing `[Route]`-without-verb warning).
- `routes.ts`: `[NonController]` now applies down a repo-local base chain (depth 6).
- `EXTRACTOR_VERSION` 5 -> 6; rehydrate G23 pins moved (`toBeGreaterThan(5)`,
  stale envelope `extractor: 5`).

## Tests (packages/extract/test/routes.test.ts)
- flipped: templated verb + `[Route]` -> `GET /r/a` + one warning at the `[Route]` line.
- new: template-less verb + `[Route]` -> `GET /r/b`, no warning.
- new: class deriving (via a mid class) from a `[NonController]` base -> no routes, no warnings.

## Mutants (each applied, run, reverted)
| mutant | failing tests |
|---|---|
| templated-only `[Route]` branch disabled (no warning) | routes.test: "gives a [Route] beside only a templated verb..." |
| `[Route]` selector given empty verbs (breaks bare-verb lending) | routes.test: "lends a template-less verb to [Route]"; mini-aspnet-routes: "reads exactly the hand-derived routes" |
| old behaviour: templated-only `[Route]` emits `GET b` | routes.test: "gives a [Route] beside only a templated verb..." |
| `nonController` not inherited | routes.test: "skips a class deriving from a repo-local [NonController] base" |
| `EXTRACTOR_VERSION` back to 5 | rehydrate.test: G23 |

## Gates
`pnpm typecheck` clean. `pnpm test` (corpus file absent, so corpus tests skip):
43 files passed, 2 skipped; 543 tests passed, 58 skipped. No new warnings on existing
fixtures (mini-aspnet-routes fixture unchanged and green).

## Files touched
Only those listed in the task. Fixture files untouched, so `Dup.Sync` stays at line 55.

## Open questions
- If the schema later gains an any-verb route, the templated-only `[Route]` case
  should emit it instead of a warning.
