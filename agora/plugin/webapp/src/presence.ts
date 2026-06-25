import manifest from 'manifest';

import {apiFetch} from './client';

// Codespace-wide presence: who is currently viewing which file. Separate from the per-file Yjs
// awareness (which only knows who's in the SAME file) — this spans the whole codespace so the file
// tree can show a dot on every file someone is in. Ephemeral: broadcast on file change + an ~8s
// heartbeat, and drop members we haven't heard from in ~20s.

const API = `/plugins/${manifest.id}/api/v1`;

export type PresenceMember = {id: string; name: string; color: string; path: string};
export type PresenceMap = Record<string, PresenceMember>; // by user_id

type Sess = {
    csId: string;
    channelId: string;
    selfId: string;
    color: string;
    path: string;
    onUpdate: (m: PresenceMap) => void;
    map: Record<string, PresenceMember & {ts: number}>;
    hb: number;
    sweep: number;
};

let sess: Sess | null = null;

const postPresence = (gone: boolean) => {
    if (!sess) {
        return;
    }
    apiFetch(`${API}/codespace/presence`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({codespace_id: sess.csId, channel_id: sess.channelId, path: sess.path, color: sess.color, gone}),
    }).catch(() => undefined);
};

const emit = () => {
    if (!sess) {
        return;
    }
    const out: PresenceMap = {};
    for (const id of Object.keys(sess.map)) {
        const m = sess.map[id];
        out[id] = {id, name: m.name, color: m.color, path: m.path};
    }
    sess.onUpdate(out);
};

export const leavePresence = () => {
    if (!sess) {
        return;
    }
    postPresence(true);
    window.clearInterval(sess.hb);
    window.clearInterval(sess.sweep);
    sess = null;
};

export type PresenceCtl = {setFile: (path: string) => void; leave: () => void};

export const joinPresence = (csId: string, channelId: string, selfId: string, color: string, onUpdate: (m: PresenceMap) => void): PresenceCtl => {
    leavePresence();
    const s: Sess = {csId, channelId, selfId, color, path: '', onUpdate, map: {}, hb: 0, sweep: 0};
    sess = s;
    s.hb = window.setInterval(() => {
        if (sess === s && s.path) {
            postPresence(false);
        }
    }, 8000);
    s.sweep = window.setInterval(() => {
        if (sess !== s) {
            return;
        }
        const now = Date.now();
        let changed = false;
        for (const id of Object.keys(s.map)) {
            if (now - s.map[id].ts > 20000) {
                delete s.map[id];
                changed = true;
            }
        }
        if (changed) {
            emit();
        }
    }, 5000);
    return {
        setFile: (path: string) => {
            if (sess === s) {
                s.path = path;
                postPresence(false);
            }
        },
        leave: () => leavePresence(),
    };
};

// --- WS bus: index.tsx forwards cs_presence here. ---
export const csReceivePresence = (data: {codespace_id: string; user_id: string; name: string; color: string; path: string; gone: boolean}) => {
    if (!sess || data.codespace_id !== sess.csId || data.user_id === sess.selfId) {
        return; // not our codespace, or our own echo
    }
    if (data.gone || !data.path) {
        if (sess.map[data.user_id]) {
            delete sess.map[data.user_id];
            emit();
        }
        return;
    }
    sess.map[data.user_id] = {id: data.user_id, name: data.name, color: data.color, path: data.path, ts: Date.now()};
    emit();
};
