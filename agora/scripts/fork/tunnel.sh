#!/usr/bin/env bash
# Agora fork — share the running stack on a public URL via a cloudflared quick tunnel.
# Gives a https://<random>.trycloudflare.com link anyone can open (zero install for them),
# and points the server's SiteURL at it so websockets/redirects/connectors work.
#
# Skip with AGORA_LOCAL=1 (localhost-only). Override the public URL with AGORA_SITEURL=<url>.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"        # .../agora
COMPOSE="$REPO_ROOT/deploy/fork/docker-compose.yml"
PROJECT="agora-fork"
PORT="${AGORA_PORT:-8066}"
STATE_DIR="$HOME/.agora-fork"; mkdir -p "$STATE_DIR"
CF_BIN="$HOME/.local/bin/cloudflared"

log() { printf '\033[36m[tunnel]\033[0m %s\n' "$*"; }
die() { printf '\033[31m[tunnel] %s\033[0m\n' "$*" >&2; exit 1; }

# localhost-only shortcut (dev iteration)
if [ "${AGORA_LOCAL:-}" = "1" ]; then
  log "AGORA_LOCAL=1 — staying on http://localhost:${PORT} (no public tunnel)"
  exit 0
fi

reup_with_siteurl() {  # recreate the server with the given SiteURL so it serves that origin correctly
  local url="$1"
  log "pointing server SiteURL at $url …"
  AGORA_SITEURL="$url" AGORA_PORT="$PORT" docker compose -p "$PROJECT" -f "$COMPOSE" up -d
  for i in $(seq 1 25); do
    [ "$(docker inspect --format '{{.State.Health.Status}}' "${PROJECT}-mattermost-1" 2>/dev/null || echo none)" = healthy ] && return 0
    sleep 3
  done
  die "server didn't become healthy after SiteURL change"
}

# explicit domain wins — no tunnel needed
if [ -n "${AGORA_SITEURL:-}" ]; then
  url="${AGORA_SITEURL%/}"
  reup_with_siteurl "$url"
  printf '\n\033[32m  ✔ Agora is shared at  %s\033[0m\n\n' "$url"
  exit 0
fi

# 1) ensure cloudflared (download the static linux binary; no apt needed)
if [ ! -x "$CF_BIN" ] && ! command -v cloudflared >/dev/null 2>&1; then
  log "installing cloudflared…"
  mkdir -p "$(dirname "$CF_BIN")"
  arch="$(uname -m)"; cf_arch=amd64; [ "$arch" = "aarch64" ] && cf_arch=arm64
  curl -fSL --retry 3 -o "$CF_BIN" \
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${cf_arch}"
  chmod +x "$CF_BIN"
fi
CF="$(command -v cloudflared || echo "$CF_BIN")"

# 2) clear any orphan tunnel from a previous run
pkill -f "cloudflared tunnel" 2>/dev/null || true
sleep 1

# 3) start the quick tunnel
logfile="$STATE_DIR/cloudflared.log"; : > "$logfile"
log "starting cloudflared quick tunnel -> http://localhost:${PORT} …"
nohup "$CF" tunnel --url "http://localhost:${PORT}" --protocol http2 --no-autoupdate \
  > "$logfile" 2>&1 &
echo $! > "$STATE_DIR/tunnel.pid"

# 4) wait for the public URL + edge registration (~90s). Guarded so `set -e` doesn't
#    bail on the expected "no match yet" grep failures during the first iterations.
url=""; connected=""
for _ in $(seq 1 45); do
  if [ -z "$url" ]; then
    url="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$logfile" 2>/dev/null | grep -v '://api\.' | head -1 || true)"
  fi
  if grep -q "Registered tunnel connection" "$logfile" 2>/dev/null; then connected=1; fi
  if [ -n "$url" ] && [ -n "$connected" ]; then break; fi
  if ! kill -0 "$(cat "$STATE_DIR/tunnel.pid" 2>/dev/null)" 2>/dev/null; then die "cloudflared exited early (see $logfile)"; fi
  sleep 2
done
[ -n "$url" ] || die "timed out waiting for the trycloudflare URL (see $logfile)"
echo "$url" > "$STATE_DIR/tunnel.url"
[ -n "$connected" ] || log "URL assigned but edge not confirmed yet — may 1033 for a few seconds."

# 5) make the server authoritative for that origin
reup_with_siteurl "$url"

printf '\n\033[32m  ✔ Agora is shared at  %s\033[0m  (localhost:%s also works)\n\n' "$url" "$PORT"
log "stop sharing:  kill \$(cat $STATE_DIR/tunnel.pid)   (or stop the stack)"
