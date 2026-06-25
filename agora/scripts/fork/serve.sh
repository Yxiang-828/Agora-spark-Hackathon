#!/usr/bin/env bash
# Agora fork — serve the compiled webapp on a version-matched Mattermost server.
# Brings up agora/deploy/fork/docker-compose.yml (server pinned to the 11.9 line,
# our webapp/channels/dist mounted as the client) and waits until it answers.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"        # .../agora
COMPOSE="$REPO_ROOT/deploy/fork/docker-compose.yml"
PROJECT="agora-fork"
PORT="${AGORA_PORT:-8066}"
export AGORA_PORT="$PORT"
DIST="$REPO_ROOT/../webapp/channels/dist"      # our compiled client
CLIENT_VOL="${PROJECT}_mmclient"               # named volume that backs /mattermost/client
MM_UID="${MM_UID:-2000}"                        # uid the mattermost server runs as

log() { printf '\033[36m[serve]\033[0m %s\n' "$*"; }
die() { printf '\033[31m[serve] %s\033[0m\n' "$*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || die "docker not found"
[ -f "$COMPOSE" ] || die "compose file missing: $COMPOSE"
[ -f "$DIST/root.html" ] || die "no build found — run build.sh first"

# Seed our compiled client into the mmclient named volume BEFORE the server starts.
# We use a named volume (not a bind mount of $DIST) because on Docker Desktop's WSL2
# backend a named volume nested under a WSL bind mount is shadowed — the server then
# cannot write or serve client/plugins (plugin bundles 404 / mkdir permission denied).
# Copying into a plain named volume owned by the mattermost uid avoids that entirely.
log "syncing compiled client → $CLIENT_VOL …"
docker volume create "$CLIENT_VOL" >/dev/null
# cp is additive: it refreshes our dist files without deleting client/plugins/* that
# the server generates at activation, so prepackaged + Agora bundles survive a re-serve.
docker run --rm \
  -v "$CLIENT_VOL:/dest" \
  -v "$DIST:/src:ro" \
  alpine sh -c "cp -a /src/. /dest/ && chown -R ${MM_UID}:${MM_UID} /dest" \
  || die "failed to seed client volume"

# Auto-terminate: reclaim our host ports from any stale/foreign stack first.
# `compose up` only reconciles its OWN project; a different project holding host port
# $PORT/8443 (e.g. the old plugin-era agora/deploy/docker-compose.yml) makes Docker
# hard-fail with "port is already allocated". Stop any non-fork container publishing
# our ports; our own stack is left for `up -d` below to reconcile.
for p in "$PORT" 8443; do
  for id in $(docker ps -q --filter "publish=$p"); do
    nm="$(docker inspect --format '{{.Name}}' "$id" 2>/dev/null | sed 's,^/,,')"
    case "$nm" in
      "${PROJECT}"*) : ;;                       # our stack — leave it
      "") : ;;
      *) log "port $p held by '$nm' (other stack) — stopping it"; docker stop "$id" >/dev/null ;;
    esac
  done
done

log "starting fork stack (project=$PROJECT, port=$PORT)…"
docker compose -p "$PROJECT" -f "$COMPOSE" up -d

log "waiting for the server to become healthy…"
for i in $(seq 1 40); do
  h="$(docker inspect --format '{{.State.Health.Status}}' "${PROJECT}-mattermost-1" 2>/dev/null || echo none)"
  [ "$h" = "healthy" ] && { log "healthy."; break; }
  sleep 3
  [ "$i" = "40" ] && die "server did not become healthy in time — check: docker compose -p $PROJECT logs mattermost"
done

code="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:${PORT}/" 2>/dev/null || echo 000)"
[ "$code" = "200" ] || die "server up but HTTP $code on :$PORT"

printf '\n\033[32m  ✔ Agora fork is serving at  http://localhost:%s\033[0m\n\n' "$PORT"
log "stop with:  docker compose -p $PROJECT down"
