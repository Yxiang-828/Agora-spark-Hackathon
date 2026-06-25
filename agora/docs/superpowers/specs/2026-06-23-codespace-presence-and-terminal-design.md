# Codespace presence highlight + per-member terminal — Design

Date: 2026-06-23 · Status: approved direction, building · Track C follow-ups to the realtime
codespace (`2026-06-22-realtime-codespace-design.md`).

## Feature 1 — "Who's in which file" presence highlight

**Goal:** in the file tree, show which teammate is currently viewing/editing which file.

The live cursors already use the per-file Yjs awareness protocol, but that only knows who is in
the *same* file. This adds a **codespace-wide** presence channel, independent of the open doc.

- **Transport:** `POST /codespace/presence {codespace_id, channel_id, path, gone}` → server
  rebroadcasts an ephemeral `cs_presence {codespace_id, user_id, name, color, path, gone}` WS
  event (never stored). Gated by `mayParticipate` (same as doc ops). The server stamps the
  authenticated user id + display name (clients can't spoof identity).
- **Client (`presence.ts`):** on open/switch/close a file, broadcast the current path; re-broadcast
  on an ~8s heartbeat so late joiners learn current state and stale entries expire (~20s with no
  refresh). A module-level bus (fed by `index.tsx`, like the doc/awareness buses) keeps a
  `user_id → {name, color, path, ts}` map and notifies the panel.
- **UI (`FileTree.tsx`):** files with viewers get small colored dots (one per member, their cursor
  color) and a subtle row highlight; hover shows names. Derived `path → members[]` map passed in.

Low-risk, reuses the cursor color/identity conventions. No durable state.

## Feature 2 — Per-member codespace terminal (jailed + gated + audited)

**Goal:** each member gets their own shell on the host (own working dir + scrollback), and
commands are **deconflicted** so two people can't run conflicting commands at once.

**Safety posture (chosen):** commands run as the host user, **working dir jailed to the codespace
root** (the session cwd can't escape root), **authority-gated** (a configurable `term_tier` in the
rules engine, default `member`), and **every command is audited** (who/when/cmd/exit, appended to a
durable server log that the audit agent can read). NOT an OS sandbox — within the root it is real
shell access for permitted members (accepted trade-off; full container sandbox is a later option).

**Deconfliction:** a **per-codespace execution lock** — only one command runs at a time across all
members; others queue. Everyone sees a shared "alice is running `npm test`…" indicator
(`cs_term_busy` WS event: running | queued | done). Serializing *all* commands (not trying to
classify read-only vs mutating, which is unreliable) is what "no conflicting commands" means.

**Exec model (v1): line-based batch, not a live PTY.** Run a command to completion (with a
timeout), stream nothing mid-run, return full output + exit code. Simpler and cross-OS; full
interactive PTY (vim/top, live output) is a later upgrade. `cd` is special-cased: the **server
tracks each member's cwd** (relative to root) and the connector validates/returns the new cwd —
so no cross-shell `pwd` parsing and the cwd jail is enforced server- and host-side.

### Components

- **`connector/connector.py` — `term_run` op:** args `{root, cwd, command}`. If the command is
  `cd [path]`: resolve `root/cwd/path`, reject if it escapes root (`_cs_safe`), return the new
  relative cwd (runs nothing). Else: run `command` via the OS shell in `root/cwd`, capture
  stdout+stderr with a timeout, return `{out, exit, cwd}`. Jailed by `_cs_safe`.
- **`plugin/server/codespace_term.go`:**
  - per-codespace exec lock (in-process mutex, matching the rest of the codespace code) +
    `cs_term_busy` broadcast (running/queued/done).
  - per-(user, codespace) cwd in KV (`csterm_<csID>::<userID>`), default `.`.
  - durable audit log `csaudit_<csID>` (append-only, capped), one entry per command.
  - `POST /codespace/term {codespace_id, channel_id, command}` → gate (`mayParticipate` +
    `rules.checkTerminal(actor)`) → acquire codespace lock → relay `term_run` with the user's cwd →
    update cwd on `cd` → audit → return `{out, exit, cwd}`.
  - `GET /codespace/term/audit?codespace_id=` → the audit log (visibility / audit agent).
- **`plugin/server/codespace_rules.go`:** add `TermTier` (default `member`) + `checkTerminal(actor)`.
- **`plugin/webapp/src/Terminal.tsx`:** a Terminal toggle in the codespace panel — monospace
  scrollback (this member's own commands+output) + an input line showing the `cwd $` prompt, and a
  shared banner showing who's currently running what (from `cs_term_busy`). Lightweight custom UI
  (no xterm.js — keeps the bundle small and same-origin per the CSP constraint).

### Tests / probes

- **Go unit:** `checkTerminal` tier gate; the exec lock serializes (second call waits); `cd` jail
  rejects an escaping path; audit append.
- **Connector probe (`_codespace_term_probe.py`):** `term_run` runs a command and returns output +
  exit; `cd subdir` updates cwd; `cd ../..` (escape) is rejected; a failing command returns nonzero.

## Out of scope (later)

Live-streaming/interactive PTY (vim, dev servers), full container sandbox, command denylist,
backgrounded long-running processes. v1 is batch + serialized + jailed + gated + audited.
