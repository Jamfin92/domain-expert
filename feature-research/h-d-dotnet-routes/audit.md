# H-d: .NET attribute-route reader with Route.handler — audit

## What changed

| File | Change |
|---|---|
| `packages/extract/src/csharp/structure.ts` | `AttributeRef.line`; `TypeDecl.attributes`; `MethodDecl.attributes` (previously read and discarded). No behaviour change for other consumers. |
| `packages/extract/src/csharp/routes.ts` (new) | `readAspNetRoutes(parses)`, `combineTemplates`, `scanUnattributedRouting(src, file)`. |
| `packages/extract/src/dotnet.ts` | Emits `routes`; per-file scan for minimal-API / conventional registrations (Program.cs top-level statements are not types, so it lexes the source). Routes are also returned on the "no DbContext" early return. |
| `packages/schema/src/index.ts` | `Route.handler?: { type, method, file, line }`. Optional; Express routes unchanged. |
| `packages/extract/src/merge.ts` | After re-prefixing, TS calls with `matches === null` are linked against the .NET routes (`aspnet` mode). |
| `packages/extract/src/node/clients.ts` | `normaliseRoutePath` exported with an `aspnet` flag (`{id}`, `{id:int}`, `{id?}`, `{*rest}`, nested-brace constraints → `*`); `linkCalls` takes `{ aspnet }` (adds case-insensitive compare). Default (Express) behaviour is byte-identical. |
| `packages/extract/src/detect.ts` | `EXTRACTOR_VERSION` 3 → 4. |
| `apps/server/test/rehydrate.test.ts` | G23 literal pins raised: bound `> 3`, stale patch `extractor: 3`. This was the only literal pin (grep for `EXTRACTOR_VERSION` and `extractor:`; `store.test.ts` uses an arbitrary `1` that is not a pin). |
| tests | `test/mini-aspnet-routes.test.ts`, `packages/extract/test/routes.test.ts`, `packages/schema/test/route.test.ts` (new); `packages/extract/test/merge.test.ts` (4 cases appended). |
| fixture | `test/fixtures/mini-aspnet-routes/` (new; `mini-efcore-refs` untouched). |

Files touched outside the "Files touched" list: **`apps/server/test/rehydrate.test.ts`** (the G23 pin the task
itself names) and **`packages/extract/src/node/clients.ts`** (the route-matching helper; `merge.ts` imports it,
and "its route-matching helper if separate" covers it). `apps/web/src/lib/api.ts` and `test/fixtures.ts` not
touched. The fixture test resolves its own path rather than adding a constant to `test/fixtures.ts`.

## Design decisions

- **Path syntax.** `Route.path` keeps ASP.NET's syntax, leading `/`, constraints as written
  (`/api/Widgets/{id:int}`). `ClientCall.matches` therefore reads `GET /api/Widgets/{id:int}`. Normalising at match
  time (not storage) mirrors how Express `:param` is handled.
- **Case.** ASP.NET routing is case-insensitive and `[controller]` keeps the class name's case, so a client's
  `/api/widgets` must meet `/api/Widgets`. Case folding is opt-in (`aspnet`), so Express matching is unchanged.
- **`Route.line`** is the line of the attribute that declares the route (a `[Route("x")]` + bare `[HttpGet]` pair
  reports the `[Route]` line); **`handler.line`** is the method declaration.
- **Ambiguity** (two .NET routes fit one call) leaves the call unmatched and warns, reusing `linkCalls`'s existing
  behaviour.
- **Quiet by default.** A `*Controller` class with no routing attribute and no class `[Route]` yields nothing and no
  warning, so `mini-efcore-refs` (controllers by name only) gains neither routes nor warnings.

## Supported / warned forms

Supported: `[ApiController]` / `ControllerBase` / `Controller` / `*Controller` / repo-local controller bases;
class `[Route]` (several → cross product); `[HttpGet|Post|Put|Delete|Patch|Head|Options]` with or without
template and with `Name=`/`Template=`; method `[Route]` combined with bare verbs; several verb attributes on one
method; `/x` and `~/x` overriding the class prefix; `[controller]`, `[action]`, `[ActionName]`; `[[`/`]]`
escapes; brackets inside `{…}` constraints; qualified and `Attribute`-suffixed names; `partial` classes (class
attributes unioned across parts).

Warn, no route (`${file}:${line}: …`): `[AcceptVerbs]`; `[Area]` controller; unknown `[token]`; non-literal /
concatenated / escaped template; `[action]` on an `*Async` method without `[ActionName]` (the suffix-trim is a
framework option psq cannot see); method `[Route]` with no verb attribute (accepts every verb); public method with
no HTTP attribute under a class `[Route]`; abstract controller holding actions; derived controller whose repo-local
base carries the `[Route]` it lacks; `MapGet/Post/Put/Delete/Patch/Methods`; `MapControllerRoute`,
`MapDefaultControllerRoute`, `MapAreaControllerRoute`, `UseMvc`, `UseMvcWithDefaultRoute`.

## Gate results

- `pnpm typecheck`: exit 0.
- `pnpm test` (corpus config absent, so corpus tests skip): **37 files passed | 2 skipped; 462 tests passed | 58
  skipped** (the 58 matches the expected corpus-skip count). New tests: 8 fixture + 26 unit + 3 schema, plus 4
  merge cases appended; G23 changed in place.
- `test/web-schema-drift.test.ts` stayed green without edits: the web mirror does not mirror `routes` at all
  (`NOT_MIRRORED`), so `Route.handler` is not a new gap there. No allowlist change.
- Existing fixtures: **no expectation changed**. `mini-efcore-refs` has controllers named `*Controller` with no
  routing attributes: zero routes, zero new warnings (asserted in `test/mini-aspnet-routes.test.ts`).
  `mini-fullstack-csharp` has no controllers; its `g.routes` is still `[]`.
- Sweep: no `/Users/` or `/home/` in any added file; no corpus names.

## Mutants (each applied, test run RED, reverted, GREEN)

| # | Mutant | Failing tests |
|---|---|---|
| M1 | `combineTemplates` drops the `~/` override | `routes.test.ts` "api/x + ~/y -> y"; `mini-aspnet-routes` "reads exactly the hand-derived routes" (2) |
| M2 | `classAttrs` ignores `partial` union | `mini-aspnet-routes` "reads exactly the hand-derived routes" (1) |
| M3 | `[Area]` check never matches | `mini-aspnet-routes` "warns on every unsupported form", "emits no route for an unsupported form" (2) |
| M4 | `actionSafe: true` (no Async guard) | `mini-aspnet-routes` routes, warnings, no-route (3) |
| M5 | inherited-`[Route]` lookup returns null | `mini-aspnet-routes` warnings, no-route (2) |
| M6 | `handler.line` = attribute line | `mini-aspnet-routes` "reads exactly the hand-derived routes" (1) |
| M7 | `scanUnattributedRouting` drops the `.`-before-name guard | `routes.test.ts` "fires on a call, not on a comment, a string, or a declaration" (1) |
| M8 | `mergeGraphs` never links against .NET routes | `merge.test.ts` "matches a TS call…", "leaves a call unmatched…" (2) |
| M9 | merge links already-matched calls too | `merge.test.ts` "never overrides a match the node reader already made" (1) |
| M10 | `linkCalls` aspnet mode loses case folding | `routes.test.ts` "matches {id:int}…", `merge.test.ts` "matches a TS call…" (2) |
| M11 | `normaliseRoutePath` ignores aspnet mode | 7 in `routes.test.ts`, 2 in `merge.test.ts` (9) |
| M12 | `EXTRACTOR_VERSION` back to 3 | `rehydrate.test.ts` G23 (1) |

Not mutant-proven (said plainly): the scan-disabled mutant for `Program.cs` warnings was not run separately;
the `Program.cs` warning lines are in the exact-list assertion, and M7 covers the scanner's guard logic.
The `[Route]`+bare-verb combination and the escaped-bracket (`lit[[x]]`) paths are asserted by the fixture
list but were not given dedicated mutants.

## Open questions

1. **Inherited actions.** A derived controller inheriting actions from an abstract base is warned, not resolved.
   Resolving needs the derived class's own `[Route]` plus the base's methods; deferred on purpose.
2. **`Async` suffix.** MVC trims it from `[action]` by default. psq warns instead of assuming the default
   (it can't see `SuppressAsyncSuffixInActionNames`). If a repo never changes it, a default could be adopted.
3. **Areas.** A `[Area]` controller's attribute routes are in fact unaffected by the area; skipping them is the
   conservative reading of "areas → warning". Emitting them with the warning is a possible follow-up.
4. **`[Route]` without a verb** accepts every verb; no "any" method exists in the vocabulary, so it warns.
5. **Case-insensitive match** applies to the whole path including literal segments; query-string and
   trailing-slash differences are not normalised (same as the Express side).
6. **Corpus.** No corpus repo was run (config absent by design); real-repo warning counts from the new reader are
   unmeasured and should be checked on repoA..repoE before relying on "treat a new warning as a bug".
