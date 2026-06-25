package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
)

// The router requires authentication and only exposes the skills API.
// (Handler/KV behaviour is covered by skill_law_test.go for the gate logic and by
// the deploy+curl integration check; here we verify auth + routing without a client.)

func TestServeHTTP_RequiresAuth(t *testing.T) {
	plugin := Plugin{}
	plugin.router = plugin.initRouter()

	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/api/v1/skills", nil) // no Mattermost-User-ID
	plugin.ServeHTTP(nil, w, r)

	assert.Equal(t, http.StatusUnauthorized, w.Result().StatusCode)
}

func TestServeHTTP_UnknownRoute(t *testing.T) {
	plugin := Plugin{}
	plugin.router = plugin.initRouter()

	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/api/v1/nope", nil)
	r.Header.Set("Mattermost-User-ID", "test-user-id") // authed, but no such route
	plugin.ServeHTTP(nil, w, r)

	assert.Equal(t, http.StatusNotFound, w.Result().StatusCode)
}
