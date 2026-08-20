#!/bin/bash
# Bring the whole stack up, and keep it up.
#
# Idempotent by design: it starts only what is missing, so launchd can run it
# every few minutes as both a boot script and a watchdog. Running it twice does
# nothing the second time.
#
# The failure this exists to prevent is silence. A dead worker still lets
# webhooks arrive and return 200, so Instagram sees success and the DM never
# sends — nothing surfaces unless something is actively checking.

set -uo pipefail

APP_DIR="${BEYONDCHAT_DIR:-$HOME/BeyondChat}"
LOG_DIR="$APP_DIR/logs"
PORT="${BEYONDCHAT_PORT:-3010}"
NODE_BIN="$HOME/.nvm/versions/node/v22.22.0/bin"
export PATH="$NODE_BIN:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

mkdir -p "$LOG_DIR"
cd "$APP_DIR" || exit 1

# The tunnel hostname Meta actually talks to, read from .env rather than baked in
# here — this file is public, .env is not. Checked from outside, because a healthy
# local server behind a dead tunnel looks fine from here and is offline to Instagram.
PUBLIC_URL="$(grep -m1 '^BEYONDCHAT_PUBLIC_URL=' .env 2>/dev/null | cut -d= -f2- | tr -d '"'"'"'')"
if [ -z "$PUBLIC_URL" ]; then
  echo "BEYONDCHAT_PUBLIC_URL is not set in .env" >> "$LOG_DIR/ensure.log"
  exit 1
fi

# Only one instance at a time: a slow Docker start would otherwise overlap with
# the next scheduled run and race to start the same services twice.
LOCK="$LOG_DIR/.ensure.lock"
if ! mkdir "$LOCK" 2>/dev/null; then exit 0; fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

log() { echo "$(date "+%Y-%m-%d %H:%M:%S") $*" >> "$LOG_DIR/ensure.log"; }

# `screen -ls` exits 1 even when it successfully lists sessions, and pipefail
# would let that status win over grep's — making every check report "not
# running" and start a duplicate on every pass. Capture first, then match.
running() {
  local sessions
  sessions=$(screen -ls 2>/dev/null || true)
  grep -q "\.$1[[:space:]]" <<<"$sessions"
}

start_screen() {
  local name="$1" cmd="$2"
  screen -dmS "$name" bash -c "export PATH=\"$NODE_BIN:\$PATH\"; cd \"$APP_DIR\"; $cmd"
}

# ---- Docker (postgres + redis + maildev) --------------------------------
if ! docker info >/dev/null 2>&1; then
  log "Docker not running, starting Docker Desktop"
  open -a Docker 2>/dev/null
  for _ in $(seq 1 60); do
    docker info >/dev/null 2>&1 && break
    sleep 5
  done
fi
if docker info >/dev/null 2>&1; then
  # `up -d` is already a no-op for containers that are up.
  docker compose up -d >>"$LOG_DIR/ensure.log" 2>&1 || log "docker compose up failed"
else
  log "ERROR: Docker never came up; database and queue are unavailable"
  exit 1
fi

# ---- Web (webhook endpoint + dashboard) ---------------------------------
if ! running openreply-web; then
  log "starting web"
  start_screen openreply-web "npm run dev -- -p $PORT >> \"$LOG_DIR/web.log\" 2>&1"
  sleep 15
fi

# ---- Worker (sends the DMs; also runs the 5-min comment sweep) ----------
if ! running openreply-worker; then
  log "starting worker"
  start_screen openreply-worker "npx tsx --env-file=.env worker/dm-worker.ts >> \"$LOG_DIR/worker.log\" 2>&1"
  sleep 8
fi

# ---- Cloudflare tunnel (the public HTTPS Meta posts to) -----------------
if ! running openreply-tunnel; then
  log "starting tunnel"
  start_screen openreply-tunnel "set -a; . ./.tunnel.env; set +a; cloudflared tunnel --no-autoupdate run --token \"\$CLOUDFLARE_TUNNEL_TOKEN\" >> \"$LOG_DIR/tunnel.log\" 2>&1"
  sleep 10
fi

# ---- Verify, and repair what claims to be running but isn't -------------
health=$(curl -fsS --max-time 10 "http://localhost:$PORT/api/health" 2>/dev/null)
if [ -z "$health" ]; then
  log "local health check failed, restarting web"
  screen -S openreply-web -X quit 2>/dev/null
  start_screen openreply-web "npm run dev -- -p $PORT >> \"$LOG_DIR/web.log\" 2>&1"
  sleep 15
  health=$(curl -fsS --max-time 10 "http://localhost:$PORT/api/health" 2>/dev/null)
fi

# A screen session can survive the process inside it dying, so trust the
# heartbeat in the health payload over the session list.
if [ -n "$health" ] && ! echo "$health" | grep -q '"healthy":true'; then
  log "worker heartbeat stale, restarting worker"
  screen -S openreply-worker -X quit 2>/dev/null
  sleep 1
  start_screen openreply-worker "npx tsx --env-file=.env worker/dm-worker.ts >> \"$LOG_DIR/worker.log\" 2>&1"
fi

# The tunnel is the only part Meta actually talks to, so it is checked from the
# outside. A 000/502 here means comments stop arriving even though everything
# local looks fine.
code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$PUBLIC_URL/api/health" 2>/dev/null)
if [ "$code" != "200" ]; then
  log "public URL returned $code, restarting tunnel"
  screen -S openreply-tunnel -X quit 2>/dev/null
  sleep 1
  start_screen openreply-tunnel "set -a; . ./.tunnel.env; set +a; cloudflared tunnel --no-autoupdate run --token \"\$CLOUDFLARE_TUNNEL_TOKEN\" >> \"$LOG_DIR/tunnel.log\" 2>&1"
fi

exit 0
