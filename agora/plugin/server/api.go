package main

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/gorilla/mux"
	"github.com/mattermost/mattermost/server/public/plugin"
)

// KV key prefix for a connector's reported skills: skills_<agentUserID>.
const skillKeyPrefix = "skills_"

func (p *Plugin) initRouter() *mux.Router {
	router := mux.NewRouter()

	// OPEN (no login): the pairing code itself is the credential, so a not-yet-paired
	// connector can claim it. Everything else requires an authenticated Mattermost user.
	open := router.PathPrefix("/api/v1").Subrouter()
	open.HandleFunc("/pair/claim", p.handlePairClaim).Methods(http.MethodPost)

	api := router.PathPrefix("/api/v1").Subrouter()
	api.Use(p.MattermostAuthorizationRequired)

	// Onboarding: a signed-in user starts pairing and polls its status.
	api.HandleFunc("/pair/start", p.handlePairStart).Methods(http.MethodPost)
	api.HandleFunc("/pair/status", p.handlePairStatus).Methods(http.MethodGet)

	// A connector submits its raw skill MANIFESTS; the room (here) gates them
	// authoritatively with skill_law and stores the verdicts. (Never trust the client.)
	api.HandleFunc("/skills", p.handlePostSkills).Methods(http.MethodPost)
	// The webapp Skills panel reads everyone's gated reports.
	api.HandleFunc("/skills", p.handleGetSkills).Methods(http.MethodGet)

	// The Gate: connector submits proposals; humans (authorized) approve into the Dictionary.
	api.HandleFunc("/proposals", p.handleSubmitProposal).Methods(http.MethodPost)
	api.HandleFunc("/proposals", p.handleListProposals).Methods(http.MethodGet)
	api.HandleFunc("/proposals/{id}/approve", p.handleApproveProposal).Methods(http.MethodPost)
	api.HandleFunc("/proposals/{id}/reject", p.handleRejectProposal).Methods(http.MethodPost)
	api.HandleFunc("/dictionary", p.handleListDictionary).Methods(http.MethodGet)

	// Engagement: the connector reads this before responding (channel off / user muted).
	api.HandleFunc("/engagement", p.handleEngagement).Methods(http.MethodGet)

	// Codespaces: shared browsable/editable code trees.
	p.initCodespaceRoutes(api)

	// Agent directory + connect/disconnect control plane.
	p.initAgentRoutes(api)

	// Agent roles + authority (host-defined skill bundles, cap rule).
	p.initRoleRoutes(api)

	// Agent memory (host-side fact store + Dictionary promotion), per owner + per channel.
	p.initMemoryRoutes(api)

	// Channel Game Masters (one per channel, four host-toggleable powers).
	p.initGameMasterRoutes(api)

	// Orchestrator: the work ledger (tasks, claims, routing) over /claim + the codespace.
	p.initOrchestratorRoutes(api)

	// 3D spatial voice room: channel-scoped WebSocket relay + agent-speak (Qwen) broadcast.
	p.initRoomRoutes(api)

	// Downloadable, double-click connector bundle (no git clone, no terminal typing).
	api.HandleFunc("/connector/bundle", p.handleConnectorBundle).Methods(http.MethodGet)

	return router
}

func (p *Plugin) ServeHTTP(c *plugin.Context, w http.ResponseWriter, r *http.Request) {
	p.router.ServeHTTP(w, r)
}

func (p *Plugin) MattermostAuthorizationRequired(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Mattermost-User-ID") == "" {
			http.Error(w, "Not authorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// --- wire contract (connector -> room) ---

type incomingSkill struct {
	Manifest            json.RawMessage `json:"manifest"`
	HostSelfcheck       string          `json:"host_selfcheck"`        // pass|fail|none (advisory; runs on the owner's host)
	HostSelfcheckDetail string          `json:"host_selfcheck_detail"` // why, if fail
}

type incomingReport struct {
	Agent  map[string]interface{} `json:"agent"`
	Skills []incomingSkill        `json:"skills"`
}

// --- stored / served shape (room -> webapp) ---

type storedVerdict struct {
	skillVerdict                        // skill, verdict, reasons, compat (authoritative, server-gated)
	HostSelfcheck       string          `json:"host_selfcheck,omitempty"`
	HostSelfcheckDetail string          `json:"host_selfcheck_detail,omitempty"`
	Manifest            json.RawMessage `json:"manifest,omitempty"` // for expandable details
}

type storedReport struct {
	Agent      map[string]interface{} `json:"agent"`
	ReportedAt int64                  `json:"reported_at"` // server time, ms — Visibility of System Status
	Admitted   []storedVerdict        `json:"admitted"`
	Rejected   []storedVerdict        `json:"rejected"`
}

// handlePostSkills gates each submitted manifest server-side and stores the verdicts.
func (p *Plugin) handlePostSkills(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
	if err != nil {
		http.Error(w, "read error", http.StatusBadRequest)
		return
	}
	var in incomingReport
	if err := json.Unmarshal(body, &in); err != nil {
		http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}
	id, _ := in.Agent["id"].(string)
	if id == "" {
		http.Error(w, "agent.id required", http.StatusBadRequest)
		return
	}

	report := storedReport{Agent: in.Agent, ReportedAt: time.Now().UnixMilli(), Admitted: []storedVerdict{}, Rejected: []storedVerdict{}}
	for _, s := range in.Skills {
		v := gateSkillManifest(s.Manifest) // AUTHORITATIVE — server re-gates, ignores any client verdict
		sv := storedVerdict{skillVerdict: v, HostSelfcheck: s.HostSelfcheck, HostSelfcheckDetail: s.HostSelfcheckDetail}
		if v.Verdict == "ADMIT" {
			// Persist only a sanitized manifest (no credentials, no selfcheck cmd). Admitted
			// manifests already passed the gate (no embedded secrets), but strip defensively.
			sv.Manifest = sanitizeManifest(s.Manifest)
			report.Admitted = append(report.Admitted, sv)
		} else {
			// NEVER persist a rejected manifest — it may carry the very secret that caused
			// the rejection (e.g. an embedded password). The reasons explain why, without it.
			report.Rejected = append(report.Rejected, sv)
		}
	}

	out, _ := json.Marshal(report)
	if _, err := p.client.KV.Set(skillKeyPrefix+id, out); err != nil {
		p.API.LogError("skills: kv set failed", "err", err)
		http.Error(w, "store failed", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"ok":true,"admitted":` + itoa(len(report.Admitted)) + `,"rejected":` + itoa(len(report.Rejected)) + `}`))
}

// sanitizeManifest drops secret-bearing / executable fields before a manifest is
// stored in KV and served to the panel: never persist credentials or a selfcheck
// command. Returns nil if the manifest can't be parsed.
func sanitizeManifest(raw json.RawMessage) json.RawMessage {
	var m map[string]interface{}
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil
	}
	delete(m, "credentials")
	delete(m, "selfcheck")
	out, err := json.Marshal(m)
	if err != nil {
		return nil
	}
	return out
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}

// handleGetSkills returns { "<agentID>": <report>, ... } for the panel.
func (p *Plugin) handleGetSkills(w http.ResponseWriter, r *http.Request) {
	out := map[string]json.RawMessage{}
	for page := 0; ; page++ {
		keys, err := p.client.KV.ListKeys(page, 200)
		if err != nil {
			p.API.LogError("skills: kv list failed", "err", err)
			http.Error(w, "list failed", http.StatusInternalServerError)
			return
		}
		if len(keys) == 0 {
			break
		}
		for _, k := range keys {
			if !strings.HasPrefix(k, skillKeyPrefix) {
				continue
			}
			var raw []byte
			if err := p.client.KV.Get(k, &raw); err == nil && len(raw) > 0 {
				out[strings.TrimPrefix(k, skillKeyPrefix)] = json.RawMessage(raw)
			}
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(out)
}
