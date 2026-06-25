#!/usr/bin/env bash
# Agora fork — reproducible webapp build.
#
# Compiles the Mattermost webapp from source (platform/* workspaces + the channels app)
# into webapp/channels/dist, which the fork serve stack mounts onto a version-matched
# server. Runs natively on Linux/macOS and inside WSL on Windows.
#
# This script encodes the recipe that actually works — every step here exists because
# skipping it breaks the build:
#   * Node 24 (Mattermost pins ^24; newer/older majors miss-resolve the toolchain)
#   * npm ci (lockfile-exact; a loose install resolves a rollup/TS combo that fails)
#   * PURGE stale tsconfig.tsbuildinfo / .rollup.cache — a cache carried across machines
#     makes TS incremental builds skip files, so raw .tsx hits rollup ("Unexpected token")
#   * a bounded JS heap that fits the host/VM RAM (too large => OOM kills the build)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"        # .../agora
WEBAPP="$(cd "$REPO_ROOT/.." && pwd)/webapp"                            # repo/webapp
NODE_HEAP_MB="${AGORA_NODE_HEAP_MB:-6144}"

log() { printf '\033[36m[build]\033[0m %s\n' "$*"; }
die() { printf '\033[31m[build] %s\033[0m\n' "$*" >&2; exit 1; }

# --- Node 24 ---------------------------------------------------------------
ensure_node() {
  if command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]')" = "24" ]; then
    log "node $(node -v) ok"; return
  fi
  # try a local install dir first (bootstrap-wsl.sh / bootstrap-linux.sh put it here)
  if [ -x "$HOME/.local/node24/bin/node" ]; then
    export PATH="$HOME/.local/node24/bin:$PATH"
    log "using node $(node -v) from ~/.local/node24"; return
  fi
  die "Node 24 not found. Run agora/scripts/fork/bootstrap.sh first."
}

main() {
  ensure_node
  [ -d "$WEBAPP" ] || die "webapp/ not found at $WEBAPP"
  cd "$WEBAPP"
  log "webapp: $WEBAPP   node: $(node -v)   heap: ${NODE_HEAP_MB}MB"

  # deps — lockfile-exact. Reinstall only if missing or lockfile newer than the marker.
  if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.agora-installed ]; then
    log "npm ci (lockfile-exact install)…"
    npm ci --no-audit --no-fund
    : > node_modules/.agora-installed
  else
    log "node_modules present and up to date — skipping install"
  fi

  # purge stale build caches that break incremental TS across machines
  log "purging stale tsconfig/rollup/parcel caches…"
  find . -path ./node_modules -prune -o -name 'tsconfig.tsbuildinfo' -exec rm -f {} + 2>/dev/null || true
  find . -path ./node_modules -prune -o -type d -name '.rollup.cache'  -exec rm -rf {} + 2>/dev/null || true
  find . -path ./node_modules -prune -o -type d -name '.parcel-cache'  -exec rm -rf {} + 2>/dev/null || true
  # NOTE: do NOT 'rm -rf channels/dist' — that dir is live-bind-mounted into the running
  # server; deleting the inode strands the mount (root.html 404 -> HTTP 500). webpack's
  # own `clean: true` wipes the contents in place, preserving the inode. Only clean the
  # platform dists (not mounted) and ensure channels/dist exists for first run.
  rm -rf platform/*/dist
  mkdir -p channels/dist

  # platform workspaces (order matters: types -> client -> shared -> components)
  log "building platform workspaces…"
  npm run build --workspace platform/types --workspace platform/client \
                --workspace platform/shared --workspace platform/components

  # the main channels bundle (webpack, the heavy one) — must run from channels/
  log "building channels webapp (webpack)…"
  ( cd channels && NODE_ENV=production NODE_OPTIONS="--max-old-space-size=${NODE_HEAP_MB}" \
      npx cross-env NODE_ENV=production webpack )

  [ -f channels/dist/root.html ] || die "build finished but channels/dist/root.html is missing"
  log "DONE — $(find channels/dist -type f | wc -l) files, $(du -sh channels/dist | cut -f1) at channels/dist"
}

main "$@"
