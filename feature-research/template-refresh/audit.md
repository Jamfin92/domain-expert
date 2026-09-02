# Phase A — template refresh audit

Repo: `~/Developer/vite-react-webapi-template` (not domain-expert).
Node: v24.19.0 / npm 11.17.0 (fnm path exported per plan). .NET SDK 10.0.400.

## Files changed

Branch `template-refresh` (off `main` @ `22f1066`):
- `client/tsconfig.e2e.json` — new
- `client/tsconfig.json` — added third project reference (`tsconfig.e2e.json`)
- `client/package.json` — `shadcn` moved dependencies → devDependencies; version
  bumps (see Step 2 below); `@types/node` `^24.13.3` → `^26.0.0`
- `client/package-lock.json` — regenerated
- `package.json` — `concurrently` `^9.2.1` → `^10.0.0`
- `package-lock.json` — regenerated

Branch `template-typescript-7` (off `template-refresh` @ `6a3b748`):
- `client/package.json` — `typescript` `~6.0.2` → `^7.0.2`
- `client/package-lock.json` — regenerated

Not touched (no changes needed): `client/e2e/pages.spec.ts`,
`client/e2e/screenshots.spec.ts`, `client/playwright.config.ts`,
`client/tsconfig.app.json`, `client/tsconfig.node.json`.

In domain-expert:
- `feature-research/template-refresh/audit.md` — this file, new

## Commit SHAs

- `template-refresh`:
  - `b08b35c` — client: add tsconfig.e2e.json to cover e2e/** and playwright.config.ts
  - `6a3b748` — deps: move shadcn to devDependencies, refresh client/root deps
- `template-typescript-7`:
  - `4238834` — client: bump typescript ~6.0.2 -> ^7.0.2 (branched from `6a3b748`)
- `main` — unchanged, still `22f1066`, working tree clean, never checked out for
  edits, never pushed.

## Step 1 — tsconfig coverage for e2e

Created `client/tsconfig.e2e.json` based on `tsconfig.node.json`'s shape
(`module: nodenext`, `types: ["node"]`, `noEmit`, `verbatimModuleSyntax`,
`erasableSyntaxOnly`, `moduleDetection: "force"`, `skipLibCheck`,
`noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`) plus
`lib: ["ES2023", "DOM"]` and its own `tsBuildInfoFile`. `include`:
`["e2e/**/*", "playwright.config.ts"]`. Added as the third entry in
`client/tsconfig.json`'s `references`.

### Falsification (required step)

1. Baseline run before falsification — `npx tsc -b` — passed (exit 0), proving
   nothing on its own.
2. Inserted `const n: number = "x"` at the top of `client/e2e/pages.spec.ts`.
3. Ran `npx tsc -b`. **Observed actual output:**
   ```
   e2e/pages.spec.ts(3,7): error TS2322: Type 'string' is not assignable to type 'number'.
   e2e/pages.spec.ts(3,7): error TS6133: 'n' is declared but its value is never read.
   ```
   Exit code: 2. The error names the file — coverage confirmed as real, not
   accidental.
4. Removed the deliberate error, reran `npx tsc -b` — exit 0, clean, and
   `git diff` showed `pages.spec.ts` byte-identical to its pre-falsification
   state (only `tsconfig.json`/`tsconfig.e2e.json` remained staged).

No pre-existing type errors were found in `e2e/pages.spec.ts`,
`e2e/screenshots.spec.ts`, or `playwright.config.ts` once newly covered — so
per the plan, none of those files were touched in the final commit.

## Step 2 — dependency refresh

`shadcn` moved from `dependencies` to `devDependencies` in
`client/package.json`.

`npm update` results (installed versions, all matching the plan's targets
except one):

| package | target | installed |
|---|---|---|
| @hookform/resolvers | 5.9.1 | 5.9.1 |
| @types/react-dom | 19.2.5 | 19.2.5 |
| @vitejs/plugin-react | 6.1.0 | **6.0.5** (see deviation below) |
| lucide-react | 1.34.0 | 1.34.0 |
| motion | 13.1.1 | 13.1.1 |
| oxlint | 1.80.0 | 1.80.0 |
| react-hook-form | 7.86.0 | 7.86.0 |
| shadcn | 4.19.0 | 4.19.0 |
| vite | 8.2.2 | 8.2.2 |
| @types/node | ^26 (explicit edit) | 26.3.0 |
| typescript | held at ~6.0.2 | 6.0.3 (patch only, via `npm install`) |

Root `package.json`: `concurrently` `^9.2.1` → `^10.0.0`, resolved `10.0.5`.

### Deviation: @vitejs/plugin-react stopped at 6.0.5, not 6.1.0

`npm update @vitejs/plugin-react` (run with the full list of packages named in
the plan, no `--force`/`--legacy-peer-deps`) resolved `6.0.5`, not the
plan-listed `6.1.0`. Confirmed by attempting an explicit
`npm install @vitejs/plugin-react@6.1.0`, which failed on its own:

```
npm error Could not resolve dependency:
npm error dev @vitejs/plugin-react@"6.1.0" from the root project
npm error Conflicting peer dependency: @babel/core@8.0.1
npm error node_modules/@babel/core
npm error   peer @babel/core@"^8.0.0" from @babel/plugin-transform-runtime@8.0.1
npm error   node_modules/@babel/plugin-transform-runtime
npm error     peerOptional @babel/plugin-transform-runtime@"^7.29.0 || ^8.0.0-rc.1" from @rolldown/plugin-babel@0.2.3
npm error       peerOptional @rolldown/plugin-babel@"^0.1.7 || ^0.2.0" from @vitejs/plugin-react@6.1.0
npm error         dev @vitejs/plugin-react@"6.1.0" from the root project
```

6.1.0 pulls in an optional peer chain (`@rolldown/plugin-babel` →
`@babel/plugin-transform-runtime@8`) that conflicts with the
`@babel/core@8.0.1` already resolved elsewhere in the tree. The plan
authorises `npm update` only, not `--force`/`--legacy-peer-deps`, so this was
left at the version npm resolved on its own (6.0.5) and reported here rather
than forced.

### npm audit — did NOT reach 0 vulnerabilities; sole-cause assumption was wrong

Plan's baseline stated nanoid was reachable "only through shadcn" and expected
`npm audit` to report 0 vulnerabilities after the devDependencies move.
Actual observed result after the move, `npm ci`, and all updates:

```
# npm audit report

nanoid  <3.3.18
Severity: high
nanoid: custom generators can loop indefinitely when size is zero - https://github.com/advisories/GHSA-2v37-7h3g-55p8
fix available via `npm audit fix`
node_modules/nanoid

1 high severity vulnerability
```

Same result with `npm audit --omit=dev`. Traced the actual path with
`npm ls nanoid --omit=dev`:

```
client@0.0.0 ~/Developer/vite-react-webapi-template/client
└─┬ @tailwindcss/vite@4.3.3
  └─┬ vite@8.2.2
    └─┬ postcss@8.5.26
      └── nanoid@3.3.17
```

`@tailwindcss/vite` is a production dependency; it pulls `vite`, whose
`postcss@8.5.26` (the latest published postcss release as of this run) pins
`nanoid: "^3.3.17"`, which resolves to `3.3.17` — below the `3.3.18` fix
threshold in GHSA-2v37-7h3g-55p8. This path exists independent of `shadcn`
entirely (confirmed separately: `npm ls postcss` shows both `shadcn` and
`vite` depending on the same deduped `postcss@8.5.26`). So the shadcn move
removed one incidental path to `nanoid` but was never the sole cause — the
finding is unfixable at the client level without a postcss major bump (out of
scope) or an override, and the plan explicitly says not to add an override.
Reported as-is; no override added.

## Step 3 — TypeScript 6 → 7

Branch `template-typescript-7` created off `template-refresh` (`6a3b748`).
Latest stable `typescript` on npm at run time: `7.0.2` (only `7.x` stable
release; everything past it was `7.1.0-dev.*` prereleases) — bumped
`typescript` to `^7.0.2`, installed `7.0.2`.

**Result: landed clean, no bail-out needed, no config changes required.**

- `npx tsc -b` (after `rm -rf node_modules/.tmp` and `--force` to rule out
  stale cache): exit 0, clean across all three projects (`tsconfig.app.json`,
  `tsconfig.node.json`, `tsconfig.e2e.json`). Verbose log confirmed all three
  projects were rebuilt from scratch, not skipped via cache.
- Verified `noEmit` held (no stray `.js` files landed in `src/` despite the
  verbose "'src/App.js' does not exist" build message, which `tsc -b -v`
  prints regardless of `noEmit`).
- `npm run build` (`tsc -b && vite build`): clean, exit 0. Bundle unchanged
  at 647.18 kB (identical output to the Step 2 build — TS 7 did not affect
  the emitted bundle).
- `composite` was **not** required on `tsconfig.app.json` / `tsconfig.node.json`
  — the plan's "expected friction" did not materialize. No application source
  changes, no compiler-option changes, no weakening of anything.

Committed as `4238834` on `template-typescript-7`. Branch is a clean,
complete commit (not left as WIP) since it succeeded outright.

## Step 4 — verification (all on `template-refresh` @ `6a3b748`)

1. **`dotnet build server`** — clean:
   ```
   Build succeeded.
       0 Warning(s)
       0 Error(s)
   Time Elapsed 00:00:00.72
   ```

2. **`npm ci && npm run build`** (client) — clean. `npm ci`: "added 440
   packages, and audited 441 packages in 2s" (1 high vuln reported, see Step
   2). Build output:
   ```
   dist/assets/index-DzmiGmPW.css   71.33 kB │ gzip:  12.28 kB
   dist/assets/index-BSc-BSw_.js   647.18 kB │ gzip: 207.51 kB
   ✓ built in 411ms
   ```
   New bundle size: **647.18 kB** (baseline was 645.87 kB — +1.31 kB from the
   dependency bumps; unchanged from Step 2's build, no code-splitting done,
   per scope).

3. **`npm audit`** (client) — **NOT** 0 vulnerabilities. Still reports the 1
   high nanoid finding documented in Step 2 above (`@tailwindcss/vite` →
   `vite` → `postcss` → `nanoid` path, independent of shadcn). This is the
   headline deviation from the plan's expected step-4 outcome; reported per
   plan instructions ("report the actual dependency path rather than adding
   an override"), no override added.

4. **`npx playwright install` + `npm run e2e`** — the headline result. First
   attempt (before `playwright install`) failed for all 7 tests with:
   ```
   Error: browserType.launch: Executable doesn't exist at
   ~/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell
   ```
   (installed cache only had `chromium_headless_shell-1228`; the
   `@playwright/test@1.62.1` in the tree pins `-1234`). Ran
   `npx playwright install`, which downloaded Chromium headless shell 151.0
   (build 1234), Firefox 153.0, and WebKit 26.5. Re-ran `npm run e2e`:
   ```
   Running 7 tests using 7 workers
     ✓  1 [chromium] › e2e/pages.spec.ts:63:3 › dos & don'ts › renders every rule with a Don't/Do pair (379ms)
     ✓  4 [chromium] › e2e/pages.spec.ts:54:3 › pagination › deep-links to a page via the URL (435ms)
     ✓  3 [chromium] › e2e/pages.spec.ts:4:3 › guide (bento README) › renders the parsed README as cards and proves the server pipe (480ms)
     ✓  6 [chromium] › e2e/pages.spec.ts:27:3 › form › shows zod errors for invalid input (738ms)
     ✓  5 [chromium] › e2e/pages.spec.ts:35:3 › form › submits a valid form to the server (806ms)
     ✓  7 [chromium] › e2e/pages.spec.ts:46:3 › pagination › serves page 1 from the server and navigates by click (845ms)
     ✓  2 [chromium] › e2e/pages.spec.ts:16:3 › carousel › advances slides and updates the counter (742ms)
     7 passed (5.0s)
   ```
   All 7 functional tests in `pages.spec.ts` passed (plan text said "6"; the
   file actually contains 7 `test(...)` cases across the 4 `describe` blocks
   — guide, carousel, form ×2, pagination ×2, dos & don'ts — all 7 passed).
   `screenshots.spec.ts` (tagged `@shots`) was correctly excluded by
   `--grep-invert @shots` and not run, per the plan's "do not run `npm run
   shots`" rule. This is the run the .NET 10 SDK install unblocked — Playwright
   started both servers (`dotnet run --project ../server` on :5170, `npm run
   dev` on :5173) itself and the 120 s `webServer` timeouts were never
   approached; total run time 5.0s. No prior 120 s hang was reproduced.

5. **`npm run lint`** (oxlint 1.80.0) — exit 0. 6 warnings emitted, all in
   `client/src/**`, none in files touched by this plan:
   ```
   src/lib/markdown.ts:83:7: warning eslint(no-unused-expressions)
   src/pages/form-page.tsx:82:22: warning react(incompatible-library)
   src/components/ui/button.tsx:67:18: warning react(only-export-components)
   src/lib/useApi.ts:23:5: warning react(set-state-in-effect)
   src/components/ui/navigation-menu.tsx:163:3: warning react(only-export-components)
   src/components/ui/carousel.tsx:239:3: warning react(only-export-components)
   src/components/ui/carousel.tsx:96:5: warning react(set-state-in-effect)
   ```
   Could not confirm against a true oxlint-1.75 baseline (no snapshot taken
   before the bump), so it is not certain which of these are newly-fired
   rules vs. pre-existing. All are in `client/src/**`, which is explicitly
   out of scope for edits under this plan ("no `client/src/**` changes"), so
   none were touched. Reporting as-is per the plan's "or report new rules
   that fired" fallback.

6. **`npm run dev:all`** (root, concurrently 10.0.5) — started successfully.
   Observed log confirmed both prefixed streams:
   ```
   [client] > vite
   [client]   VITE v8.2.2  ready in 118 ms
   [client]   ➜  Local:   http://localhost:5173/
   [server] dotnet watch 🔥 Hot reload enabled...
   [server] Build succeeded.
   [server]     0 Warning(s)
   [server]     0 Error(s)
   ```
   Sent SIGINT to the `concurrently` process (equivalent to Ctrl-C in an
   interactive terminal). Observed teardown log:
   ```
   [client] npm --prefix client run dev exited with code SIGINT
   --> Sending SIGTERM to other processes..
   [server] dotnet watch --project server exited with code 130
   ```
   Confirmed via `ps` immediately after that no `concurrently`, `dotnet
   watch --project server`, or `vite` processes from this repo remained —
   `--kill-others` still works correctly under concurrently 10.

## Decisions made

- Left `@vitejs/plugin-react` at 6.0.5 rather than forcing 6.1.0, since the
  peer conflict requires a flag the plan didn't authorise. Reported instead of
  routed around.
- Did not add an npm override for nanoid even though the audit finding
  persists, per explicit plan instruction.
- Did not touch `client/src/**` despite 6 lint warnings surfacing on the
  bumped oxlint, since those files are out of scope and the warnings do not
  fail the lint command (exit 0).
- TS 7 required zero config/source changes, so `composite` was never added and
  `tsconfig.app.json`/`tsconfig.node.json` are untouched — the plan only
  authorised that change "if TS 7 requires it," and it did not.
- Ran `npx playwright install` as an explicit, plan-authorised step before the
  e2e run, since the installed browser cache didn't match the pinned
  `@playwright/test` build.

## Open risks / follow-ups for a later phase

- The nanoid/postcss audit finding is not resolvable within this template
  without either an override (disallowed by plan) or waiting on upstream
  postcss to bump its nanoid pin past 3.3.18. Worth a standalone follow-up if
  0-vuln is a hard requirement later.
- `@vitejs/plugin-react` is one minor version behind latest (6.0.5 vs 6.1.0)
  due to the `@rolldown/plugin-babel`/`@babel/core@8` peer conflict; revisit
  once that resolves upstream.
- No oxlint-1.75 baseline snapshot was taken, so the 6 warnings in
  `client/src/**` could not be conclusively classified as new-vs-pre-existing;
  flagged, not fixed (out of scope).
- Bundle grew from 645.87 kB → 647.18 kB from the dependency bumps alone; no
  code-splitting was attempted, per explicit out-of-scope instruction.

## What could not be completed

Nothing in the plan was left undone. Step 3 (TS 7) succeeded outright rather
than bailing out, so there is no blocked-diagnostics writeup to include — TS 7
is fully landed on `template-typescript-7` and ready to merge whenever the
orchestrator chooses.

Neither branch was pushed. `main` was never checked out for edits and remains
at `22f1066` with a clean working tree, confirmed by `git status --short`
after switching back to it at the end of the session.

---

## Addendum — reviewer-flagged correction: nanoid gate was reachable, not attempted

The reviewer returned one Blocking issue on the first pass: the original
audit concluded the nanoid finding was "unfixable at the client level without
a postcss major bump (out of scope) or an override." **That conclusion was
wrong**, and `npm audit fix` was never actually tried before writing it.

### Corrected reasoning

`postcss@8.5.26` declares `"nanoid": "^3.3.17"`. The patched `3.3.18` already
satisfies that semver range — `npm audit fix` only needs to re-resolve the
lockfile to the top of the already-declared range, not bump `postcss` to a
new major or force anything. This is a plain, in-range lockfile fix, not the
either/or the original audit presented.

### Corrected dependency trace

The original audit's `npm ls postcss --omit=dev` output was read too
narrowly. `postcss@8.5.26` (and therefore `nanoid`) is reachable through
**two** parents, not one:

```
client@0.0.0
├─┬ shadcn@4.19.0
│ └── postcss@8.5.26
└─┬ vite@8.2.2  (dep of @tailwindcss/vite, a production dependency)
  └── postcss@8.5.26 deduped
```

Both paths dedupe to the same `postcss@8.5.26` → `nanoid@3.3.17` in the
lockfile. Fixing the lockfile resolution fixes both paths at once — there
was never a need to choose between "unfixable" and "add an override."

### Fix applied — `template-refresh`

Ran, in `client/`, on the already-committed `6a3b748` tip, working tree
clean beforehand:

```
$ npm audit fix
removed 1 package, changed 2 packages, and audited 441 packages in 583ms
found 0 vulnerabilities
```

No flags (`--force` / `--legacy-peer-deps` not used, not needed).

**Verified `client/package.json` untouched:**
```
$ git diff --stat
 client/package-lock.json | 6 +++---
 1 file changed, 3 insertions(+), 3 deletions(-)
$ git diff client/package.json
(empty)
```

**Verified nanoid version and audit:**
```
$ node -p "require('./node_modules/nanoid/package.json').version"
3.3.18
$ npm audit
found 0 vulnerabilities
```

**Re-verification, all on `template-refresh`:**

- `npm run build` — clean, identical output to the pre-fix build:
  `dist/assets/index-BSc-BSw_.js  647.18 kB │ gzip: 207.51 kB` (same file
  hash `BSc-BSw_` as before the fix — confirms the audit fix touched only
  transitive dev-path resolution, not anything that reaches the bundle).
- `npm run e2e` — all 7 tests passed:
  ```
  Running 7 tests using 7 workers
    ✓ dos & don'ts › renders every rule with a Don't/Do pair (582ms)
    ✓ pagination › deep-links to a page via the URL (538ms)
    ✓ guide (bento README) › renders the parsed README as cards and proves the server pipe (620ms)
    ✓ pagination › serves page 1 from the server and navigates by click (647ms)
    ✓ form › shows zod errors for invalid input (663ms)
    ✓ form › submits a valid form to the server (674ms)
    ✓ carousel › advances slides and updates the counter (708ms)
  7 passed (3.6s)
  ```
- `npm run lint` — exit 0, same 6 pre-existing warnings in `client/src/**` as
  before (unchanged set, confirming the fix didn't touch anything lint-visible).

Committed as its own commit on `template-refresh`:

```
121911e client: npm audit fix resolves nanoid to 3.3.18, 0 vulnerabilities
```

`template-refresh` now: `121911e` (was `6a3b748`).

### Carried onto `template-typescript-7`

`template-typescript-7` was based on the pre-fix `6a3b748` and would
otherwise have kept the vulnerable lockfile. Rebased onto the new
`template-refresh` tip:

```
$ git checkout template-typescript-7
$ git rebase template-refresh
Rebasing (1/1)
Successfully rebased and updated refs/heads/template-typescript-7.
```

Rebase applied with **no conflicts** — `package-lock.json` merged cleanly
(the TS 7 bump and the audit fix touched non-overlapping regions of the
lockfile). Commit `4238834` was rewritten to `95855ff`.

**Re-verification on `template-typescript-7` (`95855ff`):**

- `npm install` — "audited 442 packages ... found 0 vulnerabilities" (audit
  fix carried through the rebase correctly, no manual reapplication needed).
- `npx tsc -b --force` (after `rm -rf node_modules/.tmp` to rule out cache) —
  exit 0, clean across all three projects (`tsconfig.app.json`,
  `tsconfig.node.json`, `tsconfig.e2e.json`). `typescript` confirmed still
  `7.0.2`.
- `npm run build` — clean, identical bundle: `dist/assets/index-BSc-BSw_.js
  647.18 kB │ gzip: 207.51 kB` — same hash as `template-refresh`'s build,
  confirming TS 7 + the audit fix together produce the same output as either
  change alone.
- `npm audit` — `found 0 vulnerabilities`.

Both branches' working trees are clean after all verification
(`git status --short` empty on both). Neither branch was pushed. `main` was
not touched and remains at `22f1066`.

### Final commit SHAs

- `template-refresh`: `121911e` (was `6a3b748` before this addendum)
  - `b08b35c` — tsconfig.e2e.json coverage
  - `6a3b748` — shadcn to devDeps, dependency refresh
  - `121911e` — npm audit fix, 0 vulnerabilities
- `template-typescript-7`: `95855ff` (rewritten from `4238834` by rebase)
  - based on `121911e`, plus the TS 7 bump

---

## Addendum 2 — fold `template-typescript-7` into `template-refresh`

Per user decision, Phase A ships as a single branch. `template-typescript-7`
was rebased directly onto `template-refresh`'s `121911e`, so the merge was
required to be — and was — a fast-forward.

### Merge

```
$ git checkout template-refresh
Already on 'template-refresh'
$ git merge --ff-only template-typescript-7
Updating 121911e..95855ff
Fast-forward
 client/package-lock.json | 375 ++++++++++++++++++++++++++++++++++++++++++++++-
 client/package.json      |   2 +-
 2 files changed, 369 insertions(+), 8 deletions(-)
```

Fast-forward succeeded on the first attempt — no merge commit created, no
force needed. `template-refresh` is now at `95855ff`, history is linear:

```
95855ff client: bump typescript ~6.0.2 -> ^7.0.2
121911e client: npm audit fix resolves nanoid to 3.3.18, 0 vulnerabilities
6a3b748 deps: move shadcn to devDependencies, refresh client/root deps
b08b35c client: add tsconfig.e2e.json to cover e2e/** and playwright.config.ts
22f1066 fix: theme hover menus close before pointer reaches them   (= main)
```

### Branch cleanup

```
$ git branch -d template-typescript-7
Deleted branch template-typescript-7 (was 95855ff).
```

Safe form succeeded (branch was fully merged, as expected from a
fast-forward). Only `main` and `template-refresh` remain:

```
  main             22f1066 fix: theme hover menus close before pointer reaches them
* template-refresh 95855ff client: bump typescript ~6.0.2 -> ^7.0.2
```

### Re-verification on folded `template-refresh` (`95855ff`)

- `npm install` — "found 0 vulnerabilities" (sync only, lockfile already
  correct from the fast-forward).
- `npx tsc -b --force` (after `rm -rf node_modules/.tmp`) — exit 0, clean
  across all three projects (`tsconfig.app.json`, `tsconfig.node.json`,
  `tsconfig.e2e.json`). `typescript` confirmed `7.0.2`.
- `npm run build` — clean:
  ```
  dist/assets/index-DzmiGmPW.css   71.33 kB │ gzip:  12.28 kB
  dist/assets/index-BSc-BSw_.js   647.18 kB │ gzip: 207.51 kB
  ✓ built in 227ms
  ```
  Bundle hash `index-BSc-BSw_.js` / 647.18 kB confirmed identical to every
  prior build in this phase.
- `npm audit` — `found 0 vulnerabilities`.
- `npm run e2e` — all 7 tests passed:
  ```
  Running 7 tests using 7 workers
    ✓ dos & don'ts › renders every rule with a Don't/Do pair (465ms)
    ✓ pagination › deep-links to a page via the URL (563ms)
    ✓ form › submits a valid form to the server (648ms)
    ✓ pagination › serves page 1 from the server and navigates by click (588ms)
    ✓ form › shows zod errors for invalid input (566ms)
    ✓ guide (bento README) › renders the parsed README as cards and proves the server pipe (553ms)
    ✓ carousel › advances slides and updates the counter (592ms)
  7 passed (5.5s)
  ```
- `npm run lint` — exit 0, same 6 pre-existing `client/src/**` warnings as
  every prior run in this phase, unchanged set.

`git status --short` empty on `template-refresh` after all verification.
`main` confirmed unchanged at `22f1066`. Neither branch was pushed at any
point in this phase.

### Final state

Phase A ships as one branch: **`template-refresh` @ `95855ff`**, local,
unpushed, linear history of 4 commits on top of `main`'s `22f1066`.
`template-typescript-7` no longer exists (merged and deleted).
