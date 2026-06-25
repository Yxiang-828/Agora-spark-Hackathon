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

// Codespace terminal — each member gets their own shell session (own working dir + scrollback)
// on the host, but command execution is SERIALIZED per codespace so two people can't run
// conflicting commands at once. Safety posture (see the design doc): commands run as the host
// user, cwd jailed to the codespace root, authority-gated by the rules engine, and every command
// is written to an append-only audit log. v1 is line-based batch (run to completion), not a live
// PTY.

const (
	csTermCwdPrefix = "csterm_"  // csterm_<csID>::<userID> = that member's cwd (relative to root)
	csAuditPrefix   = "csaudit_" // csaudit_<csID> = append-only command audit log (JSON)
	maxAuditEntries = 1000
	termTimeout     = 90 * time.Second
	aiTimeout       = 5 * time.Minute
)

// aiPrompt returns the prompt when a terminal command is an AI invocation ("ai <prompt>"), else "".
func aiPrompt(command string) string {
	c := strings.TrimSpace(command)
	if len(c) >= 3 && strings.EqualFold(c[:3], "ai ") {
		return strings.TrimSpace(c[3:])
	}
	return ""
}

func cwdKey(csID, userID string) string { return csTermCwdPrefix + csID + "::" + userID }

type auditEntry struct {
	UserID  string `json:"user_id"`
	Name    string `json:"name"`
	Command string `json:"command"`
	Exit    int    `json:"exit"`
	At      int64  `json:"at"`
}

func (p *Plugin) loadCwd(csID, userID string) string {
	var raw []byte
	if p.client.KV.Get(cwdKey(csID, userID), &raw) == nil && len(raw) > 0 {
		return string(raw)
	}
	return "" // root
}

func (p *Plugin) appendAudit(csID string, e auditEntry) {
	var raw []byte
	var log []auditEntry
	if p.client.KV.Get(csAuditPrefix+csID, &raw) == nil && len(raw) > 0 {
		_ = json.Unmarshal(raw, &log)
	}
	log = append(log, e)
	if len(log) > maxAuditEntries { // keep the most recent
		log = log[len(log)-maxAuditEntries:]
	}
	b, _ := json.Marshal(log)
	_, _ = p.client.KV.Set(csAuditPrefix+csID, b)
}

// termBusy broadcasts who is running what so every member sees the shared queue/serialization.
func (p *Plugin) termBusy(csID, userID, name, command, state string) {
	p.API.PublishWebSocketEvent("cs_term_busy", map[string]interface{}{
		"codespace_id": csID, "user_id": userID, "name": name, "command": command, "state": state,
	}, &model.WebsocketBroadcast{})
}

// termDone broadcasts a finished command WITH its (truncated) output, so every member's shared
// terminal feed can show what everyone ran and what came back.
func (p *Plugin) termDone(csID, userID, name, command, out string, exit int) {
	if len(out) > 8000 {
		out = out[:8000] + "\n…(truncated)"
	}
	p.API.PublishWebSocketEvent("cs_term_busy", map[string]interface{}{
		"codespace_id": csID, "user_id": userID, "name": name, "command": command, "state": "done", "out": out, "exit": exit,
	}, &model.WebsocketBroadcast{})
}

// POST /codespace/term {codespace_id, channel_id, command} — run one command in the member's
// session. Gated, serialized per codespace, jailed to root (host-side), and audited.
func (p *Plugin) handleTerm(w http.ResponseWriter, r *http.Request) {
	var in struct {
		CodespaceID string `json:"codespace_id"`
		ChannelID   string `json:"channel_id"`
		Command     string `json:"command"`
	}
	body, _ := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<16))
	if json.Unmarshal(body, &in); in.CodespaceID == "" {
		http.Error(w, "codespace_id required", http.StatusBadRequest)
		return
	}
	cs, ok := p.getCodespace(in.CodespaceID)
	if !ok {
		http.Error(w, "codespace not found", http.StatusNotFound)
		return
	}
	if cs.HostUserID == "" {
		http.Error(w, "not a host-backed codespace", http.StatusBadRequest)
		return
	}
	userID := r.Header.Get("Mattermost-User-ID")
	if !p.mayParticipate(userID, cs, in.ChannelID) {
		http.Error(w, "not allowed in this codespace", http.StatusForbidden)
		return
	}
	if rr := p.rulesFor(cs.ID).checkTerminal(p.tierOf(userID, cs)); !rr.OK {
		writeJSON(w, http.StatusForbidden, rr)
		return
	}
	name := userID
	if u, err := p.client.User.Get(userID); err == nil && u != nil {
		name = u.Username
	}
	command := strings.TrimSpace(in.Command)
	cwd := p.loadCwd(cs.ID, userID)

	// `ai <prompt>` runs the host's AI agent INSIDE the codespace (it can read/edit the files) and
	// returns its reply. AI calls are slow, so they DON'T hold the shell serialization lock; they
	// run concurrently with shell commands. Still broadcast + audited.
	if prompt := aiPrompt(command); prompt != "" {
		p.termBusy(cs.ID, userID, name, command, "running")
		args := map[string]interface{}{"root": cs.Root, "cwd": cwd, "prompt": prompt}
		res, err := p.relayOp(cs.HostUserID, "term_ai", args, aiTimeout)
		if err != nil {
			p.termDone(cs.ID, userID, name, command, err.Error(), 1)
			writeJSON(w, http.StatusBadGateway, ruleResult{false, err.Error(), "host_offline"})
			return
		}
		var ar struct {
			Out   string `json:"out"`
			Exit  int    `json:"exit"`
			Error string `json:"error"`
		}
		if json.Unmarshal(res, &ar); ar.Error != "" {
			p.termDone(cs.ID, userID, name, command, ar.Error, 1)
			writeJSON(w, http.StatusBadGateway, ruleResult{false, ar.Error, "ai_failed"})
			return
		}
		p.termDone(cs.ID, userID, name, command, ar.Out, ar.Exit)
		p.appendAudit(cs.ID, auditEntry{UserID: userID, Name: name, Command: command, Exit: ar.Exit, At: time.Now().UnixMilli()})
		writeJSON(w, http.StatusOK, map[string]interface{}{"out": ar.Out, "exit": ar.Exit, "cwd": cwd})
		return
	}

	// Serialize: one command at a time across the whole codespace. Others see "queued" then "running".
	p.termBusy(cs.ID, userID, name, command, "queued")
	unlock := hub.lock("term:" + cs.ID)
	p.termBusy(cs.ID, userID, name, command, "running")

	args := map[string]interface{}{"root": cs.Root, "cwd": cwd, "command": command}
	if cs.Source == "ssh" {
		args["ssh"] = cs.SSHTarget
	}
	res, err := p.relayOp(cs.HostUserID, "term_run", args, termTimeout)
	unlock() // release the codespace as soon as the command finishes; others can run now
	if err != nil {
		p.termDone(cs.ID, userID, name, command, err.Error(), 1)
		writeJSON(w, http.StatusBadGateway, ruleResult{false, err.Error(), "host_offline"})
		return
	}
	var tr struct {
		Out   string `json:"out"`
		Exit  int    `json:"exit"`
		Cwd   string `json:"cwd"`
		Error string `json:"error"`
	}
	if json.Unmarshal(res, &tr); tr.Error != "" {
		p.termDone(cs.ID, userID, name, command, tr.Error, 1)
		writeJSON(w, http.StatusBadGateway, ruleResult{false, tr.Error, "term_failed"})
		return
	}
	p.termDone(cs.ID, userID, name, command, tr.Out, tr.Exit) // shared feed: everyone sees the result
	// Persist the member's new working dir (cd) and audit the command.
	if _, err := p.client.KV.Set(cwdKey(cs.ID, userID), []byte(tr.Cwd)); err != nil {
		p.API.LogWarn("codespace term: failed to save cwd", "err", err)
	}
	if command != "" {
		p.appendAudit(cs.ID, auditEntry{UserID: userID, Name: name, Command: command, Exit: tr.Exit, At: time.Now().UnixMilli()})
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"out": tr.Out, "exit": tr.Exit, "cwd": tr.Cwd})
}

// GET /codespaces/{id}/audit — the command audit log (visibility; the audit agent reads this).
func (p *Plugin) handleTermAudit(w http.ResponseWriter, r *http.Request) {
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
	_ = p.client.KV.Get(csAuditPrefix+cs.ID, &raw)
	if len(raw) == 0 {
		raw = []byte("[]")
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(raw)
}
