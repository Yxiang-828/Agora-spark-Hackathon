#!/usr/bin/env python3
"""Agora — pair this machine to a room with a one-time code from the in-app
"Connect your AI" wizard, then launch the host that runs your agents.

    python pair.py <code> [room_url]      # room_url defaults to http://localhost:8065

The code is exchanged for ONE bot per agent (claude/codex/gemini — one person, many
bots). The per-agent configs are written to connector/agents.json and the host starts,
which brings each ready agent into the room.
"""
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
PLUGIN_ID = os.environ.get("AGORA_PLUGIN_ID", "com.aegis.agora")
SHARED_KEYS = ["AGORA_URL", "AGORA_WS", "AGORA_TEAM_ID", "AGORA_CHANNEL_ID"]


def main(argv):
    # Cross-OS: everything is a python ARG (no $env: / export differences, no .ps1/.sh).
    #   python pair.py <code> [room_url] [--agents claude,codex] [--workdir "claude=PATH"] ...
    pos = [a for a in argv if not a.startswith("--")]
    if not pos:
        print('usage: python pair.py <code> [room_url] [--agents claude,codex] [--workdir "claude=PATH"]')
        return 2
    code = pos[0]
    url = (pos[1] if len(pos) > 1 else os.environ.get("AGORA_URL", "http://localhost:8065")).rstrip("/")

    agents, workdirs, i = None, {}, 0
    while i < len(argv):
        if argv[i] == "--agents" and i + 1 < len(argv):
            agents = [a.strip() for a in argv[i + 1].split(",") if a.strip()]
            i += 2
        elif argv[i] == "--workdir" and i + 1 < len(argv):
            k, _, v = argv[i + 1].partition("=")
            if k and v:
                workdirs[k.strip().lower()] = v
            i += 2
        else:
            i += 1
    if agents is None and os.environ.get("AGORA_AGENTS"):  # env still works as a fallback
        agents = [a.strip() for a in os.environ["AGORA_AGENTS"].split(",") if a.strip()]

    body = {"code": code}
    if agents:
        body["agents"] = agents

    req = urllib.request.Request(
        url + f"/plugins/{PLUGIN_ID}/api/v1/pair/claim",
        data=json.dumps(body).encode(), method="POST")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as resp:
            cfg = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        print(f"pairing failed: HTTP {e.code} - {e.read().decode()[:200]}")
        print("(codes are single-use and expire after 10 min — generate a fresh one in the wizard.)")
        return 1
    except Exception as e:  # noqa: BLE001
        print(f"pairing failed: {e}")
        return 1

    out = {k: cfg.get(k, "") for k in SHARED_KEYS}
    out["agents"] = cfg.get("agents", [])
    # per-agent workspace: AGORA_WORKDIR_<AGENT> (e.g. AGORA_WORKDIR_CLAUDE=C:\my-project)
    # so each agent runs in ITS folder and picks up that folder's prompts/config.
    for a in out["agents"]:
        wd = workdirs.get(a["agent"].lower()) or os.environ.get("AGORA_WORKDIR_" + a["agent"].upper())
        if wd:
            a["workdir"] = wd
    with open(os.path.join(HERE, "agents.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    names = ", ".join(a["agent"] for a in out["agents"])
    print(f"paired -> {len(out['agents'])} agent bot(s): {names}. Starting host…")
    return subprocess.call([sys.executable, os.path.join(HERE, "host.py")])


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
