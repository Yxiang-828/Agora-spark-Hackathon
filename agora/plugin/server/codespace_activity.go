package main

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/gorilla/mux"
	"github.com/mattermost/mattermost/server/public/model"
)

// Codespace activity feed + commit co-authorship. Every durable action (save, commit, push, file
// CRUD) is recorded with who + when into an append-only per-codespace log, and the humans who
// saved since the last commit are recorded so their names land on the commit as Co-authored-by
// trailers (so downstream `git blame`/`git log` keeps the real attribution).

const (
	csActivityPrefix = "csactivity_" // csactivity_<csID> = JSON []activityItem
	csContribPrefix  = "cscontrib_"  // cscontrib_<csID> = JSON {userID: "Name <email>"}
	maxActivity      = 500
)

type activityItem struct {
	Kind   string `json:"kind"` // save | commit | push | write | rename | delete | mkdir | rmdir | ai
	UserID string `json:"user_id"`
	Name   string `json:"name"`
	Detail string `json:"detail"` // path or commit message
	At     int64  `json:"at"`
}

func (p *Plugin) displayName(userID string) string {
	if u, err := p.client.User.Get(userID); err == nil && u != nil {
		return u.Username
	}
	return userID
}

// recordActivity appends one entry to the codespace's activity log and pings clients to refresh.
func (p *Plugin) recordActivity(csID, userID, kind, detail string) {
	var raw []byte
	var log []activityItem
	if p.client.KV.Get(csActivityPrefix+csID, &raw) == nil && len(raw) > 0 {
		_ = json.Unmarshal(raw, &log)
	}
	log = append(log, activityItem{Kind: kind, UserID: userID, Name: p.displayName(userID), Detail: detail, At: time.Now().UnixMilli()})
	if len(log) > maxActivity {
		log = log[len(log)-maxActivity:]
	}
	b, _ := json.Marshal(log)
	_, _ = p.client.KV.Set(csActivityPrefix+csID, b)
	p.API.PublishWebSocketEvent("cs_activity", map[string]interface{}{"codespace_id": csID}, &model.WebsocketBroadcast{})
}

// addContributor remembers a human who edited the codespace since the last commit (for co-authors).
func (p *Plugin) addContributor(csID, userID string) {
	if userID == "" {
		return
	}
	var raw []byte
	m := map[string]string{}
	if p.client.KV.Get(csContribPrefix+csID, &raw) == nil && len(raw) > 0 {
		_ = json.Unmarshal(raw, &m)
	}
	name, email := userID, userID+"@agora.local"
	if u, err := p.client.User.Get(userID); err == nil && u != nil {
		name = u.Username
		if u.Email != "" {
			email = u.Email
		}
	}
	m[userID] = name + " <" + email + ">"
	b, _ := json.Marshal(m)
	_, _ = p.client.KV.Set(csContribPrefix+csID, b)
}

// coauthorTrailers returns the Co-authored-by trailers for everyone (except the committer) who
// edited since the last commit, then clears the set.
func (p *Plugin) coauthorTrailers(csID, committerID string) string {
	var raw []byte
	m := map[string]string{}
	if p.client.KV.Get(csContribPrefix+csID, &raw) == nil && len(raw) > 0 {
		_ = json.Unmarshal(raw, &m)
	}
	_ = p.client.KV.Delete(csContribPrefix + csID)
	lines := []string{}
	for uid, ident := range m {
		if uid != committerID {
			lines = append(lines, "Co-authored-by: "+ident)
		}
	}
	if len(lines) == 0 {
		return ""
	}
	return "\n\n" + strings.Join(lines, "\n")
}

// GET /codespaces/{id}/activity — the activity feed (who did what, when).
func (p *Plugin) handleActivity(w http.ResponseWriter, r *http.Request) {
	cs, ok := p.getCodespace(mux.Vars(r)["id"])
	if !ok {
		http.Error(w, "codespace not found", http.StatusNotFound)
		return
	}
	if !p.mayParticipate(r.Header.Get("Mattermost-User-ID"), cs, r.URL.Query().Get("channel")) {
		http.Error(w, "not allowed in this codespace", http.StatusForbidden)
		return
	}
	var raw []byte
	_ = p.client.KV.Get(csActivityPrefix+cs.ID, &raw)
	if len(raw) == 0 {
		raw = []byte("[]")
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(raw)
}
