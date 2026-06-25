# Agora connector (v0 — proven)

Bridges the Agora room ↔ a **local** AI agent. The intelligence runs on your
machine on your **subscription** (not an API key); the connector holds one
**outbound WebSocket** to the room and drives your local CLI per message.

**Status:** v0 working end-to-end. A real question asked in the room was answered
by the local `claude` CLI and posted back in-thread (live-edited). See "proven" below.

## Run
```bash
cd growth-agent/connector
py provision.py                 # one-time: makes bot + token + team/channel -> .env
py -m pip install --user websockets

AGORA_AGENT=echo   py connector.py   # transport-only (no agent) — sanity check
AGORA_AGENT=claude py connector.py   # drive local Claude Code (subscription)
AGORA_AGENT=codex  py connector.py   # drive local Codex CLI
```
Then in the room, `@agora-claude <your message>` (or DM the bot). It replies in-thread.

## How it works (see connector.py)
- **Transport:** outbound WS `…/api/v4/websocket`, auth via the bot token
  (`authentication_challenge` frame). No inbound ports — works behind any NAT/OS.
- **Engage:** on `posted` events, replies only when @mentioned or in a DM;
  **never answers itself** (loop guard).
- **Agent adapter:** `echo | claude | codex`, selected by `AGORA_AGENT`.
  - claude: `claude -p <prompt> --output-format json [--resume <sid>]`
  - codex:  `codex exec --json <prompt>`
- **Context retention:** one agent session per thread (`thread_key → session_id`,
  resumed on follow-ups).
- **Reply:** posts `…thinking…` then PATCH-edits it with the answer (live edit).
- **Work dir:** runs the agent in `~/.agora/work` (OUTSIDE the repo) so Claude Code
  doesn't inherit the workspace `CLAUDE.md`.

## Proven (2026-06-17)
`@agora-claude In one sentence, what was the agora in ancient Athens?`
→ *"The agora was the central public square of ancient Athens that served as the
city's marketplace and the hub of its civic, political, and social life."* (local
claude, on subscription) — smoke test PASS.

## Files
- `connector.py` — the connector (WS + adapters + reply)
- `provision.py` — make bot/token/team/channel → `.env`
- `_smoke.py` — post an @mention as admin, assert the bot replies (`SMOKE_MSG` to customize)
- `.env` — secrets (gitignored)

## Next (Test Ledger items still open)
- streaming tokens → live post edits (vs single edit at end)
- engagement precedence + per-thread Case state (PLAN §4)
- identity/pairing for *other people's* agents (FEDERATION) — this v0 is the single house bot
- the non-interactive subscription credit ceiling (CONNECTOR §6 / cost)
