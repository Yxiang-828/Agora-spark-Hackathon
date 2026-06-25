#!/usr/bin/env python3
"""Smoke test: post an @mention to the room as admin, verify the bot replies."""
import json
import os
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
E = {}
for line in open(os.path.join(HERE, ".env"), encoding="utf-8"):
    line = line.strip()
    if line and "=" in line and not line.startswith("#"):
        k, v = line.split("=", 1)
        E[k] = v
URL, CID, BOT = E["AGORA_URL"], E["AGORA_CHANNEL_ID"], E["AGORA_BOT_USER_ID"]
LOGIN = os.environ.get("ADMIN_LOGIN", "agoraadmin")
PW = os.environ.get("ADMIN_PW", "Agora!admin1")


def req(method, path, token=None, body=None, wh=False):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(URL + "/api/v4" + path, data=data, method=method)
    r.add_header("Content-Type", "application/json")
    if token:
        r.add_header("Authorization", "Bearer " + token)
    try:
        resp = urllib.request.urlopen(r)
        raw = resp.read().decode()
        out = json.loads(raw) if raw.strip() else {}
        return (out, dict(resp.headers)) if wh else out
    except urllib.error.HTTPError as e:
        body = {"_e": e.code, "_b": e.read().decode()}
        return (body, dict(e.headers)) if wh else body


_, h = req("POST", "/users/login", body={"login_id": LOGIN, "password": PW}, wh=True)
tok = h["Token"]
msg = os.environ.get("SMOKE_MSG", f"@agora-claude smoke {int(time.time())}")
root = req("POST", "/posts", tok, {"channel_id": CID, "message": msg})["id"]
print("posted:", msg, "(id", root + ")")
ans = None
for _ in range(40):
    time.sleep(1)
    posts = req("GET", f"/posts/{root}/thread", tok).get("posts", {})
    for po in posts.values():
        if po.get("user_id") == BOT and po.get("id") != root:
            ans = po.get("message")
    if ans and ans != "_…thinking…_":
        break
print("bot reply:", repr(ans))
print("RESULT:", "PASS" if (ans and ans != "_…thinking…_") else "FAIL")
