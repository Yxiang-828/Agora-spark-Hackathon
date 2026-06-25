#!/usr/bin/env python3
"""Codespace filesystem-op probe — exercises the directory-tree CRUD + safety jail in
connector.codespace_op against a real temp git repo. PASS/FAIL like the laws probes; no room
needed. Run: python connector/_codespace_fs_probe.py
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


def refuses(name, fn):
    try:
        fn()
        check(name, False)  # should have raised
    except Exception:  # noqa: BLE001
        check(name, True)


def main():
    root = tempfile.mkdtemp(prefix="agora_cs_probe_")
    here = lambda *p: os.path.join(root, *p)  # noqa: E731
    try:
        subprocess.run(["git", "init", "-q"], cwd=root, check=True)
        a = {"root": root}

        C.codespace_op("write", {**a, "path": "src/main.go", "content": "package main\n"})
        check("write creates a file (and parent dirs)", os.path.isfile(here("src", "main.go")))

        t = C.codespace_op("tree", a)
        check("tree lists the new untracked file", "src/main.go" in t.get("files", []))

        C.codespace_op("mkdir", {**a, "path": "docs/sub"})
        check("mkdir creates a folder", os.path.isdir(here("docs", "sub")))

        C.codespace_op("write", {**a, "path": "docs/readme.md", "content": "hi"})
        C.codespace_op("rename", {**a, "path": "docs/readme.md", "to": "docs/guide.md"})
        check("rename moves a file", os.path.isfile(here("docs", "guide.md")) and not os.path.isfile(here("docs", "readme.md")))

        C.codespace_op("delete", {**a, "path": "docs/guide.md"})
        check("delete removes a file", not os.path.isfile(here("docs", "guide.md")))

        C.codespace_op("rmdir", {**a, "path": "docs"})
        check("rmdir removes a folder and its contents", not os.path.isdir(here("docs")))

        refuses("write refuses path traversal (../)", lambda: C.codespace_op("write", {**a, "path": "../escape.txt", "content": "x"}))
        refuses("rmdir refuses deleting the codespace root", lambda: C.codespace_op("rmdir", {**a, "path": "."}))
    finally:
        shutil.rmtree(root, ignore_errors=True)

    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
