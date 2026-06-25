#!/usr/bin/env bash
# Agora — one-shot launcher (Linux / macOS / WSL). Run from the repo root:
#
#   ./up.sh                       # build + serve + plugin + provision + public link
#   AGORA_LOCAL=1 ./up.sh         # same, but localhost only (dev iteration)
#   AGORA_SKIP_PLUGIN=1 ./up.sh   # skip the plugin build/install (webapp only)
#
# First run on a fresh box: bash agora/scripts/fork/bootstrap.sh  (installs Node 24)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
F="$HERE/agora/scripts/fork"
bash "$F/build.sh"       # compile our webapp -> channels/dist
bash "$F/serve.sh"       # bring up the version-matched server with our client
bash "$F/plugin.sh"      # build + install com.aegis.agora (all the features)
bash "$F/provision.sh"   # admin + team + channels + brand
bash "$F/tunnel.sh"      # public share link (skip with AGORA_LOCAL=1)
