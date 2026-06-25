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

// Orchestrator — a work router, NOT an edit-locker.
//
// It operates over the codespace/work layer: it tracks TASKS and who owns what, and routes
// work to agents. It deliberately does NOT lock files or reject edits — code-text convergence
// stays the job of the Yjs CRDT, and human overlap is surfaced by /claim. This is the
// coordination ledger on top of those, so the host can see "what is being worked on, by whom."
//
// A task moves open -> claimed -> done (or back to open if released). Claiming is cooperative:
// the ledger records intent so agents/humans don't collide; it never blocks a write.

const taskPrefix = "task_" // task_<id> = task JSON

type task struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Detail      string `json:"detail,omitempty"`
	CodespaceID string `json:"codespace_id,omitempty"` // the project/codespace this work targets
	Status      string `json:"status"`                 // open | claimed | done
	AssignedBot string `json:"assigned_bot,omitempty"` // bot the orchestrator routed it to
	ClaimedBy   string `json:"claimed_by,omitempty"`   // bot/user that actually picked it up
	CreatedBy   string `json:"created_by,omitempty"`
	CreatedAt   int64  `json:"created_at"`
	UpdatedAt   int64  `json:"updated_at"`
}

func (p *Plugin) getTask(id string) (task, bool) {
	var raw []byte
	if p.client.KV.Get(taskPrefix+id, &raw) != nil || len(raw) == 0 {
		return task{}, false
	}
	var t task
	if json.Unmarshal(raw, &t) != nil {
		return task{}, false
	}
	return t, true
}

func (p *Plugin) putTask(t task) error {
	t.UpdatedAt = time.Now().UnixMilli()
	out, err := json.Marshal(t)
	if err != nil {
		return err
	}
	_, err = p.client.KV.Set(taskPrefix+t.ID, out)
	return err
}

func (p *Plugin) initOrchestratorRoutes(api *mux.Router) {
	api.HandleFunc("/tasks", p.handleListTasks).Methods(http.MethodGet)
	api.HandleFunc("/tasks", p.handleCreateTask).Methods(http.MethodPost)
	api.HandleFunc("/tasks/{id}/claim", p.handleClaimTask).Methods(http.MethodPost)
	api.HandleFunc("/tasks/{id}/status", p.handleTaskStatus).Methods(http.MethodPost)
	api.HandleFunc("/tasks/{id}", p.handleDeleteTask).Methods(http.MethodDelete)
}

// GET /tasks?codespace=<id> — the work ledger, optionally scoped to one codespace.
func (p *Plugin) handleListTasks(w http.ResponseWriter, r *http.Request) {
	want := r.URL.Query().Get("codespace")
	m, err := p.kvListByPrefix(taskPrefix)
	if err != nil {
		http.Error(w, "list failed", http.StatusInternalServerError)
		return
	}
	out := []task{}
	for _, raw := range m {
		var t task
		if json.Unmarshal(raw, &t) != nil {
			continue
		}
		if want != "" && t.CodespaceID != want {
			continue
		}
		out = append(out, t)
	}
	// open first, then by recency
	sort.Slice(out, func(i, j int) bool {
		if (out[i].Status == "open") != (out[j].Status == "open") {
			return out[i].Status == "open"
		}
		return out[i].UpdatedAt > out[j].UpdatedAt
	})
	writeJSON(w, http.StatusOK, out)
}

// POST /tasks {title, detail, codespace_id, assigned_bot} — file a unit of work.
// Any signed-in member may file; routing (assigned_bot) is advisory until claimed.
func (p *Plugin) handleCreateTask(w http.ResponseWriter, r *http.Request) {
	caller := r.Header.Get("Mattermost-User-ID")
	if p.userTier(caller) < tierMember {
		http.Error(w, "members only", http.StatusForbidden)
		return
	}
	var in task
	body, _ := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<15))
	if json.Unmarshal(body, &in) != nil || strings.TrimSpace(in.Title) == "" {
		http.Error(w, "title required", http.StatusBadRequest)
		return
	}
	if in.CodespaceID != "" && !p.csExists(in.CodespaceID) {
		http.Error(w, "unknown codespace", http.StatusBadRequest)
		return
	}
	t := task{
		ID: model.NewId(), Title: strings.TrimSpace(in.Title), Detail: in.Detail,
		CodespaceID: in.CodespaceID, AssignedBot: in.AssignedBot, Status: "open",
		CreatedBy: caller, CreatedAt: time.Now().UnixMilli(),
	}
	if err := p.putTask(t); err != nil {
		http.Error(w, "store failed", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, t)
}

// POST /tasks/{id}/claim {bot_user_id} — record who is taking the work (cooperative, non-blocking).
// The owner of the bot (or an Operator) may claim on its behalf; humans may claim as themselves.
func (p *Plugin) handleClaimTask(w http.ResponseWriter, r *http.Request) {
	caller := r.Header.Get("Mattermost-User-ID")
	t, ok := p.getTask(mux.Vars(r)["id"])
	if !ok {
		http.Error(w, "task not found", http.StatusNotFound)
		return
	}
	var in struct {
		BotUserID string `json:"bot_user_id"`
	}
	body, _ := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<12))
	_ = json.Unmarshal(body, &in)
	claimer := in.BotUserID
	if claimer == "" {
		claimer = caller // a human claiming as themselves
	} else if caller != p.ownerOf(claimer) && !p.isSysadmin(caller) {
		http.Error(w, "not your agent to claim with", http.StatusForbidden)
		return
	}
	t.Status = "claimed"
	t.ClaimedBy = claimer
	if err := p.putTask(t); err != nil {
		http.Error(w, "store failed", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, t)
}

// POST /tasks/{id}/status {status} — open|claimed|done. The claimer, creator, or an Operator.
func (p *Plugin) handleTaskStatus(w http.ResponseWriter, r *http.Request) {
	caller := r.Header.Get("Mattermost-User-ID")
	t, ok := p.getTask(mux.Vars(r)["id"])
	if !ok {
		http.Error(w, "task not found", http.StatusNotFound)
		return
	}
	if caller != t.CreatedBy && caller != t.ClaimedBy && caller != p.ownerOf(t.ClaimedBy) && !p.isSysadmin(caller) {
		http.Error(w, "not allowed to update this task", http.StatusForbidden)
		return
	}
	var in struct {
		Status string `json:"status"`
	}
	body, _ := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<12))
	_ = json.Unmarshal(body, &in)
	switch in.Status {
	case "open":
		t.Status, t.ClaimedBy = "open", ""
	case "claimed", "done":
		t.Status = in.Status
	default:
		http.Error(w, "status must be open|claimed|done", http.StatusBadRequest)
		return
	}
	if err := p.putTask(t); err != nil {
		http.Error(w, "store failed", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, t)
}

func (p *Plugin) handleDeleteTask(w http.ResponseWriter, r *http.Request) {
	caller := r.Header.Get("Mattermost-User-ID")
	t, ok := p.getTask(mux.Vars(r)["id"])
	if !ok {
		http.Error(w, "task not found", http.StatusNotFound)
		return
	}
	if caller != t.CreatedBy && !p.isSysadmin(caller) {
		http.Error(w, "creator or operator only", http.StatusForbidden)
		return
	}
	if err := p.client.KV.Delete(taskPrefix + t.ID); err != nil {
		http.Error(w, "delete failed", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
