package main

import (
	"encoding/json"
	"io"
	"net/http"
	"path"
	"strings"

	"github.com/gorilla/mux"
	"github.com/mattermost/mattermost/server/public/model"
)

// Codespace rules engine — "enforce proper usage." Every check is enforced SERVER-SIDE on the
// edit / commit / push path so a client can't bypass it, and every rejection carries a typed
// reason (no silent failures). The pure decision logic (globMatch, tierFromRoles, the check*
// methods) is unit-tested in codespace_rules_test.go.

const csRulesPrefix = "csrules_" // csrules_<codespaceID> = JSON codeRules

// authority tiers, ordered low -> high. Extends today's "approver = system_admin" into the
// documented Operator/Lead/Member/Guest scheme without disturbing the proposals gate.
type tier int

const (
	tierGuest tier = iota
	tierMember
	tierLead
	tierOperator
)

func tierName(t tier) string {
	switch t {
	case tierOperator:
		return "operator"
	case tierLead:
		return "lead"
	case tierMember:
		return "member"
	default:
		return "guest"
	}
}

// parseTier reads a rule's configured minimum tier. Unknown/blank => member (a sane default
// gate: a normal signed-in user may edit, but a guest may not).
func parseTier(s string) tier {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "operator":
		return tierOperator
	case "lead":
		return tierLead
	case "guest":
		return tierGuest
	default:
		return tierMember
	}
}

// tierFromRoles maps a Mattermost role string to an Agora authority tier. Pure -> unit-tested.
func tierFromRoles(roles string) tier {
	switch {
	case strings.Contains(roles, model.SystemAdminRoleId):
		return tierOperator
	case strings.Contains(roles, "team_admin") || strings.Contains(roles, "system_manager"):
		return tierLead
	case strings.Contains(roles, model.SystemGuestRoleId):
		return tierGuest
	default:
		return tierMember
	}
}

type codeRules struct {
	Protected            []string `json:"protected"`              // globs the room may not edit/commit
	EditTier             string   `json:"edit_tier,omitempty"`    // min tier to edit (default member)
	CommitTier           string   `json:"commit_tier,omitempty"`  // min tier to commit (default member)
	PushTier             string   `json:"push_tier,omitempty"`    // min tier to push (default lead)
	TermTier             string   `json:"term_tier,omitempty"`    // min tier to use the terminal (default member)
	RequireCommitMessage bool     `json:"require_commit_message"` // reject empty commit messages
}

func defaultRules() codeRules {
	return codeRules{
		Protected:            []string{".git/**"},
		EditTier:             "member",
		CommitTier:           "member",
		PushTier:             "lead",
		TermTier:             "member",
		RequireCommitMessage: true,
	}
}

// checkTerminal gates who may run commands in the codespace terminal.
func (rs codeRules) checkTerminal(actor tier) ruleResult {
	if want := parseTier(rs.TermTier); actor < want {
		return ruleResult{false, "the terminal needs " + tierName(want) + " — you are " + tierName(actor), "tier_too_low"}
	}
	return ruleResult{OK: true}
}

// ensureGitProtected guarantees `.git/**` is always protected — the room never edits git
// internals, whatever else a lead configures.
func ensureGitProtected(globs []string) []string {
	for _, g := range globs {
		if g == ".git/**" {
			return globs
		}
	}
	return append([]string{".git/**"}, globs...)
}

// globMatch reports whether path p matches a glob with '*'/'?' (within a segment) and '**'
// (zero or more whole segments, crossing '/'). Pure -> unit-tested.
func globMatch(pattern, p string) bool {
	pattern = strings.TrimPrefix(pattern, "./")
	p = strings.TrimPrefix(strings.ReplaceAll(p, "\\", "/"), "./")
	return matchSeg(strings.Split(pattern, "/"), strings.Split(p, "/"))
}

func matchSeg(pat, name []string) bool {
	if len(pat) == 0 {
		return len(name) == 0
	}
	if pat[0] == "**" {
		for i := 0; i <= len(name); i++ { // ** matches zero or more segments
			if matchSeg(pat[1:], name[i:]) {
				return true
			}
		}
		return false
	}
	if len(name) == 0 {
		return false
	}
	if ok, _ := path.Match(pat[0], name[0]); !ok {
		return false
	}
	return matchSeg(pat[1:], name[1:])
}

// ruleResult is the typed outcome of a rule check — OK, or a clear reason + a machine code.
type ruleResult struct {
	OK     bool   `json:"ok"`
	Reason string `json:"reason,omitempty"`
	Code   string `json:"code,omitempty"` // forbidden_path | tier_too_low | message_required
}

func (rs codeRules) checkPath(p string) ruleResult {
	for _, g := range rs.Protected {
		if globMatch(g, p) {
			return ruleResult{false, "“" + p + "” is a protected path (rule: " + g + ")", "forbidden_path"}
		}
	}
	return ruleResult{OK: true}
}

func (rs codeRules) checkEdit(actor tier, p string) ruleResult {
	if r := rs.checkPath(p); !r.OK {
		return r
	}
	if want := parseTier(rs.EditTier); actor < want {
		return ruleResult{false, "editing needs " + tierName(want) + " — you are " + tierName(actor), "tier_too_low"}
	}
	return ruleResult{OK: true}
}

func (rs codeRules) checkCommit(actor tier, message string) ruleResult {
	if rs.RequireCommitMessage && strings.TrimSpace(message) == "" {
		return ruleResult{false, "a commit message is required", "message_required"}
	}
	if want := parseTier(rs.CommitTier); actor < want {
		return ruleResult{false, "committing needs " + tierName(want) + " — you are " + tierName(actor), "tier_too_low"}
	}
	return ruleResult{OK: true}
}

func (rs codeRules) checkPush(actor tier) ruleResult {
	if want := parseTier(rs.PushTier); actor < want {
		return ruleResult{false, "pushing needs " + tierName(want) + " — you are " + tierName(actor), "tier_too_low"}
	}
	return ruleResult{OK: true}
}

// --- plugin wiring ---

func (p *Plugin) rulesFor(csID string) codeRules {
	var raw []byte
	if err := p.client.KV.Get(csRulesPrefix+csID, &raw); err == nil && len(raw) > 0 {
		var rs codeRules
		if json.Unmarshal(raw, &rs) == nil {
			rs.Protected = ensureGitProtected(rs.Protected)
			return rs
		}
	}
	return defaultRules()
}

// tierOf resolves a user's authority FOR THIS codespace. The creator and the host's owner own
// the machine, so they're operators over it; everyone else is mapped from their roles. Fail
// closed: an unknown user is a guest.
func (p *Plugin) tierOf(userID string, cs codespace) tier {
	if userID != "" && (userID == cs.CreatedBy || (cs.HostUserID != "" && userID == p.ownerOf(cs.HostUserID)) || p.isSysadmin(userID)) {
		return tierOperator
	}
	u, err := p.client.User.Get(userID)
	if err != nil || u == nil {
		return tierGuest
	}
	return tierFromRoles(u.Roles)
}

// mayParticipate decides who can take part in a SHARED codespace (browse/edit/commit live).
// Beyond the owner-level access of mayUseCodespace, anyone who is a member of a channel the
// codespace is bound to may join — that's what makes "several people edit the same file"
// possible. What each participant may actually DO is then gated by the rules engine (tiers).
func (p *Plugin) mayParticipate(userID string, cs codespace, channelID string) bool {
	if p.mayUseCodespace(userID, cs) {
		return true
	}
	if channelID == "" {
		return false
	}
	// The channel must actually be bound to THIS codespace (don't trust a client-supplied id),
	// and the user must be a member of it.
	var bound []byte
	if p.client.KV.Get(wsChanPrefix+channelID, &bound) != nil || string(bound) != cs.ID {
		return false
	}
	return p.client.User.HasPermissionToChannel(userID, channelID, model.PermissionCreatePost)
}

// gateOp applies the rules engine to one relayed op. Read-only ops (tree/read/status) run
// freely; mutating ops are tier- and path-gated with a typed reason.
func (p *Plugin) gateOp(userID string, cs codespace, op string, args map[string]interface{}) ruleResult {
	rs := p.rulesFor(cs.ID)
	actor := p.tierOf(userID, cs)
	argStr := func(k string) string { s, _ := args[k].(string); return s }
	switch op {
	case "write", "mkdir", "delete", "rmdir":
		return rs.checkEdit(actor, argStr("path"))
	case "rename":
		if r := rs.checkEdit(actor, argStr("path")); !r.OK {
			return r
		}
		return rs.checkEdit(actor, argStr("to"))
	case "commit":
		return rs.checkCommit(actor, argStr("message"))
	case "push":
		return rs.checkPush(actor)
	}
	return ruleResult{OK: true} // tree / read / status are read-only — free
}

// GET /codespaces/{id}/rules — anyone who may use the codespace can read its rules.
func (p *Plugin) handleGetRules(w http.ResponseWriter, r *http.Request) {
	cs, ok := p.getCodespace(mux.Vars(r)["id"])
	if !ok {
		http.Error(w, "codespace not found", http.StatusNotFound)
		return
	}
	if !p.mayUseCodespace(r.Header.Get("Mattermost-User-ID"), cs) {
		http.Error(w, "not your codespace", http.StatusForbidden)
		return
	}
	writeJSON(w, http.StatusOK, p.rulesFor(cs.ID))
}

// PUT /codespaces/{id}/rules — only a Lead+ (or the codespace owner) may set the rules.
func (p *Plugin) handlePutRules(w http.ResponseWriter, r *http.Request) {
	cs, ok := p.getCodespace(mux.Vars(r)["id"])
	if !ok {
		http.Error(w, "codespace not found", http.StatusNotFound)
		return
	}
	if p.tierOf(r.Header.Get("Mattermost-User-ID"), cs) < tierLead {
		http.Error(w, "Forbidden: setting codespace rules requires a Lead or the codespace owner", http.StatusForbidden)
		return
	}
	body, _ := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<16))
	var rs codeRules
	if json.Unmarshal(body, &rs) != nil {
		http.Error(w, "invalid rules JSON", http.StatusBadRequest)
		return
	}
	rs.Protected = ensureGitProtected(rs.Protected)
	b, _ := json.Marshal(rs)
	if _, err := p.client.KV.Set(csRulesPrefix+cs.ID, b); err != nil {
		http.Error(w, "store failed", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, rs)
}
