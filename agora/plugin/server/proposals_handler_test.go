package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin/plugintest"
	"github.com/mattermost/mattermost/server/public/pluginapi"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
)

func gatePlugin() (*Plugin, *plugintest.API) {
	api := &plugintest.API{}
	p := &Plugin{client: pluginapi.NewClient(api, &plugintest.Driver{})}
	p.router = p.initRouter()
	return p, api
}

func approveReq(p *Plugin, userID string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/api/v1/proposals/p1/approve", nil)
	req.Header.Set("Mattermost-User-ID", userID)
	w := httptest.NewRecorder()
	p.ServeHTTP(nil, w, req)
	return w
}

func TestApprove_NonAdminForbidden(t *testing.T) {
	p, api := gatePlugin()
	api.On("GetUser", "member1").Return(&model.User{Id: "member1", Roles: "system_user"}, nil)

	w := approveReq(p, "member1")

	assert.Equal(t, http.StatusForbidden, w.Result().StatusCode)
	// must NOT have written durable memory
	api.AssertNotCalled(t, "KVSetWithOptions", "dict_p1", mock.Anything, mock.Anything)
}

func TestApprove_AdminMovesProposalToDictionary(t *testing.T) {
	p, api := gatePlugin()
	pr := proposal{ID: "p1", Issue: "charger pulses", Fix: "no action", Status: "pending"}
	b, _ := json.Marshal(pr)

	api.On("GetUser", "admin1").Return(&model.User{Id: "admin1", Roles: "system_user system_admin"}, nil)
	api.On("KVGet", "prop_p1").Return(b, nil)
	api.On("KVSetWithOptions", "dict_p1", mock.Anything, mock.Anything).Return(true, nil) // write to Dictionary
	api.On("KVSetWithOptions", "prop_p1", mock.Anything, mock.Anything).Return(true, nil) // Delete() routes through Set(nil)

	w := approveReq(p, "admin1")

	assert.Equal(t, http.StatusOK, w.Result().StatusCode)
	api.AssertCalled(t, "KVSetWithOptions", "dict_p1", mock.Anything, mock.Anything) // proposal written to Dictionary
	api.AssertCalled(t, "KVSetWithOptions", "prop_p1", mock.Anything, mock.Anything) // proposal removed
}
