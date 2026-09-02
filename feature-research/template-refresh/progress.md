# Phase A (template refresh) — progress

Status: **SHIPPED, reviewer-approved (verdict: Ship), and folded to a single
branch on 2026-08-27. NOT pushed, `main` untouched. Nothing left open.**

Do not re-explore. Everything below was measured, not recalled. Full command
output is in `feature-research/template-refresh/audit.md`; the approved plan is
`feature-research/template-refresh/plan.md`.

## What shipped

Working repo: `~/Developer/vite-react-webapi-template` (npm, not pnpm).

| branch | head | contents |
|---|---|---|
| `main` | `22f1066` | untouched, matches `origin/main` |
| `template-refresh` | `95855ff` | **the refreshed template.** Everything below. |

`template-typescript-7` no longer exists — it was folded into `template-refresh`
by `git merge --ff-only` (a genuine fast-forward, no merge commit) and deleted
with the safe `git branch -d`. Only `main` and `template-refresh` remain locally.

Commit chain: `b08b35c` (tsconfig.e2e.json + third project reference) →
`6a3b748` (shadcn to devDeps, dep refresh, root `concurrently ^10`) →
`121911e` (`npm audit fix` lockfile, 3 lines) → `95855ff` (typescript `^7.0.2`).

`git ls-remote --heads origin` shows only `main` and `console-host`. **Neither
branch exists on the remote.** Nothing was pushed.

Six files touched, exactly the plan's Files-touched list:
`client/tsconfig.e2e.json` (new), `client/tsconfig.json`, `client/package.json`,
`client/package-lock.json`, `package.json`, `package-lock.json`.
No `client/src/**`, no `server/**`, no `tsconfig.app.json`/`tsconfig.node.json`.

## Verified end state (reviewer reproduced all of it by running, not reading)

- `dotnet build server` — 0 warnings, 0 errors, net10.0.
- `npm run build` — clean, bundle **647.18 kB**, asset `index-BSc-BSw_.js`.
  Identical hash on both branches. Baseline was 645.87 kB.
- `npm audit` in `client/` — **0 vulnerabilities**, both branches.
- `npm run e2e` — **7/7 passed in ~3.6 s.**
- `npm run lint` (oxlint 1.80) — exit 0, 6 warnings, all pre-existing in
  `client/src/**`, all out of scope.
- `npm run dev:all` — both prefixed streams appear; SIGINT, `--kill-others` still
  tears both down under concurrently 10.0.5, no orphans.
- `client/public/screenshots/` — empty diff across `22f1066..template-refresh`.
  `npm run shots` was never run.

## Three roadmap facts that are now stale — do not carry them forward

1. **The .NET blocker is gone.** `dotnet --list-sdks` → 10.0.400 only. The
   "`npm run e2e` hangs 120 s on `dotnet run`" note is dead; e2e now runs in 3.6 s.
2. **TS 7 needed no config change at all.** The plan predicted `composite` would
   be required for `tsc -b`. It was not. `composite` is still absent from all
   three tsconfigs. Verified genuine, not a stale-`.tsbuildinfo` no-op:
   `node_modules/.tmp` deleted, `tsc -b --force -v` shows all three projects
   forcibly rebuilt, exit 0, `tsc --version` = 7.0.2.
3. **The plan said "6 functional tests in `pages.spec.ts`". Wrong — there are 7**,
   across 4 describe blocks. Every test in `screenshots.spec.ts` is tagged
   `@shots`, so `--grep-invert @shots` excludes that file completely.

## Two corrections to the record (the audit had these wrong first time)

The reviewer caught one Blocking issue; it was fixed and re-reviewed clean.

- **nanoid was never caused solely by `shadcn`.** Moving shadcn to devDeps was
  right on its own merits but did not clear the finding. `postcss@8.5.26` is
  reached through **two** parents — `shadcn@4.19.0` and `@tailwindcss/vite → vite`
  — and postcss is what carries nanoid.
- **It was fixable, and the first audit wrongly called it unfixable.**
  `postcss` declares `nanoid: "^3.3.17"`, which `3.3.18` already satisfies. Plain
  `npm audit fix` — no `--force`, no override, no `package.json` change — resolved
  it. `client/package.json` is byte-identical; only 3 lockfile lines moved.

`audit.md` corrects both in an addendum at line 329, but the original wrong text
still stands unedited at line 154. Cosmetic; the reviewer did not require an edit.

## Deviation accepted, not forced

`@vitejs/plugin-react` stopped at **6.0.5**, not the plan's 6.1.0 target. 6.1.0 has
a real peer conflict (`@rolldown/plugin-babel` → `@babel/plugin-transform-runtime@8`
vs resolved `@babel/core@8.0.1`) needing `--force`/`--legacy-peer-deps`, which the
plan did not authorise. `package.json` keeps `^6.0.4`, which already permits 6.0.5,
so package.json and lockfile agree. Left as a follow-up, not a defect.

## Standing user decisions (do not re-ask)

1. **Push policy: commit to local branches only. No push, no `main`.** The user
   reviews the diff and authorises any push as a separate explicit step.
   This still applies — Phase A is approved, but **not** approved to push.
2. **TS 6→7 was to be attempted last, on its own branch, with a hard bail-out**,
   and never by weakening compiler options. It landed clean, so the bail-out
   never fired and no options were weakened.

## Settled: one branch, and it carries TS 7

The plan kept TS 7 on its own branch because a blocked TS 7 was an acceptable
outcome. It landed clean, so on 2026-08-27 **the user decided it folds in**.

**Phase B forks `template-refresh` @ `95855ff`.** That is "the refreshed
template" — there is no second branch to reconcile, and it is already on TS 7.0.2.

Re-verified after the fold, not assumed: `tsc -b --force` exit 0 across all three
projects, build clean at the same `index-BSc-BSw_.js` / 647.18 kB, `npm audit` 0
vulnerabilities, e2e 7/7, lint exit 0.

Still **not pushed** — the push decision is separate and the user has not given it.

## Where this sits in the programme

`feature-research/m5b-component-attribution/roadmap.md` defines four phases.

- **Phase D (M5b, component attribution) — SHIPPED.** Committed on branch
  `m5b-component-attribution` in domain-expert. **Not merged to `master`, not
  pushed.** The user knows and left it alone. Do not land it without asking.
- **Phase A — DONE, this file.**
- **Phase B — Northwind testbed. NEXT.** Forks the refreshed template. Biggest
  phase, almost entirely greenfield.
- **Phase C — vendor the testbed in, fix `programFor`/`detectProvider`.** B gates C.

## Template shape Phase B will need (measured, still accurate)

- `client/src/`: `App.tsx`, `main.tsx`, `routes.tsx`, `index.css`; 3 hand-written
  components + **11 shadcn `ui/` primitives**; `lib/` has `useApi.ts`,
  `markdown.ts`, `theme.ts`, `utils.ts`; 5 pages; react-router 8 with a single
  `routes: AppRoute[]` consumed by both router and nav.
- **No `services/` or `hooks/` directory exists.** `useApi<T>(url): ApiState<T>`
  (a `loading | error | success` union) is the only hook and lives in `lib/`.
  Phase B replaces it with a real services/hooks/pages layer.
- `server/Program.cs`: **73 lines, 3 endpoints**, static `class Packages` with 20
  entries. `Server.csproj` has **zero PackageReference — no EF Core at all**.
- `client/e2e/**` and `client/playwright.config.ts` are now covered by
  `tsconfig.e2e.json`. Coverage was proved by falsification, not by a green run:
  injecting `const n: number = "x"` into `pages.spec.ts` made `tsc -b` fail with
  `TS2322` naming that file at exit 2; reverting restored exit 0.

## Environment (needed by every phase)

- `export PATH="$HOME/.local/share/fnm/node-versions/v24.19.0/installation/bin:$PATH"`
  — node 24.19.0, npm 11.17.0.
- .NET SDK 10.0.400 (8.0.128 is gone).
- Playwright browsers needed a refresh once: cached build 1228 vs required 1234.
  `npx playwright install` if a run complains.
- **`npm run shots` stays barred** — it rewrites `client/public/screenshots/`.
  If run by accident: `git checkout -- client/public/screenshots`.

## Next action

Phase B (Northwind testbed), starting at step 1 of the workflow — scout, then
plan. Fork from `template-refresh` @ `95855ff`. Nothing from Phase A is left
unfinished and no decision is outstanding.
