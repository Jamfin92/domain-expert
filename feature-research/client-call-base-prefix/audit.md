# client-call-base-prefix — audit

## What changed
- `packages/extract/src/node/clients.ts`
  - Reads `const X = axios.create({ baseURL })` (literal, or a `const` bound to a
    literal, resolved through the checker so an imported instance/const works)
    and `` `${CONST}/x` `` template heads. Trailing `/` is trimmed; a base that
    is not `""` or `/...` is unreadable.
  - The prefix is kept in a module `WeakMap` (`basePrefixOf` / `setBasePrefix`);
    `ClientCall.path` stays the literal text. **Schema untouched, no drift
    allowlist consequence, apps/web untouched.**
  - `linkCalls`: literal path first; prefix + path only if the literal found no
    candidate and the call declared a prefix. Ambiguity warning names the
    effective path.
  - Unreadable base: one warning per distinct expression text
    ("...is not a statically readable path prefix; calls through it may be
    unmatched"). Instance calls through it are still recorded (literal match
    still tried); a `fetch` template with an unreadable head is not recorded
    (as before) but warns. Non-fetch, non-instance receivers (`map.get(...)`)
    stay silent.
  - `readClientCalls` gained an optional trailing `checker` parameter; without
    it no base is read (old behaviour).
- `packages/extract/src/merge.ts`: `mergeGraphs` copies node calls by spread,
  which would drop the side-table entry; it re-registers each prefix on the copy.
- **Outside the stated list:** `packages/extract/src/node.ts`, one line,
  passes `checker` to `readClientCalls`. Needed for cross-file resolution.
- Tests: `packages/extract/test/client-base.test.ts` (10 tests); fixture
  `test/fixtures/mini-client-base/` (axios instance, const-prefix template,
  env-var instance base, env-var fetch head, literal `/api/...` control, a
  prefix with no route). The .NET side is hand-written routes in the test.
  Fixture is typechecked, so axios is a local `declare const`.

## Decisions
- `apiPrefix` override: skipped. `packages/extract` has no config surface
  (the only config code is in `apps/server`, out of scope); adding one is a
  separate change.
- The schema comment on `ClientCall` still says calls relative to a configured
  baseURL "match nothing"; now only partly true. Not edited (packages/schema
  out of scope). Follow-up.
- This change alters extraction output (more template calls recorded, more
  matches, new warnings on repos with env bases). `EXTRACTOR_VERSION` NOT
  bumped, per instructions; the owner of the bump in this wave must cover it.

## Gates
- `pnpm typecheck`: pass.
- `PSQ_NO_CORPUS=1 pnpm test`: 42 files passed, 2 skipped; 513 tests passed,
  58 skipped. No new warning on any existing fixture (all suites green).
- `pnpm test:e2e`: not run (forbidden).

## Mutants (each applied alone to the committed code, reverted after; all in
`client-base.test.ts`)
| # | mutant | RED tests |
|---|--------|-----------|
| m1 | prefix fallback disabled (`false && base`) | matching via mergeGraphs; linkCalls falls back only when declared; ambiguity warning names effective path (3) |
| m2 | prefix tried first instead of literal first | linkCalls prefers the literal path (1) |
| m3 | warning dedupe removed | warns once per distinct base; merge carries warnings (2) |
| m4 | merge drops the prefix on copy | matching via mergeGraphs (1) |
| m5 | instance unreadable-base warning removed | warns once; merge carries warnings (2) |
| m6 | template-head unreadable warning removed | warns once; merge carries warnings (2) |
| m7 | template const head not added to prefix | keeps literal path + prefix; matching (2) |
| m8 | prefix not validated/trailing `/` not trimmed | keeps literal path + prefix; matching (2) |
| m9 | unreadable template head still recorded | prefix record; unrecorded-call; matching (3) |

## Open questions
- Absolute `baseURL` (`https://host/api`) is treated as unreadable (warned),
  not stripped to its path. Stripping would be a reasonable follow-up.
- Only `axios.create` instances and `const` literals; `let`, object-property
  consts, `API + "/x"` concatenation remain silent misses.
- The measured real-pair improvement (1/50 -> ?) was not re-measured: no corpus
  in this worktree.
