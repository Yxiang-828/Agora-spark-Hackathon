# Real-time Codespace — Design (Section 8, Track C)

Date: 2026-06-22 · Status: approved direction, building · Supersedes the paused
`NOTES-codespace-collab.md` and carries its decisions forward.

## Goal (user's words)

A **low-latency, low-friction** codespace where teammates **edit in real time, like Google
Docs**, that is **differentiable from Git** (the version control) while staying **effective,
efficient, and mistake-free**.

## The core idea: two layers

The whole answer to "differentiable from Git" is a **live layer** on top of a **durable layer**:

| | Live layer | Durable layer (Git) |
|---|---|---|
| Unit | a keystroke | a commit |
| Speed | instant, optimistic, local-echo | deliberate, on demand |
| Sharing | automatic, continuous (CRDT merge) | explicit (`commit` / `push`) |
| Meaning | "what the file is right now" | "a named point in history" |
| Lifetime | ephemeral, converges | permanent, attributable |

**Boundary model chosen: "Disk mirrors live" (auto-flush).** Live edits merge in a CRDT and
**debounce-flush to the real file on disk** (~1.5s after typing settles). Disk is therefore
always ≈ the latest converged text. **Git stays exactly what people already know** — you
`commit`/`push` deliberately. No third "save" verb. (Rejected: "explicit save-to-disk" adds
friction and a lost-edit window; "doc-is-truth" fights the *real* working tree that the
channel AI and a member's own IDE also write to.)

## Architecture

```
 Browser A (Monaco + Yjs)  ─┐                       ┌─ host connector (the one machine)
 Browser B (Monaco + Yjs)  ─┼─ plugin = realtime hub ┼─  durable disk + git authority
 Browser C (read-only)     ─┘   relay + opaque store └─  read / write / status / commit / push
```

Three roles, matching the existing split:

- **Browsers = CRDT peers.** **CodeMirror 6** + **Yjs** + **y-codemirror.next**. Local typing is
  instant (optimistic, never blocked on the network). Yjs guarantees convergence with no overwrites.

  > **Editor engine: CodeMirror 6, not Monaco (corrected 2026-06-22).** Mattermost serves
  > `Content-Security-Policy: script-src 'self'`. `@monaco-editor/react` fetches Monaco from
  > `cdn.jsdelivr.net`, which that CSP **blocks** — so the editor hung forever on "Loading
  > editor…" and `onMount` never fired. CodeMirror 6 bundles into the plugin's own `main.js`
  > (same-origin, no web workers, no CDN, styles injected via JS), so it loads under the CSP.
  > It also has first-class Yjs collaboration via `y-codemirror.next` (`yCollab` = live text sync
  > + remote cursors from the awareness states). The server/connector/provider doc-sync layer is
  > unchanged; only the editor view and the cursor transport (now the binary Yjs awareness
  > protocol) changed.
- **Plugin = realtime hub** (the only always-on shared piece). It is a **dumb relay + durable
  store of opaque Yjs state** — it does *not* parse CRDT bytes. It (a) broadcasts each update
  to the other viewers, (b) stores the merged state so a late joiner catches up, (c) enforces
  **access rules server-side** (who may edit / which paths are protected) — clients cannot
  bypass it.
- **Host connector = durable disk + git authority.** Already built: `read`/`write`/`status`/
  `commit`/`push`/`clone`/`tree`, jailed to the codespace root. We add folder CRUD.

### Why the hub can be CRDT-blind

Yjs updates are commutative and idempotent. A relay that forwards every update to all other
peers, and stores the concatenated update log for late joiners, is correct *without merging*.
This is exactly how `y-websocket` works. So the always-on Go hub never needs a Go port of Yjs.

### Sync transport (custom provider, reusing existing plumbing)

- **client → hub:** `POST /codespace/doc/update {codespace_id, path, update(b64), origin}`.
  Hub appends to the per-file update log (KV) and broadcasts to other viewers.
- **hub → clients:** WS event `cs_doc_update {codespace_id, path, update(b64), origin}`.
  Plugin WS events arrive at the webapp as `custom_<pluginid>_cs_doc_update`; a client applies
  the update to its Yjs doc and ignores its own `origin`.
- **catch-up on open:** `POST /codespace/doc/open {codespace_id, path}` →
  `{role, state(b64)}`. **Seed election (the one subtle race):** the *first* opener of a fresh
  file gets `role:"seed"` via an **atomic KV compare-and-set**; it reads disk and pushes the
  initial Yjs update. Everyone else gets `role:"join"` + the stored `state` and just applies
  it. This prevents two independent seeders from double-inserting the disk text.
- **presence / cursors:** `POST /codespace/doc/awareness` → ephemeral WS event `cs_awareness`
  (never stored). Drives y-monaco remote cursors + selection highlights, colored per user.

### Auto-flush (disk mirrors live)

The client debounces ~1.5s **on local edits**, materializes the Y.Text to a string, and
`POST /codespace/doc/flush {codespace_id, path, content}`. The hub runs the **rules gate**,
then relays the existing `write` op to the host. Because the CRDT has converged, every editor
materializes identical text, so concurrent flushes are harmless (idempotent, same bytes).
Git `commit`/`push` stay separate and deliberate.

## Rules engine (`codespace_rules.go`)

Per-codespace rules in KV `csrules_<id>` — enforced **server-side** on `edit` (doc update +
flush), `commit`, and `push`. Every rejection returns a **typed reason** (no silent failure):

- `protected []glob` — paths the room may not edit/commit (always includes `.git/**`).
- `edit_tier` / `commit_tier` / `push_tier` — minimum authority tier for each action.
- `require_commit_message bool` — reject an empty/whitespace commit message.

**Authority tiers** (`tierOf`, consistent with the documented Operator/Lead/Member/Guest plan,
extending today's "approver = sysadmin"): `system_admin → operator`, team/system admin →
`lead`, guest → `guest`, else `member`. The codespace **creator** and the **host's owner** are
always allowed (they own the machine) — same rule as `mayUseCodespace`. Rules **fail closed**.

## Graceful failure (the "no mistakes" mandate)

- **WS drop →** edits buffer locally in Yjs; on reconnect the client re-`open`s, applies the
  latest stored state, and resyncs. CRDT merge means **no lost keystrokes**.
- **Host offline →** flush/op fails with a clear reason; the editor shows a **read-only banner**
  ("host offline — your edits are kept locally and will sync when it returns"); never silent loss.
- **Rule reject →** clear inline reason; the edit is refused, never half-applied.

## Directory tree (finish "in progress")

Connector gains `mkdir`, `rename`, `delete` (file), `rmdir` ops (jailed, `_cs_safe`). The panel
gets create / rename / delete for files and folders, built from the existing `tree` op grouped
into a folder view.

## Scope of THIS build

In: real-time editing (Yjs), live cursors/presence, auto-flush to disk, the rules engine,
directory-tree CRUD, reconnect/offline safety, and probes. Out (designed-for, later per the NEW
checklist): blame/attribution overlay, version-history scrubber, inline comments, soft locks,
find-across-codespace, terminal.

## Tests / probes (repo mandate: "done = the demo works")

- **Go unit:** rules-engine decisions (protected path, tier gates, commit-message-required);
  doc handlers gate non-members; seed-election CAS.
- **Convergence probe** (`connector/_codespace_probe.py`, PASS/FAIL like `laws/stress_test.py`):
  two headless clients push interleaved Yjs updates through the hub → assert both converge to
  the same text AND that an auto-flush lands that text on the host disk.

## Files

- `plugin/server/codespace_doc.go` — doc hub: open/update/awareness/flush, seed election, store.
- `plugin/server/codespace_rules.go` — rules CRUD + `tierOf` + `checkRule`.
- `plugin/server/codespace_doc_test.go`, `codespace_rules_test.go` — unit tests.
- `connector/connector.py` — folder CRUD ops in `codespace_op`.
- `plugin/webapp/src/CodespacePanel.tsx` — the panel (tree, git bar, peer dots, auto-flush wiring).
- `plugin/webapp/src/CodeEditor.tsx` — CodeMirror 6 view bound to the Yjs doc via `yCollab`.
- `plugin/webapp/src/cmLang.ts` — file-extension → CodeMirror syntax highlighting (legacy modes).
- `plugin/webapp/src/yprovider.ts` — the custom Yjs sync provider (doc updates + binary awareness).
- `plugin/webapp/package.json` — add `yjs`, `y-protocols`, `y-codemirror.next`, `codemirror` +
  `@codemirror/*` (state, view, language, legacy-modes, theme-one-dark). All bundle same-origin.
- `connector/_codespace_probe.py` — convergence + persistence probe.
