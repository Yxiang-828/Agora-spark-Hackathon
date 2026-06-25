package main

import (
	"encoding/json"
	"io"
	"net/http"
	"sort"
	"strings"

	"github.com/gorilla/mux"
	"github.com/mattermost/mattermost/server/public/model"
)

// Agent roles + authority core.
//
// A ROLE is a named, host-defined bundle of capability SCOPES plus an authority CEILING (tier).
// Any agent (bot) is assigned exactly one role; personal agents default to the built-in "Personal"
// role. Roles are the composable layer the host tunes ("set or not at their will").
//
// HARD INVARIANT — the cap rule: an agent's effective authority is min(role ceiling, owner's tier).
// An agent can NEVER outrank the human who owns it. Enforced server-side via agentCan / effectiveTier;
// the directory/skill layers stay the source of identity, this layer is the source of POWER.
//
// Grants are host/Operator-only (matches "server-specific, host-side"). Reads are open to any
// signed-in user so the People & Roles UI can render.

const (
	rolePrefix      = "role_"      // role_<roleID> = Role JSON
	agentRolePrefix = "agentrole_" // agentrole_<botID> = roleID (raw string)
)

// Capability scopes. A role grants a subset; agentCan checks membership.
const (
	ScopeCodespaceRead  = "codespace.read"
	ScopeCodespaceWrite = "codespace.write"
	ScopeGitCommit      = "git.commit"
	ScopeGitPush        = "git.push"
	ScopeChannelRun     = "channel.run"      // drive the channel's function (CICD, docs, …)
	ScopeChannelMod     = "channel.moderate" // admit/mute/assign within a channel
	ScopeChannelRoute   = "channel.route"    // route tasks to member agents
	ScopeChannelMemory  = "channel.memory"   // own channel memory + recaps
	ScopeSkillsAdd      = "skills.add"       // self-add project skills
	ScopeMembersManage  = "members.manage"   // server-wide member/role management
	ScopeOrchestrate    = "orchestrate"      // route work across the codespace
)

// AllScopes is the catalog the People & Roles permission matrix renders.
var AllScopes = []string{
	ScopeCodespaceRead, ScopeCodespaceWrite, ScopeGitCommit, ScopeGitPush,
	ScopeChannelRun, ScopeChannelMod, ScopeChannelRoute, ScopeChannelMemory,
	ScopeSkillsAdd, ScopeMembersManage, ScopeOrchestrate,
}

// Agent classes.
const (
	ClassPersonal     = "personal"
	ClassGameMaster   = "gm"
	ClassOrchestrator = "orchestrator"
	ClassCustom       = "custom"
)

type Role struct {
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	Color   string   `json:"color"`   // hex, for the Discord-like roster pills
	Class   string   `json:"class"`   // personal | gm | orchestrator | custom
	Tier    string   `json:"tier"`    // authority CEILING: operator|lead|member|guest
	Scopes  []string `json:"scopes"`  // granted capability scopes
	Builtin bool     `json:"builtin"` // built-ins can't be deleted, only re-scoped
}

// builtinRoles are seeded on first use; the host re-tunes them but can't delete them.
func builtinRoles() []Role {
	return []Role{
		{ID: "personal", Name: "Personal", Color: "#61AFEF", Class: ClassPersonal, Tier: "member", Builtin: true,
			Scopes: []string{ScopeCodespaceRead, ScopeCodespaceWrite, ScopeGitCommit, ScopeSkillsAdd}},
		{ID: "gm", Name: "Game Master", Color: "#C678DD", Class: ClassGameMaster, Tier: "lead", Builtin: true,
			Scopes: []string{ScopeChannelRun, ScopeChannelMod, ScopeChannelRoute, ScopeChannelMemory, ScopeCodespaceRead}},
		{ID: "orchestrator", Name: "Orchestrator", Color: "#E5C07B", Class: ClassOrchestrator, Tier: "lead", Builtin: true,
			Scopes: []string{ScopeOrchestrate, ScopeCodespaceRead}},
	}
}

func (p *Plugin) ensureBuiltinRoles() {
	for _, r := range builtinRoles() {
		var raw []byte
		if p.client.KV.Get(rolePrefix+r.ID, &raw) == nil && len(raw) > 0 {
			continue // already present (possibly re-tuned by the host) — don't clobber
		}
		if out, err := json.Marshal(r); err == nil {
			_, _ = p.client.KV.Set(rolePrefix+r.ID, out)
		}
	}
}

// userTier is the general (codespace-independent) authority of a human: sysadmin => Operator,
// otherwise mapped from Mattermost roles. Fail closed to Guest for unknown users.
func (p *Plugin) userTier(userID string) tier {
	if userID == "" {
		return tierGuest
	}
	if p.isSysadmin(userID) {
		return tierOperator
	}
	u, err := p.client.User.Get(userID)
	if err != nil || u == nil {
		return tierGuest
	}
	return tierFromRoles(u.Roles)
}

func (p *Plugin) getRole(id string) (Role, bool) {
	var raw []byte
	if id == "" || p.client.KV.Get(rolePrefix+id, &raw) != nil || len(raw) == 0 {
		return Role{}, false
	}
	var r Role
	if json.Unmarshal(raw, &r) != nil {
		return Role{}, false
	}
	return r, true
}

func (p *Plugin) listRoles() []Role {
	p.ensureBuiltinRoles()
	out := []Role{}
	for page := 0; ; page++ {
		keys, err := p.client.KV.ListKeys(page, 200)
		if err != nil || len(keys) == 0 {
			break
		}
		for _, k := range keys {
			if !strings.HasPrefix(k, rolePrefix) {
				continue
			}
			if r, ok := p.getRole(strings.TrimPrefix(k, rolePrefix)); ok {
				out = append(out, r)
			}
		}
	}
	sort.Slice(out, func(i, j int) bool { return parseTier(out[i].Tier) > parseTier(out[j].Tier) })
	return out
}

// roleOfAgent returns the role assigned to a bot, defaulting to the Personal built-in.
func (p *Plugin) roleOfAgent(botID string) Role {
	var raw []byte
	if p.client.KV.Get(agentRolePrefix+botID, &raw) == nil && len(raw) > 0 {
		if r, ok := p.getRole(string(raw)); ok {
			return r
		}
	}
	p.ensureBuiltinRoles()
	r, _ := p.getRole("personal")
	return r
}

// effectiveTier enforces the cap rule: an agent acts at min(role ceiling, owner's tier).
func (p *Plugin) effectiveTier(botID string) tier {
	role := p.roleOfAgent(botID)
	ceiling := parseTier(role.Tier)
	ownerT := p.userTier(p.ownerOf(botID))
	if ownerT < ceiling {
		return ownerT
	}
	return ceiling
}

// agentCan is the single authorization gate for agent actions: the role must grant the scope,
// AND the agent's capped effective tier must be at least Member (a guest-owned agent can't act).
func (p *Plugin) agentCan(botID, scope string) bool {
	if p.effectiveTier(botID) < tierMember {
		return false
	}
	for _, s := range p.roleOfAgent(botID).Scopes {
		if s == scope {
			return true
		}
	}
	return false
}

// --- routes ---

func (p *Plugin) initRoleRoutes(api *mux.Router) {
	api.HandleFunc("/roles", p.handleListRoles).Methods(http.MethodGet)
	api.HandleFunc("/roles", p.handleSaveRole).Methods(http.MethodPost)
	api.HandleFunc("/roles/{id}", p.handleDeleteRole).Methods(http.MethodDelete)
	api.HandleFunc("/agents/{id}/role", p.handleGetAgentRole).Methods(http.MethodGet)
	api.HandleFunc("/agents/{id}/role", p.handleSetAgentRole).Methods(http.MethodPost)
	api.HandleFunc("/scopes", p.handleListScopes).Methods(http.MethodGet)
}

func (p *Plugin) handleListScopes(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, AllScopes)
}

func (p *Plugin) handleListRoles(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, p.listRoles())
}

// handleSaveRole creates or re-tunes a role. Operator-only (host controls authority). Built-ins
// may be re-scoped but keep their id/class/builtin flag.
func (p *Plugin) handleSaveRole(w http.ResponseWriter, r *http.Request) {
	if !p.isSysadmin(r.Header.Get("Mattermost-User-ID")) {
		http.Error(w, "operator only", http.StatusForbidden)
		return
	}
	body, _ := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<14))
	var in Role
	if json.Unmarshal(body, &in) != nil || strings.TrimSpace(in.Name) == "" {
		http.Error(w, "invalid role", http.StatusBadRequest)
		return
	}
	if existing, ok := p.getRole(in.ID); ok && existing.Builtin {
		// preserve identity of a built-in; only scopes/color/tier/name are tunable
		in.ID, in.Class, in.Builtin = existing.ID, existing.Class, true
	} else if in.ID == "" {
		in.ID = model.NewId()
		in.Builtin = false
		if in.Class == "" {
			in.Class = ClassCustom
		}
	}
	in.Scopes = filterScopes(in.Scopes)
	out, _ := json.Marshal(in)
	if _, err := p.client.KV.Set(rolePrefix+in.ID, out); err != nil {
		http.Error(w, "store failed", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, in)
}

func (p *Plugin) handleDeleteRole(w http.ResponseWriter, r *http.Request) {
	if !p.isSysadmin(r.Header.Get("Mattermost-User-ID")) {
		http.Error(w, "operator only", http.StatusForbidden)
		return
	}
	id := mux.Vars(r)["id"]
	if role, ok := p.getRole(id); !ok || role.Builtin {
		http.Error(w, "cannot delete (missing or built-in)", http.StatusBadRequest)
		return
	}
	if err := p.client.KV.Delete(rolePrefix + id); err != nil {
		http.Error(w, "delete failed", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

type agentRoleView struct {
	BotUserID     string   `json:"bot_user_id"`
	Role          Role     `json:"role"`
	EffectiveTier string   `json:"effective_tier"`
	Scopes        []string `json:"scopes"` // effective (role scopes; tier already capped)
}

func (p *Plugin) handleGetAgentRole(w http.ResponseWriter, r *http.Request) {
	botID := mux.Vars(r)["id"]
	role := p.roleOfAgent(botID)
	writeJSON(w, http.StatusOK, agentRoleView{
		BotUserID: botID, Role: role,
		EffectiveTier: tierName(p.effectiveTier(botID)), Scopes: role.Scopes,
	})
}

// handleSetAgentRole assigns a role to an agent. Operator-only — host grants authority.
func (p *Plugin) handleSetAgentRole(w http.ResponseWriter, r *http.Request) {
	if !p.isSysadmin(r.Header.Get("Mattermost-User-ID")) {
		http.Error(w, "operator only", http.StatusForbidden)
		return
	}
	botID := mux.Vars(r)["id"]
	var in struct {
		RoleID string `json:"role_id"`
	}
	body, _ := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<12))
	_ = json.Unmarshal(body, &in)
	if _, ok := p.getRole(in.RoleID); !ok {
		http.Error(w, "unknown role", http.StatusBadRequest)
		return
	}
	if _, err := p.client.KV.Set(agentRolePrefix+botID, []byte(in.RoleID)); err != nil {
		http.Error(w, "store failed", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, p.roleOfAgent(botID))
}

// filterScopes drops anything not in the known catalog (no silent privilege via typo'd scope).
func filterScopes(in []string) []string {
	known := map[string]bool{}
	for _, s := range AllScopes {
		known[s] = true
	}
	out := []string{}
	for _, s := range in {
		if known[s] {
			out = append(out, s)
		}
	}
	return out
}
