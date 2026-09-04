# Phase B — Deploy, personal — PLAN

Repo: `/Users/james/Developer/domain-expert`, branch `m5b-component-attribution`
at `89448e7` (== `origin/master`), working tree clean.
Record dir: `feature-research/deploy-personal/`. Previous record:
`feature-research/green-and-push/progress.md` (row B of its MVP table is the
brief for this phase).

## Goal

psq runs on this Mac as a LaunchAgent, reachable from James's other tailnet
devices, with every `/api/*` route behind a bearer token. One script deploys a
new build. The README says how anyone else would do the same. Nothing about
extraction, grading, the desktop shell or the question banks changes.

## Record hygiene — read before writing anything under `feature-research/`

The repo is public. This phase creates a **new secret class** on top of the
corpus-name class from the previous phase: the machine's tailnet address and
the bearer token. Rules for `plan.md`, `audit.md`, `progress.md`, `README.md`
and `scripts/deploy.sh`:

- Write `<host>` and `<token>` as placeholders. Never paste the address or the
  token, never paste the output of `launchctl print` (it dumps the job's
  environment, token included), never paste the ready-to-open URL.
- The port is not secret (the previous, already-pushed record names 9450 and
  9444; a port without an address exposes nothing). Ports may be written.
- Both sweeps in the Gates table run before any commit, each with its
  positive control first.

## What exists today (scouted and verified, not assumed)

- `apps/server/src/index.ts:27-31` already reads `PSQ_PORT` (default 8092) and
  `PSQ_HOST` (default `127.0.0.1`) and calls `listen(port, host)`.
  `index.ts:19-24` already serves `apps/web/dist` with `express.static` plus an
  `index.html` catch-all, when that directory exists.
- `createApp(workspace)` in `apps/server/src/app.ts:50` mounts `express.json`
  and 14 routes, all under `/api`. **There is no auth, cors or rate-limit
  middleware anywhere.** `POST /api/repos {path}` opens any path on the Mac and
  the SQL grader runs typed input, so exposing this beyond loopback without a
  gate is not acceptable (house rule: auth first).
- Reviewer-verified: under Express 5.2.1, `app.use("/api", gate)` mounted
  before `express.json` returns 401 for `/api/health`, `/api/quiz/:id`, `/api`
  and `/api/../api/health` without a header, parses the JSON body of
  `POST /api/repos` with one, and the static catch-all mounted afterwards in
  `index.ts` still serves `/` and `/apifoo`. The ordering works.
- `@psq/server` has no build step; `exports["."]` is `./src/app.ts`. The
  server runs from TypeScript via `tsx` (`dev:server` = `tsx watch …`).
  `tsx` 4.23.12 is installed at the root. Reviewer-verified: from the repo
  root, `env -i PATH=<node bin>:/usr/bin:/bin HOME=… node --import tsx
  apps/server/src/index.ts` serves `/api/health`. `node:sqlite` needs no flag
  on Node 24.19. Nothing in the server or extractor spawns a subprocess (the
  only `spawn` is `apps/desktop/src/main.ts:94`).
- Web: every server call goes through one wrapper, `call()` in
  `apps/web/src/lib/api.ts:136-156`, which sends only `content-type`. Paths are
  relative (`/api/...`); no base URL, no env. Errors surface as `ApiError`
  (`api.ts:134`) caught into a local `error` string rendered at
  `App.tsx:150-153`. Only `apps/web/src/lib/theme.tsx` uses `localStorage`.
  Verified: no `fetch(` or `/api/` outside `api.ts` in `apps/web/src` or
  `apps/desktop/src`. The e2e file has one raw in-page fetch
  (`e2e/psq.e2e.ts:61`).
- Desktop (`apps/desktop/src/main.ts:29-36`) calls `createApp()` in-process
  and listens on `127.0.0.1` port 0; renderer loads `http://127.0.0.1:<port>`.
  It sends no auth header.
- e2e (`vitest.e2e.config.ts`, `fileParallelism: false`, 120 s hook timeout;
  `e2e/harness.ts:45-102`) calls `createApp()` in-process on port 0 and
  launches Chromium unconditionally in `startHarness`. Both `describe` blocks
  (`psq.e2e.ts:35`, `:397`) are `describe.skipIf(reason !== "")` and the
  file-level `beforeAll` at `:26-28` returns early when `reason` is set.
  19 tests today.
- `apps/server/test/api.test.ts:14-16` builds the app with `createApp()` and
  supertest; ~30 requests, none with an auth header. Nothing in
  `apps/server/test` touches env vars.
- Machine: no `com.psq.*` launchd label exists, and `com.psq.server`, `psq`,
  `9451`, `deploy` and `launchagent` match nothing in `test/corpus.local.json`.
  fnm's stable alias `~/.local/share/fnm/aliases/default/bin/{node,pnpm}` →
  v24.19.0 (root `engines` is `>=24`). Tailnet ACL allows inbound 9440-9460; a
  throwaway-socket bind test on 2026-09-04 found only 9444 and 9450 busy in
  that range. Precedent (`com.health-hub.server`): bind the tailnet address
  explicitly, not `0.0.0.0`; logs under `~/Library/Logs/<svc>/`; `RunAtLoad` +
  `KeepAlive`. `~/.config/psq` does not exist.

## Design

### B1. Token gate in the server (opt-in, default off)

`createApp(workspace?, options?: { token?: string })`. When `options.token` is
a non-empty string, a middleware mounted with `app.use("/api", gate)` **before
`express.json`** requires `Authorization: Bearer <token>` on every request
under `/api` (all 14 routes and any future one, without per-route wiring).
Mismatch or absence → `401 {"error":"unauthorized"}` with
`WWW-Authenticate: Bearer`. Compare by hashing both sides with SHA-256 and
`crypto.timingSafeEqual` (equal length by construction). Scheme match is
case-insensitive; the token is not. Header only — no query-string, no cookie
(tokens in URLs land in logs). A duplicated `Authorization` header (Node joins
them as `"Bearer a, Bearer b"`) fails the compare, which is the safe direction.

When `options.token` is absent, **no middleware is added** — the app is
byte-for-byte what it is today. This is what keeps `api.test.ts`, the e2e
harness, `pnpm dev:*` and the desktop shell unchanged.

The static UI (`index.ts:19-24`) stays ungated: it is public asset bytes, and a
navigation cannot carry a bearer header. Every byte of data is under `/api`.

### B2. Startup interlock — you cannot expose without a token

New `apps/server/src/config.ts` exporting a pure
`resolveServerConfig(env: NodeJS.ProcessEnv): { host: string; port: number; token?: string }`:

- `host` = `PSQ_HOST` trimmed, defaulting to `127.0.0.1` **only when the
  variable is unset**. An empty string after trim → throw (an empty host makes
  `listen` bind `::`, every interface — reviewer-verified). `0.0.0.0`, `::`
  and `[::]` → throw: "bind one specific address". See D-B-8.
- `port` = `PSQ_PORT` ?? 8092, must parse to an integer in 1..65535, else throw.
- `token` = `PSQ_TOKEN` if set and non-empty; must be ≥ 16 characters, else
  throw (stops `PSQ_TOKEN=x`).
- If `host` is not loopback (`127.0.0.1`, `localhost`, `::1`) **and** there is
  no token → throw with a message naming the two ways out (set `PSQ_TOKEN`, or
  bind `127.0.0.1`). Comment in the source: `localhost` is loopback by
  convention (`/etc/hosts`), the other two by construction.

`index.ts` calls it, passes `token` into `createApp`, and logs one line at
startup: address, and `api: token required` or `api: open (loopback only)`.
It never prints the token. A thrown config error exits 1 with the message.

New `scripts/check-server-config.ts` (≈5 lines): imports `resolveServerConfig`,
runs it on `process.env`, prints `host:port  token: yes|no` (never the token),
exits 1 with the message on throw. `deploy.sh` runs this, so the script and the
server enforce **literally the same code**, not a bash re-statement of it.

### B3. The UI sends the token

In `apps/web/src/lib/api.ts`:

- `call()` adds `Authorization: Bearer <t>` when a token is stored under
  `localStorage["psq.token"]` (every access wrapped in try/catch; absent → no
  header, exactly today's request).
- Export `adoptTokenFromFragment()`: parse `location.hash.slice(1)` (the
  leading `#` must be dropped or `URLSearchParams` sees a `#token` key) as
  `URLSearchParams`; if it has `token`, store it (an empty value **removes** the
  stored token) and strip the fragment with `history.replaceState`. The
  fragment never reaches the server or its logs. Called once in
  `apps/web/src/main.tsx` before `createRoot().render()`, which is before the
  mount-time `refresh()` at `App.tsx:32-34` (reviewer-verified; StrictMode
  double-mount is dev-only and harmless).
- A 401 `ApiError` gets a human message: *"This server requires a token. Open
  it once as /#token=<your PSQ_TOKEN>; the token is then remembered in this
  browser."* It surfaces through the existing `error` span in `App.tsx` with no
  new UI. (A settings field is a later nicety, not needed for one user.)

The desktop shell is **not** touched: it runs its own in-process server on
loopback with no token, and `createApp()` without `options.token` is unchanged.
See D-B-3.

### B4. `scripts/deploy.sh` — build, install the LaunchAgent, prove it

`#!/usr/bin/env bash`, `set -euo pipefail`, executable. Steps, in order:

1. **Resolve paths.** Repo root from the script's own location. `NODE` =
   `$PSQ_NODE` if set, else `~/.local/share/fnm/aliases/default/bin/node`
   (the alias survives fnm upgrades; a direct `node-versions/v24.19.0` path
   would not). Must be executable. `export PATH="$(dirname "$NODE"):$PATH"` so
   the sibling `pnpm` and its shims find `node`.
2. **Machine config** lives outside the repo in `~/.config/psq/deploy.env`
   (mode 600), sourced by the script. Keys: `PSQ_HOST`, `PSQ_PORT`, `PSQ_TOKEN`.
   First run: create it with `PSQ_PORT=9451`, a fresh
   `PSQ_TOKEN=$(openssl rand -hex 32)`, and a **commented-out `#PSQ_HOST=`**
   line with a comment saying to set the one address to bind (never an empty
   assignment — see B2), then exit 1 telling the user to set it. Exposure is
   an explicit choice, never a default. Every run then validates the loaded
   values by running `scripts/check-server-config.ts` under `$NODE --import
   tsx` with the config exported — the server's own rules, so a config the
   server would reject is never installed.
3. `pnpm install --frozen-lockfile` then `pnpm build:web`.
4. `mkdir -p ~/Library/Logs/psq`; render
   `~/Library/LaunchAgents/com.psq.server.plist` from a heredoc (write to a
   temp file, `mv` into place, `chmod 600` — it carries the token):
   - `Label` `com.psq.server`
   - `ProgramArguments` `[NODE, --import, tsx, apps/server/src/index.ts]`
   - `WorkingDirectory` = repo root (so bare `tsx` resolves from `node_modules`)
   - `EnvironmentVariables`: `PSQ_HOST`, `PSQ_PORT`, `PSQ_TOKEN`, and `PATH` =
     node bin dir + `/usr/bin:/bin`
   - `RunAtLoad` true, `KeepAlive` true, `ThrottleInterval` 30 (a config or
     bind failure is a restart loop under `KeepAlive`; 30 s keeps the err log
     growth slow — the README says where to look)
   - `StandardOutPath` / `StandardErrorPath` → `~/Library/Logs/psq/server.{out,err}.log`
5. **(Re)load:** `launchctl bootout gui/$UID/com.psq.server` (ignore failure),
   then poll `launchctl print gui/$UID/com.psq.server` until it errors (cap
   ~10 s — `bootout` returns before teardown finishes and an immediate
   `bootstrap` can fail with "Bootstrap failed: 5"), then
   `launchctl bootstrap gui/$UID <plist>`. Not `kickstart -k` alone: launchd
   caches a plist at bootstrap, so a changed port or token would be silently
   ignored. Bootout + bootstrap is the superset that also restarts.
6. **Prove it** (this is the gate, and it has a positive control): poll
   `GET http://$PSQ_HOST:$PSQ_PORT/api/health` — `$PSQ_HOST`, never loopback,
   the service is not bound there — with the bearer header up to ~20 s until
   200. Then the negative control: the same URL **without** the header must
   return exactly 401. Any other outcome → non-zero exit with the last response
   and a pointer to the err log. On success print: the health JSON; from
   `launchctl print`, **only** the `state` and `pid` lines (never the block —
   it contains the environment and therefore the token); and the ready-to-open
   URL with the token **masked** (`/#token=<redacted>`), plus the line "run
   `scripts/deploy.sh --show-url` or `cat ~/.config/psq/deploy.env` to see it".
   `--show-url` prints the real URL. The implementer never passes `--show-url`.

`scripts/deploy.sh` is the whole deploy story: code-only redeploy = run it
again.

### B5. Tests

- `apps/server/test/auth.test.ts` (new, supertest, same shape as
  `api.test.ts`): with a token — no header → 401, wrong token → 401, wrong
  scheme (`Basic …`) → 401, duplicated header → 401, correct → 200 on
  `/api/health`, and correct on a route with a JSON body (`POST /api/repos`)
  → not 401 (proves the gate sits above `express.json` without breaking body
  parsing); without a token configured — `/api/health` → 200 with no header
  (the default-off control).
- `apps/server/test/config.test.ts` (new, pure): loopback + no token → ok,
  open; non-loopback + no token → throws; non-loopback + token → ok; short
  token → throws; bad port → throws; `localhost` and `::1` count as loopback;
  `PSQ_HOST=""`, `"  "`, `0.0.0.0`, `::` → throw even with a token; unset
  `PSQ_HOST` → `127.0.0.1`.
- `e2e/harness.ts`: `startHarness({ token? })` passing it to `createApp`;
  default `undefined` leaves all 19 existing tests untouched.
- `e2e/psq.e2e.ts`: a third `describe` block with the **same
  `describe.skipIf(reason !== "")` guard** as the two existing ones, which
  starts its own gated harness in its own `beforeAll` (a second Chromium and a
  second server — fine under `fileParallelism: false` and the 120 s hook
  timeout, and the 19 untokened tests never share it). Two tests:
  (1) page opened at `<url>/#token=<t>` → `location.hash` is empty, the token
  is in `localStorage`, and the **rendered UI** reaches its loaded state with
  no error span (the real browser path: fragment → storage → header → 200).
  Not the `psq.e2e.ts:61` idiom — a raw in-page `fetch` bypasses `call()` and
  would 401 here;
  (2) page opened with no token → the error span shows the "requires a token"
  message.
- `apps/server/test/api.test.ts` **must not change**; its passing is the
  control that the gate is off by default.
- The `createApp` signature change is covered for the desktop by
  `pnpm typecheck` (it runs `@psq/desktop`'s typecheck).

### B6. README — "Hosting" section

New H2 `## Hosting` after "The app". Generic, no machine specifics (no tailnet
names or addresses in the repo). Covers: the three env vars and their defaults;
the interlock (non-loopback bind refuses to start without a token; wildcard and
empty binds are refused outright) and why (`POST /api/repos` opens any path,
the grader runs your SQL); entering the token once via `/#token=…`;
`scripts/deploy.sh`, its config file, `--show-url`; the LaunchAgent it
installs, where logs go, that a bad config shows up as a restart loop in the
err log, how to stop it (`launchctl bootout`); "the token travels in plain
HTTP, so bind a private-network address you trust (a tailnet address is
encrypted on the wire); on an open LAN put TLS in front". Add `PSQ_HOST` /
`PSQ_PORT` to the "The app" paragraph where 8092 is named.

## Files touched

| File | Change |
|---|---|
| `apps/server/src/config.ts` | **new** — `resolveServerConfig(env)`, loopback set, refused binds, validation |
| `apps/server/src/app.ts` | `createApp(workspace?, options?)`; bearer gate on `/api` when `options.token` |
| `apps/server/src/index.ts` | use `resolveServerConfig`, pass token, startup line |
| `apps/server/test/auth.test.ts` | **new** |
| `apps/server/test/config.test.ts` | **new** |
| `apps/web/src/lib/api.ts` | bearer header from storage; `adoptTokenFromFragment()`; 401 message |
| `apps/web/src/main.tsx` | call `adoptTokenFromFragment()` before render |
| `e2e/harness.ts` | `startHarness({ token? })` |
| `e2e/psq.e2e.ts` | third guarded `describe`, two token tests |
| `scripts/check-server-config.ts` | **new** — runs `resolveServerConfig` on the env for `deploy.sh` |
| `scripts/deploy.sh` | **new**, executable |
| `README.md` | "Hosting" H2; env vars in "The app" |
| `feature-research/deploy-personal/plan.md` | verbatim copy of this plan |
| `feature-research/deploy-personal/audit.md` | implementer's audit, placeholders only |

Machine state written by `deploy.sh` (outside the repo): `~/.config/psq/deploy.env`,
`~/Library/LaunchAgents/com.psq.server.plist`, `~/Library/Logs/psq/`.

**Not touched:** `apps/desktop/**`, `packages/**`, `apps/server/test/api.test.ts`,
`vite.config.ts`, `tsconfig*.json`, the question banks, the corpus config.

## Build order

Two passes in one implementer run, gates after each; nothing is committed by
the implementer (commits follow review, acceptance and both sweeps):

1. **Server**: B1, B2, `auth.test.ts`, `config.test.ts`, `check-server-config.ts`.
   Provable entirely by `pnpm typecheck` + `pnpm test`.
2. **Edge**: B3, harness + e2e, `deploy.sh`, README, records. Then the deploy
   itself and the machine gates.

## Gates (all must hold; numbers are the baseline to beat, not to match)

| Gate | Baseline | Expected |
|---|---|---|
| `pnpm typecheck` | clean | clean |
| `PSQ_NO_CORPUS=1 pnpm test` | `204 passed \| 58 skipped (262)` | 204 + new server tests passed, 58 skipped, 0 failed |
| `pnpm test` | `262 passed (262)` | 262 + new, 0 failed |
| `pnpm test:e2e` | `19 passed (19)` | `21 passed (21)` |
| Interlock, by hand | — | `PSQ_HOST=<host> node --import tsx apps/server/src/index.ts` with no token exits 1 with the interlock message; `PSQ_HOST=` (empty) exits 1; `PSQ_HOST=0.0.0.0 PSQ_TOKEN=<32 hex>` exits 1 |
| Boot under the exact plist command | — | `PSQ_HOST=127.0.0.1 PSQ_PORT=9451 node --import tsx apps/server/src/index.ts` from the repo root serves `/api/health` |
| `scripts/deploy.sh` | — | first run creates the env file and exits 1; after `PSQ_HOST` is set, second run passes its own 200-with / 401-without gate |
| Bind scope | — | `nc -z 127.0.0.1 9451` fails; `nc -z "$PSQ_HOST" 9451` succeeds. Record the outcome as words, not the address |
| `launchctl print gui/501/com.psq.server` | — | `state = running`, no restart churn — record only the state/pid lines |
| Corpus-name sweep | positive control ≥ 1 hit on `test/corpus.local.json` | 0 hits across `feature-research/deploy-personal/*.md`, `README.md`, `scripts/*` (basenames derived programmatically from the corpus file, case-insensitive, word-bounded) |
| Secret sweep | positive control ≥ 1 hit on `~/.config/psq/deploy.env` | 0 hits for the `PSQ_HOST` value and the `PSQ_TOKEN` value (read from the env file, never hand-typed) across `feature-research/deploy-personal/*.md`, `README.md`, `scripts/*`, and `git diff` of everything staged |

## Decisions

- **D-B-1. Gate is opt-in at `createApp`, mandatory at exposure.** Auth lives
  in one middleware and one env var; the interlock in `config.ts` is what makes
  it impossible to forget. Loopback stays open because that is where dev, the
  tests and the desktop shell live.
- **D-B-2. Static UI ungated; all data under `/api` gated; header-only auth
  with no CORS middleware.** A bearer header cannot ride a page navigation, and
  nothing sensitive is in the bundle. Header-only matters beyond simplicity: a
  cross-origin `POST /api/repos` from another site is preflighted and refused
  by the browser, so the gate also closes CSRF. **A cookie fallback would
  reopen it** — a later phase must not "improve" this into cookies without a
  CSRF token.
- **D-B-3. Desktop shell unchanged.** Loopback, OS-picked port, in-process, one
  user — same trust model as today and as the existing loopback-only service on
  this Mac. A per-launch token through the preload bridge is Phase F work
  (packaging), where it belongs.
- **D-B-4. Port 9451, bound to the tailnet address, not `0.0.0.0`.** Inside the
  ACL's allowed range, adjacent to the existing 9450 service, free by bind test.
  If tailscale is down at boot the bind fails and launchd retries every 30 s —
  same shape as the precedent service.
- **D-B-5. Machine config outside the repo.** The repo is public; the address
  and the token live in `~/.config/psq/deploy.env` and the generated plist. The
  plist is a build artifact of `deploy.sh`, never committed.
- **D-B-6. Run TypeScript directly via `tsx`.** Adding a server build step to
  match a built `dist/index.js` shape is not needed for one machine and would
  widen the phase. Consequence to record: **this checkout is production** — an
  edit under `apps/server/src` is live on the next restart, and `pnpm test:e2e`
  rebuilds `apps/web/dist` under the running server.
- **D-B-7. Token entry via URL fragment, not a form.** Ten lines, no new UI, and
  `deploy.sh --show-url` prints the exact URL. Revisit if a second user appears.
- **D-B-8. Wildcard and empty binds are refused, not warned.** `""`, `0.0.0.0`,
  `::` all mean "every interface", which is exactly what the interlock exists
  to prevent, and a token does not change that. A container deployment that
  needs a wildcard bind can add an explicit opt-in variable in its own phase.

## Out of scope (recorded, not done)

Desktop token bridge; TLS; cookie session; rate limiting; quiz history;
Dockerfile / CI; the `api.test.ts:213` flake; `psq selftest` on full-stack
repos (Phase C).
