package command

import (
	"fmt"
	"strings"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/pluginapi"
)

type Handler struct {
	client *pluginapi.Client
}

type Command interface {
	Handle(args *model.CommandArgs) (*model.CommandResponse, error)
	executeHelloCommand(args *model.CommandArgs) *model.CommandResponse
}

const helloCommandTrigger = "hello"
const aiCommandTrigger = "ai"

// Engagement controls — KV keys read by the connector before it responds.
//   EngageChanPrefix+<channelID> == "off"  -> agents stay silent in that channel
//   EngageMutePrefix+<userID>    == "1"     -> that user is not answered by agents
const EngageChanPrefix = "engage_chan_"
const EngageMutePrefix = "engage_mute_"

// Register all your slash commands in the NewCommandHandler function.
func NewCommandHandler(client *pluginapi.Client) Command {
	err := client.SlashCommand.Register(&model.Command{
		Trigger:          helloCommandTrigger,
		AutoComplete:     true,
		AutoCompleteDesc: "Say hello to someone",
		AutoCompleteHint: "[@username]",
		AutocompleteData: model.NewAutocompleteData(helloCommandTrigger, "[@username]", "Username to say hello to"),
	})
	if err != nil {
		client.Log.Error("Failed to register command", "error", err)
	}
	if err := client.SlashCommand.Register(&model.Command{
		Trigger:          aiCommandTrigger,
		AutoComplete:     true,
		AutoCompleteDesc: "Agora agent controls",
		AutoCompleteHint: "[ping|on|off|mute|unmute|status]",
		AutocompleteData: model.NewAutocompleteData(aiCommandTrigger, "[ping|on|off|mute|unmute|status]", "Control Agora agents"),
	}); err != nil {
		client.Log.Error("Failed to register command", "error", err)
	}
	// Sentinel claims (feature-sync).
	for _, cmd := range []struct{ trig, hint, desc string }{
		{"claim", "<area>", "Declare what you're working on (warns on overlap)"},
		{"unclaim", "", "Release your claim in this channel"},
		{"claims", "", "List active claims in this channel"},
		{"agora", "setup", "Set up Agora's default channels + welcome guide (admins)"},
	} {
		if err := client.SlashCommand.Register(&model.Command{
			Trigger: cmd.trig, AutoComplete: true, AutoCompleteDesc: cmd.desc, AutoCompleteHint: cmd.hint,
			AutocompleteData: model.NewAutocompleteData(cmd.trig, cmd.hint, cmd.desc),
		}); err != nil {
			client.Log.Error("Failed to register command", "error", err)
		}
	}
	return &Handler{
		client: client,
	}
}

// ExecuteCommand hook calls this method to execute the commands that were registered in the NewCommandHandler function.
func (c *Handler) Handle(args *model.CommandArgs) (*model.CommandResponse, error) {
	fields := strings.Fields(args.Command)
	if len(fields) == 0 {
		return &model.CommandResponse{
			ResponseType: model.CommandResponseTypeEphemeral,
			Text:         "Empty command",
		}, nil
	}
	trigger := strings.TrimPrefix(fields[0], "/")
	switch trigger {
	case helloCommandTrigger:
		return c.executeHelloCommand(args), nil
	case aiCommandTrigger:
		return c.executeAiCommand(args), nil
	case "claim":
		return c.executeClaimCommand(args), nil
	case "unclaim":
		return c.executeUnclaimCommand(args), nil
	case "claims":
		return c.executeClaimsCommand(args), nil
	case "agora":
		return c.executeAgoraCommand(args), nil
	default:
		return &model.CommandResponse{
			ResponseType: model.CommandResponseTypeEphemeral,
			Text:         fmt.Sprintf("Unknown command: %s", args.Command),
		}, nil
	}
}

func (c *Handler) executeHelloCommand(args *model.CommandArgs) *model.CommandResponse {
	if len(strings.Fields(args.Command)) < 2 {
		return &model.CommandResponse{
			ResponseType: model.CommandResponseTypeEphemeral,
			Text:         "Please specify a username",
		}
	}
	username := strings.Fields(args.Command)[1]
	return &model.CommandResponse{
		Text: "Hello, " + username,
	}
}

// executeAiCommand handles `/ai ping` — confirms the plugin is live and reports how
// many agents have registered skills (the directory). Private method: not part of
// the Command interface, so the generated mocks are unaffected.
func (c *Handler) executeAiCommand(args *model.CommandArgs) *model.CommandResponse {
	fields := strings.Fields(args.Command)
	sub := ""
	if len(fields) >= 2 {
		sub = fields[1]
	}
	switch sub {
	case "ping":
		n := 0
		for page := 0; ; page++ {
			keys, err := c.client.KV.ListKeys(page, 200)
			if err != nil {
				return &model.CommandResponse{
					ResponseType: model.CommandResponseTypeEphemeral,
					Text:         "⚠️ Agora plugin is live, but the agent registry could not be read.",
				}
			}
			if len(keys) == 0 {
				break
			}
			for _, k := range keys {
				if strings.HasPrefix(k, "skills_") {
					n++
				}
			}
		}
		return &model.CommandResponse{
			ResponseType: model.CommandResponseTypeEphemeral,
			Text: fmt.Sprintf(
				"🏓 pong — Agora plugin is live; **%d** agent(s) have registered skills. "+
					"_(Per-agent live latency/heartbeat is pending the liveness feature; this is a registry check, not a round-trip.)_", n),
		}
	case "off", "on":
		// Channel-wide on/off affects everyone -> gate to a CHANNEL admin (or higher),
		// per UX-MAP. A regular member who wants quiet uses `/ai mute` (self-scoped, below).
		if !c.client.User.HasPermissionToChannel(args.UserId, args.ChannelId, model.PermissionManageChannelRoles) {
			return eph("Only a channel admin can turn agents on/off for the whole channel. Use `/ai mute` to silence them just for yourself.")
		}
		if sub == "off" {
			if _, err := c.client.KV.Set(EngageChanPrefix+args.ChannelId, []byte("off")); err != nil {
				return eph("⚠️ Couldn't update the channel setting — please try again.")
			}
			return eph("🔇 Agents are now **OFF** in this channel. `/ai on` to re-enable.")
		}
		if err := c.client.KV.Delete(EngageChanPrefix + args.ChannelId); err != nil {
			return eph("⚠️ Couldn't update the channel setting — please try again.")
		}
		return eph("🔈 Agents are **ON** in this channel.")
	case "mute":
		if _, err := c.client.KV.Set(EngageMutePrefix+args.UserId, []byte("1")); err != nil {
			return eph("⚠️ Couldn't mute — please try again.")
		}
		return eph("🔕 Agents won't auto-engage **you** — an explicit @mention still reaches them. `/ai unmute` to undo.")
	case "unmute":
		if err := c.client.KV.Delete(EngageMutePrefix + args.UserId); err != nil {
			return eph("⚠️ Couldn't unmute — please try again.")
		}
		return eph("🔔 Agents will respond to **you** again.")
	case "status":
		var cv, mv []byte
		if c.client.KV.Get(EngageChanPrefix+args.ChannelId, &cv) != nil ||
			c.client.KV.Get(EngageMutePrefix+args.UserId, &mv) != nil {
			return eph("⚠️ Couldn't read the current state — please try again.")
		}
		ch := "ON"
		if string(cv) == "off" {
			ch = "OFF"
		}
		you := "active"
		if string(mv) == "1" {
			you = "muted"
		}
		return eph(fmt.Sprintf("Agents in this channel: **%s** · you are **%s**.", ch, you))
	default:
		return eph("Usage: `/ai [ping|on|off|mute|unmute|status]`")
	}
}

func eph(text string) *model.CommandResponse {
	return &model.CommandResponse{ResponseType: model.CommandResponseTypeEphemeral, Text: text}
}
