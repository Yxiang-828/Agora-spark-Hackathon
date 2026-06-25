package main

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/gorilla/mux"
	"github.com/mattermost/mattermost/server/public/model"
)

// The Gate (Constitution Art. III: one durable-memory writer). A connector submits
// a PROPOSAL distilled from a thread; it sits pending until an AUTHORIZED human
// approves it, at which point it becomes a Dictionary entry. Approval is enforced
// SERVER-SIDE (QUALITY-BAR §1) — the room decides who may write durable memory.

const proposalPrefix = "prop_"
const dictPrefix = "dict_"

type proposal struct {
	ID        string `json:"id"`
	AgentID   string `json:"agent_id"`
	AgentName string `json:"agent_name"`
	ThreadID  string `json:"thread_id"`
	ChannelID string `json:"channel_id"`
	Issue     string `json:"issue"`
	RootCause string `json:"root_cause"`
	Fix       string `json:"fix"`
	Status    string `json:"status"`
	CreatedAt int64  `json:"created_at"`
}

type dictEntry struct {
	proposal
	ApprovedBy string `json:"approved_by"`
	ApprovedAt int64  `json:"approved_at"`
}

// --- pure logic (unit-tested in proposals_test.go) ---

// rolesAreApprover decides authority from a user's role string. Sysadmin for now;
// the full 4-tier scheme (Operator/Lead/Member/Guest) is a later feature.
func rolesAreApprover(roles string) bool {
	return strings.Contains(roles, model.SystemAdminRoleId)
}

// approveProposal is the pure prop -> Dictionary transform.
func approveProposal(pr proposal, approverID string, nowMs int64) dictEntry {
	pr.Status = "approved"
	return dictEntry{proposal: pr, ApprovedBy: approverID, ApprovedAt: nowMs}
}

// --- helpers ---

func (p *Plugin) isApprover(userID string) bool {
	u, err := p.client.User.Get(userID)
	if err != nil || u == nil {
		return false
	}
	return rolesAreApprover(u.Roles)
}

func (p *Plugin) kvListByPrefix(prefix string) (map[string]json.RawMessage, error) {
	out := map[string]json.RawMessage{}
	for page := 0; ; page++ {
		keys, err := p.client.KV.ListKeys(page, 200)
		if err != nil {
			return nil, err // surface KV failures, never return partial data as success
		}
		if len(keys) == 0 {
			break
		}
		for _, k := range keys {
			if !strings.HasPrefix(k, prefix) {
				continue
			}
			var raw []byte
			if err := p.client.KV.Get(k, &raw); err == nil && len(raw) > 0 {
				out[strings.TrimPrefix(k, prefix)] = json.RawMessage(raw)
			}
		}
	}
	return out, nil
}

// --- handlers ---

// POST /proposals — submit a distilled proposal (pending). INTENTIONAL POLICY: any
// authenticated member may *propose* (humans and connectors alike) — proposals are
// non-durable and harmless until approved. Provenance is server-derived (no spoofing)
// and the durable write is authority-gated (handleApproveProposal). Spam is bounded by
// admin reject. If we later want connector-only submission, gate on bot accounts here.
func (p *Plugin) handleSubmitProposal(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
	if err != nil {
		http.Error(w, "read error", http.StatusBadRequest)
		return
	}
	var pr proposal
	if err := json.Unmarshal(body, &pr); err != nil {
		http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}
	if strings.TrimSpace(pr.Issue) == "" || strings.TrimSpace(pr.Fix) == "" {
		http.Error(w, "issue and fix are required", http.StatusBadRequest)
		return
	}
	// Provenance is SERVER-DERIVED from the authenticated caller — never trust the
	// body's agent_id/agent_name (would let any user spoof who submitted).
	userID := r.Header.Get("Mattermost-User-ID")
	pr.AgentID = userID
	pr.AgentName = userID
	if u, uerr := p.client.User.Get(userID); uerr == nil && u != nil {
		pr.AgentName = u.Username
	}
	pr.ID = model.NewId()
	pr.Status = "pending"
	pr.CreatedAt = time.Now().UnixMilli()
	out, _ := json.Marshal(pr)
	if _, err := p.client.KV.Set(proposalPrefix+pr.ID, out); err != nil {
		http.Error(w, "store failed", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"id": pr.ID, "status": "pending"})
}

// GET /proposals — list pending proposals (any authenticated user may view).
func (p *Plugin) handleListProposals(w http.ResponseWriter, r *http.Request) {
	out, err := p.kvListByPrefix(proposalPrefix)
	if err != nil {
		http.Error(w, "list failed", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// GET /dictionary — list approved entries.
func (p *Plugin) handleListDictionary(w http.ResponseWriter, r *http.Request) {
	out, err := p.kvListByPrefix(dictPrefix)
	if err != nil {
		http.Error(w, "list failed", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// POST /proposals/{id}/approve — AUTHORITY-GATED: only an approver (sysadmin) may
// write durable memory. Moves the proposal into the Dictionary.
func (p *Plugin) handleApproveProposal(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("Mattermost-User-ID")
	if !p.isApprover(userID) {
		http.Error(w, "Forbidden: approving requires an Operator/Lead (sysadmin)", http.StatusForbidden)
		return
	}
	id := mux.Vars(r)["id"]
	var raw []byte
	if err := p.client.KV.Get(proposalPrefix+id, &raw); err != nil || len(raw) == 0 {
		http.Error(w, "proposal not found", http.StatusNotFound)
		return
	}
	var pr proposal
	if err := json.Unmarshal(raw, &pr); err != nil {
		http.Error(w, "corrupt proposal", http.StatusInternalServerError)
		return
	}
	entry := approveProposal(pr, userID, time.Now().UnixMilli())
	out, _ := json.Marshal(entry)
	if _, err := p.client.KV.Set(dictPrefix+pr.ID, out); err != nil {
		http.Error(w, "store failed", http.StatusInternalServerError)
		return
	}
	if err := p.client.KV.Delete(proposalPrefix + id); err != nil {
		http.Error(w, "approved, but failed to clear the pending proposal", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, entry)
}

// POST /proposals/{id}/reject — AUTHORITY-GATED.
func (p *Plugin) handleRejectProposal(w http.ResponseWriter, r *http.Request) {
	if !p.isApprover(r.Header.Get("Mattermost-User-ID")) {
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}
	id := mux.Vars(r)["id"]
	var raw []byte
	if err := p.client.KV.Get(proposalPrefix+id, &raw); err != nil || len(raw) == 0 {
		http.Error(w, "proposal not found", http.StatusNotFound)
		return
	}
	if err := p.client.KV.Delete(proposalPrefix + id); err != nil {
		http.Error(w, "delete failed", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func writeJSON(w http.ResponseWriter, code int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
