#!/usr/bin/env bash
# Copy the connector source into the plugin's assets so the room can SERVE it as a
# downloadable bundle (a teammate gets the connector from the app — no git clone).
# Run before `make dist`. The copy under plugin/assets/connector is generated (gitignored).
set -e
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/connector"
DST="$ROOT/plugin/assets/connector"
rm -rf "$DST"
mkdir -p "$DST"
# runtime files only — skip caches, local state, dev-only bits
for f in connector.py host.py pair.py ws_min.py skill_report.py skill_lint.py requirements.txt; do
  [ -f "$SRC/$f" ] && cp "$SRC/$f" "$DST/"
done
for d in skills laws; do
  [ -d "$SRC/$d" ] && cp -r "$SRC/$d" "$DST/" && rm -rf "$DST/$d/__pycache__"
done
echo "synced connector -> plugin/assets/connector ($(find "$DST" -type f | wc -l) files)"
