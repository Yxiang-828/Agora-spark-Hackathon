package main

import (
	"encoding/json"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/mattermost/mattermost/server/public/model"
)

// Realtime doc hub — the live layer that sits ON TOP of host-backed git.
//
// The plugin is the only always-on shared piece, so it is the hub. It is deliberately a *dumb
// relay + opaque store* of Yjs (CRDT) updates: it never parses the CRDT bytes. Yjs updates are
// commutative and idempotent, so forwarding every update to the other peers and keeping the log
// for late joiners is correct without any server-side merge (this is how y-websocket works).
//
// What the hub DOES own: access control (rules enforced server-side, clients can't bypass),
// the durable store of doc state, seed election (so a fresh file is initialised from disk
// exactly once), and the debounced flush of live text back to the real file on disk.
//
// Single-node assumption: like the existing relay bridge (codespace_fs.go), the per-doc lock is
// in-process. A clustered deployment would need a distributed lock for append serialisation;
// that's out of scope here and matches the rest of the codespace code.

const csDocPrefix = "csdoc_" // csdoc_<csID>::<path> = JSON docRecord

const (
	maxDocUpdates   = 5000             // appended updates before a compaction (flush) is required
	maxDocBytes     = 8 * 1024 * 1024  // total stored update bytes per doc
	maxFlushBytes   = maxFileBytes     // a flushed file body is capped like any codespace file
	docFlushTimeout = 30 * time.Second // relaying the write to the host
)

func docKey(csID, p string) string { return csDocPrefix + csID + "::" + p }

// docRecord is the opaque, durable state of one live document.
type docRecord struct {
	Seeded  bool     `json:"seeded"`  // has the initial disk content been pushed in?
	Updates []string `json:"updates"` // base64 Yjs updates; compacted to one on flush (replace)
}

// docHub holds one mutex per doc so concurrent appends to the same file serialise.
type docHub struct {
	mu    sync.Mutex
	locks map[string]*sync.Mutex
}

var hub = &docHub{locks: map[string]*sync.Mutex{}}

func (h *docHub) lock(key string) func() {
	h.mu.Lock()
	m := h.locks[key]
	if m == nil {
		m = &sync.Mutex{}
		h.locks[key] = m
	}
	h.mu.Unlock()
	m.Lock()
	return m.Unlock
}

func (p *Plugin) loadDoc(key string) (docRecord, bool) {
	var raw []byte
	if err := p.client.KV.Get(key, &raw); err != nil || len(raw) == 0 {
		return docRecord{Updates: []string{}}, false
	}
	var rec docRecord
	if json.Unmarshal(raw, &rec) != nil {
		return docRecord{Updates: []string{}}, false
	}
	if rec.Updates == nil {
		rec.Updates = []string{}
	}
	return rec, true
}

func (p *Plugin) saveDoc(key string, rec docRecord) error {
	b, _ := json.Marshal(rec)
	_, err := p.client.KV.Set(key, b)
	return err
}

func docBytes(rec docRecord) int {
	n := 0
	for _, u := range rec.Updates {
		n += len(u)
	}
	return n
}

// docCtx resolves + access-checks a host-backed codespace for a doc request. Returns the
// codespace, the actor's tier, and the request body, or writes the error response itself.
func (p *Plugin) docCtx(w http.ResponseWriter, r *http.Request, in interface{}) (codespace, tier, bool) {
	body, _ := io.ReadAll(http.MaxBytesReader(w, r.Body, maxFlushBytes+1<<16))
	if json.Unmarshal(body, in) != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return codespace{}, tierGuest, false
	}
	id := docCodespaceID(in)
	cs, ok := p.getCodespace(id)
	if !ok {
		http.Error(w, "codespace not found", http.StatusNotFound)
		return codespace{}, tierGuest, false
	}
	if cs.HostUserID == "" {
		http.Error(w, "not a host-backed codespace", http.StatusBadRequest)
		return codespace{}, tierGuest, false
	}
	userID := r.Header.Get("Mattermost-User-ID")
	if !p.mayParticipate(userID, cs, docChannelID(in)) {
		http.Error(w, "not allowed in this codespace", http.StatusForbidden)
		return codespace{}, tierGuest, false
	}
	return cs, p.tierOf(userID, cs), true
}

// the doc request bodies share these fields; docCodespaceID/docChannelID read them generically.
// channel_id is how a non-owner joins: the room verifies that channel is bound to the codespace
// and that the user is a member (see mayParticipate).
type docOpenReq struct {
	CodespaceID string `json:"codespace_id"`
	ChannelID   string `json:"channel_id"`
	Path        string `json:"path"`
}
type docUpdateReq struct {
	CodespaceID string `json:"codespace_id"`
	ChannelID   string `json:"channel_id"`
	Path        string `json:"path"`
	Update      string `json:"update"`  // base64 Yjs update
	Origin      string `json:"origin"`  // sender session id (echo suppression on clients)
	Replace     bool   `json:"replace"` // true = compacted full-state, resets the log
}
type docAwarenessReq struct {
	CodespaceID string `json:"codespace_id"`
	ChannelID   string `json:"channel_id"`
	Path        string `json:"path"`
	Update      string `json:"update"` // base64 Yjs awareness update (cursor/selection/identity)
	Origin      string `json:"origin"`
}
type docFlushReq struct {
	CodespaceID string `json:"codespace_id"`
	ChannelID   string `json:"channel_id"`
	Path        string `json:"path"`
	Content     string `json:"content"`
}
type docPresenceReq struct {
	CodespaceID string `json:"codespace_id"`
	ChannelID   string `json:"channel_id"`
	Path        string `json:"path"`  // the file this member is currently viewing ("" = none)
	Color       string `json:"color"` // cosmetic, the member's cursor color
	Gone        bool   `json:"gone"`  // they left the codespace
}

func docCodespaceID(in interface{}) string {
	switch v := in.(type) {
	case *docOpenReq:
		return v.CodespaceID
	case *docUpdateReq:
		return v.CodespaceID
	case *docAwarenessReq:
		return v.CodespaceID
	case *docFlushReq:
		return v.CodespaceID
	case *docPresenceReq:
		return v.CodespaceID
	}
	return ""
}

func docChannelID(in interface{}) string {
	switch v := in.(type) {
	case *docOpenReq:
		return v.ChannelID
	case *docUpdateReq:
		return v.ChannelID
	case *docAwarenessReq:
		return v.ChannelID
	case *docFlushReq:
		return v.ChannelID
	case *docPresenceReq:
		return v.ChannelID
	}
	return ""
}

// POST /codespace/presence {codespace_id, path, color, gone} — codespace-wide presence (who is
// viewing which file). Ephemeral, never stored. The server stamps the authenticated user id +
// display name so a client can't claim to be someone else.
func (p *Plugin) handleDocPresence(w http.ResponseWriter, r *http.Request) {
	var in docPresenceReq
	cs, _, ok := p.docCtx(w, r, &in)
	if !ok {
		return
	}
	userID := r.Header.Get("Mattermost-User-ID")
	name := userID
	if u, err := p.client.User.Get(userID); err == nil && u != nil {
		name = u.Username
	}
	p.API.PublishWebSocketEvent("cs_presence", map[string]interface{}{
		"codespace_id": cs.ID, "user_id": userID, "name": name, "color": in.Color, "path": in.Path, "gone": in.Gone,
	}, &model.WebsocketBroadcast{})
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// POST /codespace/doc/open {codespace_id, path} -> {role, updates}.
// Seed election: the first opener of a fresh file gets role "seed" and must push the initial
// disk content; everyone else gets role "join" + the stored updates to catch up.
func (p *Plugin) handleDocOpen(w http.ResponseWriter, r *http.Request) {
	var in docOpenReq
	cs, _, ok := p.docCtx(w, r, &in)
	if !ok {
		return
	}
	if !validPath(in.Path) {
		http.Error(w, "invalid path", http.StatusBadRequest)
		return
	}
	key := docKey(cs.ID, in.Path)
	unlock := hub.lock(key)
	defer unlock()

	rec, exists := p.loadDoc(key)
	role := "join"
	if !exists {
		role = "seed" // we created the record; this caller initialises from disk
		_ = p.saveDoc(key, docRecord{Seeded: false, Updates: []string{}})
		rec = docRecord{Updates: []string{}}
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"role": role, "updates": rec.Updates, "seeded": rec.Seeded})
}

// POST /codespace/doc/update {codespace_id, path, update, origin, replace} — append a Yjs
// update (or replace the log with a compacted state) and broadcast it to the other peers.
func (p *Plugin) handleDocUpdate(w http.ResponseWriter, r *http.Request) {
	var in docUpdateReq
	cs, actor, ok := p.docCtx(w, r, &in)
	if !ok {
		return
	}
	if !validPath(in.Path) || in.Update == "" {
		http.Error(w, "path and update required", http.StatusBadRequest)
		return
	}
	// Server-side edit gate — clients cannot bypass it.
	if rr := p.rulesFor(cs.ID).checkEdit(actor, in.Path); !rr.OK {
		writeJSON(w, http.StatusForbidden, rr)
		return
	}

	key := docKey(cs.ID, in.Path)
	unlock := hub.lock(key)
	rec, _ := p.loadDoc(key)
	if in.Replace {
		rec.Updates = []string{in.Update} // compaction: a full-state update replaces the log
	} else {
		if len(rec.Updates) >= maxDocUpdates || docBytes(rec)+len(in.Update) > maxDocBytes {
			unlock()
			writeJSON(w, http.StatusConflict, ruleResult{false, "live history is full — commit to compact it", "doc_too_large"})
			return
		}
		rec.Updates = append(rec.Updates, in.Update)
	}
	rec.Seeded = true
	err := p.saveDoc(key, rec)
	unlock()
	if err != nil {
		http.Error(w, "store failed", http.StatusInternalServerError)
		return
	}

	// Broadcast to the other viewers. The client echoes its own origin and ignores it.
	p.API.PublishWebSocketEvent("cs_doc_update", map[string]interface{}{
		"codespace_id": cs.ID, "path": in.Path, "update": in.Update, "origin": in.Origin,
	}, &model.WebsocketBroadcast{})
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// POST /codespace/doc/awareness {codespace_id, path, state, origin} — ephemeral presence /
// cursor relay. Never stored. The server stamps the authenticated user id so a client can't
// spoof another person's cursor identity.
func (p *Plugin) handleDocAwareness(w http.ResponseWriter, r *http.Request) {
	var in docAwarenessReq
	cs, _, ok := p.docCtx(w, r, &in)
	if !ok {
		return
	}
	p.API.PublishWebSocketEvent("cs_awareness", map[string]interface{}{
		"codespace_id": cs.ID, "path": in.Path, "update": in.Update,
		"origin": in.Origin, "user_id": r.Header.Get("Mattermost-User-ID"),
	}, &model.WebsocketBroadcast{})
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// POST /codespace/doc/flush {codespace_id, path, content} — the debounced auto-save. Disk
// mirrors the live doc: the converged text is written to the real file via the host connector,
// gated by the rules engine. Git commit/push stay separate and deliberate.
func (p *Plugin) handleDocFlush(w http.ResponseWriter, r *http.Request) {
	var in docFlushReq
	cs, actor, ok := p.docCtx(w, r, &in)
	if !ok {
		return
	}
	if !validPath(in.Path) {
		http.Error(w, "invalid path", http.StatusBadRequest)
		return
	}
	if len(in.Content) > maxFlushBytes {
		writeJSON(w, http.StatusRequestEntityTooLarge, ruleResult{false, "file too large to autosave (max 256KB)", "too_large"})
		return
	}
	if rr := p.rulesFor(cs.ID).checkEdit(actor, in.Path); !rr.OK {
		writeJSON(w, http.StatusForbidden, rr)
		return
	}
	args := map[string]interface{}{"root": cs.Root, "path": in.Path, "content": in.Content}
	if cs.Source == "ssh" {
		args["ssh"] = cs.SSHTarget
	}
	res, err := p.relayOp(cs.HostUserID, "write", args, docFlushTimeout)
	if err != nil {
		// Host offline / unreachable — surface it; the client keeps edits locally and shows a banner.
		writeJSON(w, http.StatusBadGateway, ruleResult{false, err.Error(), "host_offline"})
		return
	}
	var wr struct {
		Error string `json:"error"`
	}
	if json.Unmarshal(res, &wr); wr.Error != "" {
		writeJSON(w, http.StatusBadGateway, ruleResult{false, wr.Error, "write_failed"})
		return
	}
	// Record the save in the activity feed + mark this member a contributor (for commit co-authors).
	userID := r.Header.Get("Mattermost-User-ID")
	p.recordActivity(cs.ID, userID, "save", in.Path)
	p.addContributor(cs.ID, userID)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
