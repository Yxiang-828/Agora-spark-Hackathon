#!/usr/bin/env bash
# Agora fork — one-time environment bootstrap for Linux / WSL.
# Installs Node 24 into ~/.local/node24 (idempotent) without needing a system package
# manager. The tarball is fetched from nodejs.org; on a host whose WSL network is broken
# you can pre-place it (see AGORA_NODE_TARBALL) so no download is needed.
set -euo pipefail

NODE_VER="${AGORA_NODE_VER:-v24.10.0}"
PREFIX="$HOME/.local/node24"
ARCH="linux-x64"
TARBALL_NAME="node-${NODE_VER}-${ARCH}.tar.xz"

log() { printf '\033[36m[bootstrap]\033[0m %s\n' "$*"; }

if [ -x "$PREFIX/bin/node" ] && [ "$("$PREFIX/bin/node" -v)" = "$NODE_VER" ]; then
  log "node $NODE_VER already installed at $PREFIX"
else
  mkdir -p "$PREFIX"
  if [ -n "${AGORA_NODE_TARBALL:-}" ] && [ -f "$AGORA_NODE_TARBALL" ]; then
    log "using pre-placed tarball $AGORA_NODE_TARBALL"
    tar -xJf "$AGORA_NODE_TARBALL" -C "$PREFIX" --strip-components=1
  else
    log "downloading $TARBALL_NAME from nodejs.org…"
    tmp="$(mktemp -d)"
    curl -fSL --retry 3 -o "$tmp/$TARBALL_NAME" "https://nodejs.org/dist/${NODE_VER}/${TARBALL_NAME}"
    tar -xJf "$tmp/$TARBALL_NAME" -C "$PREFIX" --strip-components=1
    rm -rf "$tmp"
  fi
fi

# put node24 on PATH for future login shells (idempotent)
LINE='export PATH="$HOME/.local/node24/bin:$PATH"'
for rc in "$HOME/.bashrc" "$HOME/.profile"; do
  grep -qF "$LINE" "$rc" 2>/dev/null || echo "$LINE" >> "$rc"
done
export PATH="$PREFIX/bin:$PATH"
log "node $(node -v), npm $(npm -v) ready. (open a new shell or 'source ~/.bashrc')"
