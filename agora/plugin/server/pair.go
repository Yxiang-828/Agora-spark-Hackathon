package main

import (
	"encoding/json"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/pluginapi"
)

// Onboarding pairing. A signed-in user starts pairing → the room mints a single-use
// code. Their connector claims the code (the code IS the credential — no login), and
// the room PROVISIONS a bot + access token for them and returns the full config, so
// the user never copies a token or hand-edits .env.

const pairPrefix = "pair_"
const ownerPrefix = "owner_"        // owner_<botUserID> = mmUserID (directory link)
const pairTTLms = int64(10 * 60 * 1000) // 10 minutes

var usernameSafe = regexp.MustCompile(`[^a-z0-9._-]`)

type pairRecord struct {
	UserID  string `json:"user_id"`
	Created int64  `json:"created"`
	// pending -> claiming (CAS won) -> done (token returned) | failed (provisioning failed)
	Status string `json:"status"`
}

// POST /pair/start (authenticated) — mint a single-use pairing code for this user.
func (p *Plugin) handlePairStart(w http.ResponseWriter, r *http.Request) {
	uid := r.Header.Get("Mattermost-User-ID")
	// CREATE authority: only members+ may bring an agent in. Fail CLOSED — if the account
	// can't be verified, deny (don't accidentally let a guest through on a lookup error).
	u, uerr := p.client.User.Get(uid)
	if uerr != nil || u == nil || u.IsGuest() {
		http.Error(w, "can't bring an agent — guests aren't allowed (or your account couldn't be verified)", http.StatusForbidden)
		return
	}
	code := model.NewId()
	rec := pairRecord{UserID: uid, Created: time.Now().UnixMilli(), Status: "pending"}
	b, _ := json.Marshal(rec)
	// Auto-expire the code so an unclaimed one disappears (status then reports expired).
	if _, err := p.client.KV.Set(pairPrefix+code, b, pluginapi.SetExpiry(time.Duration(pairTTLms)*time.Millisecond)); err != nil {
		http.Error(w, "could not start pairing", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"code": code})
}

// GET /pair/status?code=... (authenticated) — has the connector claimed it yet?
func (p *Plugin) handlePairStatus(w http.ResponseWriter, r *http.Request) {
	var raw []byte
	if err := p.client.KV.Get(pairPrefix+r.URL.Query().Get("code"), &raw); err != nil {
		writeJSON(w, http.StatusOK, map[string]bool{"claimed": false, "expired": false})
		return
	}
	if len(raw) == 0 {
		// The code auto-expired (or never existed) — tell the wizard to stop waiting.
		writeJSON(w, http.StatusOK, map[string]bool{"claimed": false, "expired": true})
		return
	}
	var rec pairRecord
	_ = json.Unmarshal(raw, &rec)
	done := rec.Status == "done"
	failed := rec.Status == "failed"
	// "claimed" means fully provisioned (token returned) — NOT merely CAS-locked, so the
	// wizard never shows Connected for a claim that failed after winning the race.
	expired := !done && !failed && time.Now().UnixMilli()-rec.Created > pairTTLms
	writeJSON(w, http.StatusOK, map[string]bool{"claimed": done, "failed": failed, "expired": expired})
}

// POST /pair/claim {code} (NO auth — the code is the credential). Provisions a bot +
// token for the code's owner and returns the connector config.
func (p *Plugin) handlePairClaim(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<16))
	var in struct {
		Code   string   `json:"code"`
		Agents []string `json:"agents"` // one bot is provisioned per agent (claude/codex/gemini)
	}
	if err := json.Unmarshal(body, &in); err != nil || in.Code == "" {
		http.Error(w, "code required", http.StatusBadRequest)
		return
	}
	if len(in.Agents) == 0 {
		in.Agents = []string{"claude", "codex", "antigravity"} // gemini deprecated (rate-limited)
	}
	var raw []byte
	if err := p.client.KV.Get(pairPrefix+in.Code, &raw); err != nil || len(raw) == 0 {
		http.Error(w, "invalid or expired code", http.StatusUnauthorized)
		return
	}
	var rec pairRecord
	if err := json.Unmarshal(raw, &rec); err != nil {
		http.Error(w, "corrupt code", http.StatusInternalServerError)
		return
	}
	if rec.Status != "pending" || time.Now().UnixMilli()-rec.Created > pairTTLms {
		http.Error(w, "code already used or expired", http.StatusGone)
		return
	}

	// ATOMIC single-use: win the claim via compare-and-set (pending -> claiming) BEFORE
	// provisioning, so two concurrent claims can't each mint a token. The "claiming" state
	// is NOT "done" — the wizard only treats "done" as Connected.
	claiming := rec
	claiming.Status = "claiming"
	cb, _ := json.Marshal(claiming)
	won, serr := p.client.KV.Set(pairPrefix+in.Code, cb, pluginapi.SetAtomic(raw))
	if serr != nil || !won {
		http.Error(w, "code already used", http.StatusGone)
		return
	}

	// Any failure after winning the CAS marks the code FAILED, so the wizard shows an
	// error (never "connected") and the burnt code can't be reused.
	fail := func(status int, msg string) {
		failed := claiming
		failed.Status = "failed"
		fb, _ := json.Marshal(failed)
		_, _ = p.client.KV.Set(pairPrefix+in.Code, fb)
		http.Error(w, msg, status)
	}

	owner, oerr := p.client.User.Get(rec.UserID)
	if oerr != nil || owner == nil {
		fail(http.StatusInternalServerError, "owner not found")
		return
	}

	// One person owns MANY bots — provision (or reuse) one bot per agent.
	teamID, channelID := "", ""
	if teams, e := p.API.GetTeamsForUser(rec.UserID); e == nil && len(teams) > 0 {
		teamID = teams[0].Id
		if ch, ce := p.API.GetChannelByNameForTeamName(teams[0].Name, "town-square", false); ce == nil && ch != nil {
			channelID = ch.Id
		}
	}
	ownerSlug := usernameSafe.ReplaceAllString(strings.ToLower(owner.Username), "-")

	cfgs := []agentBot{}
	for _, agent := range in.Agents {
		a := usernameSafe.ReplaceAllString(strings.ToLower(agent), "-")
		if a == "" {
			continue
		}
		botUsername := "agora-" + ownerSlug + "-" + a
		bot := &model.Bot{Username: botUsername, DisplayName: "Agora · " + owner.Username + " · " + a, Description: "Agora " + a + " connector for " + owner.Username}
		botID := ""
		if cerr := p.client.Bot.Create(bot); cerr == nil {
			botID = bot.UserId
		} else if u, gerr := p.API.GetUserByUsername(botUsername); gerr == nil && u != nil {
			botID = u.Id
		} else {
			fail(http.StatusInternalServerError, "could not provision bot for "+a+": "+cerr.Error())
			return
		}
		// owner↔bot link BEFORE the token (anti-spoof, D24).
		if _, lerr := p.client.KV.Set(ownerPrefix+botID, []byte(rec.UserID)); lerr != nil {
			fail(http.StatusInternalServerError, "could not persist owner link")
			return
		}
		if teams, e := p.API.GetTeamsForUser(rec.UserID); e == nil {
			for _, t := range teams {
				_, _ = p.API.CreateTeamMember(t.Id, botID)
			}
		}
		if channelID != "" {
			_, _ = p.API.AddChannelMember(channelID, botID)
		}
		tok, terr := p.client.User.CreateAccessToken(botID, "agora "+a+" connector")
		if terr != nil {
			fail(http.StatusInternalServerError, "could not mint token for "+a+": "+terr.Error())
			return
		}
		cfgs = append(cfgs, agentBot{Agent: agent, BotUserID: botID, BotUsername: botUsername, BotToken: tok.Token})
	}
	if len(cfgs) == 0 {
		fail(http.StatusBadRequest, "no valid agents")
		return
	}

	// Provisioning succeeded — only NOW mark the code "done" (what the wizard reads as Connected).
	doneRec := claiming
	doneRec.Status = "done"
	dbb, _ := json.Marshal(doneRec)
	_, _ = p.client.KV.Set(pairPrefix+in.Code, dbb)

	// Behind a TLS-terminating proxy/tunnel (cloudflared, nginx, …) r.TLS is nil but the
	// proxy sets X-Forwarded-Proto=https — honor it so the connector gets https/wss.
	scheme := "http"
	if r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https") {
		scheme = "https"
	}
	base := scheme + "://" + r.Host
	wsScheme := "ws"
	if scheme == "https" {
		wsScheme = "wss"
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"AGORA_URL":        base,
		"AGORA_WS":         wsScheme + "://" + r.Host + "/api/v4/websocket",
		"AGORA_TEAM_ID":    teamID,
		"AGORA_CHANNEL_ID": channelID,
		"agents":           cfgs,
	})
}

// agentBot is one provisioned per-agent bot returned to the local host.
type agentBot struct {
	Agent       string `json:"agent"`
	BotUserID   string `json:"bot_user_id"`
	BotUsername string `json:"bot_username"`
	BotToken    string `json:"bot_token"`
}
