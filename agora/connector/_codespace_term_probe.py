#!/usr/bin/env python3
"""Codespace terminal-op probe — exercises connector.codespace_op('term_run'): runs a command,
tracks cwd via `cd`, and enforces the root jail. PASS/FAIL, no room needed.
Run: python connector/_codespace_term_probe.py
"""
import os
import shutil
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import connector as C  # noqa: E402

passed = failed = 0


def check(name, cond):
    global passed, failed
    if cond:
        passed += 1
        print(f"PASS {name}")
    else:
        failed += 1
        print(f"FAIL {name}")


def main():
    root = tempfile.mkdtemp(prefix="agora_term_probe_")
    try:
        subprocess.run(["git", "init", "-q"], cwd=root, check=True)
        os.makedirs(os.path.join(root, "src"))
        with open(os.path.join(root, "hello.txt"), "w", encoding="utf-8") as fh:
            fh.write("hi")
        a = {"root": root}

        # A normal command runs and returns output + exit 0.
        r = C.codespace_op("term_run", {**a, "cwd": "", "command": "git rev-parse --is-inside-work-tree"})
        check("runs a command (exit 0)", r.get("exit") == 0 and "true" in r.get("out", ""))

        # `cd` updates the session cwd (relative to root), runs nothing.
        r = C.codespace_op("term_run", {**a, "cwd": "", "command": "cd src"})
        check("cd updates cwd", r.get("exit") == 0 and r.get("cwd") == "src")

        # A failing command returns a nonzero exit.
        r = C.codespace_op("term_run", {**a, "cwd": "", "command": "git no-such-subcommand"})
        check("failing command -> nonzero exit", r.get("exit", 0) != 0)

        # The jail: `cd ..` out of the root is refused (cwd stays put).
        r = C.codespace_op("term_run", {**a, "cwd": "", "command": "cd .."})
        check("cd .. (escape root) refused", r.get("exit") == 1 and r.get("cwd") == "")

        # cd into a missing dir is reported, cwd unchanged.
        r = C.codespace_op("term_run", {**a, "cwd": "", "command": "cd nope"})
        check("cd into missing dir reported", r.get("exit") == 1 and r.get("cwd") == "")
    finally:
        shutil.rmtree(root, ignore_errors=True)

    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
