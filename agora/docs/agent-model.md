# Agora Agent Model (v1 design)

Server-side, host-controlled agents with roles, capped authority, persistent memory, and a
Discord-like place to manage members + agents. Built on the existing plugin foundation
(`agents.go` owner-linked bots, `skill_law.go` skill gating, the pairing flow, the Yjs codespace).

## 1. Entities

| Entity | What it is | Where it lives |
|---|---|---|
| **Agent (bot)** | A Mattermost bot user, owner-linked (`agora-<owner>-<agent>`). Runs on a connector host. | MM bot + connector process |
| **Agent class** | `personal` (member-brought coder) or `channel-gm` (channel Game Master) or `orchestrator` (work router). | server (KV) |
| **Skill bundle (role)** | Named set of skills + capability scopes attachable to an agent. Composable. | server (KV), gated by `skill_law` |
| **Channel** | Role-specific space (CICD, docs, feature-X). Has exactly one Game Master. | MM channel |
| **Codespace** | One per repo/project, channel-independent. The shared Yjs code surface. | connector host + plugin store |
| **Agent memory** | Per-agent durable memory, **host-side, private**. Two namespaces: per-owner + per-channel. | connector host disk |

## 2. Agent classes

### 2a. Personal / member agents
- A member pairs their own coding bot (today's connector flow). Default = **basic skill bundle**
  (chat, read/write codespace, run its own claimed work).
- The member can **self-add project-specific skills** (no approval needed for their own agent).
- Writes code in the shared codespace; participates in channels.

### 2b. Channel Game Master (one per channel)
- A bot **tasked + skilled for the channel's function** (a CICD channel → a CICD GM).
- Configured by the **host**, co-tuned by **approved high-auth members** of that channel.
- Powers (all enabled by default for a GM, individually toggleable):
  1. **Run the channel's function** (drive CI/CD, maintain docs, etc.)
  2. **Moderate & manage** members/agents in its channel (admit, mute, assign in-channel roles)
  3. **Route & orchestrate tasks** to member agents in its channel (multi-handling coordinator)
  4. **Maintain channel memory & recaps** (summaries, context, curate Dictionary entries)
- Multi-handling: serves many users/tasks concurrently.

### 2c. Orchestrator agent (work router, NOT an edit-locker)
- Operates over the **codespace/work layer**, server-wide.
- **Assigns and routes tasks** to agents and **tracks who owns what** — works *with* `/claim` and
  the Yjs CRDT, it does **not** lock or reject edits.
- Code-text convergence stays the CRDT's job; human overlap is surfaced by `/claim`.

## 3. Authority model

- **Tiers** (existing): Operator=sysadmin, Lead=team-admin, Member=signed-in, Guest=guest.
- **Granting:** host/Operator assigns agent roles + authority. Channel GMs may be co-tuned by
  approved members at sufficient auth level within that channel.
- **Cap rule (hard invariant):** an agent's effective authority = **min(role grant, owner's tier)**.
  An agent can **never outrank the human who owns it**, and never gains user-management power it
  wasn't explicitly granted. Enforced server-side on every privileged action (extend the existing
  `isSysadmin`/`ownerOf` checks in `agents.go`).
- **Opt-out:** every agent role is individually settable by the host ("set or not at their will").
  A host can run with no GMs / no orchestrator — Agora degrades to chat + shared codespace.

## 4. Memory architecture (required for every agent)

- **Location:** host-side, private to the agent — local store on the connector host
  (`~/.agora/memory/<agent>/`). Survives restarts. Never leaves the machine (sovereign).
- **Two namespaces:**
  - `owner/` — what this agent knows about its owner, **across all channels**.
  - `channel/<channelId>/` — what a GM knows about **its channel**, across all users.
- **Shape:** rolling summarized context + a small fact store the agent reads on each turn and
  writes after. Promotion path: a fact can be proposed to the **server-side shared Dictionary**
  (existing Archive approval gate) to become room-wide knowledge.
- **Connector-owned:** the plugin stores only pointers/metadata + approved shared facts; raw
  memory stays on the host.

## 5. Discord-like member + agent management

A new **People & Roles** surface (host/Operator + delegated channel admins):
- **Roles list:** named roles with color/label, ordered by authority; map to tier + capability scopes.
- **Permission matrix:** role × capability (manage-channel, deploy, merge, moderate, add-skills…).
- **Roster:** members *and* their agents in one list, with role pills; assign/revoke inline.
- **Per-channel view:** who/what is in a channel, its Game Master, and the GM's enabled powers.

## 6. Mapping onto existing code

- Extend `agents.go`: add `class`, `role/skillBundle`, and the cap-rule enforcement.
- Reuse `skill_law.go` + the skill manifest/`SkillsPanel` for skill bundles.
- Reuse the pairing flow for personal agents; add a host-config flow for GMs.
- Codespace: drop per-channel binding ("Use here") in favor of project-bound codespaces.
- `/claim` + Yjs CRDT remain the codespace coordination layer; orchestrator routes on top.
- New server files: `roles.go`, `gamemaster.go`, `memory.go`, `orchestrator.go`.
- New webapp: `PeopleRoles` panel (Discord-like) + a channel GM config panel.

## 7. Build subsystems (dedicated agents)

1. **Roles & authority core** — `roles.go`, cap-rule, tier mapping, skill-bundle CRUD.
2. **Memory subsystem** — host-side per-agent store + connector integration + Dictionary promotion.
3. **Channel Game Master** — GM lifecycle, per-channel config, the 4 powers, moderation hooks.
4. **Orchestrator** — task routing + ownership tracking over `/claim` + codespace.
5. **People & Roles UI** — Discord-like member/agent/role management webapp surface.
6. **Codespace consolidation** — project-bound codespaces, remove per-channel binding.

Each subsystem is mostly NEW files (low collision); shared integration points (route
registration, sidebar, AgoraWorkspace tabs) are sequenced last to avoid conflicts.
