#!/usr/bin/env bash
# Agora fork — provision the room: admin + team + channel + brand config (idempotent).
# Mirrors agora_up.py provision_room for the fork stack. Safe to re-run.
set -uo pipefail

PROJECT="agora-fork"
C="${PROJECT}-mattermost-1"
ADMIN_USER="${ADMIN_LOGIN:-agoraadmin}"
ADMIN_PW="${ADMIN_PW:-Agora!admin1}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@agora.local}"
TEAM="${TEAM:-agora}"
CHANNEL="${CHANNEL:-lobby}"

log() { printf '\033[36m[provision]\033[0m %s\n' "$*"; }
ex()  { docker exec "$C" mmctl --local "$@"; }

docker ps --format '{{.Names}}' | grep -qx "$C" || { echo "[provision] server not running"; exit 1; }

# wait for local mode to answer
for i in $(seq 1 20); do ex system status >/dev/null 2>&1 && break; sleep 2; done

log "admin / team / channel (idempotent)…"
ex user create --email "$ADMIN_EMAIL" --username "$ADMIN_USER" --password "$ADMIN_PW" --system-admin >/dev/null 2>&1 \
  && log "created admin '$ADMIN_USER'" || log "admin '$ADMIN_USER' already present"
ex team create --name "$TEAM" --display-name "Agora" >/dev/null 2>&1 || true
ex channel create --team "$TEAM" --name "$CHANNEL" --display-name "Lobby" >/dev/null 2>&1 || true
ex team users add "$TEAM" "$ADMIN_USER" >/dev/null 2>&1 || true

# Default + feature channels so a non-dev sees the room laid out on first open (idempotent).
# Mirrors the plugin's `/agora setup`; created here too so they exist without a manual command.
log "default + feature channels…"
CHANNELS=(
  "welcome|Welcome|How to use Agora — start here."
  "features|Features|Where work happens: claim your area, open a thread, @your-agent."
  "code-review|Code Review|Discuss diffs and reviews."
  "voice-comms|🎙 Voice Comms|Spatial 3D voice room — humans on live mic, agents via Qwen."
  "orchestrator|🧭 Orchestrator|Work router: routes tasks across agents (does not lock edits)."
  "ci-cd|⚙️ CI/CD|The CI/CD Game Master agent's channel."
  "debug|🐛 Debug|The debug agent's channel."
  "audit|🔎 Audit|The audit agent's channel — cited findings."
)
for spec in "${CHANNELS[@]}"; do
  IFS='|' read -r cname cdisp cpurpose <<<"$spec"
  ex channel create --team "$TEAM" --name "$cname" --display-name "$cdisp" --purpose "$cpurpose" >/dev/null 2>&1 || true
done

log "brand config…"
ex config set TeamSettings.SiteName "Agora" >/dev/null 2>&1 || true
ex config set TeamSettings.EnableCustomBrand true >/dev/null 2>&1 || true
ex config set TeamSettings.CustomBrandText "Agora — your AI, in the room." >/dev/null 2>&1 || true
ex config set EmailSettings.RequireEmailVerification false >/dev/null 2>&1 || true

log "✔ room ready — login: $ADMIN_USER / $ADMIN_PW  (team: $TEAM)"
