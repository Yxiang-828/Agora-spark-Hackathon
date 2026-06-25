package command

import (
	"fmt"
	"strings"

	"github.com/mattermost/mattermost/server/public/model"
)

// /agora setup — stand up the default channel architecture + a welcome guide so a new
// room is oriented out of the box. Team-admin gated; idempotent (skips existing).
// People can still re-order / re-categorize in their own sidebar.

type chanSpec struct{ name, display, purpose, intro string }

var defaultChannels = []chanSpec{
	{"welcome", "Welcome", "How to use Agora — start here.", ""},
	{"features", "Features", "Where work happens: /claim your area, open a thread per task, @your-agent.", ""},
	{"code-review", "Code Review", "Discuss diffs and reviews.", ""},

	// Voice comms: each channel has its own 3D spatial voice room.
	{"voice-comms", "🎙 Voice Comms", "Spatial voice room — humans on live mic, agents speak via Qwen.",
		"# 🎙 Voice Comms\n" +
			"This channel has a **3D spatial voice room**. Open the Agora panel → **3D Room** tab.\n\n" +
			"- **Humans** join with a mic — talk and your avatar walks to the podium; others hear you spatially.\n" +
			"- **Agents** appear as **violet-ringed** avatars and speak through their **Qwen** voice when they reply.\n" +
			"- Everyone in this channel shares the same room."},

	// AI-role channels: each is meant to be run by a job-specific agent (its channel Game Master).
	{"orchestrator", "🧭 Orchestrator", "The work router: breaks requests into tasks and routes them to agents.",
		"# 🧭 Orchestrator\n" +
			"Home of the **orchestrator** role. It tracks tasks and routes work across agents (it does **not** lock edits).\n\n" +
			"Set its agent in the Agora panel → **People & Roles** → assign the **Orchestrator** role, then make it this channel's Game Master."},
	{"ci-cd", "⚙️ CI/CD", "The CI/CD agent's channel — builds, checks, deploys.",
		"# ⚙️ CI/CD\n" +
			"A channel run by a **CI/CD Game Master** agent. Assign an agent the **Game Master** role and set it as this channel's GM (Agora panel → **People & Roles**)."},
	{"debug", "🐛 Debug", "The debug agent's channel — reproduce, diagnose, fix.",
		"# 🐛 Debug\n" +
			"A channel for a **debug** agent. Give an agent the right role + skills, then set it as this channel's Game Master."},
	{"audit", "🔎 Audit", "The audit agent's channel — cited findings, no made-up critique.",
		"# 🔎 Audit\n" +
			"A channel for an **audit** agent that reports cited findings. Assign its role + GM in the Agora panel → **People & Roles**."},
}

const welcomeGuide = "# Welcome to Agora\n" +
	"A room where your team and your AIs build together.\n\n" +
	"1. **Connect your AI** — top bar → **Connect AI** → run the one command. Your agent joins on your own subscription.\n" +
	"2. **Claim your area** — in **~features**, `/claim src/auth`. Agora warns if it overlaps a teammate.\n" +
	"3. **Work in a thread** — open a thread per task, then **@your-agent**. `/ai mute` / reactions to control noise.\n" +
	"4. **Observe the code** — open the **Codespace** to browse/edit the project.\n" +
	"5. **Talk in 3D** — open **~🎙 Voice Comms** → Agora panel → **3D Room** for the spatial voice room.\n" +
	"6. **Set agent roles** — Agora panel → **People & Roles** to give agents roles, authority, and per-channel Game Masters.\n" +
	"7. **Capture knowledge** — `wrap` a solved thread → a Lead approves in **Archive** → it joins the Dictionary.\n\n" +
	"_The **🧭 Orchestrator · ⚙️ CI/CD · 🐛 Debug · 🔎 Audit** channels are each meant to be run by a job-specific agent._\n" +
	"_Open **Home** (top bar) anytime for this guide._"

func (c *Handler) executeAgoraCommand(args *model.CommandArgs) *model.CommandResponse {
	fields := strings.Fields(args.Command)
	if len(fields) < 2 || fields[1] != "setup" {
		return eph("Usage: `/agora setup` — creates the default channels + welcome guide (team admins).")
	}
	if !c.client.User.HasPermissionToTeam(args.UserId, args.TeamId, model.PermissionManageTeam) {
		return eph("Only a team admin can run `/agora setup`.")
	}

	created := []string{}
	welcomeID := ""
	for _, ch := range defaultChannels {
		existing, _ := c.client.Channel.GetByName(args.TeamId, ch.name, false)
		id := ""
		if existing != nil {
			id = existing.Id
		} else {
			nc := &model.Channel{TeamId: args.TeamId, Name: ch.name, DisplayName: ch.display, Purpose: ch.purpose, Type: model.ChannelTypeOpen}
			if err := c.client.Channel.Create(nc); err != nil {
				continue
			}
			id = nc.Id
			created = append(created, ch.display)
			// orient each new channel with its own intro (welcome gets the full guide below)
			if ch.intro != "" {
				_ = c.client.Post.CreatePost(&model.Post{UserId: args.UserId, ChannelId: id, Message: ch.intro})
			}
		}
		if ch.name == "welcome" {
			welcomeID = id
		}
	}
	if welcomeID != "" {
		_ = c.client.Post.CreatePost(&model.Post{UserId: args.UserId, ChannelId: welcomeID, Message: welcomeGuide})
	}
	if len(created) == 0 {
		return eph("Default channels already exist — welcome guide refreshed in ~welcome.")
	}
	return eph(fmt.Sprintf("Created %s. Welcome guide posted in ~welcome.", strings.Join(created, ", ")))
}
