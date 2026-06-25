package command

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/mattermost/mattermost/server/public/model"
)

// The Sentinel (v1): members declare what they're working on with /claim; when two
// claims in a channel overlap, the room calls it out publicly so they coordinate
// before they collide. (Floor = explicit claims + area-overlap; agent-auto-scope and
// git line-diff are the fast-follows on the precision ladder.)

const claimPrefix = "claim_" // claim_<channelID>_<userID>

type claimRecord struct {
	UserID    string `json:"user_id"`
	UserName  string `json:"user_name"`
	ChannelID string `json:"channel_id"`
	Area      string `json:"area"`
	CreatedAt int64  `json:"created_at"`
}

func claimKey(channelID, userID string) string { return claimPrefix + channelID + "_" + userID }

// areasOverlap: same area, or one is a path-prefix of the other ("src/auth" vs
// "src/auth/login.go"). Pure — unit-tested.
func areasOverlap(a, b string) bool {
	a = strings.Trim(strings.ToLower(strings.TrimSpace(a)), "/")
	b = strings.Trim(strings.ToLower(strings.TrimSpace(b)), "/")
	if a == "" || b == "" {
		return false
	}
	return a == b || strings.HasPrefix(a, b+"/") || strings.HasPrefix(b, a+"/")
}

func (c *Handler) claimsInChannel(channelID string) []claimRecord {
	out := []claimRecord{}
	prefix := claimPrefix + channelID + "_"
	for page := 0; ; page++ {
		keys, err := c.client.KV.ListKeys(page, 200)
		if err != nil || len(keys) == 0 {
			break
		}
		for _, k := range keys {
			if !strings.HasPrefix(k, prefix) {
				continue
			}
			var raw []byte
			var rec claimRecord
			if c.client.KV.Get(k, &raw) == nil && len(raw) > 0 && json.Unmarshal(raw, &rec) == nil {
				out = append(out, rec)
			}
		}
	}
	return out
}

func (c *Handler) executeClaimCommand(args *model.CommandArgs) *model.CommandResponse {
	area := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(args.Command), "/claim"))
	if area == "" {
		return eph("Usage: `/claim <area>` — e.g. `/claim src/auth`")
	}
	name := args.UserId
	if u, err := c.client.User.Get(args.UserId); err == nil && u != nil {
		name = u.Username
	}
	rec := claimRecord{UserID: args.UserId, UserName: name, ChannelID: args.ChannelId, Area: area, CreatedAt: time.Now().UnixMilli()}
	b, _ := json.Marshal(rec)
	if _, err := c.client.KV.Set(claimKey(args.ChannelId, args.UserId), b); err != nil {
		return eph("⚠️ Couldn't record your claim — please try again.")
	}

	var conflicts []string
	for _, other := range c.claimsInChannel(args.ChannelId) {
		if other.UserID != args.UserId && areasOverlap(other.Area, area) {
			conflicts = append(conflicts, fmt.Sprintf("@%s (`%s`)", other.UserName, other.Area))
		}
	}
	if len(conflicts) == 0 {
		return inChannel(fmt.Sprintf("🔒 @%s is now working on `%s`.", name, area))
	}
	return inChannel(fmt.Sprintf(
		"🔒 @%s is now working on `%s`.\n⚠️ **Scope overlap** with %s — coordinate here before you collide.",
		name, area, strings.Join(conflicts, ", ")))
}

func (c *Handler) executeUnclaimCommand(args *model.CommandArgs) *model.CommandResponse {
	if err := c.client.KV.Delete(claimKey(args.ChannelId, args.UserId)); err != nil {
		return eph("⚠️ Couldn't clear your claim — please try again.")
	}
	return eph("Released your claim in this channel.")
}

func (c *Handler) executeClaimsCommand(args *model.CommandArgs) *model.CommandResponse {
	claims := c.claimsInChannel(args.ChannelId)
	if len(claims) == 0 {
		return eph("No active claims here. `/claim <area>` to declare what you're working on.")
	}
	lines := make([]string, 0, len(claims))
	for _, x := range claims {
		lines = append(lines, fmt.Sprintf("- @%s → `%s`", x.UserName, x.Area))
	}
	return eph("Active claims in this channel:\n" + strings.Join(lines, "\n"))
}

func inChannel(text string) *model.CommandResponse {
	return &model.CommandResponse{ResponseType: model.CommandResponseTypeInChannel, Text: text}
}
