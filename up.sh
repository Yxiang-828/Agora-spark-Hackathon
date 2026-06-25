#!/usr/bin/env bash
# Agora — one-shot launcher (Linux / macOS / WSL). Run from the repo root:
#
#   ./up.sh                       # build + serve + plugin + provision + public link
#   AGORA_NOBUILD=1 ./up.sh       # skip the slow webapp build, just re-serve existing dist
#   AGORA_LOCAL=1 ./up.sh         # localhost only (no public tunnel)
#   AGORA_SKIP_PLUGIN=1 ./up.sh   # skip the plugin build/install (webapp only)
#
# First run on a fresh box: bash agora/scripts/fork/bootstrap.sh  (installs Node 24)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
F="$HERE/agora/scripts/fork"
[ "${AGORA_NOBUILD:-}" = "1" ] && echo "[up] AGORA_NOBUILD=1 — reusing existing webapp dist" \
                               || bash "$F/build.sh"       # compile our webapp -> channels/dist
bash "$F/serve.sh"       # bring up the version-matched server with our client
[ "${AGORA_SKIP_PLUGIN:-}" = "1" ] && echo "[up] AGORA_SKIP_PLUGIN=1 — leaving plugin as-is" \
                                   || bash "$F/plugin.sh"  # build + install com.aegis.agora (all the features)
bash "$F/provision.sh"   # admin + team + channels + brand
[ "${AGORA_LOCAL:-}" = "1" ] && echo "[up] AGORA_LOCAL=1 — skipping public tunnel" \
                             || bash "$F/tunnel.sh"        # public share link
