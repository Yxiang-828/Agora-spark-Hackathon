package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/mattermost/mattermost/server/public/model"
)

// Codespace filesystem/git relay.
//
// A host-backed codespace's files live on a connector's machine, not in the room. The
// browser asks the room to run an op (tree/read/write/status/commit/push); the room
// forwards it over the WebSocket to that connector, which runs the real op (jailed to
// the codespace root) and POSTs the result back. Correlated by req_id.

type csBridge struct {
	mu      sync.Mutex
	pending map[string]chan json.RawMessage
}

var csb = &csBridge{pending: map[string]chan json.RawMessage{}}

func (b *csBridge) register(id string) chan json.RawMessage {
	ch := make(chan json.RawMessage, 1)
	b.mu.Lock()
	b.pending[id] = ch
	b.mu.Unlock()
	return ch
}

func (b *csBridge) resolve(id string, res json.RawMessage) {
	b.mu.Lock()
	ch, ok := b.pending[id]
	delete(b.pending, id)
	b.mu.Unlock()
	if ok {
		ch <- res
	}
}

func (b *csBridge) cancel(id string) {
	b.mu.Lock()
	delete(b.pending, id)
	b.mu.Unlock()
}

// relayOp forwards one op to a host connector over its WebSocket and waits for the result.
func (p *Plugin) relayOp(hostUserID, op string, args map[string]interface{}, timeout time.Duration) (json.RawMessage, error) {
	if hostUserID == "" {
		return nil, fmt.Errorf("no host")
	}
	reqID := model.NewId()
	ch := csb.register(reqID)
	p.API.PublishWebSocketEvent("codespace_req", map[string]interface{}{
		"req_id": reqID, "op": op, "args": args,
	}, &model.WebsocketBroadcast{UserId: hostUserID})
	select {
	case res := <-ch:
		return res, nil
	case <-time.After(timeout):
		csb.cancel(reqID)
		return nil, fmt.Errorf("host did not respond — is the connector running on that machine?")
	}
}

// POST /codespace/op {codespace_id, op, args} — browser → room → host connector.
func (p *Plugin) handleCodespaceOp(w http.ResponseWriter, r *http.Request) {
	var in struct {
		CodespaceID string                 `json:"codespace_id"`
		ChannelID   string                 `json:"channel_id"`
		Op          string                 `json:"op"`
		Args        map[string]interface{} `json:"args"`
	}
	body, _ := io.ReadAll(http.MaxBytesReader(w, r.Body, 4<<20))
	if json.Unmarshal(body, &in); in.CodespaceID == "" || in.Op == "" {
		http.Error(w, "codespace_id and op required", http.StatusBadRequest)
		return
	}
	cs, ok := p.getCodespace(in.CodespaceID)
	if !ok {
		http.Error(w, "codespace not found", http.StatusNotFound)
		return
	}
	if cs.HostUserID == "" {
		http.Error(w, "not a host-backed codespace", http.StatusBadRequest)
		return
	}
	// Gate: the owner, or a member of a channel this codespace is bound to, may drive ops.
	userID := r.Header.Get("Mattermost-User-ID")
	if !p.mayParticipate(userID, cs, in.ChannelID) {
		http.Error(w, "not allowed in this codespace", http.StatusForbidden)
		return
	}
	// Rules engine — enforced here so EVERY mutating op (the old single-file Save, folder CRUD,
	// commit, push) goes through the same server-side gate with a typed reason on rejection.
	if rr := p.gateOp(userID, cs, in.Op, in.Args); !rr.OK {
		writeJSON(w, http.StatusForbidden, rr)
		return
	}
	// Root is server-derived from the codespace record — the browser never picks the path.
	if in.Args == nil {
		in.Args = map[string]interface{}{}
	}
	in.Args["root"] = cs.Root
	if cs.Source == "ssh" { // ops run on the remote box the host reaches over SSH
		in.Args["ssh"] = cs.SSHTarget
	}
	// On commit, stamp Co-authored-by trailers for everyone who saved since the last commit, so
	// downstream git history keeps the real attribution.
	if in.Op == "commit" {
		if tr := p.coauthorTrailers(cs.ID, userID); tr != "" {
			in.Args["message"] = argString(in.Args, "message") + tr
		}
	}

	res, err := p.relayOp(cs.HostUserID, in.Op, in.Args, 30*time.Second)
	if err != nil {
		http.Error(w, err.Error(), http.StatusGatewayTimeout)
		return
	}
	// Record durable actions in the activity feed.
	switch in.Op {
	case "commit":
		p.recordActivity(cs.ID, userID, "commit", argString(in.Args, "message"))
	case "push":
		p.recordActivity(cs.ID, userID, "push", "")
	case "write", "mkdir", "rename", "delete", "rmdir":
		p.recordActivity(cs.ID, userID, in.Op, argString(in.Args, "path"))
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(res)
}

// argString reads a string arg, or "".
func argString(args map[string]interface{}, k string) string {
	s, _ := args[k].(string)
	return s
}

// POST /codespace/op/response {req_id, result} — the connector returns an op result.
func (p *Plugin) handleCodespaceOpResponse(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ReqID  string          `json:"req_id"`
		Result json.RawMessage `json:"result"`
	}
	body, _ := io.ReadAll(http.MaxBytesReader(w, r.Body, 8<<20))
	if json.Unmarshal(body, &in); in.ReqID == "" {
		http.Error(w, "req_id required", http.StatusBadRequest)
		return
	}
	csb.resolve(in.ReqID, in.Result)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
