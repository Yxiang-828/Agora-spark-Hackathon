package main

import (
	"net/http"

	"github.com/aegis/agora/server/command"
)

// engagementState is pure: from the raw KV values, decide whether agents are on in
// the channel and whether the user has muted them. Unit-tested in engagement_test.go.
func engagementState(chanVal []byte, muteVal []byte) (channelOn bool, muted bool) {
	channelOn = string(chanVal) != "off"
	muted = string(muteVal) == "1"
	return
}

// GET /engagement?channel=<id>&user=<id> — the connector reads this BEFORE responding,
// so a muted channel/user gets silence. Defaults to "on" when nothing is set.
func (p *Plugin) handleEngagement(w http.ResponseWriter, r *http.Request) {
	ch := r.URL.Query().Get("channel")
	u := r.URL.Query().Get("user")
	var cv, mv []byte
	if ch != "" {
		_ = p.client.KV.Get(command.EngageChanPrefix+ch, &cv)
	}
	if u != "" {
		_ = p.client.KV.Get(command.EngageMutePrefix+u, &mv)
	}
	on, muted := engagementState(cv, mv)
	state := "on"
	if !on {
		state = "off"
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"channel_ai": state, "muted": muted})
}
