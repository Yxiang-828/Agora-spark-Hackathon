package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin/plugintest"
	"github.com/mattermost/mattermost/server/public/pluginapi"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
)

func csPlugin() (*Plugin, *plugintest.API) {
	api := &plugintest.API{}
	p := &Plugin{client: pluginapi.NewClient(api, &plugintest.Driver{})}
	p.API = api
	p.router = p.initRouter()
	return p, api
}

func csReq(p *Plugin, method, path, body string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	r.Header.Set("Mattermost-User-ID", "u1") // codespace routes are authenticated
	w := httptest.NewRecorder()
	p.ServeHTTP(nil, w, r)
	return w
}

func TestCreateCodespace(t *testing.T) {
	p, api := csPlugin()
	api.On("KVList", 0, 200).Return([]string{}, nil)
	api.On("KVSetWithOptions", mock.Anything, mock.Anything, mock.Anything).Return(true, nil)

	w := csReq(p, "POST", "/api/v1/codespaces", `{"name":"demo"}`)

	assert.Equal(t, http.StatusOK, w.Result().StatusCode)
	var cs codespace
	_ = json.NewDecoder(w.Result().Body).Decode(&cs)
	assert.Equal(t, "demo", cs.Name)
	assert.NotEmpty(t, cs.ID)
}

func TestCreateCodespace_LimitReached(t *testing.T) {
	p, api := csPlugin()
	keys := make([]string, maxCodespaces)
	for i := range keys {
		keys[i] = fmt.Sprintf("cs_%d", i)
	}
	api.On("KVList", 0, 200).Return(keys, nil)
	api.On("KVList", 1, 200).Return([]string{}, nil)
	api.On("KVGet", mock.Anything).Return([]byte("{}"), nil)

	w := csReq(p, "POST", "/api/v1/codespaces", `{"name":"demo"}`)

	assert.Equal(t, http.StatusForbidden, w.Result().StatusCode)
}

func TestCreateCodespace_OnlyOnAHostYouOwn(t *testing.T) {
	p, api := csPlugin()
	api.On("KVList", 0, 200).Return([]string{}, nil)            // cap check
	api.On("KVGet", "owner_hostbot").Return([]byte("u2"), nil)  // host is owned by someone else
	api.On("HasPermissionTo", "u1", mock.Anything).Return(false) // and u1 isn't a sysadmin

	w := csReq(p, "POST", "/api/v1/codespaces", `{"name":"x","host_user_id":"hostbot","source":"local","root":"/r"}`)

	assert.Equal(t, http.StatusForbidden, w.Result().StatusCode) // can't point at someone else's machine
}

func TestPutFile_MissingCodespace(t *testing.T) {
	p, api := csPlugin()
	api.On("KVGet", "cs_nope").Return([]byte(nil), nil) // codespace doesn't exist

	w := csReq(p, "PUT", "/api/v1/codespaces/nope/file", `{"path":"a.txt","content":"x"}`)

	assert.Equal(t, http.StatusNotFound, w.Result().StatusCode) // no orphan tree
	api.AssertNotCalled(t, "KVSetWithOptions", "csfile_nope::a.txt", mock.Anything, mock.Anything)
}

func TestPutFile_TooLarge(t *testing.T) {
	p, api := csPlugin()
	api.On("KVGet", "cs_cs1").Return([]byte(`{"id":"cs1"}`), nil) // exists
	big := strings.Repeat("x", maxFileBytes+1)
	body, _ := json.Marshal(map[string]string{"path": "a.txt", "content": big})

	w := csReq(p, "PUT", "/api/v1/codespaces/cs1/file", string(body))

	assert.Equal(t, http.StatusRequestEntityTooLarge, w.Result().StatusCode)
}

func TestPutFile_OK(t *testing.T) {
	p, api := csPlugin()
	api.On("KVGet", "cs_cs1").Return([]byte(`{"id":"cs1"}`), nil) // exists
	api.On("KVList", 0, 200).Return([]string{}, nil)              // no existing files (cap check)
	api.On("KVSetWithOptions", "csfile_cs1::a.txt", mock.Anything, mock.Anything).Return(true, nil)

	w := csReq(p, "PUT", "/api/v1/codespaces/cs1/file", `{"path":"a.txt","content":"hello"}`)

	assert.Equal(t, http.StatusOK, w.Result().StatusCode)
	api.AssertCalled(t, "KVSetWithOptions", "csfile_cs1::a.txt", mock.Anything, mock.Anything)
}

func TestPutFile_RejectsBadPath(t *testing.T) {
	for _, bad := range []string{"", "  ", "/etc/passwd", "a/../../b", strings.Repeat("x", 513)} {
		p, api := csPlugin()
		api.On("KVGet", "cs_cs1").Return([]byte(`{"id":"cs1"}`), nil) // exists
		body, _ := json.Marshal(map[string]string{"path": bad, "content": "x"})

		w := csReq(p, "PUT", "/api/v1/codespaces/cs1/file", string(body))

		assert.Equal(t, http.StatusBadRequest, w.Result().StatusCode, "path %q should be rejected", bad)
		api.AssertNotCalled(t, "KVSetWithOptions", mock.Anything, mock.Anything, mock.Anything)
	}
}

func TestValidPath(t *testing.T) {
	for _, ok := range []string{"a.txt", "src/main.go", "deep/nested/dir/file.ts"} {
		assert.True(t, validPath(ok), ok)
	}
	for _, bad := range []string{"", "/abs", "../up", "a/../b", strings.Repeat("x", 513)} {
		assert.False(t, validPath(bad), bad)
	}
}

func TestBindWorkspace_RequiresChannelMembership(t *testing.T) {
	p, api := csPlugin()
	api.On("HasPermissionToChannel", "u1", "chX", mock.Anything).Return(false)

	w := csReq(p, "POST", "/api/v1/workspace", `{"channel_id":"chX","codespace_id":"cs1"}`)

	assert.Equal(t, http.StatusForbidden, w.Result().StatusCode) // non-member can't bind
	api.AssertNotCalled(t, "KVSetWithOptions", "wschan_chX", mock.Anything, mock.Anything)
}

func TestBindWorkspace_OK(t *testing.T) {
	p, api := csPlugin()
	api.On("HasPermissionToChannel", "u1", "chX", mock.Anything).Return(true)
	api.On("KVGet", "cs_cs1").Return([]byte(`{"id":"cs1"}`), nil)
	api.On("KVSetWithOptions", "wschan_chX", mock.Anything, mock.Anything).Return(true, nil)

	w := csReq(p, "POST", "/api/v1/workspace", `{"channel_id":"chX","codespace_id":"cs1"}`)

	assert.Equal(t, http.StatusOK, w.Result().StatusCode)
}

func TestDeleteCodespace_RequiresOwner(t *testing.T) {
	p, api := csPlugin()
	api.On("KVGet", "cs_h1").Return([]byte(`{"id":"h1","host_user_id":"botX","created_by":"alice"}`), nil)
	api.On("KVGet", "owner_botX").Return([]byte("alice"), nil)   // host owned by alice
	api.On("HasPermissionTo", "u1", mock.Anything).Return(false) // u1 not sysadmin

	w := csReq(p, "DELETE", "/api/v1/codespaces/h1", "")

	assert.Equal(t, http.StatusForbidden, w.Result().StatusCode) // u1 can't delete alice's codespace
}

func TestBindWorkspace_RequiresCodespaceAccess(t *testing.T) {
	p, api := csPlugin()
	api.On("HasPermissionToChannel", "u1", "c1", mock.Anything).Return(true) // member of the channel
	api.On("KVGet", "cs_h1").Return([]byte(`{"id":"h1","host_user_id":"botX","created_by":"alice"}`), nil)
	api.On("KVGet", "owner_botX").Return([]byte("alice"), nil)
	api.On("HasPermissionTo", "u1", mock.Anything).Return(false)

	w := csReq(p, "POST", "/api/v1/workspace", `{"channel_id":"c1","codespace_id":"h1"}`)

	assert.Equal(t, http.StatusForbidden, w.Result().StatusCode) // can't bind a codespace you can't use
	api.AssertNotCalled(t, "KVSetWithOptions", "wschan_c1", mock.Anything, mock.Anything)
}

func TestDeleteCodespace_ListErrorIs500(t *testing.T) {
	p, api := csPlugin()
	api.On("KVGet", "cs_cs1").Return([]byte(`{"id":"cs1"}`), nil) // exists, legacy (no host -> allowed)
	api.On("KVList", 0, 200).Return([]string(nil), model.NewAppError("KVList", "boom", nil, "", 500))

	w := csReq(p, "DELETE", "/api/v1/codespaces/cs1", "")

	assert.Equal(t, http.StatusInternalServerError, w.Result().StatusCode) // don't lie that delete succeeded
}
