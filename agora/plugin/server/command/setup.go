package command

import (
	"fmt"
	"strings"

	"github.com/mattermost/mattermost/server/public/model"
)

// /agora setup — stand up the default channel architecture + a welcome guide so a new
// room is oriented out of the box. Team-admin gated; idempotent (skips existing).
// People can still re-order / re-categorize in their own sidebar.

type chanSpec struct{ name, display, purpose string }

var defaultChannels = []chanSpec{
	{"welcome", "Welcome", "How to use Agora — start here."},
	{"features", "Features", "Where work happens: /claim your area, open a thread per task, @your-agent."},
	{"code-review", "Code Review", "Discuss diffs and reviews."},
}

const welcomeGuide = "# Welcome to Agora\n" +
	"A room where your team and your AIs build together.\n\n" +
	"1. **Connect your AI** — top bar → **Connect AI** → run the one command. Your agent joins on your own subscription.\n" +
	"2. **Claim your area** — in **~features**, `/claim src/auth`. Agora warns if it overlaps a teammate.\n" +
	"3. **Work in a thread** — open a thread per task, then **@your-agent**. `/ai mute` / reactions to control noise.\n" +
	"4. **Observe the code** — open the **Codespace** to browse/edit the project.\n" +
	"5. **Capture knowledge** — `wrap` a solved thread → a Lead approves in **Archive** → it joins the Dictionary.\n\n" +
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
