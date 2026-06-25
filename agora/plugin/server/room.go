package main

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"sync"

	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
	"github.com/mattermost/mattermost/server/public/model"
)

// 3D spatial voice room — the in-plugin port of the standalone VC-3d-room relay.
//
// The static client lives under public/room/ (served by Mattermost at
// /plugins/com.aegis.agora/public/room/). This file replaces the toy's node server.mjs:
// one authenticated, CHANNEL-SCOPED WebSocket relay, plus an agent-speak broadcast.
//
// HUMANS vs AGENTS — the distinction:
//   - Humans open the room in a browser → a WS peer with a mic (WebRTC mesh, relayed here).
//     Each claims a human "slot" (0..roomSlots-1) and an avatar.
//   - Agents are server-side (no browser, no mic). They never hold a human slot. Their voice
//     is the connector's Qwen TTS clip: when an agent posts speech, the connector calls
//     POST /room/agent-speak and we fan an {type:"agent-speak", audio_url,...} event to the
//     room; clients render the badged agent avatar and play that clip spatialized at it.

const roomSlots = 8 // humans per room (the toy was 4; lifted for real channels)

var roomUpgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	// Same-origin behind Mattermost; the session cookie is the credential and is checked
	// before the upgrade (the route sits behind MattermostAuthorizationRequired).
	CheckOrigin: func(r *http.Request) bool { return true },
}

type roomPeer struct {
	id       string
	slot     int
	userID   string
	username string
	conn     *websocket.Conn
	writeMu  sync.Mutex
}

func (pe *roomPeer) send(v any) {
	b, err := json.Marshal(v)
	if err != nil {
		return
	}
	pe.writeMu.Lock()
	defer pe.writeMu.Unlock()
	_ = pe.conn.WriteMessage(websocket.TextMessage, b)
}

type voiceRoom struct {
	id     string
	mu     sync.Mutex
	peers  map[string]*roomPeer
	nextID int
}

func (vr *voiceRoom) freeSlot() int {
	used := map[int]bool{}
	for _, pe := range vr.peers {
		used[pe.slot] = true
	}
	for s := 0; s < roomSlots; s++ {
		if !used[s] {
			return s
		}
	}
	return -1
}

// broadcast sends v to every peer except exceptID (held under the room lock by the caller's
// snapshot, but we copy the slice first to write without holding the lock during IO).
func (vr *voiceRoom) broadcast(v any, exceptID string) {
	vr.mu.Lock()
	targets := make([]*roomPeer, 0, len(vr.peers))
	for id, pe := range vr.peers {
		if id != exceptID {
			targets = append(targets, pe)
		}
	}
	vr.mu.Unlock()
	for _, pe := range targets {
		pe.send(v)
	}
}

type roomHub struct {
	mu    sync.Mutex
	rooms map[string]*voiceRoom
}

func (h *roomHub) room(channelID string) *voiceRoom {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.rooms == nil {
		h.rooms = map[string]*voiceRoom{}
	}
	vr := h.rooms[channelID]
	if vr == nil {
		vr = &voiceRoom{id: channelID, peers: map[string]*roomPeer{}}
		h.rooms[channelID] = vr
	}
	return vr
}

func (p *Plugin) initRoomRoutes(api *mux.Router) {
	api.HandleFunc("/room/ws", p.handleRoomWS).Methods(http.MethodGet)
	api.HandleFunc("/room/agent-speak", p.handleAgentSpeak).Methods(http.MethodPost)
	api.HandleFunc("/room/roster", p.handleRoomRoster).Methods(http.MethodGet)
}

// GET /room/ws?channel=<id> — join the channel's voice room (WebSocket).
func (p *Plugin) handleRoomWS(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("Mattermost-User-ID")
	channelID := r.URL.Query().Get("channel")
	if channelID == "" {
		http.Error(w, "channel required", http.StatusBadRequest)
		return
	}
	// Only a member of the channel may join its room.
	if !p.client.User.HasPermissionToChannel(userID, channelID, model.PermissionCreatePost) {
		http.Error(w, "not a member of that channel", http.StatusForbidden)
		return
	}
	username := userID
	if u, e := p.API.GetUser(userID); e == nil && u != nil {
		username = u.Username
	}

	conn, err := roomUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return // upgrade writes its own error
	}

	vr := p.roomHub.room(channelID)
	vr.mu.Lock()
	slot := vr.freeSlot()
	if slot < 0 {
		vr.mu.Unlock()
		_ = conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"full"}`))
		_ = conn.Close()
		return
	}
	vr.nextID++
	id := strconv.Itoa(vr.nextID)
	pe := &roomPeer{id: id, slot: slot, userID: userID, username: username, conn: conn}
	vr.peers[id] = pe
	// snapshot existing peers for the welcome
	type peerView struct {
		ID       string `json:"id"`
		Slot     int    `json:"slot"`
		Username string `json:"username"`
	}
	others := []peerView{}
	for pid, op := range vr.peers {
		if pid != id {
			others = append(others, peerView{op.id, op.slot, op.username})
		}
	}
	vr.mu.Unlock()

	pe.send(map[string]any{"type": "welcome", "id": id, "slot": slot, "username": username, "peers": others})
	vr.broadcast(map[string]any{"type": "peer-join", "id": id, "slot": slot, "username": username}, id)

	// read loop: relay JSON. Targeted (msg.to) → that peer; else broadcast.
	for {
		_, data, rerr := conn.ReadMessage()
		if rerr != nil {
			break
		}
		var msg map[string]any
		if json.Unmarshal(data, &msg) != nil {
			continue
		}
		msg["from"] = id
		if to, ok := msg["to"].(string); ok && to != "" {
			vr.mu.Lock()
			t := vr.peers[to]
			vr.mu.Unlock()
			if t != nil {
				t.send(msg)
			}
		} else {
			vr.broadcast(msg, id)
		}
	}

	vr.mu.Lock()
	delete(vr.peers, id)
	empty := len(vr.peers) == 0
	vr.mu.Unlock()
	_ = conn.Close()
	vr.broadcast(map[string]any{"type": "peer-leave", "id": id, "slot": slot}, id)
	if empty {
		p.roomHub.mu.Lock()
		delete(p.roomHub.rooms, channelID)
		p.roomHub.mu.Unlock()
	}
}

// POST /room/agent-speak {channel, bot_user_id, audio_url, text} — the connector calls this
// when its agent speaks (Qwen TTS). We fan an agent-speak event to everyone in the room so
// the badged agent avatar animates and the clip plays spatialized. Caller must be the agent's
// owner / an operator, and the bot must be a real agent.
func (p *Plugin) handleAgentSpeak(w http.ResponseWriter, r *http.Request) {
	caller := r.Header.Get("Mattermost-User-ID")
	var in struct {
		Channel   string `json:"channel"`
		BotUserID string `json:"bot_user_id"`
		AudioURL  string `json:"audio_url"`
		Text      string `json:"text"`
	}
	body, _ := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<14))
	if json.Unmarshal(body, &in) != nil || in.Channel == "" || in.BotUserID == "" {
		http.Error(w, "channel and bot_user_id required", http.StatusBadRequest)
		return
	}
	bot, e := p.API.GetUser(in.BotUserID)
	if e != nil || bot == nil || agentOf(bot.Username) == "" {
		http.Error(w, "not a valid agent", http.StatusBadRequest)
		return
	}
	if caller != in.BotUserID && caller != p.ownerOf(in.BotUserID) && !p.isSysadmin(caller) {
		http.Error(w, "not allowed to speak as this agent", http.StatusForbidden)
		return
	}
	vr := p.roomHub.room(in.Channel)
	vr.broadcast(map[string]any{
		"type": "agent-speak", "bot_user_id": in.BotUserID, "name": agentOf(bot.Username),
		"username": bot.Username, "audio_url": in.AudioURL, "text": in.Text,
	}, "")
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// GET /room/roster?channel=<id> — humans currently in the room + the channel's agents (badged),
// so a joining client can render agent avatars even before any of them speak.
func (p *Plugin) handleRoomRoster(w http.ResponseWriter, r *http.Request) {
	channelID := r.URL.Query().Get("channel")
	type member struct {
		ID       string `json:"id"`
		Slot     int    `json:"slot"`
		Username string `json:"username"`
		IsAgent  bool   `json:"is_agent"`
		Online   bool   `json:"online"`
	}
	out := []member{}
	vr := p.roomHub.room(channelID)
	vr.mu.Lock()
	for _, pe := range vr.peers {
		out = append(out, member{ID: pe.id, Slot: pe.slot, Username: pe.username, IsAgent: false, Online: true})
	}
	vr.mu.Unlock()
	// channel's agents: any owner-linked bot that's a member of this channel
	for botID := range p.ownerLinks() {
		bot, e := p.API.GetUser(botID)
		if e != nil || bot == nil || agentOf(bot.Username) == "" {
			continue
		}
		if channelID != "" && !p.client.User.HasPermissionToChannel(botID, channelID, model.PermissionCreatePost) {
			continue
		}
		out = append(out, member{ID: botID, Slot: -1, Username: bot.Username, IsAgent: true, Online: p.online(botID)})
	}
	writeJSON(w, http.StatusOK, out)
}
