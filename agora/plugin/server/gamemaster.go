package main

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/gorilla/mux"
	"github.com/mattermost/mattermost/server/public/model"
)

// Channel Game Master — exactly one per channel. A bot tasked + skilled for the channel's
// function (a CI/CD channel gets a CI/CD GM). Configured by the host, co-tunable by approved
// channel admins. The GM has four host-toggleable powers; each maps to a capability scope that
// the agent's ROLE must also grant — so a GM can never exceed what its role + owner-tier allow.
//
//   run      -> channel.run       drive the channel's function
//   moderate -> channel.moderate  admit / mute / assign within the channel
//   route    -> channel.route     route tasks to member agents in the channel
//   memory   -> channel.memory    own channel memory + recaps
//
// "set or not at their will": a host can leave a channel with no GM — Agora degrades to plain
// chat + shared codespace there.

const gmPrefix = "gm_" // gm_<channelID> = gmConfig JSON

// gmPowerScope maps a GM power name to the role scope it requires.
var gmPowerScope = map[string]string{
	"run":      ScopeChannelRun,
	"moderate": ScopeChannelMod,
	"route":    ScopeChannelRoute,
	"memory":   ScopeChannelMemory,
}

type gmConfig struct {
	ChannelID string          `json:"channel_id"`
	BotUserID string          `json:"bot_user_id"` // the agent acting as this channel's GM
	Enabled   bool            `json:"enabled"`
	Powers    map[string]bool `json:"powers"` // run/moderate/route/memory
}

// channelAdmin: an Operator, or someone with channel-role-management on this channel
// (the "approved high-auth members" who may co-tune the GM).
func (p *Plugin) channelAdmin(userID, channelID string) bool {
	if p.isSysadmin(userID) {
		return true
	}
	return userID != "" && channelID != "" &&
		p.client.User.HasPermissionToChannel(userID, channelID, model.PermissionManageChannelRoles)
}

func (p *Plugin) getGM(channelID string) (gmConfig, bool) {
	var raw []byte
	if p.client.KV.Get(gmPrefix+channelID, &raw) != nil || len(raw) == 0 {
		return gmConfig{}, false
	}
	var c gmConfig
	if json.Unmarshal(raw, &c) != nil {
		return gmConfig{}, false
	}
	return c, true
}

// gmCan is the channel-scoped authorization gate: the channel must have an ENABLED GM that is
// THIS bot, the power must be on, AND the agent's role (capped to owner tier) must grant the
// matching scope. One choke point for every GM action.
func (p *Plugin) gmCan(channelID, botID, power string) bool {
	c, ok := p.getGM(channelID)
	if !ok || !c.Enabled || c.BotUserID != botID || !c.Powers[power] {
		return false
	}
	scope, ok := gmPowerScope[power]
	if !ok {
		return false
	}
	return p.agentCan(botID, scope)
}

func (p *Plugin) initGameMasterRoutes(api *mux.Router) {
	api.HandleFunc("/channels/{cid}/gm", p.handleGetGM).Methods(http.MethodGet)
	api.HandleFunc("/channels/{cid}/gm", p.handleSetGM).Methods(http.MethodPost)
	api.HandleFunc("/channels/{cid}/gm", p.handleClearGM).Methods(http.MethodDelete)
}

type gmView struct {
	gmConfig
	BotUsername   string   `json:"bot_username"`
	RoleName      string   `json:"role_name"`
	EffectiveTier string   `json:"effective_tier"`
	GrantedHere   []string `json:"granted_here"` // powers actually exercisable after the scope/cap check
}

func (p *Plugin) viewGM(c gmConfig) gmView {
	v := gmView{gmConfig: c, GrantedHere: []string{}}
	if u, e := p.API.GetUser(c.BotUserID); e == nil && u != nil {
		v.BotUsername = u.Username
	}
	role := p.roleOfAgent(c.BotUserID)
	v.RoleName = role.Name
	v.EffectiveTier = tierName(p.effectiveTier(c.BotUserID))
	for power := range gmPowerScope {
		if p.gmCan(c.ChannelID, c.BotUserID, power) {
			v.GrantedHere = append(v.GrantedHere, power)
		}
	}
	return v
}

func (p *Plugin) handleGetGM(w http.ResponseWriter, r *http.Request) {
	cid := mux.Vars(r)["cid"]
	c, ok := p.getGM(cid)
	if !ok {
		writeJSON(w, http.StatusOK, map[string]any{"enabled": false, "channel_id": cid})
		return
	}
	writeJSON(w, http.StatusOK, p.viewGM(c))
}

func (p *Plugin) handleSetGM(w http.ResponseWriter, r *http.Request) {
	cid := mux.Vars(r)["cid"]
	caller := r.Header.Get("Mattermost-User-ID")
	if !p.channelAdmin(caller, cid) {
		http.Error(w, "host or channel admin only", http.StatusForbidden)
		return
	}
	var in gmConfig
	body, _ := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<14))
	if json.Unmarshal(body, &in) != nil || in.BotUserID == "" {
		http.Error(w, "bot_user_id required", http.StatusBadRequest)
		return
	}
	// validate the named bot is a real, owner-linked agent
	bot, e := p.API.GetUser(in.BotUserID)
	if e != nil || bot == nil || agentOf(bot.Username) == "" {
		http.Error(w, "not a valid agent", http.StatusBadRequest)
		return
	}
	in.ChannelID = cid
	if in.Powers == nil {
		in.Powers = map[string]bool{"run": true, "moderate": true, "route": true, "memory": true}
	} else {
		in.Powers = filterPowers(in.Powers)
	}
	out, _ := json.Marshal(in)
	if _, err := p.client.KV.Set(gmPrefix+cid, out); err != nil {
		http.Error(w, "store failed", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, p.viewGM(in))
}

func (p *Plugin) handleClearGM(w http.ResponseWriter, r *http.Request) {
	cid := mux.Vars(r)["cid"]
	caller := r.Header.Get("Mattermost-User-ID")
	if !p.channelAdmin(caller, cid) {
		http.Error(w, "host or channel admin only", http.StatusForbidden)
		return
	}
	if err := p.client.KV.Delete(gmPrefix + cid); err != nil {
		http.Error(w, "delete failed", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// filterPowers drops unknown power keys so a typo can't store a phantom power.
func filterPowers(in map[string]bool) map[string]bool {
	out := map[string]bool{}
	for k, v := range in {
		if _, known := gmPowerScope[k]; known {
			out[k] = v
		}
	}
	return out
}
