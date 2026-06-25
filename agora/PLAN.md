# Agora — Plan & Source of Truth

> This file is the **single source of truth** for direction. It supersedes the old
> plugin-era docs (readme/SETUP/BUILDING/GETTING-STARTED), which have been cleared.
> Architecture detail still lives in `components/*/README.md` and `FEATURES.md`.

Agora is a **self-hosted AI team room**: a place where a team and their AI agents
build software together — chat, code, run, learn — in one space. The room is the
product, not an add-on to someone else's product.

---

## 1. Direction: own the fork, not the plugin

**Decision (2026-06-24):** Agora is a **Mattermost fork** we own, not a plugin
installed onto stock Mattermost.

Every wall we keep hitting is a *plugin-boundary* wall, not a bug:

- **Branding** — a plugin can't touch the core shell or the "Mattermost / Team
  Edition" wordmark. A fork owns the whole chrome.
- **Layout** — plugin UI is jailed into the right-hand sidebar (RHS) / app-bar.
  We can't restructure the surface. A fork lays out the UI we actually want.
- **Codespace / IDE** — the entire browser → room → connector WebSocket op-relay
  exists **only** because a plugin can't touch a filesystem or run an editor
  backend. The "(no files) / loading… / is the host online?" failure mode is the
  boundary leaking through. In a fork the IDE backend is **native** — no relay.

The plugin model answers "add a feature to someone else's Mattermost." Agora **is**
the room. That mismatch is the tax on our change-pace. We stop paying it.

## 2. Principle: move the buildings, not the bricks

The architecture and features are already set. The fork is a **restructure, not a
rewrite**:

1. **Modular-first, behavior-preserving.** Anything not already modular gets made
   modular *with no behavior change* (covered by existing tests / verified by an
   actual `up.bat` run) **before** it moves.
2. **Then relocate.** Plugin backend (codespace fs/git, rules, presence, skills,
   the component model) moves into the fork as native code or as an internal
   plugin **we** control and never bow to the public API ceiling for.
3. **Then restyle & integrate.** Own the shell: rebrand, the spacious tab
   workspace, one integrated environment.

Footprint is the evidence: every step is built, then **verified by running it**
(`up.bat`/`up.sh` → screenshot), never claimed done off code alone.

## 3. What's already built (inventory — nothing gets lost)

- **The room:** Mattermost + Postgres via `deploy/docker-compose.yml`; one-shot
  bring-up `scripts/agora_up.py` (brain) behind `up.sh`/`up.bat`; cloudflared
  share link; admin/team/channel provisioning; Calls (voice/screenshare).
- **Component architecture** (`components/*`): **substrate** (clock/space/event
  bus), **surface** (presence/Mattermost I/O), **brain** (memory tiers),
  **conductor** (orchestration), **gate** (human-gated learning), **hands**
  (cross-OS effectors), **worker** (single-task plan→act→observe).
- **Codespace** (`plugin/server/codespace*.go`, `plugin/webapp/src/Codespace*`):
  shared browsable/editable tree, live CRDT doc layer, presence, terminal, rules
  engine, activity feed, inline comments, git status/commit/push.
- **Skills / roles:** skill registry gated by skill_law; connector "hatch" for
  agents (Claude/Codex/Antigravity).
- **Connector:** outbound-WS agent bridge (`connector/`), install-once intent.
- **Feature catalog:** `FEATURES.md`.

## 4. The product we're building

A **spacious, tab-based integrated environment** for fast-paced **vibe coding** —
real-time development with AI agents — where channels, agents, codespace, terminal,
runs, and CI/CD all live in **harmony**, not bolted onto a chat sidebar.

Hard "don't":

- **No coding in the right-hand sidebar.** The current RHS codespace is cramped and
  miserable to code in. The editor is a **first-class, full-width, spacious
  workspace** — a real surface, the tab UI we're already moving toward.
- **No disjoint tools.** Channels ↔ agents ↔ codespace ↔ terminal ↔ runs are one
  integrated env that serves a single purpose: ship code fast with AI in the loop.

## 5. AI agent roles (the team you build with)

Agents assume **roles**; roles carry skills. Target roles:

- **Debugger** — dedicated to reproducing, isolating, and fixing failures.
- **CI/CD** — owns a pipeline **custom-built for vibe coding** (fast, forgiving,
  preview-first; not enterprise gatekeeping).
- **Role roulette** — plugin-skills are assumed via a **roulette** mechanism so
  roles get picked up / rotated across agents rather than hard-pinned.

(Builds on the existing skill registry + connector hatch.)

## 6. The fork pivot — phased plan

- **P0 — Source of truth & cleanup** ✅ this commit: PLAN.md in; stale plugin docs
  cleared; pushed.
- **P1 — Modularize in place (no behavior change).** Make the webapp surface
  (shell, tab controller, panels) and the plugin backend cleanly modular so they
  lift without rewrites. Verify each by `up.bat` + screenshot.
- **P2 — Own the shell.** Vendor the Mattermost server+webapp source into the repo
  (Docker build already proven); fork build runs through `up.sh`/`up.bat`.
- **P3 — Rebrand.** Kill "Mattermost / Team Edition," Agora wordmark + theme,
  native — the thing the plugin boundary kept refusing.
- **P4 — Spacious tab workspace.** Rebuild the surface as the full-width tab UI;
  retire the RHS-jailed codespace.
- **P5 — Native IDE.** Serve codespace files natively in the fork; drop the
  connector relay for in-room editing (connector stays for members' *local*
  machine access only).
- **P6 — Integrated env + roles.** Channels/agents/codespace/terminal/runs in one
  surface; debugger + CI/CD roles; vibe-coding pipeline; role roulette.

## 7. Migration map (plugin piece → fork home)

| Today (plugin) | Fork home |
|---|---|
| `plugin/webapp` panels in RHS | native webapp views (full tab workspace) |
| codespace fs/git **relay** (browser→room→connector) | native server-side fs/git |
| `plugin/server/*` (codespace, rules, skills) | built-in server modules |
| branding via config/CustomBrand | native shell rebrand |
| connector serves codespace files | connector = members' local-machine access only |

## 8. How I work on this

Per the working agreement: **drive the stated direction, don't re-ask decisions
already made, be relentless, self-verify by running the app.** No option-menus for
things I can decide. Stop only for genuinely irreversible/ambiguous calls.
