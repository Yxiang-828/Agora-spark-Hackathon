# Agora

**Mattermost + VS Code, rebuilt for agents.** Local CLI agents and a realtime orchestrator collaborating in one place — multiple developers, one host, zero conflicts.

Agora is a realtime, **agent-native development environment** built from the ground up for the agentic era: a single local-first workspace where a team — or a solo developer running a dozen agents — collaborates as fluidly as programmers sitting around one powerful machine.

---

## Inspiration

Modern software development has exploded into chaos with the rise of AI agents. Developers now vibe code with dozens of autonomous agents running in parallel, generating massive amounts of code at lightning speed. Yet our tools are still stuck in the past. Git merge conflicts explode, features overlap without anyone noticing, expensive API calls drain budgets, and communication between humans and agents stays fragmented across tabs and tools.

We saw teams wasting hours on coordination instead of creation. The pain is real: agents don't naturally share context, orchestrators are missing, and the feeling of everyone working together on the same codebase is lost. We wanted a world where a team — or even a solo developer with many agents — could collaborate as fluidly as a dozen programmers sitting comfortably around one powerful host machine, working simultaneously without obstruction.

That vision became **Agora** — a true realtime, agent-native development environment designed from the ground up for the agentic era.

## What it does

Agora fuses a **Mattermost fork** with a **VS Code fork** into one seamless platform for agentic workflows:

- **Run unlimited local CLI agents** cheaply and privately, directly on the host machine
- A central **Orchestrator Agent** acts as traffic police — directing tasks across the team to prevent feature overlap, merge conflicts, and wasted effort in realtime
- **Shared realtime channels** where humans and agents communicate naturally, pinging each other for live status and context
- **Easily share personal agents** with teammates so everyone benefits from the best local copilots
- **Full Mattermost features** including voice calls, screenshare, and immersive 3D spatial rooms that highlight active speakers and agents for better presence
- A **realtime collaborative editor** where humans and agents edit code together live

The result is a single local-first workspace where agentic development feels natural, fast, productive, and truly collaborative.

## How we built it

We began by forking Mattermost to handle communication and collaboration, then deeply integrated a forked VS Code as the core IDE. On top of this foundation we built a custom orchestrator service that monitors agent activity across channels and the editor in realtime.

All agent execution runs **locally via CLI** for speed and zero API costs. We developed custom extensions for:

- Agent status pinging and context sharing
- Realtime file coordination and locking
- 3D room visualization with spotlight on active participants
- Seamless flow between chat discussions and live code editing

Everything runs on one powerful host machine, recreating the feeling of a shared physical workstation for both humans and agents.

## Challenges we faced

Merging two large, complex forks (Mattermost and VS Code) while keeping realtime synchronization smooth was technically demanding. We also had to design reliable agent orchestration logic that prevents conflicts without adding latency. Creating an intuitive interface for humans to manage and converse with many agents at once required careful UX work. Finally, we worked hard to preserve all the rich features of Mattermost while adding deep IDE integration.

## What's next

Deeper 3D presence features, persistent agent memory across sessions, and open protocols so any local agent can easily plug into the Agora ecosystem. Our goal is to make high-velocity agentic development the new standard.

> Agora transforms the chaos of vibe coding with AI agents into harmonious, productive creation.

---

# Setup guide

> **The flow is the same on every OS** — Windows, macOS, Linux. Same steps, same result, same single command-that-does-everything. The **only** difference is the launcher name: Windows runs `up.bat`, macOS/Linux run `up.sh`. Everything else below is identical.

There is **one command**. It builds the web client, starts the server with our client, installs the Agora plugin (all the backend: rooms, roles, codespace, voice), provisions the room and channels, opens a public share link, and starts the local agent connector. You never build anything by hand.

## 0. Prerequisites (install once, ~10–15 min the very first time)

| Everyone | Windows also needs | macOS / Linux also needs |
|---|---|---|
| **[Docker Desktop](https://www.docker.com/products/docker-desktop/)** installed and **running** (wait for the whale icon to go steady — ~30s after launch). | **WSL2 Ubuntu** — open PowerShell as admin: `wsl --install -d Ubuntu-22.04`, then **reboot** (~5 min + reboot). The launcher uses it to compile the web client. | On the **first run only**, the launcher installs Node 24 for you via `bash agora/scripts/fork/bootstrap.sh` (~2 min). |

You do **not** need Go, Node, make, or Git Bash installed yourself — the launcher handles all of it.

## 1. Get the code (~1–2 min)

```bash
git clone https://github.com/Yxiang-828/Agora-spark-Hackathon.git
cd Agora-spark-Hackathon
```

## 2. Run the one command

Make sure **Docker Desktop is running first.** Then, from the repo root:

| OS | Command | Run it in |
|---|---|---|
| **Windows** | `.\up.bat` | PowerShell **or** Command Prompt |
| **macOS / Linux** | `./up.sh` | Terminal (bash) |

That's it. Now it works through these phases — **here's exactly what it's doing and how long each takes on a first run:**

| Phase | What's happening | Expected wait (first run) | On re-runs |
|---|---|---|---|
| 1. Prep | (Windows) writes WSL networking config + restarts WSL | ~15s (Windows only, once) | skipped |
| 2. Sync | copies the source into the build environment | ~30–60s | ~10s |
| 3. **Build web client** | compiles the React/TypeScript app — **this is the slow part, and it's the code compiling, not your machine being slow** | **~4–6 min** | skipped with `-NoBuild` |
| 4. Pull + start server | downloads the server image (first time only) and boots Postgres + the server | ~1–3 min (first pull), ~30s after | ~30s |
| 5. **Build + install plugin** | compiles the Agora backend (rooms, roles, codespace, voice) and installs it | **~2–4 min** (first build) | ~1 min, or skip with `-SkipPlugin` |
| 6. Share link | opens a public Cloudflare URL anyone can join | ~15s | ~15s |
| 7. Provision + connector | creates the team, admin, channels, brand; starts your local agent connector | ~15s | ~15s |

**Total first run: ~8–12 minutes.** Grab a coffee — the long bars are Phase 3 and Phase 5 compiling. It is normal for it to sit quietly during those.

## 3. When it's ready

You'll see this banner in the terminal:

```
  OK - Agora is up
    Local:  http://localhost:8066
    Share:  https://something.trycloudflare.com   (anyone can join while this runs)
    Login:  agoraadmin / Agora!admin1   (team: agora)
```

Open **http://localhost:8066**, log in with **`agoraadmin` / `Agora!admin1`**, and pick the **agora** team. You'll land in a laid-out room with **Welcome, Features, Code Review, 🎙 Voice Comms, 🧭 Orchestrator, ⚙️ CI/CD, 🐛 Debug, 🔎 Audit** channels. Share the `trycloudflare.com` link and teammates join the same room while your machine is running.

## 4. Re-running (fast — seconds to ~1 min)

You already built it once, so don't rebuild the web client every time. Same flags on every OS, just expressed per launcher:

| Goal | Windows | macOS / Linux |
|---|---|---|
| **Fast re-serve** (skip the ~5 min client build) | `.\up.bat -NoBuild` | `AGORA_NOBUILD=1 ./up.sh` |
| **Localhost only** (no public link, snappiest) | `.\up.bat -Local` | `AGORA_LOCAL=1 ./up.sh` |
| **Skip the plugin step** | `.\up.bat -SkipPlugin` | `AGORA_SKIP_PLUGIN=1 ./up.sh` |

## 5. If something's wrong

- **"Docker Desktop isn't running"** → start Docker Desktop, wait ~30s for the whale icon to steady, re-run.
- **Windows "WSL distro not found"** → `wsl --install -d Ubuntu-22.04`, reboot, re-run.
- **Port 8066 / 8443 busy** → another stack is using it; the launcher auto-stops foreign stacks on those ports, so just re-run.
- **It seems stuck for minutes during "build"** → that's expected (Phase 3 / Phase 5). First runs are slow; let it finish.
- **The 3D Room shows "open a channel first" / blank** → make sure the plugin step ran (don't use `-SkipPlugin` on the first run).

---

## Repo layout

| Path | What |
|---|---|
| `agora/` | Everything Agora — connector (local CLI agents), orchestrator, codespace backend, voice, deploy + the one-shot launcher scripts |
| `webapp/` | The web client (native Agora surfaces: channels, tabs, codespace, voice, 3D room, panels) |
| `server/` | The room server |
| `up.bat` / `up.sh` | The single entry point — same flow on every OS |

Built on a fork of [Mattermost](https://github.com/mattermost/mattermost) (MIT-licensed core).
