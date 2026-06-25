"""Skill registry — loads a folder of skill manifests and gates each through
skill_law. Only ADMITTED skills are registered; REJECTED ones are reported with
reasons (hard-reject: they do not enter the registry in any form).
"""
import os

from .skill_law import check_file


def gate_dir(path, run_selfcheck=True):
    """Run skill_law over every *.json manifest in `path`.
    Returns (admitted, rejected) where each item is a Verdict.to_dict()."""
    admitted, rejected = [], []
    if not os.path.isdir(path):
        return admitted, rejected
    for fn in sorted(os.listdir(path)):
        if not fn.endswith(".json"):
            continue
        v = check_file(os.path.join(path, fn), run_selfcheck=run_selfcheck)
        (admitted if v.admit else rejected).append(v.to_dict())
    return admitted, rejected


def manifest_for(admitted):
    """The Skill-Manifest the room would serve: name + description of admitted skills."""
    return [{"name": a["skill"]} for a in admitted]
