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

// Codespaces: shared, browsable/editable code trees (0..* per project). Stored in the
// plugin KV — one entry per file — with hard caps so many codespaces can't exhaust
// storage ("don't crash the system").

const csPrefix = "cs_"          // cs_<id> = codespace metadata
const csFilePrefix = "csfile_"  // csfile_<csID>::<path> = file content (bytes)
const maxFileBytes = 256 * 1024 // per file
const maxCodespaces = 50        // total
const maxFilesPerCs = 500       // per codespace

type codespace struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	CreatedAt int64  `json:"created_at"`
	// Host-backed codespaces point at a real folder/git repo served by a connector.
	// (Legacy codespaces with an empty HostUserID are the old KV-only scratch kind.)
	HostUserID string `json:"host_user_id,omitempty"` // connector bot that serves the files
	Root       string `json:"root,omitempty"`         // absolute path on that host
	Source     string `json:"source,omitempty"`       // local | git | ssh
	SSHTarget  string `json:"ssh_target,omitempty"`   // user@host for source=ssh
	CreatedBy  string `json:"created_by,omitempty"`   // mm user id of the creator
}

// ownerOf returns the human (mm user id) linked to a connector bot, per pairing.
func (p *Plugin) ownerOf(botUserID string) string {
	var raw []byte
	if p.client.KV.Get(ownerPrefix+botUserID, &raw) == nil {
		return string(raw)
	}
	return ""
}

func (p *Plugin) isSysadmin(userID string) bool {
	return p.client.User.HasPermissionTo(userID, model.PermissionManageSystem)
}

// mayUseCodespace: the creator, the host's owner, or a sysadmin. (Legacy KV codespaces
// with no host/creator stay open — they hold no machine access.)
func (p *Plugin) mayUseCodespace(userID string, cs codespace) bool {
	if cs.HostUserID == "" {
		return true
	}
	return userID != "" && (userID == cs.CreatedBy || userID == p.ownerOf(cs.HostUserID) || p.isSysadmin(userID))
}

func (p *Plugin) getCodespace(id string) (codespace, bool) {
	var raw []byte
	var cs codespace
	if err := p.client.KV.Get(csPrefix+id, &raw); err != nil || raw == nil {
		return cs, false
	}
	if json.Unmarshal(raw, &cs) != nil {
		return cs, false
	}
	return cs, true
}

func csFileKeyPrefix(csID string) string { return csFilePrefix + csID + "::" }
func csFileKey(csID, path string) string { return csFileKeyPrefix(csID) + path }

// validPath: a codespace file path must be non-empty, relative, bounded, and free of
// ".." segments. (Files are KV keys, not filesystem paths, so there's no real traversal —
// but we reject the shapes anyway to keep keys clean and predictable.)
func validPath(p string) bool {
	p = strings.TrimSpace(p)
	if p == "" || len(p) > 512 || strings.HasPrefix(p, "/") {
		return false
	}
	for _, seg := range strings.Split(p, "/") {
		if seg == ".." {
			return false
		}
	}
	return true
}

const wsChanPrefix = "wschan_" // wschan_<channelID> = the codespace id bound to that channel

func (p *Plugin) initCodespaceRoutes(api *mux.Router) {
	api.HandleFunc("/codespaces", p.handleListCodespaces).Methods(http.MethodGet)
	api.HandleFunc("/codespaces", p.handleCreateCodespace).Methods(http.MethodPost)
	api.HandleFunc("/codespaces/{id}", p.handleDeleteCodespace).Methods(http.MethodDelete)
	api.HandleFunc("/codespaces/{id}/files", p.handleListFiles).Methods(http.MethodGet)
	api.HandleFunc("/codespaces/{id}/file", p.handleGetFile).Methods(http.MethodGet)
	api.HandleFunc("/codespaces/{id}/file", p.handlePutFile).Methods(http.MethodPut)
	api.HandleFunc("/codespaces/{id}/file", p.handleDeleteFile).Methods(http.MethodDelete)
	// Per-codespace rules (protected paths, edit/commit/push authority, commit-message required).
	api.HandleFunc("/codespaces/{id}/rules", p.handleGetRules).Methods(http.MethodGet)
	api.HandleFunc("/codespaces/{id}/rules", p.handlePutRules).Methods(http.MethodPut)
	// Realtime doc hub (the live, Google-Docs layer): catch-up, CRDT update relay, presence, autosave.
	api.HandleFunc("/codespace/doc/open", p.handleDocOpen).Methods(http.MethodPost)
	api.HandleFunc("/codespace/doc/update", p.handleDocUpdate).Methods(http.MethodPost)
	api.HandleFunc("/codespace/doc/awareness", p.handleDocAwareness).Methods(http.MethodPost)
	api.HandleFunc("/codespace/doc/flush", p.handleDocFlush).Methods(http.MethodPost)
	// Codespace-wide presence: who is viewing which file (drives the file-tree highlights).
	api.HandleFunc("/codespace/presence", p.handleDocPresence).Methods(http.MethodPost)
	// Terminal: per-member shell, serialized + jailed + gated + audited.
	api.HandleFunc("/codespace/term", p.handleTerm).Methods(http.MethodPost)
	api.HandleFunc("/codespaces/{id}/audit", p.handleTermAudit).Methods(http.MethodGet)
	// Activity feed: who did what (save/commit/push/file ops), when.
	api.HandleFunc("/codespaces/{id}/activity", p.handleActivity).Methods(http.MethodGet)
	// Inline code comments (Google-Docs style on a line), posted to chat for @mentions.
	api.HandleFunc("/codespace/comments", p.handleAddComment).Methods(http.MethodPost)
	api.HandleFunc("/codespace/comments", p.handleListComments).Methods(http.MethodGet)
	api.HandleFunc("/codespace/comments/{id}/resolve", p.handleResolveComment).Methods(http.MethodPost)
	// Workspace = a channel bound to a codespace (where this channel's agent writes code).
	api.HandleFunc("/workspace", p.handleBindWorkspace).Methods(http.MethodPost)
	api.HandleFunc("/workspace", p.handleGetWorkspace).Methods(http.MethodGet)
	// Agent/project binding: one consolidated codespace per agent, channel-independent.
	// The agent writes into THIS codespace (its project/task), not "whichever channel it's in".
	api.HandleFunc("/agent/codespace", p.handleGetAgentCodespace).Methods(http.MethodGet)
	api.HandleFunc("/agent/codespace", p.handleSetAgentCodespace).Methods(http.MethodPost)
	// Host-backed codespace: relay fs/git ops to the connector that serves the files.
	api.HandleFunc("/codespace/op", p.handleCodespaceOp).Methods(http.MethodPost)
	api.HandleFunc("/codespace/op/response", p.handleCodespaceOpResponse).Methods(http.MethodPost)
}

// POST /workspace {channel_id, codespace_id} — bind a codespace to a channel.
func (p *Plugin) handleBindWorkspace(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ChannelID   string `json:"channel_id"`
		CodespaceID string `json:"codespace_id"`
	}
	body, _ := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<16))
	if json.Unmarshal(body, &in); in.ChannelID == "" || in.CodespaceID == "" {
		http.Error(w, "channel_id and codespace_id required", http.StatusBadRequest)
		return
	}
	// Only someone who can post in the channel may bind it (don't trust the client's
	// channel_id — a non-member could otherwise repoint another channel's workspace).
	userID := r.Header.Get("Mattermost-User-ID")
	if !p.client.User.HasPermissionToChannel(userID, in.ChannelID, model.PermissionCreatePost) {
		http.Error(w, "not a member of that channel", http.StatusForbidden)
		return
	}
	cs, ok := p.getCodespace(in.CodespaceID)
	if !ok {
		http.Error(w, "codespace not found", http.StatusNotFound)
		return
	}
	if !p.mayUseCodespace(userID, cs) { // can't bind a codespace you're not allowed to use
		http.Error(w, "not allowed to use that codespace", http.StatusForbidden)
		return
	}
	if _, err := p.client.KV.Set(wsChanPrefix+in.ChannelID, []byte(in.CodespaceID)); err != nil {
		http.Error(w, "store failed", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// GET /workspace?channel=<id> — the codespace bound to a channel (connector + panel read this).
func (p *Plugin) handleGetWorkspace(w http.ResponseWriter, r *http.Request) {
	var idRaw []byte
	_ = p.client.KV.Get(wsChanPrefix+r.URL.Query().Get("channel"), &idRaw)
	csID := string(idRaw)
	name := ""
	if csID != "" {
		var csRaw []byte
		if p.client.KV.Get(csPrefix+csID, &csRaw) == nil && csRaw != nil {
			var cs codespace
			_ = json.Unmarshal(csRaw, &cs)
			name = cs.Name
		}
	}
	writeJSON(w, http.StatusOK, map[string]string{"codespace_id": csID, "name": name})
}

const agentCsPrefix = "agentcs_" // agentcs_<botID> = the codespace id this agent writes into

// GET /agent/codespace[?bot=<id>] — the codespace bound to an agent (its project), channel-independent.
// The connector calls this authenticated AS the bot (no ?bot needed) to learn where to write code.
func (p *Plugin) handleGetAgentCodespace(w http.ResponseWriter, r *http.Request) {
	caller := r.Header.Get("Mattermost-User-ID")
	botID := r.URL.Query().Get("bot")
	if botID == "" {
		botID = caller // connector authenticates as its own bot
	}
	var raw []byte
	_ = p.client.KV.Get(agentCsPrefix+botID, &raw)
	csID := string(raw)
	name := ""
	if cs, ok := p.getCodespace(csID); ok {
		name = cs.Name
	}
	writeJSON(w, http.StatusOK, map[string]string{"codespace_id": csID, "name": name})
}

// POST /agent/codespace {bot_user_id, codespace_id} — bind an agent to its consolidated codespace.
// The agent's owner or an Operator sets this. codespace_id "" unbinds.
func (p *Plugin) handleSetAgentCodespace(w http.ResponseWriter, r *http.Request) {
	caller := r.Header.Get("Mattermost-User-ID")
	var in struct {
		BotUserID   string `json:"bot_user_id"`
		CodespaceID string `json:"codespace_id"`
	}
	body, _ := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<14))
	if json.Unmarshal(body, &in) != nil || in.BotUserID == "" {
		http.Error(w, "bot_user_id required", http.StatusBadRequest)
		return
	}
	if caller != p.ownerOf(in.BotUserID) && !p.isSysadmin(caller) {
		http.Error(w, "not your agent", http.StatusForbidden)
		return
	}
	if in.CodespaceID == "" {
		_ = p.client.KV.Delete(agentCsPrefix + in.BotUserID)
		writeJSON(w, http.StatusOK, map[string]string{"codespace_id": ""})
		return
	}
	cs, ok := p.getCodespace(in.CodespaceID)
	if !ok {
		http.Error(w, "codespace not found", http.StatusNotFound)
		return
	}
	if !p.mayUseCodespace(caller, cs) {
		http.Error(w, "not allowed to use that codespace", http.StatusForbidden)
		return
	}
	if _, err := p.client.KV.Set(agentCsPrefix+in.BotUserID, []byte(in.CodespaceID)); err != nil {
		http.Error(w, "store failed", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"codespace_id": in.CodespaceID, "name": cs.Name})
}

func (p *Plugin) handleListCodespaces(w http.ResponseWriter, r *http.Request) {
	m, err := p.kvListByPrefix(csPrefix)
	if err != nil {
		http.Error(w, "list failed", http.StatusInternalServerError)
		return
	}
	out := []codespace{}
	for _, raw := range m {
		var cs codespace
		if json.Unmarshal(raw, &cs) == nil {
			out = append(out, cs)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt < out[j].CreatedAt })
	writeJSON(w, http.StatusOK, out)
}

func (p *Plugin) handleCreateCodespace(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name       string `json:"name"`
		HostUserID string `json:"host_user_id"`
		Root       string `json:"root"`
		Source     string `json:"source"`
		RepoURL    string `json:"repo_url"`
		SSHTarget  string `json:"ssh_target"`
	}
	body, _ := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<16))
	if json.Unmarshal(body, &in); strings.TrimSpace(in.Name) == "" {
		http.Error(w, "name required", http.StatusBadRequest)
		return
	}
	if m, err := p.kvListByPrefix(csPrefix); err == nil && len(m) >= maxCodespaces {
		http.Error(w, "codespace limit reached", http.StatusForbidden)
		return
	}
	userID := r.Header.Get("Mattermost-User-ID")
	// Gate: you can only put a codespace on a host you own (your own connector) — or be admin.
	if in.HostUserID != "" && userID != p.ownerOf(in.HostUserID) && !p.isSysadmin(userID) {
		http.Error(w, "you can only create a codespace on your own connected machine", http.StatusForbidden)
		return
	}
	cs := codespace{
		ID: model.NewId(), Name: strings.TrimSpace(in.Name), CreatedAt: model.GetMillis(),
		HostUserID: in.HostUserID, Root: strings.TrimSpace(in.Root), Source: in.Source,
		SSHTarget: strings.TrimSpace(in.SSHTarget), CreatedBy: userID,
	}
	// git source: the connector clones the repo and reports back the working dir.
	if in.Source == "git" {
		args := map[string]interface{}{"repo_url": in.RepoURL, "name": cs.ID}
		if in.SSHTarget != "" {
			args["ssh"] = in.SSHTarget
		}
		res, err := p.relayOp(in.HostUserID, "clone", args, 10*time.Minute)
		if err != nil {
			http.Error(w, "clone failed: "+err.Error(), http.StatusBadGateway)
			return
		}
		var cr struct {
			OK   bool   `json:"ok"`
			Root string `json:"root"`
			Out  string `json:"out"`
		}
		if json.Unmarshal(res, &cr); !cr.OK || cr.Root == "" {
			http.Error(w, "clone failed: "+cr.Out, http.StatusBadGateway)
			return
		}
		cs.Root = cr.Root
	}
	b, _ := json.Marshal(cs)
	if _, err := p.client.KV.Set(csPrefix+cs.ID, b); err != nil {
		http.Error(w, "store failed", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, cs)
}

func (p *Plugin) csExists(id string) bool {
	var raw []byte
	return p.client.KV.Get(csPrefix+id, &raw) == nil && raw != nil
}

func (p *Plugin) handleDeleteCodespace(w http.ResponseWriter, r *http.Request) {
	id := mux.Vars(r)["id"]
	if cs, ok := p.getCodespace(id); ok && !p.mayUseCodespace(r.Header.Get("Mattermost-User-ID"), cs) {
		http.Error(w, "not your codespace", http.StatusForbidden)
		return
	}
	files, err := p.kvListByPrefix(csFileKeyPrefix(id))
	if err != nil {
		http.Error(w, "list failed", http.StatusInternalServerError)
		return
	}
	for path := range files {
		if derr := p.client.KV.Delete(csFileKey(id, path)); derr != nil {
			http.Error(w, "delete failed", http.StatusInternalServerError)
			return
		}
	}
	if derr := p.client.KV.Delete(csPrefix + id); derr != nil {
		http.Error(w, "delete failed", http.StatusInternalServerError)
		return
	}
	// Clear any channel bindings that pointed at this codespace (no dangling workspace).
	for page := 0; ; page++ {
		keys, kerr := p.client.KV.ListKeys(page, 200)
		if kerr != nil || len(keys) == 0 {
			break
		}
		for _, k := range keys {
			if !strings.HasPrefix(k, wsChanPrefix) {
				continue
			}
			var bound []byte
			if p.client.KV.Get(k, &bound) == nil && string(bound) == id {
				_ = p.client.KV.Delete(k)
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (p *Plugin) handleListFiles(w http.ResponseWriter, r *http.Request) {
	if !p.csExists(mux.Vars(r)["id"]) {
		http.Error(w, "codespace not found", http.StatusNotFound)
		return
	}
	m, err := p.kvListByPrefix(csFileKeyPrefix(mux.Vars(r)["id"]))
	if err != nil {
		http.Error(w, "list failed", http.StatusInternalServerError)
		return
	}
	paths := make([]string, 0, len(m))
	for path := range m {
		paths = append(paths, path)
	}
	sort.Strings(paths)
	writeJSON(w, http.StatusOK, paths)
}

func (p *Plugin) handleGetFile(w http.ResponseWriter, r *http.Request) {
	id := mux.Vars(r)["id"]
	path := r.URL.Query().Get("path")
	var raw []byte
	if err := p.client.KV.Get(csFileKey(id, path), &raw); err != nil || raw == nil {
		http.Error(w, "file not found", http.StatusNotFound)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"path": path, "content": string(raw)})
}

func (p *Plugin) handlePutFile(w http.ResponseWriter, r *http.Request) {
	id := mux.Vars(r)["id"]
	if !p.csExists(id) { // never create an orphan file tree under a missing codespace
		http.Error(w, "codespace not found", http.StatusNotFound)
		return
	}
	body, _ := io.ReadAll(http.MaxBytesReader(w, r.Body, maxFileBytes+4096))
	var in struct {
		Path    string `json:"path"`
		Content string `json:"content"`
	}
	if err := json.Unmarshal(body, &in); err != nil || !validPath(in.Path) {
		http.Error(w, "invalid path", http.StatusBadRequest)
		return
	}
	if len(in.Content) > maxFileBytes {
		http.Error(w, "file too large (max 256KB)", http.StatusRequestEntityTooLarge)
		return
	}
	// Enforce a per-codespace file cap (only when adding a NEW file).
	existing, _ := p.kvListByPrefix(csFileKeyPrefix(id))
	if _, isUpdate := existing[in.Path]; !isUpdate && len(existing) >= maxFilesPerCs {
		http.Error(w, "file limit reached for this codespace", http.StatusForbidden)
		return
	}
	if _, err := p.client.KV.Set(csFileKey(id, in.Path), []byte(in.Content)); err != nil {
		http.Error(w, "store failed", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (p *Plugin) handleDeleteFile(w http.ResponseWriter, r *http.Request) {
	id := mux.Vars(r)["id"]
	if err := p.client.KV.Delete(csFileKey(id, r.URL.Query().Get("path"))); err != nil {
		http.Error(w, "delete failed", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
