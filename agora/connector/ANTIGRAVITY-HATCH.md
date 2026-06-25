# Hatching Antigravity (`agy`) into Agora — findings + plan
Branch: `antigravity-hatch` · 2026-06-21 · replaces the `gemini` agent (rate-limit fragile) with Antigravity.

## What we know
- **The CLI is `agy`** (`~/AppData/Local/agy/bin/agy`, v1.0.10). Data dir: `~/.gemini/antigravity-cli/`.
- `agy -p/--print "<prompt>"` runs **one prompt non-interactively** (+ `--dangerously-skip-permissions`, `--model`, `--conversation <id>` for session continuity). So unlike gemini, `agy` HAS headless.
- **BUT capture is the catch:** `agy -p` renders the answer to the **console (ConPTY)**, not stdout/stderr — `subprocess.run(capture_output=True)` gets **empty** output (verified in Python). The answer also persists to `~/.gemini/antigravity-cli/conversations/<id>.db`, which is **protobuf** (too brittle to parse).
- **aiko-core's proven driver** = `skills/cascade-bridge/run.py` (the "pilot switch"): discovers the Antigravity **language server** and calls its gRPC-over-HTTP API:
  - discover: `ps aux` → `language_server*` proc → `/proc/<pid>/cmdline` `--csrf_token` (or env `WINDSURF_CSRF_TOKEN`) → `lsof -i` for the `127.0.0.1:<port>` → probe `GetStatus`.
  - call: `POST {https|http}://127.0.0.1:{port}/exa.language_server_pb.LanguageServerService/{GetStatus|StartCascade|SendUserCascadeMessage}`, headers `content-type: application/json` + `x-codeium-csrf-token: {csrf}`, body `metadata.ideName/extensionName="antigravity"`.
  - **Gap:** bridge v1 only ACKs — "results appear in the IDE UI." It does **not** read the assistant's reply back.

## Capturing the reply — SOLVED (file-answer trick, verified 2026-06-21)
`agy` is **agentic** — it writes files via its own tool (it created `aiko.md`/`generated_image.md` in the user's transcript). So the connector instructs agy to **write its final answer to a file**, then reads that file. **No stdout, no ConPTY, no IDE/language-server, no second agent** — agy is the room's *direct* agent.

Verified: `agy --dangerously-skip-permissions -p "...write EXACTLY 'HELLO_AGY_FILE_OK' to <path>"` → the file appeared with the exact content.

Why this beats the alternatives: aiko-core's consult-claude/consult-gemmy capture via **stdout** (works for claude/gemini, NOT the Go-binary `agy`); cascade-bridge needs the **IDE open** (talks to live `language_server.exe`) — wrong for a headless room bot. The file trick needs neither.

Rejected: ConPTY capture (adds a non-stdlib Windows dep) and decoding the protobuf `.db` (version-fragile).

## Connector integration plan (once capture is decided)
- Add an `antigravity` branch to `connector.py:run_agent()` mirroring the gemini branch's shape:
  discover (cache csrf/port per host) → `StartCascade`(prompt) or `SendUserCascadeMessage`(per-thread `cascade_id` in `SESSIONS`) → **read reply** (method TBD) → strip noise → return.
- `host.py:prereq("antigravity")`: check `agy` installed AND the language server is discoverable/alive (instead of the gemini `GEMINI_API_KEY` check).
- Registry: add `antigravity` in `pair.py`/`agents.json` (+ `plugin/server/agents.go` if it enumerates agent types). Remove `gemini` AFTER `agy` is verified.
- Windows note: discovery differs from the Linux bridge (no `/proc`; use `tasklist`/`wmic`/`Get-Process` + a Windows port-lister). The bridge code is Linux-pathed — needs a Windows discovery path.
