# MCP: gate Flow count ordering, empty-Flow wording — audit

## What changed

Three changes, all in `apps/mcp` (records `feature-research/mcp-server-fixes-2/`).

### 1. Gate the Flow count-ordering term (new test + no prod code change)

`apps/mcp/src/brief.ts` orders entity-bearing routes in the Flow section with
`entsOf(b).length - entsOf(a).length || cmp(method+path)` (line 107). The prior test
`orders entity-bearing routes by entity count desc, then method and path` built both of
its routes on one shared handler, so their counts tied and deleting the count term left
every mcp test green — the count term was un-gated.

New test in `apps/mcp/test/tools.test.ts`: `puts a higher-count route first even when its
method+path sort later`. It gives the `POST`/`Create` handler two extra entities
(count 3) and adds a `List`-handler route `GET /api/aaa` (count 1). The higher-count route
`POST /api/zzz` (3) must render before the lower-count `GET /api/aaa` (1), even though
`GET …` sorts before `POST …` alphabetically. The test scopes to the Flow section only
(`## Flow`..`## Client-call`) — the Routes section also contains `→` for handler routes,
which made an earlier draft pass under the mutant.

Mutant (count term deleted → pure method+path sort): RED — `expected 6 to be less than 4`.
Reverted → GREEN. See **Gate results**.

### 2. Empty-Flow wording (one prod line + new test)

When no route's handler touches an entity (`bearing.length === 0`), the Flow section
showed only the `N more routes with handlers touching no entity directly …` line with
nothing above it. Added one line in `apps/mcp/src/brief.ts` (line 111):

```
if (bearing.length === 0) out.push("- no handler mentions an entity directly");
```

New test: `says no handler mentions an entity directly when none do` clears
`g.entityRefs` and asserts the Flow section contains the new line.

Mutant (line removed): RED — output shows only `25 more routes …`, no explanation line.
Reverted → GREEN.

### 3. Restore explicit-repo-id assertion in the warnings test

The `defaultRepo` field was dropped from `Ctx` (`apps/mcp/src/tools.ts`), and with it a
warnings assertion using `repo: ctx.defaultRepo` was removed. Restored it with an explicit
id captured from `openRefs()`:

```
const refsId = openRefs();
...
expect((tools.warnings.run(ctx, { repo: refsId }) as Json).cannotSee.join("\n")).not.toMatch(/wrapper functions/);
```

The assertion is placed after `openReact()`, so two repos are open and passing `refsId`
must select the refs repo (which has no client code → no wrapper-functions blind spot),
not the just-opened react repo. This is a restoration of deleted coverage, not a new test.

Mutant (deleted the `byId` explicit-id lookup in `resolveRepo`): RED —
`Unknown repo …` throw at `tools.test.ts:210`. Reverted → GREEN.

## Gate results

- `pnpm typecheck` — pass.
- `PSQ_NO_CORPUS=1 pnpm test` — **549 passed, 58 skipped** (corpus tests skip; the
  gitignored `test/corpus.local.json` is absent here, as expected). 45 test files, 2 skipped.
- `PSQ_NO_CORPUS=1 npx vitest run apps/mcp` — 48 passed (protocol + tools).

## Mutants

| Mutant | Code under test | Failing test(s) | RED | Reverted GREEN |
| --- | --- | --- | --- | --- |
| Delete `entsOf(b).length - entsOf(a).length \|\|` | `apps/mcp/src/brief.ts` Flow sort | `flow > puts a higher-count route first even when its method+path sort later` | yes (`6 < 4` failed) | yes |
| Delete `if (bearing.length === 0) out.push(…)` | `apps/mcp/src/brief.ts` Flow block | `flow > says no handler mentions an entity directly when none do` | yes | yes |
| Delete `byId` lookup in `resolveRepo` | `apps/mcp/src/tools.ts` | `warnings > only lists client blind spots for a repo with client code` | yes | yes |

## Files touched

- `apps/mcp/src/brief.ts`
- `apps/mcp/test/tools.test.ts`

No fixtures changed. Fixture anchor intact: `Dup.Sync` at line 55 of
`test/fixtures/mini-efcore-refs/Services/EnrollmentService.cs` and
`test/fixtures/mini-efcore-refs/Controllers/CoursesController.cs`.

## Determinism

No `Math.random`; tests use the seeded graph from the fixtures and only push entities with
fixed names (`Zed`, `Yank`). No new extraction warnings are produced on existing fixtures
(no extraction path changed).

## Open questions

- None. The existing `orders entity-bearing routes by entity count desc, then method and
  path` test still gates the method+path tie-break; the new test gates the count term.
