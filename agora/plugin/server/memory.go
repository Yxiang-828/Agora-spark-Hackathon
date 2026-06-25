package main

import (
	"encoding/json"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/gorilla/mux"
	"github.com/mattermost/mattermost/server/public/model"
)

// Agent memory — persistence is required for every agent (the model's hard rule).
//
// Raw, full memory lives HOST-SIDE on the connector (sovereign, never leaves the machine).
// This plugin layer holds the small, promotable FACT STORE + metadata so the room can:
//   - give an agent durable context across restarts (read on each turn, append after),
//   - show the host what an agent "knows" (People & Roles / channel view),
//   - promote a fact to the server-side shared Dictionary via the existing Gate.
//
// Two namespaces (per the model):
//   owner            — what this agent knows about its owner, across ALL channels.
//   channel:<cid>    — what a channel GM knows about ITS channel, across all users.

const memPrefix = "mem_" // mem_<botID>_<ns> = memoryStore JSON

const (
	maxFactsPerStore = 100
	maxFactLen       = 1200
	maxSummaryLen    = 4000
)

type fact struct {
	ID        string `json:"id"`
	Text      string `json:"text"`
	Source    string `json:"source"`     // who/what wrote it (bot username, "owner", "gm")
	CreatedAt int64  `json:"created_at"` // ms
}

type memoryStore struct {
	BotUserID string `json:"bot_user_id"`
	Namespace string `json:"namespace"` // "owner" | "channel:<cid>"
	Summary   string `json:"summary"`   // rolling summarized context
	Facts     []fact `json:"facts"`
	UpdatedAt int64  `json:"updated_at"`
}

// normalizeNS maps a requested namespace to a safe, stable key segment.
// "" / "owner" -> "owner"; "channel:<cid>" -> "channel:<cid>" (cid kept verbatim, it's an MM id).
func normalizeNS(ns string) (string, bool) {
	ns = strings.TrimSpace(ns)
	if ns == "" || ns == "owner" {
		return "owner", true
	}
	if strings.HasPrefix(ns, "channel:") {
		cid := strings.TrimPrefix(ns, "channel:")
		if cid == "" || strings.ContainsAny(cid, "_/ \t") {
			return "", false
		}
		return "channel:" + cid, true
	}
	return "", false
}

func memKey(botID, ns string) string { return memPrefix + botID + "_" + ns }

func (p *Plugin) getMemory(botID, ns string) memoryStore {
	var raw []byte
	ms := memoryStore{BotUserID: botID, Namespace: ns, Facts: []fact{}}
	if p.client.KV.Get(memKey(botID, ns), &raw) == nil && len(raw) > 0 {
		_ = json.Unmarshal(raw, &ms)
		if ms.Facts == nil {
			ms.Facts = []fact{}
		}
	}
	return ms
}

func (p *Plugin) putMemory(ms memoryStore) error {
	ms.UpdatedAt = time.Now().UnixMilli()
	out, err := json.Marshal(ms)
	if err != nil {
		return err
	}
	_, err = p.client.KV.Set(memKey(ms.BotUserID, ms.Namespace), out)
	return err
}

// memWriter: who may WRITE an agent's memory — the agent itself (its connector), the owner,
// or an Operator. (Reads are open to any signed-in user so the host can inspect.)
func (p *Plugin) memWriter(callerID, botID string) bool {
	return callerID != "" && (callerID == botID || callerID == p.ownerOf(botID) || p.isSysadmin(callerID))
}

func (p *Plugin) initMemoryRoutes(api *mux.Router) {
	api.HandleFunc("/agents/{id}/memory", p.handleGetMemory).Methods(http.MethodGet)
	api.HandleFunc("/agents/{id}/memory", p.handleAppendMemory).Methods(http.MethodPost)
	api.HandleFunc("/agents/{id}/memory/summary", p.handlePutSummary).Methods(http.MethodPost)
	api.HandleFunc("/agents/{id}/memory/{factID}", p.handleDeleteFact).Methods(http.MethodDelete)
	api.HandleFunc("/agents/{id}/memory/{factID}/promote", p.handlePromoteFact).Methods(http.MethodPost)
}

func (p *Plugin) handleGetMemory(w http.ResponseWriter, r *http.Request) {
	botID := mux.Vars(r)["id"]
	ns, ok := normalizeNS(r.URL.Query().Get("ns"))
	if !ok {
		http.Error(w, "bad namespace", http.StatusBadRequest)
		return
	}
	writeJSON(w, http.StatusOK, p.getMemory(botID, ns))
}

// handleAppendMemory adds a fact (the per-turn write). Bounded; oldest facts roll off.
func (p *Plugin) handleAppendMemory(w http.ResponseWriter, r *http.Request) {
	botID := mux.Vars(r)["id"]
	caller := r.Header.Get("Mattermost-User-ID")
	if !p.memWriter(caller, botID) {
		http.Error(w, "not allowed to write this agent's memory", http.StatusForbidden)
		return
	}
	var in struct {
		NS     string `json:"ns"`
		Text   string `json:"text"`
		Source string `json:"source"`
	}
	body, _ := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<14))
	_ = json.Unmarshal(body, &in)
	ns, ok := normalizeNS(in.NS)
	if !ok || strings.TrimSpace(in.Text) == "" {
		http.Error(w, "ns and text required", http.StatusBadRequest)
		return
	}
	txt := in.Text
	if len(txt) > maxFactLen {
		txt = txt[:maxFactLen]
	}
	src := in.Source
	if src == "" {
		if u, e := p.API.GetUser(caller); e == nil && u != nil {
			src = u.Username
		}
	}
	ms := p.getMemory(botID, ns)
	ms.Facts = append(ms.Facts, fact{ID: model.NewId(), Text: txt, Source: src, CreatedAt: time.Now().UnixMilli()})
	if len(ms.Facts) > maxFactsPerStore { // roll off oldest
		ms.Facts = ms.Facts[len(ms.Facts)-maxFactsPerStore:]
	}
	if err := p.putMemory(ms); err != nil {
		http.Error(w, "store failed", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, ms)
}

func (p *Plugin) handlePutSummary(w http.ResponseWriter, r *http.Request) {
	botID := mux.Vars(r)["id"]
	caller := r.Header.Get("Mattermost-User-ID")
	if !p.memWriter(caller, botID) {
		http.Error(w, "not allowed", http.StatusForbidden)
		return
	}
	var in struct {
		NS      string `json:"ns"`
		Summary string `json:"summary"`
	}
	body, _ := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<14))
	_ = json.Unmarshal(body, &in)
	ns, ok := normalizeNS(in.NS)
	if !ok {
		http.Error(w, "bad namespace", http.StatusBadRequest)
		return
	}
	s := in.Summary
	if len(s) > maxSummaryLen {
		s = s[:maxSummaryLen]
	}
	ms := p.getMemory(botID, ns)
	ms.Summary = s
	if err := p.putMemory(ms); err != nil {
		http.Error(w, "store failed", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, ms)
}

func (p *Plugin) handleDeleteFact(w http.ResponseWriter, r *http.Request) {
	botID := mux.Vars(r)["id"]
	caller := r.Header.Get("Mattermost-User-ID")
	if !p.memWriter(caller, botID) {
		http.Error(w, "not allowed", http.StatusForbidden)
		return
	}
	ns, ok := normalizeNS(r.URL.Query().Get("ns"))
	if !ok {
		http.Error(w, "bad namespace", http.StatusBadRequest)
		return
	}
	factID := mux.Vars(r)["factID"]
	ms := p.getMemory(botID, ns)
	kept := ms.Facts[:0]
	for _, f := range ms.Facts {
		if f.ID != factID {
			kept = append(kept, f)
		}
	}
	ms.Facts = kept
	if err := p.putMemory(ms); err != nil {
		http.Error(w, "store failed", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, ms)
}

// handlePromoteFact turns a private fact into a pending Dictionary proposal (the existing Gate).
// Anyone who can write the memory may propose; a human still approves it into the Dictionary.
func (p *Plugin) handlePromoteFact(w http.ResponseWriter, r *http.Request) {
	botID := mux.Vars(r)["id"]
	caller := r.Header.Get("Mattermost-User-ID")
	if !p.memWriter(caller, botID) {
		http.Error(w, "not allowed", http.StatusForbidden)
		return
	}
	ns, ok := normalizeNS(r.URL.Query().Get("ns"))
	if !ok {
		http.Error(w, "bad namespace", http.StatusBadRequest)
		return
	}
	factID := mux.Vars(r)["factID"]
	ms := p.getMemory(botID, ns)
	var target *fact
	for i := range ms.Facts {
		if ms.Facts[i].ID == factID {
			target = &ms.Facts[i]
			break
		}
	}
	if target == nil {
		http.Error(w, "fact not found", http.StatusNotFound)
		return
	}
	channelID := ""
	if strings.HasPrefix(ns, "channel:") {
		channelID = strings.TrimPrefix(ns, "channel:")
	}
	agentName := botID
	if u, e := p.API.GetUser(botID); e == nil && u != nil {
		agentName = u.Username
	}
	pr := proposal{
		ID:        model.NewId(),
		AgentID:   botID,
		AgentName: agentName,
		ChannelID: channelID,
		Issue:     "Promote agent memory to shared Dictionary",
		RootCause: "Agent learned this in private memory (" + ns + ")",
		Fix:       target.Text,
		Status:    "pending",
		CreatedAt: time.Now().UnixMilli(),
	}
	out, _ := json.Marshal(pr)
	if _, err := p.client.KV.Set(proposalPrefix+pr.ID, out); err != nil {
		http.Error(w, "store failed", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"proposal_id": pr.ID, "status": "pending"})
}

// memorySummaryFor: a compact, human-ordered fact list (newest first) — used by the channel view.
func (p *Plugin) memorySummaryFor(botID, ns string) memoryStore {
	ms := p.getMemory(botID, ns)
	sort.Slice(ms.Facts, func(i, j int) bool { return ms.Facts[i].CreatedAt > ms.Facts[j].CreatedAt })
	return ms
}
