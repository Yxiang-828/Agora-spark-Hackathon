package main

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
)

func TestGlobMatch(t *testing.T) {
	cases := []struct {
		glob, path string
		want       bool
	}{
		{".git/**", ".git/config", true},
		{".git/**", ".git/objects/ab/cd", true},
		{".git/**", ".git", true},
		{".git/**", "src/main.go", false},
		{"**/secret*", "src/secret.txt", true},
		{"**/secret*", "deep/nested/secrets.yml", true},
		{"**/secret*", "src/main.go", false},
		{"*.env", ".env", true},
		{"*.env", "prod.env", true},
		{"*.env", "config/prod.env", false}, // * doesn't cross '/'
		{"config/*.json", "config/app.json", true},
		{"config/*.json", "config/sub/app.json", false},
		{"**", "anything/at/all", true},
	}
	for _, c := range cases {
		assert.Equalf(t, c.want, globMatch(c.glob, c.path), "glob %q vs %q", c.glob, c.path)
	}
	// Windows-style separators are normalised before matching.
	assert.True(t, globMatch(".git/**", ".git\\config"))
}

func TestTierFromRoles(t *testing.T) {
	assert.Equal(t, tierOperator, tierFromRoles("system_user system_admin"))
	assert.Equal(t, tierLead, tierFromRoles("system_user team_admin"))
	assert.Equal(t, tierLead, tierFromRoles("system_user system_manager"))
	assert.Equal(t, tierGuest, tierFromRoles("system_guest"))
	assert.Equal(t, tierMember, tierFromRoles("system_user"))
	assert.Equal(t, tierMember, tierFromRoles(""))
	// operator outranks a lead-ish role when both are present.
	assert.Equal(t, tierOperator, tierFromRoles("team_admin system_admin"))
}

func TestParseTierDefaultsToMember(t *testing.T) {
	assert.Equal(t, tierMember, parseTier(""))
	assert.Equal(t, tierMember, parseTier("nonsense"))
	assert.Equal(t, tierOperator, parseTier("operator"))
	assert.Equal(t, tierGuest, parseTier("guest"))
}

func TestCheckEdit(t *testing.T) {
	rs := defaultRules()

	// Protected path is refused regardless of tier, with a typed reason.
	r := rs.checkEdit(tierOperator, ".git/config")
	assert.False(t, r.OK)
	assert.Equal(t, "forbidden_path", r.Code)
	assert.NotEmpty(t, r.Reason)

	// A member may edit a normal file; a guest may not (default edit tier = member).
	assert.True(t, rs.checkEdit(tierMember, "src/main.go").OK)
	low := rs.checkEdit(tierGuest, "src/main.go")
	assert.False(t, low.OK)
	assert.Equal(t, "tier_too_low", low.Code)
}

func TestCheckCommit(t *testing.T) {
	rs := defaultRules()

	// Empty message refused when required.
	r := rs.checkCommit(tierMember, "   ")
	assert.False(t, r.OK)
	assert.Equal(t, "message_required", r.Code)

	// With a message a member may commit (default commit tier = member).
	assert.True(t, rs.checkCommit(tierMember, "fix the bug").OK)

	// If a message is not required, blank passes the message check.
	rs.RequireCommitMessage = false
	assert.True(t, rs.checkCommit(tierMember, "").OK)
}

func TestCheckPushRequiresLead(t *testing.T) {
	rs := defaultRules() // push_tier = lead
	assert.False(t, rs.checkPush(tierMember).OK)
	assert.True(t, rs.checkPush(tierLead).OK)
	assert.True(t, rs.checkPush(tierOperator).OK)
}

func TestEnsureGitProtectedAlwaysPresent(t *testing.T) {
	got := ensureGitProtected([]string{"secrets/**"})
	assert.Contains(t, got, ".git/**")
	assert.Contains(t, got, "secrets/**")
	// Not duplicated if already there.
	assert.Len(t, ensureGitProtected([]string{".git/**"}), 1)
}

// handlePutRules is authority-gated: a plain member can't set codespace rules.
func TestPutRules_RequiresLead(t *testing.T) {
	p, api := csPlugin()
	api.On("KVGet", "cs_h1").Return([]byte(`{"id":"h1","host_user_id":"botX","created_by":"alice"}`), nil)
	api.On("KVGet", "owner_botX").Return([]byte("alice"), nil)        // u1 isn't the owner
	api.On("HasPermissionTo", "u1", mock.Anything).Return(false)      // not a sysadmin
	api.On("GetUser", "u1").Return(mmUser("u1", "system_user"), nil)  // a plain member

	w := csReq(p, "PUT", "/api/v1/codespaces/h1/rules", `{"protected":["secrets/**"]}`)

	assert.Equal(t, http.StatusForbidden, w.Result().StatusCode)
	api.AssertNotCalled(t, "KVSetWithOptions", "csrules_h1", mock.Anything, mock.Anything)
}
