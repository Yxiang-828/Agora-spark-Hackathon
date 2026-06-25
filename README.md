# Agora

**Mattermost + VS Code, rebuilt for agents.** Local CLI agents and a realtime orchestrator collaborating in one place — multiple developers, one host, zero conflicts.

Agora is a realtime, **agent-native development environment** built from the ground up for the agentic era: a single local-first workspace where a team — or a solo developer running a dozen agents — collaborates as fluidly as programmers sitting around one powerful machine.

---

## ▶ Quickstart — run Agora (read this first)

**One command brings up the whole room** (server + our webapp + the Agora plugin + channels + a share link). You do **not** need to build anything by hand.

### 1. Install the prerequisites (once)
| Your OS | Install |
|---|---|
| **Windows** | [Docker Desktop](https://www.docker.com/products/docker-desktop/) **and** WSL Ubuntu — open PowerShell and run `wsl --install -d Ubuntu-22.04`, then reboot. |
| **macOS** | [Docker Desktop](https://www.docker.com/products/docker-desktop/). First run only: `bash agora/scripts/fork/bootstrap.sh` (installs Node 24). |
| **Linux** | Docker Engine + Docker Compose. First run only: `bash agora/scripts/fork/bootstrap.sh`. |

Make sure **Docker Desktop is running** before you start.

### 2. Open a terminal and go to this folder
```
cd <the folder this README is in>     # the repo root
```

### 3. Run the one command for your OS
| Your OS | Run | In what |
|---|---|---|
| **Windows** | `.\up.bat` | PowerShell **or** Command Prompt |
| **macOS / Linux** | `./up.sh` | Terminal (bash) |

**First run takes ~5–8 minutes** — it compiles the web client from source (that's the slow part, not your machine). When it finishes you'll see:
```
  OK - Agora is up
    Local:  http://localhost:8066
    Share:  https://something.trycloudflare.com   (anyone can join while this runs)
    Login:  agoraadmin / Agora!admin1   (team: agora)
```

### 4. Open it
Go to **http://localhost:8066**, log in with **`agoraadmin` / `Agora!admin1`**, pick the **agora** team. You'll land in a room with **Welcome, Features, Code Review, 🎙 Voice Comms, 🧭 Orchestrator, ⚙️ CI/CD, 🐛 Debug, 🔎 Audit** channels.

### Re-running (fast)
You already built it once — don't rebuild the web client every time:
| Goal | Windows | macOS / Linux |
|---|---|---|
| **Fast re-serve** (no client rebuild) | `.\up.bat -NoBuild` | `AGORA_NOBUILD=1 ./up.sh` |
| **Localhost only** (no public link) | `.\up.bat -Local` | `AGORA_LOCAL=1 ./up.sh` |
| **Skip the plugin step** | `.\up.bat -SkipPlugin` | `AGORA_SKIP_PLUGIN=1 ./up.sh` |

### If something's wrong
- **"Docker Desktop isn't running"** → start Docker Desktop, wait for the whale icon, retry.
- **Windows "WSL distro not found"** → `wsl --install -d Ubuntu-22.04`, reboot, retry.
- **Port 8066 busy** → another stack is up; the script stops foreign stacks on that port automatically, just re-run.

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

## Run it

One launcher, one host. Clone the repo, then bring up everything (build, server, share link, agent connector) with a single command from the repo root.

**Prerequisites:** Docker Desktop. On Windows, WSL2 (Ubuntu) — the launcher uses it to build the web client.

```bash
git clone https://github.com/Yxiang-828/Agora-spark-Hackathon.git
cd Agora-spark-Hackathon

# Windows
up.bat

# macOS / Linux
chmod +x up.sh && ./up.sh
```

Then open the printed URL and log in. The launcher builds the web client, brings up the server with the Agora client, opens a public share link, and starts the local agent connector.

## Repo layout

| Path | What |
|---|---|
| `agora/` | Everything Agora — connector (local CLI agents), orchestrator, codespace backend, voice, deploy + the one-shot launcher scripts |
| `webapp/` | The web client (native Agora surfaces: channels, tabs, codespace, voice, panels) |
| `server/` | The room server |
| `up.bat` / `up.sh` | The single entry point |

Built on a fork of [Mattermost](https://github.com/mattermost/mattermost) (MIT-licensed core).
