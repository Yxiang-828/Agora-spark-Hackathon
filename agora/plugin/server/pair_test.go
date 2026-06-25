package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin/plugintest"
	"github.com/mattermost/mattermost/server/public/pluginapi"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
)

func pairPlugin() (*Plugin, *plugintest.API) {
	api := &plugintest.API{}
	p := &Plugin{client: pluginapi.NewClient(api, &plugintest.Driver{})}
	p.API = api // pair.go calls p.API directly for team/channel ops (Mattermost sets this in prod)
	p.router = p.initRouter()
	return p, api
}

func claimReq(p *Plugin, code string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(http.MethodPost, "/api/v1/pair/claim", strings.NewReader(`{"code":"`+code+`"}`))
	w := httptest.NewRecorder()
	p.ServeHTTP(nil, w, r)
	return w
}

func TestPairClaim_UnknownCode(t *testing.T) {
	p, api := pairPlugin()
	api.On("KVGet", "pair_nope").Return([]byte(nil), nil)

	w := claimReq(p, "nope")

	assert.Equal(t, http.StatusUnauthorized, w.Result().StatusCode)
	api.AssertNotCalled(t, "CreateBot", mock.Anything)
}

// Concurrent claim: the loser's compare-and-set fails -> no bot/token minted.
func TestPairClaim_LosesAtomicRace(t *testing.T) {
	p, api := pairPlugin()
	rec, _ := json.Marshal(pairRecord{UserID: "alice", Created: time.Now().UnixMilli(), Status: "pending"})
	api.On("KVGet", "pair_X").Return([]byte(rec), nil)
	api.On("KVSetWithOptions", "pair_X", mock.Anything, mock.Anything).Return(false, nil) // CAS lost

	w := claimReq(p, "X")

	assert.Equal(t, http.StatusGone, w.Result().StatusCode)
	api.AssertNotCalled(t, "CreateBot", mock.Anything)
	api.AssertNotCalled(t, "CreateUserAccessToken", mock.Anything)
}

// Happy path: wins the CAS, provisions a bot, persists the owner link BEFORE minting,
// and returns a token.
func TestPairClaim_Mints(t *testing.T) {
	p, api := pairPlugin()
	rec, _ := json.Marshal(pairRecord{UserID: "alice", Created: time.Now().UnixMilli(), Status: "pending"})
	api.On("KVGet", "pair_X").Return([]byte(rec), nil)
	api.On("KVSetWithOptions", "pair_X", mock.Anything, mock.Anything).Return(true, nil) // win CAS
	api.On("GetUser", "alice").Return(&model.User{Id: "alice", Username: "alice"}, nil)
	api.On("CreateBot", mock.Anything).Return(&model.Bot{UserId: "botid", Username: "agora-alice"}, nil)
	api.On("KVSetWithOptions", "owner_botid", mock.Anything, mock.Anything).Return(true, nil) // owner link
	api.On("CreateUserAccessToken", mock.Anything).Return(&model.UserAccessToken{Token: "TOKEN123"}, nil)
	api.On("GetTeamsForUser", "alice").Return([]*model.Team{}, nil)

	w := claimReq(p, "X")
	res := w.Result()

	assert.Equal(t, http.StatusOK, res.StatusCode)
	var cfg struct {
		Agents []struct {
			Agent     string `json:"agent"`
			BotUserID string `json:"bot_user_id"`
			BotToken  string `json:"bot_token"`
		} `json:"agents"`
	}
	_ = json.NewDecoder(res.Body).Decode(&cfg)
	assert.Equal(t, 3, len(cfg.Agents)) // one bot per agent: claude, codex, gemini
	assert.Equal(t, "TOKEN123", cfg.Agents[0].BotToken)
	assert.Equal(t, "botid", cfg.Agents[0].BotUserID)
	api.AssertCalled(t, "KVSetWithOptions", "owner_botid", mock.Anything, mock.Anything) // link persisted
}
