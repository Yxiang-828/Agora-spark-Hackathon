package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/gorilla/mux"
	"github.com/mattermost/mattermost/server/public/model"
)

// Inline code comments — Google-Docs-style notes anchored to a file + line, threaded into the
// codespace and posted to the bound channel so @mentions in the text notify people in chat.

const (
	csCommentsPrefix = "cscomments_" // cscomments_<csID> = JSON []comment
	maxComments      = 2000
)

type comment struct {
	ID       string `json:"id"`
	Path     string `json:"path"`
	Line     int    `json:"line"` // 1-based line the comment is anchored to
	Snippet  string `json:"snippet"`
	AuthorID string `json:"author_id"`
	Author   string `json:"author"`
	Text     string `json:"text"`
	Resolved bool   `json:"resolved"`
	At       int64  `json:"at"`
}

func (p *Plugin) loadComments(csID string) []comment {
	var raw []byte
	var cs []comment
	if p.client.KV.Get(csCommentsPrefix+csID, &raw) == nil && len(raw) > 0 {
		_ = json.Unmarshal(raw, &cs)
	}
	return cs
}

func (p *Plugin) saveComments(csID string, cs []comment) {
	if len(cs) > maxComments {
		cs = cs[len(cs)-maxComments:]
	}
	b, _ := json.Marshal(cs)
	_, _ = p.client.KV.Set(csCommentsPrefix+csID, b)
	p.API.PublishWebSocketEvent("cs_comments", map[string]interface{}{"codespace_id": csID}, &model.WebsocketBroadcast{})
}

// POST /codespace/comments {codespace_id, channel_id, path, line, snippet, text}
func (p *Plugin) handleAddComment(w http.ResponseWriter, r *http.Request) {
	var in struct {
		CodespaceID string `json:"codespace_id"`
		ChannelID   string `json:"channel_id"`
		Path        string `json:"path"`
		Line        int    `json:"line"`
		Snippet     string `json:"snippet"`
		Text        string `json:"text"`
	}
	body, _ := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<16))
	if json.Unmarshal(body, &in); in.CodespaceID == "" || in.Text == "" {
		http.Error(w, "codespace_id and text required", http.StatusBadRequest)
		return
	}
	cs, ok := p.getCodespace(in.CodespaceID)
	if !ok {
		http.Error(w, "codespace not found", http.StatusNotFound)
		return
	}
	userID := r.Header.Get("Mattermost-User-ID")
	if !p.mayParticipate(userID, cs, in.ChannelID) {
		http.Error(w, "not allowed in this codespace", http.StatusForbidden)
		return
	}
	c := comment{
		ID: model.NewId(), Path: in.Path, Line: in.Line, Snippet: in.Snippet,
		AuthorID: userID, Author: p.displayName(userID), Text: in.Text, At: time.Now().UnixMilli(),
	}
	p.saveComments(cs.ID, append(p.loadComments(cs.ID), c))
	p.recordActivity(cs.ID, userID, "comment", fmt.Sprintf("%s:%d", in.Path, in.Line))

	// Post to the bound channel so @mentions in the comment notify people in chat, with a reference
	// back to the exact spot. Posted as the author so it reads naturally in the thread.
	if in.ChannelID != "" {
		msg := fmt.Sprintf("💬 commented on `%s` line %d (codespace **%s**):\n> %s", in.Path, in.Line, cs.Name, in.Text)
		_ = p.client.Post.CreatePost(&model.Post{ChannelId: in.ChannelID, UserId: userID, Message: msg})
	}
	writeJSON(w, http.StatusOK, c)
}

// GET /codespace/comments?codespace=<id>&channel=<id> — all comments for a codespace.
func (p *Plugin) handleListComments(w http.ResponseWriter, r *http.Request) {
	cs, ok := p.getCodespace(r.URL.Query().Get("codespace"))
	if !ok {
		http.Error(w, "codespace not found", http.StatusNotFound)
		return
	}
	if !p.mayParticipate(r.Header.Get("Mattermost-User-ID"), cs, r.URL.Query().Get("channel")) {
		http.Error(w, "not allowed in this codespace", http.StatusForbidden)
		return
	}
	writeJSON(w, http.StatusOK, p.loadComments(cs.ID))
}

// POST /codespace/comments/{id}/resolve {codespace_id, channel_id} — toggle resolved.
func (p *Plugin) handleResolveComment(w http.ResponseWriter, r *http.Request) {
	var in struct {
		CodespaceID string `json:"codespace_id"`
		ChannelID   string `json:"channel_id"`
	}
	body, _ := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<14))
	_ = json.Unmarshal(body, &in)
	cs, ok := p.getCodespace(in.CodespaceID)
	if !ok {
		http.Error(w, "codespace not found", http.StatusNotFound)
		return
	}
	if !p.mayParticipate(r.Header.Get("Mattermost-User-ID"), cs, in.ChannelID) {
		http.Error(w, "not allowed in this codespace", http.StatusForbidden)
		return
	}
	id := mux.Vars(r)["id"]
	list := p.loadComments(cs.ID)
	for i := range list {
		if list[i].ID == id {
			list[i].Resolved = !list[i].Resolved
		}
	}
	p.saveComments(cs.ID, list)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
