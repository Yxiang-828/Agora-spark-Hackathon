#!/usr/bin/env python3
"""Agora connector (v0): bridges the Agora room <-> a local AI agent.

- holds ONE outbound WebSocket to the room (the "tunnel"), auth via bot token
- listens for posts; engages on @mention or DM (loop-guarded against itself)
- drives a LOCAL agent (echo | claude | codex) and replies in-thread
- one agent session per thread (native context retention)

Cross-OS: stdlib + `websockets`. Run on Windows/macOS/Linux.
Config from connector/.env (see provision.py).
Agent via AGORA_AGENT=claude|codex|gemini|echo (echo = test stand-in, no real AI).
"""
import asyncio
import json
import os
import re
import shlex
import shutil
import subprocess
import time
import urllib.request
import uuid

import voice  # local: Qwen3-TTS synthesis for the AI call

HERE = os.path.dirname(os.path.abspath(__file__))


def load_env():
    # AGORA_ENV lets the host point each per-agent connector at its own config file.
    path = os.environ.get("AGORA_ENV", os.path.join(HERE, ".env"))
    env = {}
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    env[k] = v
    return env


E = load_env()


def _cfg(k):
    # env var wins over the file, so the host can launch a per-agent bot purely via env.
    return os.environ.get(k) or E.get(k, "")


URL = _cfg("AGORA_URL")
WS = _cfg("AGORA_WS")
TOKEN = _cfg("AGORA_BOT_TOKEN")
BOT_ID = _cfg("AGORA_BOT_USER_ID")
BOT_USER = _cfg("AGORA_BOT_USERNAME")
PLUGIN_ID = _cfg("AGORA_PLUGIN_ID") or "com.aegis.agora"
os.environ.setdefault("AGORA_PLUGIN_ID", PLUGIN_ID)
AGENT = os.environ.get("AGORA_AGENT", "echo")
# run the agent OUTSIDE the repo so Claude Code doesn't inherit workspace CLAUDE.md
WORKDIR = os.environ.get("AGORA_WORKDIR", os.path.join(os.path.expanduser("~"), ".agora", "work"))
os.makedirs(WORKDIR, exist_ok=True)
SESSIONS = {}  # thread_key -> agent session id (per-thread context retention)


def api(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(URL + "/api/v4" + path, data=data, method=method)
    r.add_header("Content-Type", "application/json")
    r.add_header("Authorization", "Bearer " + TOKEN)
    with urllib.request.urlopen(r) as resp:
        raw = resp.read().decode()
        return json.loads(raw) if raw.strip() else {}


def plugin_post(path, body):
    """POST to the plugin's API (the room), e.g. submitting a proposal to the Gate."""
    data = json.dumps(body).encode()
    r = urllib.request.Request(URL + f"/plugins/{PLUGIN_ID}/api/v1" + path, data=data, method="POST")
    r.add_header("Content-Type", "application/json")
    r.add_header("Authorization", "Bearer " + TOKEN)
    with urllib.request.urlopen(r) as resp:
        raw = resp.read().decode()
        return json.loads(raw) if raw.strip() else {}


def plugin_get(path):
    """GET from the plugin's API (the room), e.g. reading engagement controls."""
    r = urllib.request.Request(URL + f"/plugins/{PLUGIN_ID}/api/v1" + path, method="GET")
    r.add_header("Authorization", "Bearer " + TOKEN)
    with urllib.request.urlopen(r) as resp:
        raw = resp.read().decode()
        return json.loads(raw) if raw.strip() else {}


def upload_file(channel_id, file_path, filename=None):
    """Upload a local file to the room via the core Files API; return its file id (or None).
    Pure-stdlib multipart so the connector keeps zero third-party deps."""
    filename = filename or os.path.basename(file_path)
    try:
        with open(file_path, "rb") as f:
            payload = f.read()
    except OSError:
        return None
    boundary = "----agora" + uuid.uuid4().hex
    body = b"".join([
        f"--{boundary}\r\n".encode(),
        f'Content-Disposition: form-data; name="channel_id"\r\n\r\n{channel_id}\r\n'.encode(),
        f"--{boundary}\r\n".encode(),
        f'Content-Disposition: form-data; name="files"; filename="{filename}"\r\n'.encode(),
        b"Content-Type: audio/wav\r\n\r\n", payload, b"\r\n",
        f"--{boundary}--\r\n".encode(),
    ])
    r = urllib.request.Request(URL + "/api/v4/files", data=body, method="POST")
    r.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
    r.add_header("Authorization", "Bearer " + TOKEN)
    try:
        with urllib.request.urlopen(r) as resp:
            info = json.loads(resp.read().decode())
        infos = info.get("file_infos") or []
        return infos[0]["id"] if infos else None
    except Exception as e:  # noqa: BLE001
        print(f"[voice] file upload failed: {e}", flush=True)
        return None


_SPEAK_STRIP = re.compile(r"```[\s\S]*?```|`[^`]*`|!\[[^\]]*\]\([^)]*\)|https?://\S+")


def speak_reply(channel_id, text):
    """Synthesize an agent reply to audio and upload it; return a file id or None.
    Best-effort: never raises, never blocks chat delivery."""
    try:
        if not voice.VOICE_ENABLED or not voice.engine_ok():
            return None
        clean = _SPEAK_STRIP.sub(" ", text or "")
        clean = re.sub(r"[*_>#~|]", " ", clean)
        clean = re.sub(r"\s+", " ", clean).strip()
        if not clean:
            return None
        wav = voice.synth(clean)
        if not wav:
            return None
        fid = upload_file(channel_id, wav, "agent_voice.wav")
        try:
            os.remove(wav)
        except OSError:
            pass
        return fid
    except Exception as e:  # noqa: BLE001
        print(f"[voice] speak_reply error: {e}", flush=True)
        return None


def plugin_put(path, body):
    """PUT to the plugin's API (the room), e.g. writing a codespace file."""
    data = json.dumps(body).encode()
    r = urllib.request.Request(URL + f"/plugins/{PLUGIN_ID}/api/v1" + path, data=data, method="PUT")
    r.add_header("Content-Type", "application/json")
    r.add_header("Authorization", "Bearer " + TOKEN)
    with urllib.request.urlopen(r) as resp:
        raw = resp.read().decode()
        return json.loads(raw) if raw.strip() else {}


def target_codespace(channel_id):
    """Where THIS agent writes code. Consolidated, project-bound model: the agent targets a
    codespace by id (its project/task), not by "whichever channel it's in". We resolve the
    agent-level binding first (/agent/codespace, authed as this bot); only if unset do we fall
    back to the legacy per-channel binding for back-compat."""
    try:
        csid = plugin_get("/agent/codespace").get("codespace_id") or ""
        if csid:
            return csid
    except Exception:  # noqa: BLE001
        pass
    try:
        return plugin_get(f"/workspace?channel={channel_id}").get("codespace_id") or ""
    except Exception:  # noqa: BLE001
        return ""


_LANG_EXT = {"go": "go", "python": "py", "py": "py", "javascript": "js", "js": "js",
             "typescript": "ts", "ts": "ts", "tsx": "tsx", "json": "json", "bash": "sh",
             "sh": "sh", "yaml": "yml", "html": "html", "css": "css", "rust": "rs", "java": "java"}


def extract_code_blocks(text):
    """Pull fenced code blocks from an agent answer. Returns [(path, code)]. A block's
    path comes from its info string (```go path=src/main.go  or  ```src/main.go);
    otherwise a default snippet-N.<ext> is used."""
    out = []
    for i, m in enumerate(re.finditer(r"```([^\n`]*)\n(.*?)```", text, re.DOTALL)):
        info, code = m.group(1).strip(), m.group(2)
        path = None
        pm = re.search(r"(?:path=|file=)?([\w./\-]+\.\w+)", info)
        if pm:
            path = pm.group(1)
        if not path:
            lang = (info.split() or [""])[0].lower()
            path = f"snippet-{i + 1}.{_LANG_EXT.get(lang, 'txt')}"
        out.append((path, code))
    return out


def write_codeblocks_to_codespace(csid, text):
    """Write each code block in `text` into the bound codespace.
    Returns (written_paths, failures) where failures is [(path, why)]."""
    written, failed = [], []
    for path, code in extract_code_blocks(text):
        try:
            plugin_put(f"/codespaces/{csid}/file", {"path": path, "content": code})
            written.append(path)
        except Exception as e:  # noqa: BLE001
            failed.append((path, str(e)[:100]))
    return written, failed


# --- Codespace: serve a real folder/git repo on THIS machine to the room ---
# The room relays browser requests here over the WebSocket; we run real fs/git ops,
# jailed to the codespace root, and POST the result back. This is how "local folder",
# "clone a git repo", and (later) "ssh to another box" all become one mechanism.

CS_BASE = os.path.realpath(os.environ.get("AGORA_CS_BASE", os.path.join(WORKDIR, "codespaces")))
_CS_IGNORE = {".git", "node_modules", ".venv", "__pycache__", "dist", ".next"}


def _cs_safe(root, rel):
    """Resolve root/rel and refuse anything escaping root (no '..' traversal)."""
    root = os.path.realpath(root)
    full = os.path.realpath(os.path.join(root, rel or ""))
    if full != root and not full.startswith(root + os.sep):
        raise ValueError("path escapes codespace root")
    return full


def _git(root, *args, timeout=60):
    r = subprocess.run(["git", *args], cwd=root, capture_output=True, text=True, timeout=timeout)
    return r.returncode, r.stdout, r.stderr


def _rsh(ssh, cwd, argv, timeout=60, stdin=None):
    """Run argv locally (cwd) OR over ssh ('cd cwd && argv') when ssh=user@host."""
    if ssh:
        inner = ("cd " + shlex.quote(cwd) + " && " if cwd else "") + " ".join(shlex.quote(a) for a in argv)
        cmd = ["ssh", "-o", "BatchMode=yes", ssh, inner]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, input=stdin)
    else:
        r = subprocess.run(argv, cwd=cwd, capture_output=True, text=True, timeout=timeout, input=stdin)
    return r.returncode, r.stdout, r.stderr


def _rel_ok(path):
    return bool(path) and ".." not in path.split("/") and not path.startswith("/")


def codespace_op(op, args):
    """Run one filesystem/git op for a codespace, locally or over SSH. JSON-able dict."""
    root = args.get("root", "")
    ssh = args.get("ssh", "")
    if op == "tree":  # real file list (tracked + untracked, respecting .gitignore)
        code, out, _ = _rsh(ssh, root, ["git", "ls-files", "--cached", "--others", "--exclude-standard"])
        if code == 0:
            return {"files": [l for l in out.splitlines() if l.strip()], "is_git": True}
        if ssh:
            _, out, _ = _rsh(ssh, root, ["bash", "-lc", "find . -type f -not -path '*/.git/*' | sed 's|^\\./||'"])
            return {"files": [l for l in out.splitlines() if l.strip()], "is_git": False}
        files = []
        for dp, dn, fn in os.walk(root):
            dn[:] = [d for d in dn if d not in _CS_IGNORE]
            for f in fn:
                files.append(os.path.relpath(os.path.join(dp, f), root).replace("\\", "/"))
        return {"files": sorted(files), "is_git": False}
    if op == "read":
        if ssh:
            if not _rel_ok(args["path"]):
                raise ValueError("path escapes codespace root")
            code, out, err = _rsh(ssh, None, ["cat", root.rstrip("/") + "/" + args["path"]])
            if code != 0:
                raise ValueError(err[:120] or "read failed")
            return {"content": out}
        with open(_cs_safe(root, args["path"]), "r", encoding="utf-8", errors="replace") as fh:
            return {"content": fh.read()}
    if op == "write":
        if ssh:
            if not _rel_ok(args["path"]):
                raise ValueError("path escapes codespace root")
            full = root.rstrip("/") + "/" + args["path"]
            _rsh(ssh, None, ["mkdir", "-p", full.rsplit("/", 1)[0]])
            code, _, err = _rsh(ssh, None, ["tee", full], stdin=args.get("content", ""))
            if code != 0:
                raise ValueError(err[:120] or "write failed")
            return {"ok": True}
        full = _cs_safe(root, args["path"])
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w", encoding="utf-8") as fh:
            fh.write(args.get("content", ""))
        return {"ok": True}
    if op == "mkdir":  # create a folder (directory tree CRUD)
        if ssh:
            if not _rel_ok(args["path"]):
                raise ValueError("path escapes codespace root")
            code, _, err = _rsh(ssh, None, ["mkdir", "-p", root.rstrip("/") + "/" + args["path"]])
            if code != 0:
                raise ValueError(err[:120] or "mkdir failed")
            return {"ok": True}
        os.makedirs(_cs_safe(root, args["path"]), exist_ok=True)
        return {"ok": True}
    if op == "delete":  # delete a single file
        if ssh:
            if not _rel_ok(args["path"]):
                raise ValueError("path escapes codespace root")
            code, _, err = _rsh(ssh, None, ["rm", "-f", root.rstrip("/") + "/" + args["path"]])
            if code != 0:
                raise ValueError(err[:120] or "delete failed")
            return {"ok": True}
        full = _cs_safe(root, args["path"])
        if os.path.isfile(full):
            os.remove(full)
        return {"ok": True}
    if op == "rmdir":  # delete a folder and its contents
        if ssh:
            if not _rel_ok(args["path"]):
                raise ValueError("path escapes codespace root")
            code, _, err = _rsh(ssh, None, ["rm", "-rf", root.rstrip("/") + "/" + args["path"]])
            if code != 0:
                raise ValueError(err[:120] or "rmdir failed")
            return {"ok": True}
        full = _cs_safe(root, args["path"])
        if full == os.path.realpath(root):
            raise ValueError("refusing to delete the codespace root")
        if os.path.isdir(full):
            shutil.rmtree(full)
        return {"ok": True}
    if op == "rename":  # move/rename a file or folder within the codespace
        src_rel, dst_rel = args.get("path", ""), args.get("to", "")
        if ssh:
            if not (_rel_ok(src_rel) and _rel_ok(dst_rel)):
                raise ValueError("path escapes codespace root")
            base = root.rstrip("/")
            code, _, err = _rsh(ssh, None, ["bash", "-lc",
                f"mkdir -p {shlex.quote(os.path.dirname(base + '/' + dst_rel))} && mv {shlex.quote(base + '/' + src_rel)} {shlex.quote(base + '/' + dst_rel)}"])
            if code != 0:
                raise ValueError(err[:120] or "rename failed")
            return {"ok": True}
        src, dst = _cs_safe(root, src_rel), _cs_safe(root, dst_rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        os.replace(src, dst)
        return {"ok": True}
    if op == "status":
        code, out, err = _rsh(ssh, root, ["git", "status", "--porcelain=v1", "-b"])
        return {"status": out, "err": (err if code else "")}
    if op == "diff":  # working changes not yet committed (for review-before-commit)
        code, out, _ = _rsh(ssh, root, ["git", "diff", "HEAD"])
        if code != 0:  # no HEAD yet (no commits) — show the working/index diff instead
            _, out, _ = _rsh(ssh, root, ["git", "diff"])
        return {"diff": out}
    if op == "blame":  # per-line last-committed author (git blame), for the blame overlay
        path = args.get("path", "")
        if not (_rel_ok(path) if ssh else True):
            raise ValueError("path escapes codespace root")
        if not ssh:
            _cs_safe(root, path)  # jail check
        code, out, _ = _rsh(ssh, root, ["git", "blame", "--line-porcelain", "--", path])
        authors, cur = [], None
        if code == 0:
            for line in out.splitlines():
                if line.startswith("author "):
                    cur = line[len("author "):]
                elif line.startswith("\t"):
                    authors.append(cur or "")
                    cur = None
        return {"authors": authors}  # authors[i] = who last committed line i+1 ([] if uncommitted)
    if op == "commit":
        if args.get("paths"):
            for p in args["paths"]:
                _rsh(ssh, root, ["git", "add", "--", p])
        else:
            _rsh(ssh, root, ["git", "add", "-A"])
        code, out, err = _rsh(ssh, root, ["git", "commit", "-m", args.get("message", "update from Agora")])
        return {"ok": code == 0, "out": out + err}
    if op == "push":
        code, out, err = _rsh(ssh, root, ["git", "push"], timeout=180)
        return {"ok": code == 0, "out": out + err}
    if op == "clone":
        url, name = args["repo_url"], (args.get("name") or "repo")
        if ssh:
            base = "~/agora-codespaces"
            dest = base + "/" + name
            code, out, err = _rsh(ssh, None, ["bash", "-lc", f"mkdir -p {base} && git clone {shlex.quote(url)} {shlex.quote(dest)}"], timeout=600)
            return {"ok": code == 0, "root": dest, "out": out + err}
        os.makedirs(CS_BASE, exist_ok=True)
        dest = _cs_safe(CS_BASE, name)
        code, out, err = _git(CS_BASE, "clone", url, dest, timeout=600)
        return {"ok": code == 0, "root": dest, "out": out + err}
    if op == "term_run":  # codespace terminal: run one command in the member's session (jailed to root)
        if ssh:
            return {"error": "terminal is not yet supported on ssh codespaces"}
        cwd_rel = (args.get("cwd") or "").strip()
        command = args.get("command", "")
        try:
            cwd_full = _cs_safe(root, cwd_rel)
        except ValueError:
            cwd_full, cwd_rel = os.path.realpath(root), ""
        if not os.path.isdir(cwd_full):
            cwd_full, cwd_rel = os.path.realpath(root), ""
        stripped = command.strip()
        # `cd` is handled here (no shell) so the session cwd stays jailed to the codespace root.
        if stripped == "cd" or stripped.startswith(("cd ", "cd\t")):
            target = stripped[2:].strip().strip('"').strip("'") or "."
            joined = target if os.path.isabs(target) else os.path.join(cwd_rel, target)
            try:
                new_full = _cs_safe(root, joined)
            except ValueError:
                return {"out": "cd: refusing to leave the codespace root", "exit": 1, "cwd": cwd_rel}
            if not os.path.isdir(new_full):
                return {"out": f"cd: no such directory: {target}", "exit": 1, "cwd": cwd_rel}
            new_rel = os.path.relpath(new_full, os.path.realpath(root)).replace("\\", "/")
            return {"out": "", "exit": 0, "cwd": ("" if new_rel == "." else new_rel)}
        if not stripped:
            return {"out": "", "exit": 0, "cwd": cwd_rel}
        try:
            r = subprocess.run(command, cwd=cwd_full, shell=True, capture_output=True, text=True, timeout=int(args.get("timeout", 80)))
            return {"out": ((r.stdout or "") + (r.stderr or ""))[:200000], "exit": r.returncode, "cwd": cwd_rel}
        except subprocess.TimeoutExpired:
            return {"out": "(command timed out)", "exit": 124, "cwd": cwd_rel}
        except Exception as e:  # noqa: BLE001
            return {"out": f"(failed to run: {str(e)[:200]})", "exit": 1, "cwd": cwd_rel}
    if op == "term_ai":  # run THIS host's AI agent inside the codespace dir, return its reply
        if ssh:
            return {"error": "AI terminal is not supported on ssh codespaces"}
        cwd_rel = (args.get("cwd") or "").strip()
        prompt = (args.get("prompt") or "").strip()
        if not prompt:
            return {"out": "(no prompt)", "exit": 1, "cwd": cwd_rel}
        try:
            cwd_full = _cs_safe(root, cwd_rel)
        except ValueError:
            cwd_full = os.path.realpath(root)
        if not os.path.isdir(cwd_full):
            cwd_full = os.path.realpath(root)
        try:
            ans = run_agent("term:" + os.path.realpath(root), prompt, cwd=cwd_full)
            return {"out": ans, "exit": 0, "cwd": cwd_rel, "agent": AGENT}
        except Exception as e:  # noqa: BLE001
            return {"out": f"(ai error: {str(e)[:300]})", "exit": 1, "cwd": cwd_rel}
    return {"error": f"unknown op: {op}"}


def handle_codespace_req(data):
    req_id = data.get("req_id")
    try:
        result = codespace_op(data.get("op", ""), data.get("args") or {})
    except Exception as e:  # noqa: BLE001
        result = {"error": str(e)[:200]}
    try:
        plugin_post("/codespace/op/response", {"req_id": req_id, "result": result})
    except Exception:  # noqa: BLE001
        pass


def muted_here(channel_id, user_id, is_mention):
    """Engagement control. channel-off silences everything; a personal mute silences
    only NON-@mention engagement (an explicit @mention still reaches the agent — UX-MAP).
    Fail CLOSED: if the control check errors, stay silent rather than risk answering in
    a channel that may have opted out."""
    try:
        eng = plugin_get(f"/engagement?channel={channel_id}&user={user_id}")
    except Exception as e:  # noqa: BLE001
        print(f"[connector] engagement check failed; staying silent (fail-closed): {e}", flush=True)
        return True
    if eng.get("channel_ai") == "off":
        return True
    if eng.get("muted") and not is_mention:
        return True
    return False


def propose_from_thread(channel_id, root):
    """Distil the thread into a proposed Dictionary entry and submit it to the Gate
    (pending human approval). Triggered by '@agent wrap'."""
    thread = api("GET", f"/posts/{root}/thread")
    posts = thread.get("posts", {})
    ordered = sorted(posts.values(), key=lambda p: p.get("create_at", 0))
    convo = "\n".join(f"{p.get('user_id', '?')[:6]}: {p.get('message', '')}" for p in ordered if p.get("message"))
    distill = (
        "Distil this support/ops thread into ONE reusable knowledge entry. "
        'Reply with ONLY a JSON object: {"issue": "...", "root_cause": "...", "fix": "..."}.\n\n'
        + convo
    )
    raw = run_agent(root, distill)
    issue, root_cause, fix = "", "", ""
    try:
        start, end = raw.find("{"), raw.rfind("}")
        obj = json.loads(raw[start:end + 1]) if start >= 0 else {}
        issue, root_cause, fix = obj.get("issue", ""), obj.get("root_cause", ""), obj.get("fix", "")
    except (json.JSONDecodeError, ValueError):
        pass
    if not issue:  # fallback so a weak/echo agent still yields something reviewable
        issue = (convo.splitlines() or ["(thread)"])[0][:140]
    if not fix:
        fix = raw.strip()[:500]
    res = plugin_post("/proposals", {"agent_id": BOT_ID, "agent_name": BOT_USER,
                                     "thread_id": root, "channel_id": channel_id,
                                     "issue": issue, "root_cause": root_cause, "fix": fix})
    summary = f"**Issue:** {issue}\n**Root cause:** {root_cause or '—'}\n**Fix:** {fix}\n\n_Pending approval (id {res.get('id', '?')[:8]})._"
    action = {"case_id": root, "agent_id": BOT_ID, "title": "Proposed a Dictionary entry",
              "status": "done", "summary": summary, "subactions": []}
    api("POST", "/posts", {"channel_id": channel_id, "message": "(proposal)", "root_id": root,
                           "type": "custom_agora_action", "props": {"agora_action": action}})


def report_skills():
    """Gate the local skills/ folder via skill_law and POST the verdicts to the room
    plugin (it stores + renders them in the Skills panel). Graceful if plugin absent."""
    try:
        import skill_report
        skills_dir = os.path.join(HERE, "skills")
        payload = skill_report.build_payload(skills_dir, BOT_ID, BOT_USER)
        ok, detail = skill_report.post_skills(URL, TOKEN, payload)
        print(f"[connector] {skill_report.summarize(payload)} -> posted={ok} ({detail})", flush=True)
    except Exception as e:  # noqa: BLE001
        print(f"[connector] skill report skipped: {e}", flush=True)


def run_agent(thread_key, prompt, cwd=None):
    # cwd lets the terminal run the AI INSIDE the codespace (so it can see/edit the shared files);
    # normal chat answers default to the agent's private WORKDIR.
    cwd = cwd or WORKDIR
    if AGENT == "echo":
        return f"(echo) {prompt}"
    if AGENT == "claude":
        exe = shutil.which("claude") or "claude"
        cmd = [exe, "-p", prompt, "--output-format", "json"]
        if SESSIONS.get(thread_key):
            cmd += ["--resume", SESSIONS[thread_key]]
        res = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True,
                             timeout=240, shell=(os.name == "nt" and not os.path.isabs(exe)))
        try:
            out = json.loads(res.stdout)
        except json.JSONDecodeError:
            return f"[claude error] {(res.stderr or res.stdout)[:600]}"
        if out.get("session_id"):
            SESSIONS[thread_key] = out["session_id"]
        return out.get("result", "(no result)")
    if AGENT == "codex":
        exe = shutil.which("codex") or "codex"
        # --skip-git-repo-check: the workdir may not be a git repo (codex otherwise refuses).
        # input="" closes stdin so codex doesn't hang on "Reading additional input from stdin".
        cmd = [exe, "exec", "--json", "--skip-git-repo-check", prompt]
        res = subprocess.run(cmd, cwd=cwd, input="", capture_output=True, text=True,
                             timeout=240, shell=(os.name == "nt" and not os.path.isabs(exe)))
        # The answer is the agent_message in an item.completed event (the last stdout line is
        # Windows taskkill noise, not JSON).
        msg = ""
        for line in res.stdout.splitlines():
            line = line.strip()
            if not line.startswith("{"):
                continue
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                continue
            it = ev.get("item") or {}
            if ev.get("type") == "item.completed" and it.get("type") == "agent_message":
                msg = it.get("text", msg)
        if msg:
            return msg
        return f"[codex error] {(res.stderr or res.stdout or 'no output')[:400]}"
    if AGENT == "gemini":
        # Gemini CLI has no usable -p: aiko-core pipes the prompt over STDIN to
        # `gemini --approval-mode yolo --sandbox false`, with CI=true so it runs
        # non-interactively, then strips the banner noise. Auth is the host's job
        # (run `gemini` once to log in, or set GEMINI_API_KEY).
        exe = shutil.which("gemini") or "gemini"
        cmd = [exe, "--approval-mode", "yolo", "--sandbox", "false"]
        model = os.environ.get("AGORA_GEMINI_MODEL")
        if model:
            cmd += ["-m", model]
        env = dict(os.environ, CI="true", NPM_CONFIG_YES="true")
        res = subprocess.run(cmd, cwd=cwd, input=prompt, capture_output=True, text=True,
                             timeout=240, env=env, shell=(os.name == "nt" and not os.path.isabs(exe)))
        noise = ("YOLO mode is enabled", "Approval mode overridden", "Flushing log",
                 "ClearcutLogg", "conpty_console", "AttachConsole", "Loaded cached", "Data collection")
        lines = [l for l in res.stdout.splitlines() if l.strip() and not any(n in l for n in noise)]
        ans = "\n".join(lines).strip()
        if ans:
            return ans
        err = (res.stderr or "no output").strip()
        if "Auth method" in err or "GEMINI_API_KEY" in err:
            return "[gemini not authenticated] run `gemini` once on the host to log in, or set GEMINI_API_KEY."
        return f"[gemini error] {err[:400]}"
    if AGENT in ("antigravity", "agy"):
        # Antigravity CLI ('agy') renders only to the console/ConPTY (uncapturable via pipes)
        # and persists answers to a protobuf DB. So we have agy WRITE its answer to a file via
        # its own file tool (it's agentic), then read that file. No stdout, no IDE/language-server,
        # no second agent — agy is the room's agent directly. (verified 2026-06-21)
        exe = shutil.which("agy") or "agy"
        ans_path = os.path.join(WORKDIR, f"agy_answer_{os.urandom(4).hex()}.txt")
        try:
            os.remove(ans_path)
        except OSError:
            pass
        ans_uri = ans_path.replace(os.sep, "/")
        wrapped = (prompt + "\n\n[Agora: when finished, use your file-writing tool to write ONLY "
                   f"your final answer as plain text (no commentary) to this exact path: {ans_uri}]")
        cmd = [exe, "--dangerously-skip-permissions", "-p", wrapped]
        model = os.environ.get("AGORA_AGY_MODEL")
        if model:
            cmd += ["--model", model]
        res = subprocess.run(cmd, cwd=cwd, input="", capture_output=True, text=True,
                             timeout=300, shell=(os.name == "nt" and not os.path.isabs(exe)))
        if os.path.exists(ans_path):
            try:
                with open(ans_path, encoding="utf-8", errors="replace") as fh:
                    ans = fh.read().strip()
            finally:
                try:
                    os.remove(ans_path)
                except OSError:
                    pass
            if ans:
                return ans
        out = (res.stdout or "").strip()  # fallback if a future agy build prints to stdout
        if out:
            return out
        err = (res.stderr or "no output").strip()
        if "auth" in err.lower() or "login" in err.lower():
            return "[antigravity not authenticated] run `agy` once on the host to log in."
        return f"[antigravity error] no answer file written (rc={res.returncode}); {err[:300]}"
    return "(no agent configured)"


def handle_post(post, channel_type):
    if post.get("user_id") == BOT_ID:
        return  # loop guard: never answer ourselves
    text = post.get("message", "")
    if not (("@" + BOT_USER) in text or channel_type == "D"):
        return  # engage only on @mention or DM
    channel_id = post["channel_id"]
    root = post.get("root_id") or post["id"]
    prompt = text.replace("@" + BOT_USER, "").strip()

    # Engagement control: respect channel-off / per-user mute before doing anything.
    is_mention = ("@" + BOT_USER) in text
    if muted_here(channel_id, post.get("user_id", ""), is_mention):
        return

    # "wrap" → distil the thread into a Dictionary proposal (the Gate), not a normal answer.
    if prompt.lower().startswith("wrap"):
        try:
            propose_from_thread(channel_id, root)
        except Exception as e:  # noqa: BLE001
            api("POST", "/posts", {"channel_id": channel_id, "root_id": root, "message": f"[wrap error] {e}"})
        return

    # If this channel is bound to a codespace, ask the agent to tag code with file paths
    # so we can write its output into the shared codespace (observe the AI's code in the editor).
    csid = target_codespace(channel_id)
    run_prompt = prompt
    if csid:
        run_prompt = (prompt + "\n\n[Agora: if you write code, put each file in its own fenced "
                      "block tagged with a path, e.g. ```go path=src/main.go]")

    # Emit a rich Action post (custom_agora_action): main action + sub-actions, streamed via PATCH.
    action = {"case_id": root, "agent_id": BOT_ID, "title": "Answering", "status": "running",
              "summary": "", "subactions": [{"id": "run", "label": f"run {AGENT}", "tool": AGENT, "status": "running"}]}
    reply = api("POST", "/posts", {"channel_id": channel_id, "message": "_…working…_", "root_id": root,
                                   "type": "custom_agora_action", "props": {"agora_action": action}})
    t0 = time.time()
    try:
        ans = run_agent(root, run_prompt)
        status = "done"
    except Exception as e:  # noqa: BLE001
        ans, status = f"[error] {e}", "error"
    dur = int((time.time() - t0) * 1000)
    subs = [{"id": "run", "label": f"ran {AGENT}", "tool": AGENT, "status": status, "duration_ms": dur}]
    summary = ans or "(empty)"
    if csid and status == "done":
        written, failed = write_codeblocks_to_codespace(csid, ans)
        if written:
            subs.append({"id": "cs", "label": f"wrote {len(written)} file(s) to codespace", "tool": "codespace", "status": "done"})
            summary += "\n\n_Saved to codespace: " + ", ".join(f"`{p}`" for p in written) + "_"
        if failed:
            subs.append({"id": "cs_err", "label": f"{len(failed)} codespace write(s) failed", "tool": "codespace", "status": "error"})
            summary += "\n\n_Codespace write failed: " + ", ".join(f"`{p}` ({why})" for p, why in failed) + "_"
    action["status"] = status
    action["summary"] = summary
    action["subactions"] = subs
    patch = {"message": summary, "props": {"agora_action": action}}
    # Speak the reply for anyone on a call with this agent: synth → upload → attach audio.
    # Best-effort and non-blocking on failure; the call falls back to reading the text aloud.
    if status == "done":
        audio_id = speak_reply(channel_id, ans)
        if audio_id:
            patch["file_ids"] = [audio_id]
            # Announce into the channel's 3D voice room so this agent's badged avatar speaks
            # the same Qwen clip, spatialized. Best-effort; the chat reply is already delivered.
            try:
                plugin_post("/room/agent-speak", {"channel": channel_id, "bot_user_id": BOT_ID,
                                                  "audio_url": f"/api/v4/files/{audio_id}", "text": ans})
            except Exception:  # noqa: BLE001
                pass
    api("PUT", f"/posts/{reply['id']}/patch", patch)


async def heartbeat_loop():
    """Ping the room ~every 20s so the dashboard knows this bot is actually online
    (more reliable than Mattermost's bot presence).

    The heartbeat is what flips the dashboard to ONLINE — a silently-failing one is exactly
    why a connected bot shows offline. So log failures LOUDLY (and the first success), instead
    of swallowing them, so a bad token/URL/auth is diagnosable from the connector window."""
    first = True
    while True:
        try:
            await asyncio.to_thread(plugin_post, "/agent/heartbeat", {})
            if first:
                print(f"[connector] heartbeat OK — {BOT_USER} should now show ONLINE", flush=True)
                first = False
        except Exception as e:  # noqa: BLE001
            print(f"[connector] HEARTBEAT FAILED — {BOT_USER} will show OFFLINE despite being "
                  f"connected: {e}", flush=True)
        await asyncio.sleep(20)


async def main():
    from ws_min import ws_connect  # stdlib-only WS client, no pip dependency
    asyncio.create_task(heartbeat_loop())  # independent of WS reconnects
    backoff = 3
    while True:
        try:
            async with ws_connect(WS) as ws:
                await ws.send(json.dumps({"seq": 1, "action": "authentication_challenge",
                                          "data": {"token": TOKEN}}))
                print(f"[connector] connected as {BOT_USER}; agent={AGENT}", flush=True)
                backoff = 3
                report_skills()
                async for raw in ws:
                    try:
                        ev = json.loads(raw)
                    except json.JSONDecodeError:
                        continue
                    evname = ev.get("event", "")
                    if evname == "posted":
                        d = ev["data"]
                        post = json.loads(d["post"])
                        await asyncio.to_thread(handle_post, post, d.get("channel_type", ""))
                    elif evname.endswith("_codespace_req"):  # room relays a fs/git request
                        await asyncio.to_thread(handle_codespace_req, ev.get("data") or {})
        except Exception as e:  # noqa: BLE001
            print(f"[connector] disconnected: {e}; retry in {backoff}s", flush=True)
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 60)


if __name__ == "__main__":
    asyncio.run(main())
