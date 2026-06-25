#!/usr/bin/env bash
# Agora fork — build + install the Agora plugin (com.aegis.agora) into the running fork.
# This is what brings full plugin-Agora feature parity into the fork. Idempotent: rebuilds
# only when plugin source changed; always (re)deploys the current bundle (cheap).
#
# Skip entirely with AGORA_SKIP_PLUGIN=1. Force a rebuild with AGORA_PLUGIN_REBUILD=1.
set -euo pipefail

AGORA_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"   # .../agora
PLUGIN="$AGORA_ROOT/plugin"
PROJECT="agora-fork"
C="${PROJECT}-mattermost-1"
PLUGIN_ID="com.aegis.agora"

log() { printf '\033[36m[plugin]\033[0m %s\n' "$*"; }
die() { printf '\033[31m[plugin] %s\033[0m\n' "$*" >&2; exit 1; }

[ "${AGORA_SKIP_PLUGIN:-}" = "1" ] && { log "AGORA_SKIP_PLUGIN=1 — leaving plugin as-is"; exit 0; }
command -v docker >/dev/null || die "docker not found"
[ -d "$PLUGIN" ] || die "plugin/ not found at $PLUGIN"

# --- rebuild only when source changed --------------------------------------
# content-based (not mtime — rsync bumps mtimes every sync, which would force a needless rebuild)
src_hash() { find "$PLUGIN/server" "$PLUGIN/webapp/src" "$PLUGIN/plugin.json" -type f \
               -exec sha1sum {} + 2>/dev/null | sort -k2 | sha1sum | cut -d' ' -f1; }
HASH="$(src_hash)"
MARKER="$PLUGIN/dist/.agora-src-hash"
bundle() { ls -t "$PLUGIN"/dist/${PLUGIN_ID}-*.tar.gz 2>/dev/null | grep -v -- -fixed | head -1 || true; }

if [ -z "$(bundle)" ] || [ "${AGORA_PLUGIN_REBUILD:-}" = "1" ] || [ "$(cat "$MARKER" 2>/dev/null)" != "$HASH" ]; then
  ARCH="$(uname -m)"; GOARCH=amd64; [ "$ARCH" = "aarch64" ] && GOARCH=arm64
  log "building plugin (server + webapp) in agora-builder container…"
  docker build -q -f "$PLUGIN/build/builder.Dockerfile" -t agora-builder "$PLUGIN/build" >/dev/null
  docker run --rm \
    -v "$AGORA_ROOT:/src" \
    -v agora-go-mod:/go/pkg/mod -v agora-go-build:/root/.cache/go-build \
    -w /src/plugin -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" \
    agora-builder bash -euc '
      git config --global --add safe.directory /src || true
      export GOFLAGS=-buildvcs=false
      make apply
      (cd server && CGO_ENABLED=0 GOOS=linux GOARCH='"$GOARCH"' go build -trimpath -o dist/plugin-linux-'"$GOARCH"')
      make webapp
      echo container-linux > webapp/node_modules/.agora_build_os
      make bundle
      [ -n "${HOST_UID:-}" ] && chown -R "$HOST_UID:$HOST_GID" dist server/dist webapp/dist webapp/node_modules 2>/dev/null || true
    '
  echo "$HASH" > "$MARKER"
  log "built $(basename "$(bundle)")"
else
  log "plugin source unchanged — reusing $(basename "$(bundle)")"
fi

BUNDLE="$(bundle)"; [ -n "$BUNDLE" ] || die "no plugin bundle produced"

# --- deploy into the running server ----------------------------------------
docker ps --format '{{.Names}}' | grep -qx "$C" || die "fork server ($C) not running — run serve.sh first"
FIXED="${BUNDLE%.tar.gz}-fixed.tar.gz"
if command -v python3 >/dev/null 2>&1 && [ -f "$PLUGIN/build/fixperms.py" ]; then
  python3 "$PLUGIN/build/fixperms.py" "$BUNDLE" "$FIXED" >/dev/null
else
  FIXED="$BUNDLE"
fi
log "installing $PLUGIN_ID …"
docker cp "$FIXED" "$C:/tmp/agora-plugin.tar.gz"
# Add first; only delete+re-add if add fails because it's already installed. This avoids the
# old delete-before-add race that left the room with NO plugin whenever the add step failed.
if ! docker exec "$C" mmctl --local plugin add /tmp/agora-plugin.tar.gz >/dev/null 2>&1; then
  docker exec "$C" mmctl --local plugin delete "$PLUGIN_ID" >/dev/null 2>&1 || true
  docker exec "$C" mmctl --local plugin add /tmp/agora-plugin.tar.gz >/dev/null
fi
docker exec "$C" mmctl --local plugin enable "$PLUGIN_ID" >/dev/null
docker exec "$C" mmctl --local plugin list 2>/dev/null | grep -q "$PLUGIN_ID" \
  && log "✔ $PLUGIN_ID enabled in the fork" || die "plugin did not enable"
