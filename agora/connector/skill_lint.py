#!/usr/bin/env python3
"""skill_lint — your stress surface for skill_law.

Throw any manifest (or a folder of them) at the gate and see ADMIT / REJECT + why.
Cross-OS, stdlib only. Exit code 0 = all admitted, 1 = at least one rejected
(so it doubles as a CI check).

    python skill_lint.py skills/ssh-access.json        # one manifest
    python skill_lint.py skills/                        # a whole folder
    python skill_lint.py skills/ --no-selfcheck        # skip running selfchecks
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from laws.skill_law import check_file, host_os  # noqa: E402

GREEN, RED, DIM, RST = "\033[32m", "\033[31m", "\033[2m", "\033[0m"


def _print(v):
    ok = v.admit
    tag = f"{GREEN}ADMIT {RST}" if ok else f"{RED}REJECT{RST}"
    print(f"{tag}  {v.name}")
    for r in v.reasons:
        where = f" [{r['os']}]" if r.get("os") else ""
        print(f"        {RED}x{RST} {r['clause']}{where}: {r['detail']}")
    for o, c in (v.compat or {}).items():
        if c.get("status") != "ok":
            print(f"        {DIM}~ {o}: {c['status']} - {c['detail']}{RST}")


def main(argv):
    run_selfcheck = "--no-selfcheck" not in argv
    targets = [a for a in argv if not a.startswith("-")]
    if not targets:
        print(__doc__); return 2

    paths = []
    for t in targets:
        if os.path.isdir(t):
            paths += [os.path.join(t, f) for f in sorted(os.listdir(t)) if f.endswith(".json")]
        else:
            paths.append(t)

    print(f"{DIM}host OS: {host_os()} | selfcheck: {'on' if run_selfcheck else 'off'}{RST}\n")
    any_reject = False
    for p in paths:
        v = check_file(p, run_selfcheck=run_selfcheck)
        _print(v)
        any_reject = any_reject or not v.admit
    print()
    n = len(paths)
    bad = sum(1 for p in paths if not check_file(p, run_selfcheck=run_selfcheck).admit)
    print(f"{DIM}{n - bad}/{n} admitted, {bad} rejected{RST}")
    return 1 if any_reject else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
