# H-d: .NET attribute-route reader with Route.handler — plan

## Approach

1. **Structure reader** (`csharp/structure.ts`): keep what it already reads but
   discards. `AttributeRef` gains `line`; `TypeDecl` and `MethodDecl` gain
   `attributes`. No behaviour change for existing consumers.
2. **Route reader** (new `csharp/routes.ts`): pure over `FileParse[]` plus a
   per-file scan for the unsupported registration forms. Supported: controllers
   (`[ApiController]`, base `Controller`/`ControllerBase`, or `*Controller`
   name), class `[Route]` (several allowed), method `[HttpGet|Post|Put|Delete|
   Patch|Head|Options]` with/without template, method `[Route]` combined with
   verb attributes that carry no template, `[controller]` / `[action]` /
   `[ActionName]` substitution, `[[`/`]]` escapes, and ASP.NET's combination rule
   (`/x` or `~/x` on the action discards the class prefix).
3. **Warn, never guess** (`${file}:${line}: …`): `[AcceptVerbs]`, `[Area]`
   controllers, `[area]` token, unknown tokens, non-literal templates,
   `[action]` on an `*Async` method (the suffix-trim is a framework option psq
   cannot see), a verbless method `[Route]`, a controller whose base class
   (declared in the repo) carries the `[Route]` it lacks, public methods with no
   verb attribute on a class that has a class route, abstract controllers that
   hold actions, conventional routing (`MapControllerRoute`,
   `MapDefaultControllerRoute`, `MapAreaControllerRoute`, `UseMvc`) and minimal
   APIs (`MapGet/Post/Put/Delete/Patch/Methods`). A controller with no routing
   attribute anywhere stays silent, so existing fixtures gain no warning.
4. **Schema**: optional `Route.handler {type, method, file, line}`.
5. **Emit** from `dotnet.ts`; `Route.path` keeps ASP.NET syntax (`{id:int}`),
   leading `/`, params and constraints as written.
6. **Matching**: `linkCalls` normalisation learns `{…}` params (constraints,
   `?`, catch-all) and an opt-in case-insensitive compare; `mergeGraphs` links
   still-unmatched TS client calls against the .NET routes. ASP.NET routing is
   case-insensitive, Express' default match here stays exact.
7. `EXTRACTOR_VERSION` 3 → 4 and every literal pin.

## Files touched

`packages/extract/src/csharp/{structure,routes}.ts`, `dotnet.ts`, `merge.ts`,
`node/clients.ts` (the route-matching helper lives there), `detect.ts`,
`packages/extract/test/**`, `packages/schema/src/index.ts`,
`packages/schema/test/**`, `test/fixtures/mini-aspnet-routes/**` (new), new
`test/mini-aspnet-routes.test.ts`, expectation updates where output legitimately
changes, `test/web-schema-drift.test.ts` (allowlist only if it reddens).

## Gates

Fixture test with hand-written ground truth for every supported form and one of
each unsupported form (asserting the warning text); unit tests for template
combination and path normalisation; a merge test that matches a TS client call
to a .NET route; schema test that `handler` is optional; G23 pin at 4. Each gate
is proven with a mutant (recorded in audit.md).
