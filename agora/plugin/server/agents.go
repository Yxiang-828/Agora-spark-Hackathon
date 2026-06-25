package main

import (
	"encoding/json"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/mux"
	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/pluginapi"
)

const hbPrefix = "hb_"       // hb_<botID> = last heartbeat ms (connector pings; presence)
const hbFreshMs = int64(45000)

// The agent directory + connect/disconnect control plane.
//
// CRUD authority (tiers → Mattermost roles: Operator=sysadmin, Lead=team-admin,
// Member=signed-in user, Guest=guest):
//   CREATE  bring an agent (pair)        -> Member+ (guests blocked in handlePairStart)
//   READ    GET /agents (directory)      -> any signed-in user (see who's connected)
//   UPDATE  POST /agents/{id}/desire     -> the bot's OWNER, or an Operator (kill-switch)
//           (connect/disconnect someone else's agent requires Operator)
//   the host only ever reads desires for ITS OWN owner's bots (GET /host/desires).
//
// GET  /agents              -> who's in the room (every agent bot, owner, online?, mine?)
// POST /agents/{id}/desire  -> set run|stop for a bot (owner or Operator) — GUI connect/disconnect
// GET  /host/desires        -> the local host polls this (as one of its bots) and reconciles

const desirePrefix = "desire_" // desire_<botID> = "run" | "stop"

type agentInfo struct {
	BotUserID   string `json:"bot_user_id"`
	BotUsername string `json:"bot_username"`
	Agent       string `json:"agent"`
	OwnerID     string `json:"owner_id"`
	OwnerName   string `json:"owner_name"`
	Online      bool   `json:"online"`
	Mine        bool   `json:"mine"`
	Desired     string `json:"desired"`
}

func (p *Plugin) initAgentRoutes(api *mux.Router) {
	api.HandleFunc("/agents", p.handleListAgents).Methods(http.MethodGet)
	api.HandleFunc("/agents/{id}/desire", p.handleSetDesire).Methods(http.MethodPost)
	api.HandleFunc("/host/desires", p.handleHostDesires).Methods(http.MethodGet)
	api.HandleFunc("/agent/heartbeat", p.handleHeartbeat).Methods(http.MethodPost)
}

// handleHeartbeat: each connector pings ~every 20s; we use this (not MM's flaky bot
// presence) to know who's actually online. Authed as the bot itself.
func (p *Plugin) handleHeartbeat(w http.ResponseWriter, r *http.Request) {
	bot := r.Header.Get("Mattermost-User-ID")
	ts := strconv.FormatInt(model.GetMillis(), 10)
	_, _ = p.client.KV.Set(hbPrefix+bot, []byte(ts), pluginapi.SetExpiry(90*time.Second))
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (p *Plugin) online(botID string) bool {
	var hb []byte
	if p.client.KV.Get(hbPrefix+botID, &hb) == nil && len(hb) > 0 {
		if ts, err := strconv.ParseInt(string(hb), 10, 64); err == nil {
			return model.GetMillis()-ts < hbFreshMs
		}
	}
	return false
}

// agentOf parses the agent type from a bot username "agora-<owner>-<agent>".
func agentOf(username string) string {
	parts := strings.Split(username, "-")
	if len(parts) >= 3 {
		return parts[len(parts)-1]
	}
	return ""
}

// ownerLinks scans owner_<botID> = ownerUserID (stored as raw bytes, not JSON).
func (p *Plugin) ownerLinks() map[string]string {
	out := map[string]string{}
	for page := 0; ; page++ {
		keys, err := p.client.KV.ListKeys(page, 200)
		if err != nil || len(keys) == 0 {
			break
		}
		for _, k := range keys {
			if !strings.HasPrefix(k, ownerPrefix) {
				continue
			}
			var raw []byte
			if p.client.KV.Get(k, &raw) == nil && len(raw) > 0 {
				out[strings.TrimPrefix(k, ownerPrefix)] = string(raw)
			}
		}
	}
	return out
}

func (p *Plugin) desireOf(botID string) string {
	var raw []byte
	if p.client.KV.Get(desirePrefix+botID, &raw) == nil && len(raw) > 0 {
		return string(raw)
	}
	return "run"
}

func (p *Plugin) handleListAgents(w http.ResponseWriter, r *http.Request) {
	me := r.Header.Get("Mattermost-User-ID")
	out := []agentInfo{}
	for botID, ownerID := range p.ownerLinks() {
		bot, e := p.API.GetUser(botID)
		if e != nil || bot == nil {
			continue
		}
		ag := agentOf(bot.Username)
		if ag == "" {
			continue // hide legacy / non per-agent bots from the dashboard
		}
		ownerName := ownerID
		if o, oe := p.API.GetUser(ownerID); oe == nil && o != nil {
			ownerName = o.Username
		}
		out = append(out, agentInfo{
			BotUserID: botID, BotUsername: bot.Username, Agent: ag,
			OwnerID: ownerID, OwnerName: ownerName, Online: p.online(botID),
			Mine: ownerID == me, Desired: p.desireOf(botID),
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].BotUsername < out[j].BotUsername })
	writeJSON(w, http.StatusOK, out)
}

func (p *Plugin) handleSetDesire(w http.ResponseWriter, r *http.Request) {
	botID := mux.Vars(r)["id"]
	me := r.Header.Get("Mattermost-User-ID")
	if me != p.ownerOf(botID) && !p.isSysadmin(me) {
		http.Error(w, "not your agent", http.StatusForbidden)
		return
	}
	var in struct {
		Want string `json:"want"`
	}
	body, _ := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<12))
	_ = json.Unmarshal(body, &in)
	want := "run"
	if in.Want == "stop" {
		want = "stop"
	}
	if _, err := p.client.KV.Set(desirePrefix+botID, []byte(want)); err != nil {
		http.Error(w, "store failed", http.StatusInternalServerError)
		return
	}
	if want == "stop" {
		_ = p.client.KV.Delete(hbPrefix + botID) // flip the dashboard to offline immediately
	}
	writeJSON(w, http.StatusOK, map[string]string{"desired": want})
}

// handleHostDesires: the local host authenticates as one of its bots and gets the run/stop
// state for ALL of that owner's bots, then reconciles (starts/stops connectors) locally.
func (p *Plugin) handleHostDesires(w http.ResponseWriter, r *http.Request) {
	caller := r.Header.Get("Mattermost-User-ID")
	owner := p.ownerOf(caller) // caller is a bot -> its human owner
	if owner == "" {
		owner = caller // or a human calling directly
	}
	out := map[string]string{}
	for botID, ownerID := range p.ownerLinks() {
		if ownerID == owner {
			out[botID] = p.desireOf(botID)
		}
	}
	writeJSON(w, http.StatusOK, out)
}
