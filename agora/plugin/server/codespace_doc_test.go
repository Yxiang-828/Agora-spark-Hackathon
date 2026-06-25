package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
)

func mmUser(id, roles string) *model.User { return &model.User{Id: id, Roles: roles} }

// newReqAs / serve mirror csReq but let a test choose the acting user id.
func newReqAs(method, path, body, userID string) *http.Request {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	r.Header.Set("Mattermost-User-ID", userID)
	return r
}

func serve(p *Plugin, r *http.Request) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	p.ServeHTTP(nil, w, r)
	return w
}

// A non-member can't push live edits into someone else's codespace.
func TestDocUpdate_RejectsNonMember(t *testing.T) {
	p, api := csPlugin()
	api.On("KVGet", "cs_h1").Return([]byte(`{"id":"h1","host_user_id":"botX","created_by":"alice","root":"/r"}`), nil)
	api.On("KVGet", "owner_botX").Return([]byte("alice"), nil)   // host owned by alice
	api.On("HasPermissionTo", "u1", mock.Anything).Return(false) // u1 not a sysadmin

	w := csReq(p, "POST", "/api/v1/codespace/doc/update",
		`{"codespace_id":"h1","path":"a.txt","update":"AQ==","origin":"s1"}`)

	assert.Equal(t, http.StatusForbidden, w.Result().StatusCode)
	api.AssertNotCalled(t, "PublishWebSocketEvent", mock.Anything, mock.Anything, mock.Anything)
}

// First opener of a fresh file is elected the seeder and the record is created.
func TestDocOpen_FreshFileElectsSeeder(t *testing.T) {
	p, api := csPlugin()
	api.On("KVGet", "cs_cs1").Return([]byte(`{"id":"cs1","host_user_id":"botX","created_by":"u1","root":"/r"}`), nil)
	api.On("KVGet", "csdoc_cs1::a.txt").Return([]byte(nil), nil) // no doc yet
	api.On("KVSetWithOptions", "csdoc_cs1::a.txt", mock.Anything, mock.Anything).Return(true, nil)

	w := csReq(p, "POST", "/api/v1/codespace/doc/open", `{"codespace_id":"cs1","path":"a.txt"}`)

	assert.Equal(t, http.StatusOK, w.Result().StatusCode)
	var out map[string]interface{}
	_ = json.NewDecoder(w.Result().Body).Decode(&out)
	assert.Equal(t, "seed", out["role"]) // first opener seeds from disk
	api.AssertCalled(t, "KVSetWithOptions", "csdoc_cs1::a.txt", mock.Anything, mock.Anything)
}

// A later opener joins and receives the stored updates (no re-seed).
func TestDocOpen_ExistingFileJoins(t *testing.T) {
	p, api := csPlugin()
	api.On("KVGet", "cs_cs1").Return([]byte(`{"id":"cs1","host_user_id":"botX","created_by":"u1","root":"/r"}`), nil)
	api.On("KVGet", "csdoc_cs1::a.txt").Return([]byte(`{"seeded":true,"updates":["AAA","BBB"]}`), nil)

	w := csReq(p, "POST", "/api/v1/codespace/doc/open", `{"codespace_id":"cs1","path":"a.txt"}`)

	assert.Equal(t, http.StatusOK, w.Result().StatusCode)
	var out struct {
		Role    string   `json:"role"`
		Updates []string `json:"updates"`
	}
	_ = json.NewDecoder(w.Result().Body).Decode(&out)
	assert.Equal(t, "join", out.Role)
	assert.Equal(t, []string{"AAA", "BBB"}, out.Updates)
}

// A guest is refused live editing under default rules (edit tier = member), with a typed reason.
func TestDocUpdate_GuestRefusedByRules(t *testing.T) {
	p, api := csPlugin()
	api.On("KVGet", "cs_cs1").Return([]byte(`{"id":"cs1","host_user_id":"botX","created_by":"alice","root":"/r"}`), nil)
	api.On("KVGet", "owner_botX").Return([]byte("alice"), nil)
	api.On("HasPermissionTo", "guest1", mock.Anything).Return(false)
	// guest1 joins via a bound channel (a member, but only guest tier).
	api.On("KVGet", "wschan_c1").Return([]byte("cs1"), nil)
	api.On("HasPermissionToChannel", "guest1", "c1", mock.Anything).Return(true)
	api.On("GetUser", "guest1").Return(mmUser("guest1", "system_guest"), nil) // a guest
	api.On("KVGet", "csrules_cs1").Return([]byte(nil), nil)                    // default rules

	r := newReqAs("POST", "/api/v1/codespace/doc/update",
		`{"codespace_id":"cs1","channel_id":"c1","path":"src/main.go","update":"AQ==","origin":"s1"}`, "guest1")
	w := serve(p, r)

	assert.Equal(t, http.StatusForbidden, w.Result().StatusCode)
	var rr ruleResult
	_ = json.NewDecoder(w.Result().Body).Decode(&rr)
	assert.Equal(t, "tier_too_low", rr.Code)
}

// Flush relays a write to the host, gated by the rules engine. Protected paths are refused
// before any host call.
func TestDocFlush_ProtectedPathRefused(t *testing.T) {
	p, api := csPlugin()
	api.On("KVGet", "cs_cs1").Return([]byte(`{"id":"cs1","host_user_id":"botX","created_by":"u1","root":"/r"}`), nil)
	api.On("KVGet", "csrules_cs1").Return([]byte(nil), nil) // default rules => .git/** protected

	w := csReq(p, "POST", "/api/v1/codespace/doc/flush",
		`{"codespace_id":"cs1","path":".git/config","content":"x"}`)

	assert.Equal(t, http.StatusForbidden, w.Result().StatusCode)
	var rr ruleResult
	_ = json.NewDecoder(w.Result().Body).Decode(&rr)
	assert.Equal(t, "forbidden_path", rr.Code)
	api.AssertNotCalled(t, "PublishWebSocketEvent", mock.Anything, mock.Anything, mock.Anything)
}
