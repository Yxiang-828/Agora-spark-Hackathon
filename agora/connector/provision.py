#!/usr/bin/env python3
"""Provision the Agora dev room for the connector: bot account + access token +
team/channel membership. Idempotent-ish. Writes secrets to connector/.env
(gitignored); never prints the token. Talks to the local server's REST API.

Env overrides: AGORA_URL (admin API, usually localhost), AGORA_PUBLIC_URL (written
to connector/.env for members), ADMIN_LOGIN, ADMIN_PW, BOT_USERNAME, TEAM, CHANNEL.
"""
import json
import os
import urllib.error
import urllib.request
from urllib.parse import urlparse

API = os.environ.get("AGORA_URL", "http://localhost:8065").rstrip("/")
PUBLIC = os.environ.get(
    "AGORA_PUBLIC_URL", os.environ.get("AGORA_URL", "http://localhost:8065")
).rstrip("/")
BASE = API + "/api/v4"


def _ws_url(http_base: str) -> str:
    u = urlparse(http_base)
    scheme = "wss" if u.scheme == "https" else "ws"
    return f"{scheme}://{u.netloc}/api/v4/websocket"
ADMIN_LOGIN = os.environ.get("ADMIN_LOGIN", "agoraadmin")
ADMIN_PW = os.environ.get("ADMIN_PW", "Agora!admin1")
BOT_USERNAME = os.environ.get("BOT_USERNAME", "agora-claude")
TEAM = os.environ.get("TEAM", "agora")
CHANNEL = os.environ.get("CHANNEL", "lobby")
HERE = os.path.dirname(os.path.abspath(__file__))


def req(method, path, token=None, body=None, want_headers=False):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method)
    r.add_header("Content-Type", "application/json")
    if token:
        r.add_header("Authorization", "Bearer " + token)
    try:
        resp = urllib.request.urlopen(r)
        raw = resp.read().decode()
        out = json.loads(raw) if raw.strip() else {}
        return (out, dict(resp.headers)) if want_headers else out
    except urllib.error.HTTPError as e:
        out = {"_error": e.code, "_body": e.read().decode()}
        return (out, dict(e.headers)) if want_headers else out


def main():
    _, hdr = req("POST", "/users/login",
                 body={"login_id": ADMIN_LOGIN, "password": ADMIN_PW}, want_headers=True)
    admin = hdr.get("Token")
    if not admin:
        raise SystemExit("admin login failed")

    team = req("GET", f"/teams/name/{TEAM}", admin)
    team_id = team["id"]

    bot = req("POST", "/bots", admin,
              {"username": BOT_USERNAME, "display_name": "Agora · Claude"})
    if bot.get("_error"):
        bots = req("GET", "/bots?per_page=200", admin)
        bot = next((b for b in bots if b.get("username") == BOT_USERNAME), None)
        if not bot:
            raise SystemExit(f"could not create or find bot: {bot}")
    bot_user_id = bot["user_id"]

    tok = req("POST", f"/users/{bot_user_id}/tokens", admin, {"description": "connector"})
    if "token" not in tok:
        raise SystemExit(f"token creation failed: {tok}")
    bot_token = tok["token"]

    req("POST", f"/teams/{team_id}/members", admin, {"team_id": team_id, "user_id": bot_user_id})
    chan = req("GET", f"/teams/{team_id}/channels/name/{CHANNEL}", admin)
    chan_id = chan["id"]
    req("POST", f"/channels/{chan_id}/members", admin, {"user_id": bot_user_id})

    # The LOCAL house connector runs on the same machine as the room, so it dials the room over
    # the LOCAL api (localhost) — never the public tunnel. Routing the connector through the
    # tunnel makes every host relay a slow double-hop that Cloudflare times out (504). The public
    # URL is only for REMOTE connectors (the downloadable bundle), not this one.
    env = (
        f"AGORA_URL={API}\n"
        f"AGORA_WS={_ws_url(API)}\n"
        f"AGORA_PLUGIN_ID={os.environ.get('AGORA_PLUGIN_ID', 'com.aegis.agora')}\n"
        f"AGORA_BOT_TOKEN={bot_token}\n"
        f"AGORA_BOT_USER_ID={bot_user_id}\n"
        f"AGORA_BOT_USERNAME={BOT_USERNAME}\n"
        f"AGORA_TEAM_ID={team_id}\n"
        f"AGORA_CHANNEL_ID={chan_id}\n"
    )
    with open(os.path.join(HERE, ".env"), "w", encoding="utf-8") as f:
        f.write(env)
    print(f"provisioned: bot={BOT_USERNAME} user_id={bot_user_id} team={TEAM} "
          f"channel={CHANNEL} -> wrote .env (token len {len(bot_token)})")


if __name__ == "__main__":
    main()
