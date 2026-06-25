package command

import (
	"encoding/json"
	"testing"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
)

func TestAreasOverlap(t *testing.T) {
	cases := []struct {
		a, b string
		want bool
	}{
		{"src/auth", "src/auth", true},
		{"src/auth", "src/auth/login.go", true}, // prefix
		{"src/auth/login.go", "src/auth", true}, // prefix (other way)
		{"SRC/Auth", "src/auth", true},          // case-insensitive
		{"src/auth/", "src/auth", true},         // trailing slash
		{"src/auth", "src/api", false},
		{"auth", "authorization", false}, // not a path-prefix
		{"", "src/auth", false},
	}
	for _, c := range cases {
		if got := areasOverlap(c.a, c.b); got != c.want {
			t.Errorf("areasOverlap(%q,%q)=%v want %v", c.a, c.b, got, c.want)
		}
	}
}

func TestClaim_WarnsOnOverlap(t *testing.T) {
	env := setupTest()
	h := &Handler{client: env.client}
	bob, _ := json.Marshal(claimRecord{UserID: "bob", UserName: "bob", ChannelID: "c1", Area: "src/auth"})

	env.api.On("GetUser", "alice").Return(&model.User{Id: "alice", Username: "alice"}, nil)
	env.api.On("KVSetWithOptions", "claim_c1_alice", mock.Anything, mock.Anything).Return(true, nil)
	env.api.On("KVList", 0, 200).Return([]string{"claim_c1_bob"}, nil)
	env.api.On("KVList", 1, 200).Return([]string{}, nil)
	env.api.On("KVGet", "claim_c1_bob").Return(bob, nil)

	resp := h.executeClaimCommand(&model.CommandArgs{Command: "/claim src/auth/login.go", UserId: "alice", ChannelId: "c1"})

	assert.Equal(t, model.CommandResponseTypeInChannel, resp.ResponseType) // public callout
	assert.Contains(t, resp.Text, "Scope overlap")
	assert.Contains(t, resp.Text, "@bob")
}

func TestClaim_NoOverlapIsQuiet(t *testing.T) {
	env := setupTest()
	h := &Handler{client: env.client}

	env.api.On("GetUser", "alice").Return(&model.User{Id: "alice", Username: "alice"}, nil)
	env.api.On("KVSetWithOptions", "claim_c1_alice", mock.Anything, mock.Anything).Return(true, nil)
	env.api.On("KVList", 0, 200).Return([]string{"claim_c1_alice"}, nil) // only self
	env.api.On("KVList", 1, 200).Return([]string{}, nil)
	self, _ := json.Marshal(claimRecord{UserID: "alice", UserName: "alice", ChannelID: "c1", Area: "src/auth/login.go"})
	env.api.On("KVGet", "claim_c1_alice").Return(self, nil)

	resp := h.executeClaimCommand(&model.CommandArgs{Command: "/claim src/auth/login.go", UserId: "alice", ChannelId: "c1"})

	assert.NotContains(t, resp.Text, "overlap")
	assert.Contains(t, resp.Text, "working on")
}
