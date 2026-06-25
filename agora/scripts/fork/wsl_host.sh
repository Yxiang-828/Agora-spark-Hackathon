#!/usr/bin/env bash
# Runs INSIDE WSL on behalf of the Windows launcher (up.ps1).
# Syncs the Windows repo onto ext4, ensures Node 24, then builds + serves the fork.
#
# Inputs (env):
#   AGORA_SRC_MNT  /mnt/c/... path to the Windows repo (rsync source)
#   AGORA_PORT     host port (default 8066)
set -euo pipefail

SRC="${AGORA_SRC_MNT:?AGORA_SRC_MNT not set}"
DST="$HOME/agora-mm"
export AGORA_PORT="${AGORA_PORT:-8066}"
export PATH="$HOME/.local/node24/bin:$PATH"

log() { printf '\033[35m[wsl-host]\033[0m %s\n' "$*"; }

command -v rsync >/dev/null || { sudo apt-get update -qq && sudo apt-get install -y rsync; }
mkdir -p "$DST"

log "syncing source onto ext4 ($SRC -> $DST)…"
rsync -a --delete \
  --exclude 'node_modules/' --exclude 'dist/' --exclude '.git/' \
  --exclude '*.log' --exclude '.parcel-cache/' --exclude '.rollup.cache/' \
  --exclude 'tsconfig.tsbuildinfo' \
  "$SRC/" "$DST/"

cd "$DST"
# normalize our shell scripts to LF (a Windows checkout may carry CRLF)
find agora/scripts/fork -name '*.sh' -exec sed -i 's/\r$//' {} +

[ -x "$HOME/.local/node24/bin/node" ] || bash agora/scripts/fork/bootstrap.sh
bash agora/scripts/fork/up.sh
