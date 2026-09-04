# Phase B — Deploy, personal — PROGRESS

**Status: SHIPPED at `ff28efa` (2026-09-04); reviewer Ship; deployed and
running.** The feature commit sits on `m5b-component-attribution` directly on
top of `89448e7` (the previous phase's close-out, == `origin/master` at the
time). This record is committed on top of it, `master` is fast-forwarded to
the record commit, and both refs are pushed together, in the shape D-A-3 set.

Plan: `plan.md` (the approved plan, with two decision lines reworded for
hygiene — see "Deviations"). Audit: `audit.md` (build, fix pass, tidy).
Previous phase record: `../green-and-push/progress.md` (row B of its MVP table
was the brief for this phase).

---

## What shipped

**psq runs on this Mac as a LaunchAgent, reachable from James's other tailnet
devices, with every `/api/*` route behind a bearer token.** One script deploys
a new build and proves the result. Nothing about extraction, grading, the
desktop shell or the question banks changed.

| Part | Where | What |
|---|---|---|
| Token gate | `apps/server/src/app.ts` | `createApp(workspace?, { token? })`. With a token, one middleware on `/api` (mounted before `express.json`) requires `Authorization: Bearer <token>`; SHA-256 + `timingSafeEqual`; 401 JSON + `WWW-Authenticate`. Header only. **Without a token no middleware is added** — dev, tests and the desktop shell are byte-for-byte unchanged. |
| Interlock | `apps/server/src/config.ts` | `resolveServerConfig(env)`: non-loopback `PSQ_HOST` without a ≥16-char token → throw; empty, whitespace, `0.0.0.0`, `::`, `[::]` hosts → throw even with a token; `PSQ_PORT` must be `/^\d+$/` in 1..65535; token trimmed. Loopback = `127.0.0.1`, `localhost`, `::1`. |
| Entry | `apps/server/src/index.ts` | Uses the config, passes the token, logs one startup line (address + `api: token required` / `api: open (loopback only)`), never the token. |
| Same rules for the script | `scripts/check-server-config.ts` | Runs `resolveServerConfig` on the env for `deploy.sh`, so the script and the server enforce literally the same code. |
| UI sends the token | `apps/web/src/lib/api.ts`, `main.tsx` | `call()` adds the bearer header when `localStorage["psq.token"]` is set. `adoptTokenFromFragment()` runs before render: `/#token=<t>` stores it (empty value removes it) and strips the fragment with `replaceState`, so it never reaches server logs. A 401 shows a plain "requires a token" message in the existing error span. |
| Deploy | `scripts/deploy.sh` | Config from `~/.config/psq/deploy.env` (600; `PSQ_DEPLOY_ENV` overrides). First run generates a token and exits asking for `PSQ_HOST`. Then: validate via the checker → `pnpm install --frozen-lockfile` → `pnpm build:web` → render `~/Library/LaunchAgents/com.psq.server.plist` (600, XML-escaped) → `bootout` → poll until gone → `bootstrap` → prove **200 with the token, then 401 without**. Token masked in output unless `--show-url`; token passed to curl via a 600 temp file, never argv; log dir 700. |
| README | `README.md` | New `## Hosting` (generic, no machine specifics); `PSQ_HOST`/`PSQ_PORT` named under "The app". |
| Tests | `apps/server/test/{auth,config}.test.ts`, `e2e/harness.ts`, `e2e/psq.e2e.ts` | 9 auth tests (incl. comma-joined value, real two-header-line first-wins, default-off control), 12 config tests, `startHarness({ token? })`, a third `describe.skipIf`-guarded e2e block with its own gated harness: fragment → storage → header → rendered UI; and the no-token error message. |

The plist runs `node --import tsx apps/server/src/index.ts` from the repo
root with `RunAtLoad`, `KeepAlive`, `ThrottleInterval 30`, logs under
`~/Library/Logs/psq/`. Node is fnm's stable alias
`~/.local/share/fnm/aliases/default/bin/node`, so an fnm upgrade does not
break the job.

### Gates (final, reviewer re-ran every one)

| Gate | Baseline | Result |
|---|---|---|
| `pnpm typecheck` | clean | clean (4 projects) |
| `PSQ_NO_CORPUS=1 pnpm test` | `204 passed \| 58 skipped (262)` | `225 passed \| 58 skipped (283)`, 0 failed |
| `pnpm test` | `262 passed (262)` | `283 passed (283)` |
| `pnpm test:e2e` | `19 passed (19)` | `21 passed (21)` (a skip-guard control with a bogus browser path: 21 skipped, no Chromium launched) |
| Interlock by hand | — | non-loopback + no token, empty host, `0.0.0.0` + token, `[::]`, short token, bad port: all exit 1 with the intended message |
| `deploy.sh` negative gates (throwaway configs, run from `$HOME`) | — | wildcard host, short token, **empty port**: exit 1 at the config step, no build output, plist mtime and service pid unchanged (positive control: the real run moves both) |
| `deploy.sh` real run | — | exit 0; 200 with token / 401 without; `state = running`; err log 0 lines |
| Bind scope | — | loopback: connection refused; `<host>`: reachable, 401 without header, 200 with |
| Path-normalisation probes (no header) | — | 12 variants: every `/api…` form → 401; the two that return 200 are the SPA shell (`text/html`), no API JSON reachable |
| Token in build env | — | a fake `pnpm` first on PATH saw `PSQ_TOKEN` 0 / `PSQ_HOST` 0 while a control variable read 1 |
| `apps/server/test/api.test.ts` | — | byte-unchanged (the default-off control) |
| Corpus-name sweep | control 45/45 on the corpus file | 0 genuine across the record dir, `README.md`, `scripts/*` and the committed files (remaining hits: names already in the pushed tree at `89448e7`, and dictionary words) |
| Secret sweep | control 2/2 on the env file | host 0, token 0 across the record dir, `README.md`, `scripts/*`, `git show HEAD`, every untracked path, the whole tree, **and inside the built `apps/web/dist` bundle** |

Scope: `git show --stat ff28efa` = 14 files, exactly the plan's table (7
modified, 7 new). Nothing outside it.

---

## Review history

1. **Plan critique** (before build): two blocking — no sweep for the new
   secret class this phase creates (address, token), and an empty/wildcard
   `PSQ_HOST` passing the interlock and binding every interface (verified:
   `listen(port, "")` binds `::`). Both folded into the plan, plus the
   non-blocking items (`.slice(1)` on the hash, `skipIf` guard, bootout →
   poll → bootstrap, `ThrottleInterval`, header-only/CSRF note).
2. **Implementation review**: one blocking — `deploy.sh` ran the config
   checker inside `echo "config: $(...)"`; under `set -e` a failing
   substitution in argument position does not abort, so a rejected config
   would have been built, installed and left restart-looping. Fixed by
   capturing to a variable. Twelve non-blocking items, all taken.
3. **Re-review**: Ship. The fix proved by the negative gate the bug would have
   passed. Eight non-blocking; the three cheap ones (empty-port default in
   the script, token exported into the build subtree, stale audit lines) were
   tidied before the commit.

---

## Deviations from the approved plan (all recorded in `audit.md`)

- **`plan.md` is not byte-verbatim.** The approved plan's own prose named a
  corpus repo twice (decisions D-B-3 and D-B-6, comparing to an existing
  loopback-only service on this Mac). The corpus sweep caught it; the two
  clauses were reworded before commit. The rule stands: the sweep is a
  per-commit gate, and it caught a leak that originated in the orchestrator's
  plan, not in the implementer's records.
- **The duplicate-`Authorization` premise in the plan was wrong.** Node does
  not join duplicate `Authorization` headers; it discards duplicates and keeps
  the first. Verified live: good-then-wrong → 200, wrong-then-good → 401. No
  security impact (a valid first header means the caller has the token). The
  code comment says the right thing and a real two-line test asserts
  first-wins.
- `index.ts` uses a small typed `loadConfig()` helper (strict-mode `let`).
- `scripts/**` and `apps/server/test/**` are outside `tsconfig.json`'s
  `include`, so the checker and the new tests are not statically typechecked.
  Pre-existing shape (`api.test.ts` always was); the checker is exercised for
  real on every deploy run. Not changed because `tsconfig*.json` was out of
  scope.

---

## Decisions

Full text in `plan.md`. The ones the next phases must not undo:

- **D-B-1** gate opt-in at `createApp`, mandatory at exposure via the interlock.
- **D-B-2** static UI ungated; all data under `/api` gated; **header-only auth
  with no CORS middleware is what closes CSRF** (a cross-origin POST is
  preflighted and refused). A cookie fallback would reopen it.
- **D-B-3** desktop shell unchanged (loopback, in-process, no token) — a
  per-launch token through the preload bridge belongs to Phase F.
- **D-B-4** port 9451, bound to the tailnet address, never `0.0.0.0`.
- **D-B-5** machine config outside the repo; the plist is a build artifact.
- **D-B-6** TypeScript run directly via `tsx`; **this checkout is production.**
- **D-B-7** token entry via URL fragment, not a form.
- **D-B-8** wildcard and empty binds refused, not warned.
- **D-B-9 (new, from the plan critique)**: the tailnet address and the token
  are a secret class for this public repo; the port is not (already-pushed
  records name ports). Records use `<host>`/`<token>`; never paste
  `launchctl print` (it dumps the environment) or the `--show-url` output.

---

## What the next phase needs to know

- **This checkout is production.** An edit under `apps/server/src` is live on
  the next restart; `pnpm test:e2e` rebuilds `apps/web/dist` under the running
  server (same code, harmless). To pick up a server change: `scripts/deploy.sh`.
  To stop: `launchctl bootout gui/$(id -u)/com.psq.server`.
- **Daily use**: open `http://<host>:9451/#token=<token>` once per browser;
  `scripts/deploy.sh --show-url` prints that URL (James only, never an agent).
  A bad config shows as a 30 s restart loop in `~/Library/Logs/psq/server.err.log`.
- **Two sweeps before every commit now**, positive control first: corpus
  basenames derived from `test/corpus.local.json`, and the `PSQ_HOST` /
  `PSQ_TOKEN` values read from `~/.config/psq/deploy.env` — across new
  records, `README.md`, `scripts/*`, and the staged diff. Never hand-type
  either set.
- Carried forward, unchanged by this phase:
  - **`psq selftest` exits 1 on any full-stack repo** (shape-name ambiguity).
    Full-stack banks stay formally untrusted until Phase C.
  - **`clientCalls` / `components` are extracted but never surfaced** (M5c).
  - **`apps/server/test/api.test.ts:213` flaked once in ~13 runs**, harness
    side; not seen in any run this phase (the suite ran ≥ 8 times).
  - **No Dockerfile, no CI.** The corpus config is the only copy of the ground
    truth.
- Non-blocking leftovers from review, not gates: the UI maps every 401 to the
  "requires a token" message (correct today, one cause); `/Users/james`
  appears in records (precedent in the pushed tree); the `deploy.sh` plist
  heredoc trusts `$PSQ_PORT` unescaped, safe by the checker's `/^\d+$/`.
- **Next: Phase C (1b-ii).** `shapeLabel(g, shape)` helper at the five prompt
  sites; `psq selftest` passes on `mini-fullstack-csharp` and Northwind. Spec
  at the bottom of `feature-research/complexity-facts/plan-phase1b.md`; prior
  record `feature-research/complexity-facts/progress-1b.md`. Then D/E (M5c-i,
  M5c-ii) per the MVP table in `../green-and-push/progress.md`.
