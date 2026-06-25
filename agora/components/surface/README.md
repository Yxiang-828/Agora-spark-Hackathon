# surface

The presence layer — where the agent lives and is addressed. Target: **Mattermost**.

- **Responsibility:** receive commands (@mention, `/wrap`, `/approve`, pause);
  render main action + **foldable subactions**; render the Gate's promotion
  reports with Approve/Discuss/Reject controls; show live progress.
- **Membrane (invariant):** the **only** human I/O seam. Raw model scratchpad
  must **never** leak to the channel (a flaw in the reference bot we are fixing).
- **Triggers it emits:** human events scoped `channel/thread/message` onto the bus.
- **States:** drives Thread/Case (`open→active→idle→…`) — see `../../docs/STATES.md`.
- **Mechanism (decided, D14):** external bot — Bot account + non-expiring PAT,
  **WebSocket** `GET /api/v4/websocket` to listen, **REST** `POST /api/v4/posts` +
  `PUT /api/v4/posts/{id}/patch` to reply/live-edit, attachment `actions[]` +
  interactive dialogs for the Approve/Discuss/Reject Gate UI. Client lib:
  Python `mattermostautodriver`. Thread key = `root_id or id`. Runs on Windows.
  Details + citations: `../../docs/RESEARCH.md`.
- **To verify against their instance:** what their internal bot stack is, Agents-plugin
  on/off, server version, SSRF allowlist for our callback, bot channel scope,
  PAT availability, rate limits.
