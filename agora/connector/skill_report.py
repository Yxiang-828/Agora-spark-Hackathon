"""Report this connector's skills to the room.

The connector submits its raw skill MANIFESTS; the room (plugin) gates them with
skill_law AUTHORITATIVELY and stores the verdicts. The connector also runs its own
gate locally — but only as advisory fast-feedback, and to report the host-side
selfcheck result (which the server deliberately does NOT run; never execute
client-supplied code on the server). See docs/QUALITY-BAR.md §1.

Contract (connector -> plugin):
  POST  {base}/plugins/{plugin_id}/api/v1/skills
  body  { "agent": {"id","name"},
          "skills": [ { "manifest": {...}, "host_selfcheck": "pass|fail|none",
                        "host_selfcheck_detail": "..." } ] }
"""
import json
import os
import urllib.request

from laws.skill_law import check_manifest

PLUGIN_ID = os.environ.get("AGORA_PLUGIN_ID", "com.aegis.agora")


def _host_selfcheck(manifest):
    """Run the FULL local gate (incl. selfcheck) and report only the selfcheck outcome."""
    if not isinstance(manifest, dict) or "selfcheck" not in manifest:
        return "none", ""
    v = check_manifest(manifest, run_selfcheck=True)
    fails = [r for r in v.reasons if r["clause"] == "SELFCHECK_FAILED"]
    if fails:
        return "fail", fails[0]["detail"]
    return "pass", ""


def build_payload(skills_dir, bot_user_id, bot_username, run_selfcheck=True):
    skills = []
    if os.path.isdir(skills_dir):
        for fn in sorted(os.listdir(skills_dir)):
            if not fn.endswith(".json"):
                continue
            path = os.path.join(skills_dir, fn)
            try:
                with open(path, encoding="utf-8") as f:
                    manifest = json.load(f)
            except json.JSONDecodeError:
                # let the server reject it (PARSE_ERROR) — send a marker it can't admit
                manifest = {"name": fn, "_unparseable": True}
            sc, detail = (_host_selfcheck(manifest) if run_selfcheck else ("none", ""))
            skills.append({"manifest": manifest, "host_selfcheck": sc, "host_selfcheck_detail": detail})
    return {"agent": {"id": bot_user_id, "name": bot_username}, "skills": skills}


def post_skills(base_url, token, payload, plugin_id=PLUGIN_ID):
    """POST manifests to the plugin. Returns (ok, detail). Never raises."""
    url = f"{base_url.rstrip('/')}/plugins/{plugin_id}/api/v1/skills"
    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req) as resp:
            return True, resp.read().decode()[:120]
    except Exception as ex:  # noqa: BLE001 (plugin may be absent — graceful)
        return False, str(ex)


def summarize(payload):
    return f"skills: submitted {len(payload['skills'])} manifest(s) for server-side gating"
