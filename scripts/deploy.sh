#!/usr/bin/env bash
#
# Deploy psq on this Mac as a LaunchAgent, and prove it answers.
#
# This is the whole deploy story: a code-only redeploy is running it again.
# The machine's address and token live outside the repo in
# ~/.config/psq/deploy.env, because this repo is public.
#
# Usage: scripts/deploy.sh [--show-url]
#   --show-url  print the ready-to-open URL with the real token in it.
#               Without it the token is masked, so the output is safe to paste.

set -euo pipefail

SHOW_URL=0
for arg in "$@"; do
  case "$arg" in
    --show-url) SHOW_URL=1 ;;
    *) echo "unknown option: $arg (usage: deploy.sh [--show-url])" >&2; exit 2 ;;
  esac
done

# --- 1. paths -----------------------------------------------------------------

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# The fnm *alias* path, not a versioned one: the alias survives an fnm upgrade,
# and this path is baked into a plist that launchd keeps using for months.
NODE="${PSQ_NODE:-$HOME/.local/share/fnm/aliases/default/bin/node}"
if [[ ! -x "$NODE" ]]; then
  echo "no node at $NODE — install one, or set PSQ_NODE to the node binary" >&2
  exit 1
fi
NODE_BIN_DIR="$(dirname "$NODE")"
# So the sibling pnpm, and every shim it runs, finds this same node.
export PATH="$NODE_BIN_DIR:$PATH"

LABEL="com.psq.server"
# PSQ_DEPLOY_ENV points the script at a different config file, which is how the
# refuse-a-bad-config path is testable without touching the real one.
CONFIG_FILE="${PSQ_DEPLOY_ENV:-$HOME/.config/psq/deploy.env}"
CONFIG_DIR="$(dirname "$CONFIG_FILE")"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs/psq"
DOMAIN="gui/$(id -u)"

# --- 2. machine config --------------------------------------------------------

if [[ ! -f "$CONFIG_FILE" ]]; then
  mkdir -p "$CONFIG_DIR"
  umask 077
  # Generated before the heredoc so a failing openssl is caught here rather
  # than silently writing an empty PSQ_TOKEN= line.
  NEW_TOKEN="$(openssl rand -hex 32)"
  if [[ ${#NEW_TOKEN} -lt 32 ]]; then
    echo "openssl produced no usable token — cannot write $CONFIG_FILE" >&2
    exit 1
  fi
  cat > "$CONFIG_FILE" <<EOF
# psq deploy config for this machine. Not in the repo: it holds a secret.
#
# Set PSQ_HOST to the ONE address to bind. There is no default and no wildcard:
# exposing this server is an explicit choice, because POST /api/repos opens any
# directory on this machine and the grader runs SQL you send it.
#   127.0.0.1        this machine only
#   <private addr>   a private-network address you trust (e.g. a tailnet address)
#PSQ_HOST=
PSQ_PORT=9451
PSQ_TOKEN=$NEW_TOKEN
EOF
  chmod 600 "$CONFIG_FILE"
  echo "created $CONFIG_FILE with a fresh token."
  echo "Set PSQ_HOST in it to the address to bind, then run this again."
  exit 1
fi

chmod 600 "$CONFIG_FILE"
# Sourced WITHOUT `set -a`: these stay shell variables and are never exported,
# so `pnpm install` and `pnpm build:web` below — and every process they spawn —
# run without PSQ_TOKEN in their environment. The checker is handed the three
# values explicitly instead.
# shellcheck disable=SC1090
source "$CONFIG_FILE"

if [[ -z "${PSQ_HOST:-}" ]]; then
  echo "PSQ_HOST is not set in $CONFIG_FILE — set the one address to bind." >&2
  exit 1
fi
# `-` not `:-`: a set-but-empty PSQ_PORT must reach the checker and be refused
# there, the same way config.ts refuses it. Only an unset one takes the default.
PSQ_PORT="${PSQ_PORT-8092}"

# From anywhere else, `--import tsx` resolves the bare specifier against the
# caller's cwd and dies with ERR_MODULE_NOT_FOUND. Everything below runs here.
cd "$REPO_ROOT"

# Validate with the server's own code, not a bash restatement of it, so a
# config the server would refuse is never installed.
#
# Captured into a variable on its own line, NOT interpolated into an echo:
# under `set -e` a command substitution that fails in an argument position does
# not abort the script, so a rejected config would print a blank line and this
# would go on to build and bootstrap a job that cannot start.
CONFIG_LINE="$(env PSQ_HOST="$PSQ_HOST" PSQ_PORT="$PSQ_PORT" PSQ_TOKEN="$PSQ_TOKEN" \
  "$NODE" --import tsx "$REPO_ROOT/scripts/check-server-config.ts")"
echo "config: $CONFIG_LINE"

# --- 3. build -----------------------------------------------------------------

pnpm install --frozen-lockfile
pnpm build:web

# --- 4. the LaunchAgent -------------------------------------------------------

# 700: the out log records the address the server bound.
mkdir -p -m 700 "$LOG_DIR"
chmod 700 "$LOG_DIR"
mkdir -p "$HOME/Library/LaunchAgents"

# Written to a temp file and moved into place, so launchd never reads a half
# written plist. It carries the token, hence 600.
# A plist is XML: an ampersand in a path or a token would make it unparseable,
# and launchd would refuse the job with a message about the file, not the value.
xml_escape() {
  local v="$1"
  v="${v//&/&amp;}"
  v="${v//</&lt;}"
  v="${v//>/&gt;}"
  printf '%s' "$v"
}
X_NODE="$(xml_escape "$NODE")"
X_ROOT="$(xml_escape "$REPO_ROOT")"
X_HOST="$(xml_escape "$PSQ_HOST")"
X_TOKEN="$(xml_escape "$PSQ_TOKEN")"
X_NODE_BIN_DIR="$(xml_escape "$NODE_BIN_DIR")"
X_LOG_DIR="$(xml_escape "$LOG_DIR")"

TMP_PLIST="$(mktemp "${TMPDIR:-/tmp}/com.psq.server.XXXXXX.plist")"
cat > "$TMP_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$X_NODE</string>
    <string>--import</string>
    <string>tsx</string>
    <string>apps/server/src/index.ts</string>
  </array>
  <key>WorkingDirectory</key><string>$X_ROOT</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PSQ_HOST</key><string>$X_HOST</string>
    <key>PSQ_PORT</key><string>$PSQ_PORT</string>
    <key>PSQ_TOKEN</key><string>$X_TOKEN</string>
    <key>PATH</key><string>$X_NODE_BIN_DIR:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>$X_LOG_DIR/server.out.log</string>
  <key>StandardErrorPath</key><string>$X_LOG_DIR/server.err.log</string>
</dict>
</plist>
EOF
mv "$TMP_PLIST" "$PLIST"
chmod 600 "$PLIST"

# --- 5. (re)load --------------------------------------------------------------

# bootout + bootstrap, not `kickstart -k`: launchd caches the plist it was
# bootstrapped with, so a changed port or token would be silently ignored.
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true

# bootout returns before teardown finishes, and bootstrapping into a domain
# that still holds the old job fails with "Bootstrap failed: 5".
for _ in $(seq 1 20); do
  launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1 || break
  sleep 0.5
done

launchctl bootstrap "$DOMAIN" "$PLIST"

# --- 6. prove it --------------------------------------------------------------

URL="http://$PSQ_HOST:$PSQ_PORT"

# The header goes in a 600 file rather than curl's argv, where every process on
# the machine could read the token out of `ps`.
HEADER_FILE="$(mktemp "${TMPDIR:-/tmp}/psq-auth.XXXXXX")"
chmod 600 "$HEADER_FILE"
trap 'rm -f "$HEADER_FILE"' EXIT
printf 'Authorization: Bearer %s\n' "$PSQ_TOKEN" > "$HEADER_FILE"

HEALTH=""
for _ in $(seq 1 40); do
  if HEALTH="$(curl -fsS --max-time 3 -H "@$HEADER_FILE" "$URL/api/health" 2>/dev/null)"; then
    break
  fi
  HEALTH=""
  sleep 0.5
done

if [[ -z "$HEALTH" ]]; then
  echo "FAILED: $URL/api/health did not answer 200 with the token." >&2
  echo "Look at $LOG_DIR/server.err.log — a bad config restart-loops there." >&2
  exit 1
fi

# The negative control. A 200 here would mean the gate is not on, which on a
# non-loopback address is the failure this whole phase exists to prevent.
CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "$URL/api/health" || true)"
if [[ "$CODE" != "401" ]]; then
  echo "FAILED: an unauthenticated request returned $CODE, expected 401." >&2
  exit 1
fi

echo
echo "health (with token):  $HEALTH"
echo "unauthenticated:      401 as required"
# Only these two lines from launchctl print: the full block dumps the job's
# environment, and that includes the token.
launchctl print "$DOMAIN/$LABEL" | grep -E $'^\t(state|pid) = ' || true
echo
if [[ "$SHOW_URL" == "1" ]]; then
  echo "open once:  $URL/#token=$PSQ_TOKEN"
else
  echo "open once:  $URL/#token=<redacted>"
  echo "run \`scripts/deploy.sh --show-url\` or \`cat $CONFIG_FILE\` to see it."
fi
