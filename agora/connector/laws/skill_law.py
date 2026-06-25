"""skill_law — the gate that ADMITS or hard-REJECTS a skill.

Agora Law (see docs/laws/skill_law.md). Pure stdlib, cross-OS.
A skill is ADMITTED only if it has ZERO violations; otherwise REJECTED with a
structured list of reasons (which clause failed, on which OS). No partial admission.

Register-time check (what runs here):
  - static: the manifest conforms to the contract (typed inputs/outputs/errors,
    complete description, declared workflow, no creds in the manifest).
  - compatibility: every OS (windows/macos/linux) declares a resolution OR a
    graceful refusal -> nothing can hard-crash (Constitution Art. I).
  - dynamic dry-run: if the skill ships a selfcheck, run it on the HOST OS;
    the other two OSes are dry-resolved (declared-resolution present).
Graduate-time (real pass on all 3 OS) is a separate step; see check_graduation().
"""
import json
import os
import platform
import subprocess

OSES = ("windows", "macos", "linux")
INPUT_TYPES = {"string", "int", "float", "bool", "list", "object"}
# keys in a credential entry that would mean a secret VALUE is embedded (Art. II)
SECRET_KEYS = {"value", "secret", "password", "pass", "token", "key", "apikey", "api_key"}


def host_os():
    s = platform.system().lower()
    return {"darwin": "macos", "windows": "windows", "linux": "linux"}.get(s, s)


class Verdict:
    def __init__(self, name):
        self.name = name
        self.reasons = []  # [{clause, os, detail}]  -> hard-reject if any
        self.compat = {}   # {os: {status: ok|graceful|incompatible, detail}}  -> never rejects

    def fail(self, clause, detail, on_os=None):
        self.reasons.append({"clause": clause, "os": on_os, "detail": detail})

    @property
    def admit(self):
        return not self.reasons

    def to_dict(self):
        return {
            "skill": self.name,
            "verdict": "ADMIT" if self.admit else "REJECT",
            "reasons": self.reasons,
            "compat": self.compat,
        }


def _is_nonempty_str(x):
    return isinstance(x, str) and x.strip() != ""


def check_manifest(manifest, run_selfcheck=True, host=None):
    """Validate one parsed manifest dict. Returns a Verdict."""
    host = host or host_os()
    name = manifest.get("name") if isinstance(manifest, dict) else None
    v = Verdict(name if _is_nonempty_str(name) else "<unnamed>")

    if not isinstance(manifest, dict):
        v.fail("SCHEMA", "manifest is not an object")
        return v

    # --- identity ---
    if not _is_nonempty_str(manifest.get("name")):
        v.fail("NAME", "missing or empty 'name'")
    if not _is_nonempty_str(manifest.get("version")):
        v.fail("VERSION", "missing or empty 'version'")

    # --- description (must let an agent decide WHEN to use it) ---
    desc = manifest.get("description")
    if not isinstance(desc, dict):
        v.fail("DESCRIPTION", "missing 'description' object")
    else:
        for field in ("what", "when_to_use", "not_for"):
            if not _is_nonempty_str(desc.get(field)):
                v.fail("DESCRIPTION_INCOMPLETE", f"description.{field} missing/empty")

    # --- inputs: typed ---
    inputs = manifest.get("inputs")
    if not isinstance(inputs, list):
        v.fail("INPUTS", "missing 'inputs' list")
    else:
        for i, inp in enumerate(inputs):
            if not isinstance(inp, dict):
                v.fail("INPUT_SHAPE", f"inputs[{i}] not an object"); continue
            if not _is_nonempty_str(inp.get("name")):
                v.fail("INPUT_SHAPE", f"inputs[{i}] missing name")
            t = inp.get("type")
            if t not in INPUT_TYPES:
                v.fail("INPUT_TYPE", f"inputs[{i}] type {t!r} not in {sorted(INPUT_TYPES)}")
            if not isinstance(inp.get("required", False), bool):
                v.fail("INPUT_SHAPE", f"inputs[{i}].required must be bool")

    # --- outputs: typed ---
    outputs = manifest.get("outputs")
    if not isinstance(outputs, list):
        v.fail("OUTPUTS", "missing 'outputs' list")
    else:
        for i, out in enumerate(outputs):
            if not (isinstance(out, dict) and _is_nonempty_str(out.get("name")) and out.get("type") in INPUT_TYPES):
                v.fail("OUTPUT_SHAPE", f"outputs[{i}] needs name + valid type")

    # --- errors: enumerated, no silent failure ---
    errors = manifest.get("errors")
    if not isinstance(errors, list) or len(errors) == 0:
        v.fail("NO_ERROR_CONTRACT", "must enumerate >=1 typed error (no silent failure)")
    else:
        for i, e in enumerate(errors):
            if not (isinstance(e, dict) and _is_nonempty_str(e.get("code")) and _is_nonempty_str(e.get("when"))):
                v.fail("ERROR_SHAPE", f"errors[{i}] needs code + when")

    # --- workflow: end-to-end ---
    wf = manifest.get("workflow")
    if not isinstance(wf, dict):
        v.fail("WORKFLOW", "missing 'workflow' object")
    else:
        if not isinstance(wf.get("steps"), list) or len(wf.get("steps") or []) == 0:
            v.fail("WORKFLOW", "workflow.steps must be a non-empty list")
        for field in ("preconditions", "postconditions"):
            if not isinstance(wf.get(field), list):
                v.fail("WORKFLOW", f"workflow.{field} must be a list")

    # --- compatibility: per-OS status (NEVER rejects; missing OS = graceful incompat, Art. I) ---
    oss = manifest.get("os_support") if isinstance(manifest.get("os_support"), dict) else {}
    for o in OSES:
        spec = oss.get(o)
        if isinstance(spec, dict) and _is_nonempty_str(spec.get("resolve")):
            v.compat[o] = {"status": "ok", "detail": spec["resolve"]}
        elif isinstance(spec, dict) and _is_nonempty_str(spec.get("graceful")):
            v.compat[o] = {"status": "graceful", "detail": spec["graceful"]}
        else:
            v.compat[o] = {"status": "incompatible",
                           "detail": f"incompatible on {o} - install support or declare a 'resolve' to enable"}

    # --- failure semantics ---
    fail_spec = manifest.get("failure")
    if not isinstance(fail_spec, dict):
        v.fail("FAILURE", "missing 'failure' object")
    else:
        if not _is_nonempty_str(str(fail_spec.get("blast_radius", ""))):
            v.fail("FAILURE", "failure.blast_radius required (Art. IV)")
        if not isinstance(fail_spec.get("idempotent", False), bool):
            v.fail("FAILURE", "failure.idempotent must be bool")

    # --- credentials: ids only, never values (Art. II) ---
    creds = manifest.get("credentials", [])
    if creds and not isinstance(creds, list):
        v.fail("CREDENTIALS", "'credentials' must be a list")
    else:
        for i, c in enumerate(creds or []):
            if isinstance(c, dict):
                leaked = SECRET_KEYS.intersection(k.lower() for k in c.keys())
                if leaked:
                    v.fail("CREDS_IN_MANIFEST", f"credentials[{i}] embeds {sorted(leaked)}; use a ref", )
                if not _is_nonempty_str(c.get("ref")):
                    v.fail("CREDENTIALS", f"credentials[{i}] must carry a 'ref'")

    # --- dynamic dry-run: run selfcheck on the host OS only ---
    sc = manifest.get("selfcheck")
    if run_selfcheck and isinstance(sc, dict) and isinstance(sc.get("cmd"), list) and sc["cmd"]:
        try:
            r = subprocess.run(sc["cmd"], capture_output=True, text=True,
                               timeout=int(sc.get("timeout", 30)))
            if r.returncode != 0:
                v.fail("SELFCHECK_FAILED", f"exit {r.returncode}: {(r.stderr or r.stdout)[:200]}", on_os=host)
        except subprocess.TimeoutExpired:
            v.fail("SELFCHECK_FAILED", "selfcheck timed out", on_os=host)
        except Exception as ex:  # noqa: BLE001
            v.fail("SELFCHECK_FAILED", f"could not run selfcheck: {ex}", on_os=host)

    return v


def check_file(path, run_selfcheck=True):
    """Validate a manifest file. JSON parse errors are themselves a REJECT."""
    name = os.path.splitext(os.path.basename(path))[0]
    try:
        with open(path, encoding="utf-8") as f:
            manifest = json.load(f)
    except json.JSONDecodeError as e:
        v = Verdict(name)
        v.fail("PARSE_ERROR", f"invalid JSON: {e}")
        return v
    return check_manifest(manifest, run_selfcheck=run_selfcheck)


def check_graduation():
    """Graduate = real pass on windows+macos+linux. Stub: wired to the CI matrix /
    the Test Ledger when we build skill graduation. Register-time uses check_manifest."""
    raise NotImplementedError("graduation runs the real 3-OS matrix; not part of register")
