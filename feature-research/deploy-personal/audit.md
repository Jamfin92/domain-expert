# Phase B — Deploy, personal — AUDIT

Branch `m5b-component-attribution`, base `89448e7`. **Nothing committed.** All
work is in the working tree; the seven untracked paths are listed below.

Placeholders throughout: `<host>` is the bound tailnet address, `<token>` is the
bearer token. Neither appears anywhere in this repo — see the secret sweep.

## Files changed

| File | State |
|---|---|
| `apps/server/src/config.ts` | **new** |
| `apps/server/src/app.ts` | modified |
| `apps/server/src/index.ts` | modified |
| `apps/server/test/auth.test.ts` | **new** |
| `apps/server/test/config.test.ts` | **new** |
| `apps/web/src/lib/api.ts` | modified |
| `apps/web/src/main.tsx` | modified |
| `e2e/harness.ts` | modified |
| `e2e/psq.e2e.ts` | modified (appended one `describe`) |
| `scripts/check-server-config.ts` | **new** |
| `scripts/deploy.sh` | **new**, mode 755 |
| `README.md` | modified |
| `feature-research/deploy-personal/plan.md` | **new** — verbatim copy of the approved plan |
| `feature-research/deploy-personal/audit.md` | **new** — this file |

Nothing outside the plan's "Files touched" table was edited.
`apps/server/test/api.test.ts` is byte-unchanged (it is the control that the
gate is off by default). `apps/desktop/**`, `packages/**`, `vite.config.ts`,
`tsconfig*.json`, the question banks and the corpus config are untouched.

Machine state written outside the repo (all by `deploy.sh`):
`~/.config/psq/deploy.env` (600), `~/Library/LaunchAgents/com.psq.server.plist`
(600), `~/Library/Logs/psq/server.{out,err}.log`.

## What was built, per plan section

### B1 — token gate (`apps/server/src/app.ts`)

`createApp(workspace?, options?: AppOptions)`. When `options.token` is a
non-empty string, `app.use("/api", bearerGate(token))` is mounted **before**
`express.json`, so an unauthorized request is rejected before its body is read.
Absent token → **no middleware is added at all**, which is what leaves
`api.test.ts`, the desktop shell and `pnpm dev:server` untouched.

The compare hashes both sides with SHA-256 and uses `crypto.timingSafeEqual`,
so the two buffers are always 32 bytes and a length mismatch can neither throw
nor leak. Scheme compare is case-insensitive, the token is not. Mismatch →
`401 {"error":"unauthorized"}` with `WWW-Authenticate: Bearer`. Header only —
no query string, no cookie.

The static UI in `index.ts` stays ungated, as designed (D-B-2).

### B2 — startup interlock (`apps/server/src/config.ts`, `index.ts`)

`resolveServerConfig(env)` is pure. It
implements exactly the plan's rules: unset `PSQ_HOST` → `127.0.0.1`; set but
empty (or all-whitespace) → throw; `0.0.0.0` / `::` / `[::]` → throw; port must
parse to an integer in 1..65535; `PSQ_TOKEN` non-empty must be ≥ 16 characters;
non-loopback host with no token → throw naming both ways out. The loopback set
is `127.0.0.1`, `localhost`, `::1`, with the source comment about `/etc/hosts`.

`index.ts` calls it through a small `loadConfig()` that prints the message and
`process.exit(1)` on throw, passes `token` into `createApp`, and logs
`api: token required` or `api: open (loopback only)` after the listening line.
The token itself is never printed.

`scripts/check-server-config.ts` runs the same function on `process.env` and
prints `host:port  token: yes|no`. `deploy.sh` calls it, so the script and the
server enforce literally the same code.

### B3 — the UI sends the token (`apps/web/src/lib/api.ts`, `main.tsx`)

`call()` adds `Authorization: Bearer <t>` when `localStorage["psq.token"]` is
set; every storage access is in a `try/catch`, and with no stored token the
request is byte-identical to today's. `adoptTokenFromFragment()` parses
`location.hash.slice(1)` as `URLSearchParams`, stores `token` (empty value
**removes** it), and strips the fragment with `history.replaceState`; it is
called in `main.tsx` before `createRoot().render()`. A 401 becomes the human
message "This server requires a token. Open it once as /#token=<your
PSQ_TOKEN>; …", which surfaces through the existing error card in `App.tsx`
with no new UI. The desktop shell was not touched.

### B4 — `scripts/deploy.sh`

`set -euo pipefail`, executable, `--show-url` the only flag. Resolves the repo
root from its own location; `NODE` = `$PSQ_NODE` or the fnm **alias** path (not
a versioned one, so an fnm upgrade does not orphan the plist), must be
executable, and its directory is prepended to `PATH`. Config is
`~/.config/psq/deploy.env`, created on first run under `umask 077` with
`PSQ_PORT=9451`, a fresh `openssl rand -hex 32` token and a **commented-out**
`#PSQ_HOST=` line, then exit 1. Validates via `check-server-config.ts`, runs
`pnpm install --frozen-lockfile` and `pnpm build:web`, renders the plist to a
`mktemp` file and `mv`s it into place at mode 600 (`Label`,
`ProgramArguments = [NODE, --import, tsx, apps/server/src/index.ts]`,
`WorkingDirectory` = repo root, the three env vars plus a `PATH`, `RunAtLoad`,
`KeepAlive`, `ThrottleInterval 30`, both log paths), then `bootout` → poll
`launchctl print` until it errors (cap 10 s) → `bootstrap`.

The proof is the gate: poll `/api/health` at `<host>:9451` **with** the header
until 200 (cap 20 s), then the negative control — the same URL **without** the
header must be exactly 401. Either failing exits non-zero pointing at the err
log. On success it prints the health JSON, only the `state` and `pid` lines out
of `launchctl print` (the full block dumps the job environment, token
included), and the URL with the token masked.

### B5 — tests

`apps/server/test/auth.test.ts` (9 tests): no header → 401 with
`WWW-Authenticate`; wrong token → 401; `Basic <token>` → 401; duplicated header
joined as `"Bearer a, Bearer b"` → 401; correct token → 200, and `bearer`
lower-case → 200; `/api/does-not-exist`, `/api` and `/api/../api/health` → 401
(the mount covers the whole tree); `POST /api/repos` with the header and a JSON
body → 400 "No such directory", not 401, which proves the gate sits above
`express.json` without breaking body parsing; and the default-off control —
`createApp` with no options → 200 with no header.

`apps/server/test/config.test.ts` (12 tests): every branch of B2 including
`localhost`/`::1`, trimming, the empty and wildcard binds with a token present,
the short-token boundary at 15/16 characters, empty-vs-unset token, and five
bad ports.

`e2e/harness.ts`: `startHarness(opts: HarnessOptions = {})` passes
`opts.token` through; the default leaves all 19 existing tests untouched.
`e2e/psq.e2e.ts`: a third `describe.skipIf(reason !== "")` block with its own
`beforeAll`/`afterAll` starting a **separate** gated harness (its own server and
browser). Test 1 opens `<url>/#token=<t>` and asserts `location.hash` is empty,
`localStorage["psq.token"]` holds the token, and the rendered UI reached its
loaded state with no error span — the real path, not a raw in-page fetch.
Test 2 opens with no token and asserts the "This server requires a token"
message renders.

### B6 — README

New `## Hosting` H2 after "The app", with a `### Deploying it on a Mac`
subsection. Covers the three env vars and defaults in a table; the interlock and
why (`POST /api/repos` opens any directory, the grader runs your SQL); the
header-only, no-cookie rule; `/#token=…` entry and how to forget it; the plain
HTTP warning and the advice to bind a private-network address or put TLS in
front; `deploy.sh`, its config file, `--show-url`, the LaunchAgent, the log
paths, that a bad config appears as a restart loop, and `launchctl bootout`;
and the D-B-6 consequence that the checkout is the deployment. Two sentences
added under "The app" naming `PSQ_HOST` / `PSQ_PORT` and linking to Hosting.
No machine specifics: no address, no tailnet name, no token.

## Deviations from the plan

1. **`index.ts` uses a `loadConfig()` function rather than a bare
   `let config; try { … }`.** A `let` with no initializer and no annotation is
   an implicit `any` under `strict` and reads as possibly-unassigned after the
   catch. A function whose catch ends in `process.exit(1)` (type `never`) gives
   the same behaviour with a properly typed `const config`. Behaviour is
   identical: message to stderr, exit 1.
2. *(withdrawn in the fix pass)* `config.ts` briefly also exported
   `isLoopback(host)`. Nothing imported it, so it was made module-private.
3. **`scripts/check-server-config.ts` is not covered by `pnpm typecheck`.**
   `tsconfig.json`'s `include` does not list `scripts/**`, and the plan forbids
   touching `tsconfig*.json`. This is not a gap this phase opened: `include`
   does not list `apps/server/test/**` either, so `api.test.ts` has always sat
   in exactly that position, as do the two new test files. Vitest typechecks
   none of them either way; what checks them is that they run. The script is
   ~10 lines and is exercised for real on every `deploy.sh` run — its output is
   the `config:` line in the deploy proof — so it is not unverified, just not
   statically checked. Left alone because closing it means editing a file
   outside the plan.
4. **`deploy.sh` also rejects a `PSQ_HOST` that is present but empty in the
   config file**, before calling the checker. The checker would reject it too
   (identical rule); the earlier check just produces a message naming the config
   file. No behavioural difference in what gets installed.
5. **The `launchctl print` filter is `grep -E $'^\t(state|pid) = '`, anchored to
   a single tab.** The first version used `^\s+` and also matched nested
   `state = active` lines from sub-dictionaries. Harmless, but noisy; the tab
   anchor prints exactly the two intended lines. No secret was ever in either
   version's output.

## Gates

| Gate | Baseline | Result |
|---|---|---|
| `pnpm typecheck` | clean | **clean** (all four projects) |
| `PSQ_NO_CORPUS=1 pnpm test` | 204 passed \| 58 skipped (262) | **222 passed \| 58 skipped (280)**, 0 failed — +18 (8 auth, 10 config) |
| `pnpm test` | 262 passed (262) | **283 passed (283)**, 0 failed |
| `pnpm test:e2e` | 19 passed (19) | **21 passed (21)** |
| Interlock, by hand | — | non-loopback + no token → **exit 1**, message names both ways out; `PSQ_HOST=` empty → **exit 1**; `PSQ_HOST=0.0.0.0` + a 32-hex token → **exit 1**; (extra) `PSQ_PORT=notaport` → **exit 1** |
| Boot under the exact plist command | — | `PSQ_HOST=127.0.0.1 PSQ_PORT=9451 node --import tsx apps/server/src/index.ts` from the repo root → `{"ok":true,"repos":0}` from `/api/health`, and logged `api: open (loopback only)` |
| `scripts/deploy.sh` first run | — | created `~/.config/psq/deploy.env`, **exit 1** asking for `PSQ_HOST` |
| `scripts/deploy.sh` second run | — | **passed its own proof**: `config: <host>:9451  token: yes`, health 200 with the token, **401 without** |
| Bind scope | — | `nc` to **loopback** 9451 → **refused** (good); `nc` to the **bound address** 9451 → **reachable** (good) |
| `launchctl print gui/501/com.psq.server` | — | `state = running`, one pid, **unchanged across the whole gate run** (no restart churn); `server.err.log` is **0 lines** |
| Corpus-name sweep | positive control ≥ 1 | **45/45** basenames hit the corpus file (control passes). Sweep before redaction: **6 of 45** hit (2 already public at `89448e7`, 3 ordinary English words, 1 genuine corpus name in `plan.md`). **After redaction: 4 of 45, and 0 genuine** — see Redaction below |
| Secret sweep | positive control ≥ 1 | **2/2** values found in the env file (control passes). **0 hits** for the `PSQ_HOST` value and **0 hits** for the `PSQ_TOKEN` value |

`PSQ_HOST` was written into the config file programmatically from
`Tailscale ip -4`; it was never typed, echoed or printed. `--show-url` was never
passed.

## Sweep detail

**Corpus-name sweep.** The basename set was derived programmatically from
`test/corpus.local.json` — every path-like string value, `os.path.basename` of
each — giving **45** terms. Positive control, run first: each of the 45 grepped
case-insensitively and word-bounded against `test/corpus.local.json` itself →
**45/45 hit**, so the sweep can see. (A stricter `\b`-anchored re-run scored
44/45 — one basename ends in a non-word character — with identical results.) Swept across
`feature-research/deploy-personal/*.md`, `README.md` and `scripts/*`:

**6 of the 45 produced at least one hit**, and each was classified:

- **2 terms are already public**, appearing verbatim in the README as committed
  at `89448e7` — they were public before this phase touched anything.
- **3 terms are ordinary English words** that happen to also be corpus
  basenames. One is the word inside `/api/health`, which is why the raw hit
  count is large; the other two occur in ordinary prose in this audit and the
  plan. None is a reference to anything private.
- **1 term hit twice, both in `feature-research/deploy-personal/plan.md`.** A
  genuine corpus-repo basename, in the approved plan's own prose. It has since
  been redacted — see the Redaction section, which supersedes this line.
  `README.md`, `scripts/*` and this audit contained **zero** hits of it at any
  point.

**Secret sweep.** In a subshell sourcing `~/.config/psq/deploy.env`,
`grep -rF` of the `PSQ_HOST` and `PSQ_TOKEN` values. Positive control first:
both values grepped against the env file itself → **2/2 found**. Then across
`feature-research/deploy-personal/*.md`, `README.md`, `scripts/*` and
`git diff HEAD` → **0 and 0**; and again across every untracked path
enumerated from `git status --porcelain` (`git diff HEAD` cannot see them) →
**0 and 0**. No matched line was printed.

## Open risks and notes for the reviewer

- **This checkout is production (D-B-6).** The service runs
  `apps/server/src/*.ts` through `tsx` from `/Users/james/Developer/domain-expert`
  with `KeepAlive`. An edit under `apps/server/src` goes live on the next
  restart, and `pnpm test:e2e` rebuilds `apps/web/dist` underneath the running
  server. That is intentional and recorded, but it means a future implementer
  working in this tree is editing a live service.
- **The service is running right now**, `state = running`, bound to the tailnet
  address on 9451, gate on, err log empty.
- The e2e token block starts a **second** Chromium and a second server. That is
  safe under `fileParallelism: false` and the 120 s hook timeout, and the run
  went from 19 s to 25 s. If e2e wall time ever matters, that block is the
  thing to fold back into the shared harness.
- `scripts/check-server-config.ts` is outside `tsconfig.json`'s `include`
  (deviation 3). A one-line `include` addition in a later phase would close it.
- The gate is **header-only on purpose** (D-B-2): it is what closes CSRF for
  `POST /api/repos`. A later phase must not "improve" this into a cookie
  session without adding a CSRF token.
- `git status` shows 7 modified files and 7 untracked paths, all inside the
  plan's table.

## Redaction

After the sweep above, the coordinator directed that the one genuine corpus-repo
name be redacted from `feature-research/deploy-personal/plan.md` rather than
accepted. Two clauses were reworded, wording only; nothing else in the file
changed, and a diff against the approved plan shows exactly those two hunks.

- **D-B-3** — the clause naming the other project's loopback server now reads
  "same trust model as today and as the existing loopback-only service on this
  Mac".
- **D-B-6** — the clause naming the other project's `dist/index.js` now reads
  "to match a built `dist/index.js` shape".

**Sweep counts, same 45 basenames, same three targets
(`feature-research/deploy-personal/*.md`, `README.md`, `scripts/*`), positive
control run first each time.**

| | Positive control | Terms with hits | Genuine corpus names |
|---|---|---|---|
| Before redaction | 45/45 (`grep -w`); 44/45 (`\b` regex) | **6** of 45 | **1** |
| After redaction | 45/45 (`grep -w`); 44/45 (`\b` regex) | **4** of 45 | **0** |

The 4 remaining terms break down as **2 already public at `89448e7`** (they
appear verbatim in the README as committed, so they predate this phase) and
**2 ordinary English words** that happen to also be corpus basenames. Their
values are deliberately not reproduced here.

(The count fell from 5 to 4 because rewording the paragraph above — the one
that used to ask for a decision on the flagged term — happened to drop an
ordinary English word that is also a corpus basename. No redaction was intended
there and none of the meaning changed.)

**`audit.md` itself: 0 genuine hits.** Three basenames match this file: two in
the already-public class and one ordinary English word. All occur in normal
prose, not as references to anything private.

## Fix pass (post-review)

Ten items from the review, all inside files already in the plan's table. No new
repo files; the only new file was a throwaway config in the scratchpad, deleted
after use.

**Blocking — `scripts/deploy.sh`, the checker's exit status was discarded.** It
ran as `echo "config: $(…)"`. Under `set -e` a command substitution that fails
in an *argument* position does not abort the script, so a configuration the
server refuses would have printed a blank line and the run would have gone on
to build, overwrite the plist and bootstrap a job that cannot start — a
restart loop, installed by the very step meant to prevent one. Fixed: the
substitution is now its own statement, `CONFIG_LINE="$(…)"`, and the echo
follows. Proved by gate (b) below, which is the negative gate this bug would
have passed.

Also in `deploy.sh`:

1. `cd "$REPO_ROOT"` hoisted above the checker call. `--import tsx` resolves the
   bare specifier from the caller's cwd, so from anywhere else the checker died
   with `ERR_MODULE_NOT_FOUND` — which, with the blocking bug, was silent.
   Every gate below runs the script from `$HOME`, not the repo.
2. The first-run token is generated into `NEW_TOKEN` and length-checked before
   the heredoc, so a failing `openssl` cannot write an empty `PSQ_TOKEN=`.
3. The token is no longer in curl's argv, where any process could read it from
   `ps`: the header is written to a `mktemp` file at mode 600 and passed as
   `-H @file`, removed by an `EXIT` trap. (The real run's 200 is what proves
   curl accepted the `@file` form; a mis-parsed header would have produced a
   401 and failed the gate.)
4. `mkdir -p -m 700` plus an unconditional `chmod 700` on `~/Library/Logs/psq`
   — the out log records the bound address.
5. An `xml_escape` helper (`&`, `<`, `>`) applied to the node path, repo root,
   host, token and log dir when rendering the plist. An ampersand in any of
   them made the plist unparseable, and launchd's complaint would have named
   the file, not the value.
6. `CONFIG_FILE="${PSQ_DEPLOY_ENV:-$HOME/.config/psq/deploy.env}"`, with the
   config directory derived from it. Documented in one line in README Hosting.
   This is what makes gate (b) possible without touching the real config.

`apps/server/src/config.ts`:

7. `PSQ_TOKEN` is trimmed before it is measured and before it is used. A
   trailing space in an env file is invisible and must neither pad a short
   token past the minimum nor become part of the compared secret. Sixteen
   spaces now reduce to no token at all.
8. `PSQ_PORT` set-but-empty (or whitespace) now throws, matching the `PSQ_HOST`
   rule, and the value must match `/^\d+$/` before the range check — `Number()`
   read `0x2360` as 9056 and `1e3` as 1000. Both cases added to
   `config.test.ts`, along with the trimmed-token cases.
9. `isLoopback` was exported and imported by nothing; it is module-private now.

`apps/server/src/app.ts` + `auth.test.ts`:

10. **A comment was factually wrong and is corrected.** It claimed Node joins
    duplicate `Authorization` headers into `"Bearer a, Bearer b"`. It does not:
    for `authorization` Node keeps the **first** line and discards the rest, so
    a second header can neither append to nor override the first. Verified here
    on real header lines — supertest does send an array as two separate lines
    (checked: the request arrived with two `authorization` raw-header entries),
    so a test now documents first-wins directly: good-then-wrong → **200**,
    wrong-then-good → **401**. The existing test was renamed to say what it
    actually covers, a comma-joined single value being rejected rather than
    half-accepted. The gate's behaviour never changed; only the explanation of
    why it is safe was wrong.

### Fix-pass verification

| # | Check | Result |
|---|---|---|
| a | `bash -n scripts/deploy.sh` | **OK** |
| a | `pnpm typecheck` | **clean** |
| a | `PSQ_NO_CORPUS=1 pnpm test` | **225 passed \| 58 skipped (283)**, 0 failed (was 222/280; +3: one auth first-wins test, two config tests) |
| b | Negative gate: bad config, run from `$HOME` | Exited **1** at the config step with the wildcard-bind message, **before** `pnpm install` and `pnpm build:web` (no vite output was emitted). Plist mtime **unchanged**, service pid **unchanged**. Throwaway config deleted. |
| b | Positive control for that observation | The real run in (c) **did** move both — new plist mtime and a new pid — so "unchanged" in (b) is a signal, not a blind check. |
| c | Real `scripts/deploy.sh`, run from `$HOME` | Passed its own proof: `config: <host>:9451  token: yes`, health **200** with the token, **401** without. `state = running`, one pid. `server.err.log` **0 lines**. `ls -ld ~/Library/Logs/psq` → **drwx------ (700)**. No `psq-auth` temp file left behind. |
| d | `audit.md` corrections | Stale reviewer-decision paragraphs removed (the Redaction section supersedes them); deviation 3 reworded; deviation 2 withdrawn; the duplicate-header correction recorded above. |
| e | Corpus-name sweep | Positive control **45/45**. Sweep: **4 of 45** terms hit — 2 already public at `89448e7`, 2 ordinary English words, **0 genuine**. |
| e | Secret sweep | Positive control **2/2** in the env file. Across `feature-research/deploy-personal/*.md`, `README.md`, `scripts/*`, `git diff HEAD` and all untracked paths: host value **0 hits**, token value **0 hits**. |

`pnpm test:e2e` was not re-run in the fix pass: nothing under `apps/web`,
`e2e/` or the gate's request path changed, and the full `pnpm test` covers the
server changes. Worth one run before commit if the reviewer wants it belt-and-
braces.

The service is running on the fixed script, on a new pid, gate on, err log
empty. Still nothing committed.

## Tidy (pre-commit)

Three items from the re-review (verdict Ship), plus the accuracy fixes above:

1. `scripts/deploy.sh`: `${PSQ_PORT:-8092}` → `${PSQ_PORT-8092}`, so a
   set-but-empty port reaches the checker and is refused there instead of
   quietly becoming 8092. The script and `config.ts` now agree on all three
   variables.
2. `scripts/deploy.sh`: `set -a` dropped from around the `source`. The three
   values stay ordinary shell variables and are passed to the checker with an
   explicit `env PSQ_HOST=… PSQ_PORT=… PSQ_TOKEN=…` prefix; the plist heredoc
   reads the same shell variables as before. `pnpm install` and `pnpm build:web`
   no longer inherit the token. **Verified empirically, not by reading**: a fake
   `pnpm` was placed first on `PATH` (via `PSQ_NODE` pointing at a scratchpad
   directory holding a `node` symlink beside it) and the script run against a
   throwaway loopback config. The fake reported `PSQ_TOKEN` **0** and
   `PSQ_HOST` **0** in its environment, while the control variable that *is*
   exported into it read **1** — so the check could see exported variables and
   these two were genuinely absent. The script aborted at the fake `pnpm`, well
   before the plist step; the fake and the throwaway config were then deleted.
   The only `export` left in the file is `PATH`.
3. `audit.md`: the "exported alongside `isLoopback`" phrase removed; "six
   untracked" → seven in all three places; the secret-sweep evidence line now
   says the paths were enumerated from `git status --porcelain`;
   `auth.test.ts` 8 → 9 tests, `config.test.ts` 10 → 12, and the Gates table's
   `pnpm test` 280 → 283.

`pnpm test:e2e` was re-run by the reviewer: **21 passed**.

### Tidy verification

| # | Check | Result |
|---|---|---|
| a | `bash -n scripts/deploy.sh` | **OK** |
| a | `PSQ_NO_CORPUS=1 pnpm test` | **225 passed \| 58 skipped (283)**, 0 failed |
| b | Negative gate, empty `PSQ_PORT` (the case item 1 unlocks), run from `$HOME` | exit **1** at the config step with the port message; **0** build lines emitted; plist mtime **unchanged**, pid **unchanged**. Throwaway deleted. |
| c | Real `scripts/deploy.sh` from `$HOME` | exit **0**, passed its own proof: health **200** with the token, **401** without. `state = running`, one pid. `server.err.log` **0 lines**, log dir still **700**. |
| d | Corpus-name sweep, final tree | positive control **45/45**; **4 of 45** terms hit — 2 already public at `89448e7`, 2 ordinary English, **0 genuine**. |
| d | Secret sweep, final tree | positive control **2/2** in the env file; across `feature-research/deploy-personal/*.md`, `README.md`, `scripts/*`, `git diff HEAD` and every untracked path from `git status --porcelain`: host **0 hits**, token **0 hits**. |
| — | Post-commit sweeps | over `git show HEAD`: host **0**, token **0**; corpus basenames over the committed files: **0 genuine**. |

