#!/usr/bin/env python3
"""Agora host — the local "sprout".

One process you run on your machine. It reads agents.json (written by pair.py: the
per-agent bots the room provisioned for you) and brings each agent into the room as its
OWN bot, after checking prerequisites. One person -> many bots.

    python pair.py <code> [room_url]     # provisions per-agent bots, writes agents.json
    python host.py                       # (pair.py runs this for you) supervises the agents

Prereq doctor: each agent's CLI must be installed and logged in. The host prints a clear
status per agent and skips ones that aren't ready (no cryptic failures).
"""
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CFG = os.path.join(HERE, "agents.json")
SHARED_KEYS = ("AGORA_URL", "AGORA_WS", "AGORA_TEAM_ID", "AGORA_CHANNEL_ID")
PLUGIN_ID = os.environ.get("AGORA_PLUGIN_ID", "com.aegis.agora")


def get_desires(url, token):
    """Poll the room for run/stop per bot (set from the GUI). None = couldn't reach."""
    try:
        r = urllib.request.Request(url + f"/plugins/{PLUGIN_ID}/api/v1/host/desires")
        r.add_header("Authorization", "Bearer " + token)
        with urllib.request.urlopen(r, timeout=10) as resp:
            return json.loads(resp.read().decode())
    except Exception:  # noqa: BLE001
        return None


def agent_workdir(a):
    """Where THIS agent runs — its own workspace, so it picks up that folder's CLAUDE.md /
    configs / prompts / MCP. Falls back to a clean per-agent dir if none was chosen."""
    return a.get("workdir") or os.path.join(os.path.expanduser("~"), ".agora", "work", a["agent"])


def build_env(a, shared):
    wd = agent_workdir(a)
    os.makedirs(wd, exist_ok=True)
    env = dict(os.environ, AGORA_AGENT=a["agent"],
               AGORA_BOT_TOKEN=a["bot_token"], AGORA_BOT_USER_ID=a["bot_user_id"],
               AGORA_BOT_USERNAME=a["bot_username"], AGORA_WORKDIR=wd, **shared)
    env.pop("AGORA_ENV", None)  # identity comes from env, not a file
    return env


def prereq(agent):
    """Return (ready, detail) — is this agent's CLI installed and usable?"""
    if agent == "echo":
        return True, "test stand-in (no real AI)"
    # antigravity's CLI binary is `agy`, not `antigravity`.
    binname = "agy" if agent == "antigravity" else agent
    exe = shutil.which(binname)
    if not exe:
        return False, f"`{binname}` not installed — install it and log in, then restart the host"
    if agent == "gemini":
        # DEPRECATED (rate-limit fragile) — kept as a fallback; prefer antigravity (agy).
        has_key = bool(os.environ.get("GEMINI_API_KEY"))
        settings = os.path.join(os.path.expanduser("~"), ".gemini", "settings.json")
        authed = has_key or os.path.exists(settings)
        if not authed:
            return False, "gemini has no auth — run `gemini` once to log in, or set GEMINI_API_KEY"
    if agent == "antigravity":
        # agy auths via the Antigravity/Google login; its data dir existing = it's been run once.
        ag_dir = os.path.join(os.path.expanduser("~"), ".gemini", "antigravity-cli")
        if not os.path.isdir(ag_dir):
            return False, "antigravity (agy) has no session — run `agy` once to log in"
    return True, "ready"


def main():
    if not os.path.exists(CFG):
        print("no agents.json — run `python pair.py <code> [room_url]` first.")
        return 2
    cfg = json.load(open(CFG, encoding="utf-8"))
    shared = {k: cfg.get(k, "") for k in SHARED_KEYS}
    agents = cfg.get("agents", [])
    if not agents:
        print("agents.json has no agents — re-pair.")
        return 2

    print(f"Agora host — {len(agents)} agent bot(s) provisioned.")
    ready = []
    for a in agents:
        ok, detail = prereq(a["agent"])
        if ok:
            ready.append(a)
        else:
            print(f"  [skip] {a['agent']:<7} {a['bot_username']}: {detail}")
    if not ready:
        print("No agents ready. Fix the prereqs above and restart.")
        return 1
    token = ready[0]["bot_token"]  # used to poll desired run/stop state
    conn = os.path.join(HERE, "connector.py")
    procs = {}  # agent -> Popen

    def start(a):
        procs[a["agent"]] = subprocess.Popen([sys.executable, conn], env=build_env(a, shared))
        print(f"  [run ] {a['agent']:<7} {a['bot_username']} in {agent_workdir(a)}")

    def stop(a):
        p = procs.pop(a["agent"], None)
        if p:
            p.terminate()
            print(f"  [stop] {a['agent']:<7} {a['bot_username']} (disconnected)")

    print(f"\nReconciling to the room's connect/disconnect state. Ctrl+C to stop all.")
    last = {}  # last-known desires — fail CLOSED: a 'stop' is remembered even if the room
    try:       # becomes unreachable, so a disconnected agent is never silently resurrected.
        while True:
            desires = get_desires(shared.get("AGORA_URL", ""), token)  # {botID: run|stop} or None
            if desires is not None:
                last = desires
            for a in ready:
                want = last.get(a["bot_user_id"], "run")
                alive = a["agent"] in procs and procs[a["agent"]].poll() is None
                if want == "run" and not alive:
                    start(a)  # initial start, GUI reconnect, or auto-restart after a crash
                elif want == "stop" and alive:
                    stop(a)  # GUI disconnect
            time.sleep(3)
    except KeyboardInterrupt:
        print("\nstopping all agents…")
        for p in procs.values():
            p.terminate()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
