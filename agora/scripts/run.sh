#!/usr/bin/env bash
# Agora — 1-shot run: connect your LOCAL AI to the room over the outbound WebSocket.
# All-OS (macOS/Linux). Windows users should use scripts/run.bat. Drives your local CLI on your subscription (not an API key).
#   AGORA_AGENT=claude scripts/run.sh   # or codex / echo (transport-only sanity check)
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AGENT="${AGORA_AGENT:-claude}"
PY="$(command -v python || command -v python3 || true)"
[ -n "$PY" ] || { echo "Python not found (need 'python' or 'python3')."; exit 1; }

if [ ! -f "$ROOT/connector/.env" ]; then
  echo "No connector/.env — run scripts/up.sh first (it provisions the bot + token)."
  exit 1
fi

# Load .env so AGORA_PLUGIN_ID etc. match what provision wrote (connector.py also reads the file).
set -a
# shellcheck disable=SC1091
source "$ROOT/connector/.env"
set +a

# no pip deps: the connector ships a stdlib-only WebSocket client (ws_min.py)
echo "Connecting agent='$AGENT' to the room (Ctrl-C to stop)..."
AGORA_AGENT="$AGENT" "$PY" "$ROOT/connector/connector.py"
