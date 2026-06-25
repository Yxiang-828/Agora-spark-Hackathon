# Agora fork — build & serve the host (one-shot)

This is the **fork** path: we compile Mattermost's webapp from source and serve it on a
version-matched server, so Codespace and the rest can live **natively in the app** instead of
as a plugin. Same one-command UX as the old plugin room — the build step is just bigger now,
because we own the whole webapp.

## One command

**Linux / macOS**
```bash
./agora/scripts/fork/bootstrap.sh   # first run only — installs Node 24 to ~/.local/node24
./agora/scripts/fork/up.sh          # build webapp -> serve -> prints the URL
```

**Windows** (builds inside WSL2 automatically — native ext4, full RAM)
```bat
agora\scripts\fork\up.bat
```

Then open **http://localhost:8066** (first run: create the admin account).

## What `up` does

1. **bootstrap** (first run) — installs Node 24 (Mattermost pins `^24`) into `~/.local/node24`.
2. **build** (`build.sh`) —
   - `npm ci` (lockfile-exact; a loose install resolves a rollup/TS combo that fails),
   - purges stale `tsconfig.tsbuildinfo` / `.rollup.cache` (carried-over caches make TS skip
     files, so raw `.tsx` hits rollup → `Unexpected token`),
   - builds the `platform/*` workspaces, then the `channels` webpack bundle
     (heap bounded to fit RAM; too large → OOM),
   - output: `webapp/channels/dist`.
3. **serve** (`serve.sh`) — brings up `deploy/fork/docker-compose.yml`: a server pinned to the
   `release-11.9` line with our `dist` mounted as the client, waits until healthy, prints the URL.

## Why Windows goes through WSL

Building this webapp on Windows means a Docker bind-mount over NTFS (slow source reads) and
Docker's memory ceiling (the webpack build wants ~6 GB and gets OOM-killed). WSL2 fixes both:
native ext4 and the host's full RAM. `up.ps1` makes it transparent — it ensures the WSL env
(including **mirrored networking**, which is required for npm to reach the registry behind a
VPN), syncs the repo onto ext4, and runs the exact same POSIX `up.sh`.

## Knobs

| env var              | default        | meaning                                   |
|----------------------|----------------|-------------------------------------------|
| `AGORA_PORT`         | `8066`         | host port to serve on                     |
| `MM_IMAGE_TAG`       | `release-11.9` | server image tag (match the fork version) |
| `AGORA_NODE_HEAP_MB` | `6144`         | webpack JS heap (MB) — raise on big RAM   |
| `WEBAPP_DIST`        | repo build     | serve a different prebuilt client         |

## Stop
```bash
docker compose -p agora-fork down
```
(8066 is separate from the old plugin room on 8065 — they coexist.)
