package main

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
)

func TestCheckTerminal(t *testing.T) {
	rs := defaultRules() // term_tier = member
	assert.True(t, rs.checkTerminal(tierMember).OK)
	assert.True(t, rs.checkTerminal(tierOperator).OK)
	low := rs.checkTerminal(tierGuest)
	assert.False(t, low.OK)
	assert.Equal(t, "tier_too_low", low.Code)
}

// A non-participant can't run terminal commands in someone else's codespace.
func TestTerm_RejectsNonMember(t *testing.T) {
	p, api := csPlugin()
	api.On("KVGet", "cs_h1").Return([]byte(`{"id":"h1","host_user_id":"botX","created_by":"alice","root":"/r"}`), nil)
	api.On("KVGet", "owner_botX").Return([]byte("alice"), nil)
	api.On("HasPermissionTo", "u1", mock.Anything).Return(false)

	w := csReq(p, "POST", "/api/v1/codespace/term", `{"codespace_id":"h1","command":"ls"}`)

	assert.Equal(t, http.StatusForbidden, w.Result().StatusCode)
	api.AssertNotCalled(t, "PublishWebSocketEvent", mock.Anything, mock.Anything, mock.Anything)
}

// A guest channel-member is refused by the default term tier (member), with a typed reason —
// and crucially BEFORE any command is relayed to the host.
func TestTerm_GuestRefusedByTier(t *testing.T) {
	p, api := csPlugin()
	api.On("KVGet", "cs_cs1").Return([]byte(`{"id":"cs1","host_user_id":"botX","created_by":"alice","root":"/r"}`), nil)
	api.On("KVGet", "owner_botX").Return([]byte("alice"), nil)
	api.On("HasPermissionTo", "guest1", mock.Anything).Return(false)
	api.On("KVGet", "wschan_c1").Return([]byte("cs1"), nil)
	api.On("HasPermissionToChannel", "guest1", "c1", mock.Anything).Return(true)
	api.On("GetUser", "guest1").Return(mmUser("guest1", "system_guest"), nil)
	api.On("KVGet", "csrules_cs1").Return([]byte(nil), nil)

	r := newReqAs("POST", "/api/v1/codespace/term", `{"codespace_id":"cs1","channel_id":"c1","command":"ls"}`, "guest1")
	w := serve(p, r)

	assert.Equal(t, http.StatusForbidden, w.Result().StatusCode)
	var rr ruleResult
	_ = json.NewDecoder(w.Result().Body).Decode(&rr)
	assert.Equal(t, "tier_too_low", rr.Code)
	api.AssertNotCalled(t, "PublishWebSocketEvent", mock.Anything, mock.Anything, mock.Anything)
}
