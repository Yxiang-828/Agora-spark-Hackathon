# Roles — empowering agents beyond single skills

A **skill** is one capability with a typed contract (see `../skills/*.json`, gated by
`../laws/skill_law.py`). A **role** is a *purpose* an agent assumes that **composes
several skills**, carries its own **authority** (what it may do), and is **picked up by
roulette** rather than hard-pinned to one agent.

This is how we get the team the product is for: role-specific agents (debugger, CI/CD),
personal agents (your own connector), and rotating coverage — all on top of the existing
skill law.

## Role manifest

```jsonc
{
  "name": "debugger",
  "version": "1.0.0",
  "purpose": { "what": "...", "when_to_assume": "...", "not_for": "..." },
  "skills": ["agora-codespace", "..."],   // composed, each must be skill_law-ADMITTED
  "authority": { "edit": true, "commit": false, "run": true, "push": false },
  "roulette": { "eligible": true, "weight": 1, "max_concurrent": 1, "rotate_after": "task" },
  "os_support": { "linux": {"resolve": "..."}, "macos": {"resolve": "..."}, "windows": {"resolve": "..."} },
  "failure": { "idempotent": true, "blast_radius": "..." }
}
```

A role is **ADMITTED** only if every composed skill is itself admitted (no role can grant a
capability the skill law rejects) — same zero-violations rule as skills.

## Roulette assignment

When a channel/task needs a role and more than one connected agent is eligible, the room
**spins a roulette** over eligible agents (by `weight`, honoring `max_concurrent`) and the
winner *assumes* the role for the unit set by `rotate_after` (a task, a thread, a session).
This rotates coverage across the team's agents instead of pinning "debugging" to one bot —
so roles get picked up, handed off, and re-spun as agents come and go.

- `eligible` / `weight` — who can be picked, and how likely.
- `max_concurrent` — cap simultaneous holders (e.g. one CI/CD driver at a time).
- `rotate_after` — `task` | `thread` | `session` — when the role is re-spun.

## Roles we ship

- **`debugger.json`** — reproduce, isolate, fix failures.
- **`ci-cd.json`** — own a vibe-coding pipeline (fast, preview-first), build/test/deploy.
- *(personal roles are an agent's own connector assuming any eligible role for its owner.)*

See `../../PLAN.md` §5 (AI roles) and §6 (P6 integrated env + roles).
