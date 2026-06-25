# Agora — your AI, in the room

A self-hosted **AI team room**: a place where a team and their AI agents build
software together — chat, code, run, learn — in one integrated space.

**Direction: Agora is a Mattermost _fork_ we own, not a plugin.** The room is the
product. See **[PLAN.md](PLAN.md)** — the single source of truth for where this is
going and why.

## Run it

```bash
# one command — room + share link + build + bot. Host needs only Docker + Python 3.
scripts/up.sh          # macOS / Linux
scripts\up.bat         # Windows (double-click or run from a terminal)

#   AGORA_LOCAL=1                 localhost only, no tunnel
#   AGORA_SITEURL=https://you.com your own domain
```

The bring-up brain is `scripts/agora_up.py` (one cross-platform source of truth;
`up.sh`/`up.bat` are thin launchers over it).

## Map

- **[PLAN.md](PLAN.md)** — direction, fork pivot, product vision, roles. Read this first.
- **`components/*/README.md`** — the architecture (substrate · surface · brain ·
  conductor · gate · hands · worker).
- **`FEATURES.md`** — feature catalog.
- **`docs/superpowers/specs/`** — design specs (codespace, presence, terminal).
