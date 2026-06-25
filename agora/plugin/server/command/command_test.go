package command

import (
	"testing"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin/plugintest"
	"github.com/mattermost/mattermost/server/public/pluginapi"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
)

type env struct {
	client *pluginapi.Client
	api    *plugintest.API
}

func setupTest() *env {
	api := &plugintest.API{}
	driver := &plugintest.Driver{}
	client := pluginapi.NewClient(api, driver)

	return &env{
		client: client,
		api:    api,
	}
}

func TestHelloCommand(t *testing.T) {
	assert := assert.New(t)
	env := setupTest()

	env.api.On("RegisterCommand", mock.Anything).Return(nil)
	cmdHandler := NewCommandHandler(env.client)

	args := &model.CommandArgs{
		Command: "/hello world",
	}
	response, err := cmdHandler.Handle(args)
	assert.Nil(err)
	assert.Equal("Hello, world", response.Text)
}

// Channel-wide `/ai off` must be admin-gated (the audit's High finding).
func TestAiOff_RequiresAdmin(t *testing.T) {
	env := setupTest()
	env.api.On("HasPermissionToChannel", "u1", "c1", mock.Anything).Return(false)
	h := &Handler{client: env.client}

	resp, err := h.Handle(&model.CommandArgs{Command: "/ai off", UserId: "u1", ChannelId: "c1"})

	assert.Nil(t, err)
	assert.Contains(t, resp.Text, "channel admin")
	env.api.AssertNotCalled(t, "KVSetWithOptions", "engage_chan_c1", mock.Anything, mock.Anything)
}

func TestAgoraSetup_RequiresTeamAdmin(t *testing.T) {
	env := setupTest()
	env.api.On("HasPermissionToTeam", "u1", "t1", mock.Anything).Return(false)
	h := &Handler{client: env.client}

	resp := h.executeAgoraCommand(&model.CommandArgs{Command: "/agora setup", UserId: "u1", TeamId: "t1"})

	assert.Contains(t, resp.Text, "team admin")
	env.api.AssertNotCalled(t, "CreateChannel", mock.Anything)
}

func TestAiOff_AdminSetsChannelOff(t *testing.T) {
	env := setupTest()
	env.api.On("HasPermissionToChannel", "a1", "c1", mock.Anything).Return(true)
	env.api.On("KVSetWithOptions", "engage_chan_c1", mock.Anything, mock.Anything).Return(true, nil)
	h := &Handler{client: env.client}

	resp, _ := h.Handle(&model.CommandArgs{Command: "/ai off", UserId: "a1", ChannelId: "c1"})

	assert.Contains(t, resp.Text, "OFF")
	env.api.AssertCalled(t, "KVSetWithOptions", "engage_chan_c1", mock.Anything, mock.Anything)
}
