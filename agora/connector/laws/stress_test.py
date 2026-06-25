#!/usr/bin/env python3
"""Stress test for skill_law — ADVERSARIAL inputs and their expected verdicts.

Not happy-path: every case is a deliberately malformed/abusive manifest, asserting
the gate REJECTs (with the right clause) or ADMITs-gracefully (with the right per-OS
compat). Run:  python3 stress_test.py   (stdlib only). Exit 0 = all cases as expected.
"""
import copy
import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # connector/
from laws.skill_law import check_file, check_manifest  # noqa: E402

BASE = {
    "name": "ssh-access", "version": "1.2.0",
    "description": {"what": "run remote cmd", "when_to_use": "reach a host", "not_for": "local"},
    "inputs": [{"name": "host", "type": "string", "required": True},
               {"name": "command", "type": "string", "required": True}],
    "outputs": [{"name": "stdout", "type": "string"}],
    "errors": [{"code": "NO_TRANSPORT", "when": "no ssh"}],
    "workflow": {"preconditions": ["host resolves"], "steps": ["exec"], "postconditions": ["typed result"]},
    "os_support": {"linux": {"resolve": "ssh"}, "macos": {"resolve": "ssh"}, "windows": {"resolve": "plink"}},
    "failure": {"idempotent": False, "blast_radius": "host:command"},
    "credentials": [{"ref": "ssh/host"}],
}
PY = sys.executable  # cross-OS for selfcheck cases


def d(**changes):
    m = copy.deepcopy(BASE)
    for k, v in changes.items():
        m[k] = v
    return m


def drop(key, sub=None):
    m = copy.deepcopy(BASE)
    if sub is None:
        m.pop(key, None)
    else:
        m[key].pop(sub, None)
    return m


# (id, manifest, expect_verdict, expect_clause|None, expect_compat (os,status)|None)
CASES = [
    ("valid-baseline",            BASE,                                              "ADMIT",  None, ("windows", "ok")),
    ("missing-name",              drop("name"),                                      "REJECT", "NAME", None),
    ("missing-version",           drop("version"),                                   "REJECT", "VERSION", None),
    ("missing-description",       drop("description"),                               "REJECT", "DESCRIPTION", None),
    ("empty-when_to_use",         d(description={"what": "x", "when_to_use": "", "not_for": "y"}), "REJECT", "DESCRIPTION_INCOMPLETE", None),
    ("missing-inputs",            drop("inputs"),                                    "REJECT", "INPUTS", None),
    ("input-bad-type",            d(inputs=[{"name": "host", "type": "str", "required": True}]), "REJECT", "INPUT_TYPE", None),
    ("input-no-name",             d(inputs=[{"type": "string", "required": True}]),  "REJECT", "INPUT_SHAPE", None),
    ("input-required-not-bool",   d(inputs=[{"name": "h", "type": "string", "required": "yes"}]), "REJECT", "INPUT_SHAPE", None),
    ("output-no-type",            d(outputs=[{"name": "stdout"}]),                   "REJECT", "OUTPUT_SHAPE", None),
    ("errors-empty",              d(errors=[]),                                      "REJECT", "NO_ERROR_CONTRACT", None),
    ("error-no-when",             d(errors=[{"code": "X"}]),                         "REJECT", "ERROR_SHAPE", None),
    ("missing-workflow",          drop("workflow"),                                  "REJECT", "WORKFLOW", None),
    ("workflow-no-steps",         d(workflow={"preconditions": [], "steps": [], "postconditions": []}), "REJECT", "WORKFLOW", None),
    ("missing-failure",           drop("failure"),                                   "REJECT", "FAILURE", None),
    ("failure-no-blast",          d(failure={"idempotent": False}),                  "REJECT", "FAILURE", None),
    ("failure-idempotent-str",    d(failure={"idempotent": "no", "blast_radius": "h"}), "REJECT", "FAILURE", None),
    ("creds-password",            d(credentials=[{"ref": "x", "password": "p"}]),    "REJECT", "CREDS_IN_MANIFEST", None),
    ("creds-token",               d(credentials=[{"ref": "x", "token": "t"}]),       "REJECT", "CREDS_IN_MANIFEST", None),
    ("creds-apikey",              d(credentials=[{"ref": "x", "apikey": "a"}]),      "REJECT", "CREDS_IN_MANIFEST", None),
    ("creds-no-ref",             d(credentials=[{"foo": "bar"}]),                    "REJECT", "CREDENTIALS", None),
    ("manifest-not-object",       ["not", "a", "dict"],                              "REJECT", "SCHEMA", None),
    ("os-windows-empty",          d(os_support={"linux": {"resolve": "ssh"}, "macos": {"resolve": "ssh"}, "windows": {}}), "ADMIT", None, ("windows", "incompatible")),
    ("os-windows-graceful",       d(os_support={"linux": {"resolve": "ssh"}, "macos": {"resolve": "ssh"}, "windows": {"graceful": "needs WSL"}}), "ADMIT", None, ("windows", "graceful")),
    ("os-support-missing",        drop("os_support"),                                "ADMIT", None, ("linux", "incompatible")),
    ("selfcheck-nonzero",         d(selfcheck={"cmd": [PY, "-c", "import sys;sys.exit(3)"], "timeout": 10}), "REJECT", "SELFCHECK_FAILED", None),
    ("selfcheck-timeout",         d(selfcheck={"cmd": [PY, "-c", "import time;time.sleep(30)"], "timeout": 1}), "REJECT", "SELFCHECK_FAILED", None),
    ("selfcheck-missing-binary",  d(selfcheck={"cmd": ["__no_such_binary_xyz__"], "timeout": 5}), "REJECT", "SELFCHECK_FAILED", None),
]


def run():
    passed = failed = 0
    for cid, manifest, exp_verdict, exp_clause, exp_compat in CASES:
        v = check_manifest(manifest)
        got = "ADMIT" if v.admit else "REJECT"
        clauses = {r["clause"] for r in v.reasons}
        ok = (got == exp_verdict)
        if exp_clause:
            ok = ok and (exp_clause in clauses)
        if exp_compat:
            os_, st = exp_compat
            ok = ok and (v.compat.get(os_, {}).get("status") == st)
        flag = "PASS" if ok else "FAIL"
        if ok:
            passed += 1
        else:
            failed += 1
        detail = f"-> {got}"
        if v.reasons:
            detail += f" {sorted(clauses)}"
        if exp_compat:
            detail += f" compat[{exp_compat[0]}]={v.compat.get(exp_compat[0], {}).get('status')}"
        print(f"[{flag}] {cid:24s} expect={exp_verdict}/{exp_clause or exp_compat}  {detail}")

    # file-level case: invalid JSON -> PARSE_ERROR
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        f.write('{ "name": "x", }')  # trailing comma = invalid JSON
        bad = f.name
    pv = check_file(bad)
    os.unlink(bad)
    ok = (not pv.admit) and any(r["clause"] == "PARSE_ERROR" for r in pv.reasons)
    print(f"[{'PASS' if ok else 'FAIL'}] {'invalid-json-file':24s} expect=REJECT/PARSE_ERROR  -> {'REJECT' if not pv.admit else 'ADMIT'}")
    passed += ok
    failed += (not ok)

    print(f"\n{passed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(run())
