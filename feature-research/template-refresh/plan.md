# Phase A — refresh the template repo

Roadmap: `feature-research/m5b-component-attribution/roadmap.md`, Phase A.
Prerequisite (now satisfied): .NET 10 SDK. Verified `10.0.400`; `dotnet build server`
succeeds, 0 warnings / 0 errors, on `net10.0`.

**Working repo is NOT domain-expert.** All work happens in the fresh clone at
`~/Developer/vite-react-webapi-template` (branch `main`, at `22f1066`).
domain-expert is touched only for the audit/progress files.

Node: `export PATH="$HOME/.local/share/fnm/node-versions/v24.19.0/installation/bin:$PATH"`
(node 24.19.0, npm 11.17.0). This repo is **npm**, not pnpm.

## Authorisation

- Commit to a local branch `template-refresh`. **Do not push. Do not touch `main`.**
- Do not run `npm run shots` — it rewrites `client/public/screenshots/`. If it is
  run by accident, `git checkout -- client/public/screenshots`.

## Baseline (measured before any change, do not re-derive)

- `npm run build` (= `tsc -b && vite build`) passes. Bundle 645.87 kB.
- `npm audit` in `client/`: **1 high** — `nanoid <3.3.18`, GHSA-2v37-7h3g-55p8,
  reachable only through `shadcn`.
- 11 outdated in `client/`; `typescript` 6.0.3 vs latest 7.0.2.
- `client/e2e/**` and `client/playwright.config.ts` are in **no** tsconfig project.
- `composite` is absent from `tsconfig.app.json` and `tsconfig.node.json`. `tsc -b`
  tolerates this under TS 6.

## Step 1 — tsconfig coverage for e2e  (MUST be first; gates step 3)

Create `client/tsconfig.e2e.json` covering `e2e/**/*` and `playwright.config.ts`.
Base it on `tsconfig.node.json`'s shape (`module: nodenext`, `types: ["node"]`,
`lib: ["ES2023"]`, `noEmit`, `verbatimModuleSyntax`, `erasableSyntaxOnly`,
`moduleDetection: "force"`, `skipLibCheck`, `noUnusedLocals`, `noUnusedParameters`)
plus `lib: ["ES2023","DOM"]` — the specs use DOM types through Playwright's
`page.evaluate` — and its own `tsBuildInfoFile`.

Add it as a third `references` entry in `client/tsconfig.json`.

**Falsification is required, not optional.** A passing `tsc -b` proves nothing here,
because it passed before the file existed. Prove coverage by breaking it:

1. Insert a deliberate type error into `client/e2e/pages.spec.ts` (e.g. `const n: number = "x";`).
2. Run `npx tsc -b`. It **must fail**, and the error must name that file.
3. Remove the error, re-run, must pass.

Record the observed failure text in `audit.md`. If step 2 passes, the project is
not actually covering the file and the step is not done.

If the newly-typechecked files turn out to have real pre-existing type errors,
**fix the specs**, do not loosen the tsconfig to hide them. Report each in `audit.md`.

## Step 2 — dependency refresh

In `client/`:
- **Move `shadcn` from `dependencies` to `devDependencies`.** It is a build-time CLI.
  This is the sole cause of the audit finding.
- `npm update` to take the wanted/latest for: `@hookform/resolvers` 5.7.1→5.9.1,
  `@types/react-dom` →19.2.5, `@vitejs/plugin-react` →6.1.0, `lucide-react` →1.34.0,
  `motion` →13.1.1, `oxlint` →1.80.0, `react-hook-form` →7.86.0, `shadcn` →4.19.0,
  `vite` →8.2.2.
- `@types/node` `^24.13.3` → `^26` (major; needs an explicit range edit, `npm update`
  will not cross it).
- **Do not touch `typescript`.** It stays `~6.0.2` until step 3.

In the repo root:
- `concurrently` `^9.2.1` → `^10`.

After: `npm audit` in `client/` must report **0 vulnerabilities**. If `nanoid`
survives the shadcn move, report the actual dependency path rather than adding an
override.

## Step 3 — TypeScript 6 → 7  (LAST, separate branch, hard bail-out)

Branch `template-typescript-7` off `template-refresh` **after steps 1–2 are committed**.

Bump `typescript` to `^7`. Gate: `npx tsc -b` clean across all three projects,
then `npm run build` clean.

Expected friction: `verbatimModuleSyntax` + `erasableSyntaxOnly` are already on, so
the likely breaks are elsewhere — in particular `composite` is missing on the
referenced projects and TS 7 may require it for `tsc -b`. Adding `composite: true`
(plus whatever `declaration` settings it drags in) is in scope.

**Bail-out is explicit.** If `tsc -b` is not clean after a genuine bounded effort, or
if the fix requires changing application source semantics rather than config:
stop, leave the branch unmerged and uncommitted-or-committed-as-WIP, and write up in
`audit.md` exactly which diagnostics blocked it. A blocked TS 7 is an acceptable
outcome for this phase and blocks nothing downstream. **Do not weaken compiler
options to force it green** — that would hide the very thing the bump is for.

## Step 4 — verification

Run and record actual output for each. The e2e run is the one that the .NET 10
install unblocked, so it is the headline result.

1. `dotnet build server` — clean.
2. `client/`: `npm ci && npm run build` — clean, note the new bundle size.
3. `client/`: `npm audit` — 0 vulnerabilities.
4. `client/`: `npx playwright install` if needed, then `npm run e2e` — the 6
   functional tests in `pages.spec.ts` must pass. Playwright starts both servers
   itself (`dotnet run --project ../server` on :5170, `npm run dev` on :5173,
   120 s timeouts). **Before this phase, this hung for 120 s on the .NET server.**
   If it still fails, that is a finding to report, not something to route around.
5. `client/`: `npm run lint` (oxlint 1.80) — clean, or report new rules that fired.
6. Root: `npm run dev:all` — start it, confirm both prefixed streams appear
   (`-n client,server`, `-c cyan,magenta`), then Ctrl-C and confirm `--kill-others`
   still tears both down under concurrently 10. A major bump is exactly where these
   flags change.

## Files touched

In `~/Developer/vite-react-webapi-template`:
- `client/tsconfig.e2e.json` — **new**
- `client/tsconfig.json` — add the third project reference
- `client/package.json` — shadcn to devDeps, version bumps
- `client/package-lock.json` — regenerated
- `package.json` — concurrently `^10`
- `package-lock.json` — regenerated
- `client/e2e/pages.spec.ts`, `client/e2e/screenshots.spec.ts`,
  `client/playwright.config.ts` — **only if** newly-enabled typechecking finds real
  errors; otherwise untouched
- `client/tsconfig.app.json`, `client/tsconfig.node.json` — **only** under step 3,
  if TS 7 requires `composite`

In `~/Developer/domain-expert`:
- `feature-research/template-refresh/audit.md` — **new**

Nothing else. In particular: no `client/src/**` changes, no `server/**` changes, no
code-splitting of the 645 kB bundle (explicitly out of scope per the roadmap), and no
`main`-branch commits in either repo.

## Out of scope

- Code-splitting the bundle.
- Anything in Phase B (Northwind) or Phase C (vendoring, `programFor`, `detectProvider`).
- Merging or pushing the domain-expert `m5b-component-attribution` branch.
