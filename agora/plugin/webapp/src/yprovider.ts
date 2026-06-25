import manifest from 'manifest';
import {Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates} from 'y-protocols/awareness';
import * as Y from 'yjs';

import {apiFetch, cleanError} from './client';

// RoomProvider — a tiny custom Yjs sync provider over Agora's existing transport.
//
// The plugin is a dumb relay + opaque store (see codespace_doc.go). Locally we type into a
// Yjs doc (instant, optimistic); each local update is POSTed to the room, which broadcasts it
// to the other peers over the Mattermost WebSocket. Remote updates arrive via the WS bus below
// and are applied with the 'remote' origin so we never echo them back. Convergence is Yjs's
// job — no overwrites, ever.
//
// Presence/cursors ride the standard Yjs awareness protocol (binary, base64) over the same
// relay; the CodeMirror editor renders them via y-codemirror.next's yCollab.

const API = `/plugins/${manifest.id}/api/v1`;

export const REMOTE = 'remote'; // Yjs transaction origin for applied-from-network updates
const LOCAL = 'local'; // origin for our own seed (these get sent)

export type PeerInfo = {id: string; name: string; color: string};

const PALETTE = ['#E06C75', '#61AFEF', '#98C379', '#E5C07B', '#C678DD', '#56B6C2', '#D19A66', '#BE5046'];

// A stable color per seed (so a teammate keeps the same color across cursor moves).
export const colorFor = (seed: string): string => {
    let h = 0;
    for (let i = 0; i < seed.length; i++) {
        h = (((h << 5) - h) + seed.charCodeAt(i)) | 0;
    }
    return PALETTE[Math.abs(h) % PALETTE.length];
};

const toB64 = (u: Uint8Array): string => {
    let s = '';
    for (let i = 0; i < u.length; i++) {
        s += String.fromCharCode(u[i]);
    }
    return btoa(s);
};

const fromB64 = (b: string): Uint8Array => {
    const s = atob(b);
    const u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) {
        u[i] = s.charCodeAt(i);
    }
    return u;
};

type ProviderOpts = {
    csId: string;
    channelId: string;
    path: string;
    sessionId: string;
    user: {id: string; name: string; color: string};
    onPeers: (peers: PeerInfo[]) => void;
    onError: (msg: string) => void;
    onLocalEdit: () => void;
};

const providers = new Map<string, RoomProvider>();
const keyOf = (csId: string, path: string) => `${csId}::${path}`;

export class RoomProvider {
    doc: Y.Doc;
    text: Y.Text;
    awareness: Awareness;
    readonly csId: string;
    readonly channelId: string;
    readonly path: string;
    readonly sessionId: string;
    readonly user: {id: string; name: string; color: string};
    private readonly onPeers: (peers: PeerInfo[]) => void;
    private readonly onError: (msg: string) => void;
    private readonly onLocalEdit: () => void;
    private destroyed = false;

    constructor(o: ProviderOpts) {
        this.doc = new Y.Doc();
        this.text = this.doc.getText('content');
        this.awareness = new Awareness(this.doc);
        this.awareness.setLocalStateField('user', {name: o.user.name, color: o.user.color});
        this.csId = o.csId;
        this.channelId = o.channelId;
        this.path = o.path;
        this.sessionId = o.sessionId;
        this.user = o.user;
        this.onPeers = o.onPeers;
        this.onError = o.onError;
        this.onLocalEdit = o.onLocalEdit;
        providers.set(keyOf(this.csId, this.path), this);
        this.doc.on('update', this.handleLocalUpdate);
        this.awareness.on('update', this.handleAwarenessUpdate);
    }

    // The Yjs transaction origin for our seed (so it gets sent like a normal local edit).
    localOrigin() {
        return LOCAL;
    }

    private handleLocalUpdate = (update: Uint8Array, origin: unknown) => {
        if (origin === REMOTE || this.destroyed) {
            return; // applied from the network — don't echo it back
        }
        this.post('update', {update: toB64(update), origin: this.sessionId, replace: false});
        this.onLocalEdit(); // a local edit happened → schedule an auto-flush to disk
    };

    private handleAwarenessUpdate = (
        {added, updated, removed}: {added: number[]; updated: number[]; removed: number[]},
        origin: unknown,
    ) => {
        if (origin !== REMOTE && !this.destroyed) {
            const changed = added.concat(updated, removed);
            this.post('awareness', {update: toB64(encodeAwarenessUpdate(this.awareness, changed)), origin: this.sessionId});
        }
        this.emitPeers();
    };

    private emitPeers() {
        const peers: PeerInfo[] = [];
        this.awareness.getStates().forEach((st: any, cid: number) => {
            if (cid === this.doc.clientID || !st || !st.user) {
                return;
            }
            peers.push({id: String(cid), name: st.user.name, color: st.user.color});
        });
        this.onPeers(peers);
    }

    // open: catch up. Returns 'seed' (we must initialise from disk) or 'join' (apply stored state).
    async open(): Promise<'seed' | 'join'> {
        const r = await apiFetch(`${API}/codespace/doc/open`, this.body({}));
        if (!r.ok) {
            throw new Error(cleanError(await r.text()));
        }
        const d = await r.json();
        if (Array.isArray(d.updates)) {
            for (const u of d.updates) {
                Y.applyUpdate(this.doc, fromB64(u), REMOTE); // catch-up: don't re-send
            }
        }
        return d.role === 'seed' ? 'seed' : 'join';
    }

    // seedFromDisk initialises a fresh doc with the file's current on-disk content (seeder only).
    seedFromDisk(content: string) {
        this.doc.transact(() => {
            if (this.text.length === 0) {
                this.text.insert(0, content);
            }
        }, LOCAL); // sent to the room so joiners receive the initial content
    }

    // compact replaces the server-side update log with one full-state update after a flush,
    // so live history can't grow without bound.
    compact() {
        this.post('update', {update: toB64(Y.encodeStateAsUpdate(this.doc)), origin: this.sessionId, replace: true});
    }

    // flush writes the converged text to the real file on disk (the "disk mirrors live" save).
    async flush(): Promise<void> {
        const r = await apiFetch(`${API}/codespace/doc/flush`, this.body({content: this.text.toString()}));
        if (!r.ok) {
            throw new Error(cleanError(await r.text()));
        }
        this.compact();
    }

    receiveDoc(data: {update: string; origin: string}) {
        if (data.origin === this.sessionId) {
            return; // our own update, echoed back
        }
        Y.applyUpdate(this.doc, fromB64(data.update), REMOTE);
    }

    receiveAwareness(data: {update: string; origin: string}) {
        if (data.origin === this.sessionId) {
            return;
        }
        applyAwarenessUpdate(this.awareness, fromB64(data.update), REMOTE);
    }

    // resync re-establishes the doc after a WebSocket reconnect: re-fetch the stored state (catch
    // up on anything we missed while offline — applying already-seen updates is a Yjs no-op), then
    // re-broadcast our full state + awareness so peers that missed OUR updates converge too.
    async resync(): Promise<void> {
        if (this.destroyed) {
            return;
        }
        try {
            const r = await apiFetch(`${API}/codespace/doc/open`, this.body({}));
            if (r.ok) {
                const d = await r.json();
                if (Array.isArray(d.updates)) {
                    for (const u of d.updates) {
                        Y.applyUpdate(this.doc, fromB64(u), REMOTE);
                    }
                }
            }
            this.post('update', {update: toB64(Y.encodeStateAsUpdate(this.doc)), origin: this.sessionId, replace: false});
            this.post('awareness', {update: toB64(encodeAwarenessUpdate(this.awareness, [this.doc.clientID])), origin: this.sessionId});
        } catch (e) {
            // best effort; the next edit will sync anyway
        }
    }

    destroy() {
        // Tell peers our cursor is gone BEFORE marking destroyed — removeAwarenessStates fires
        // the awareness 'update', which (while not yet destroyed) posts the removal so the other
        // editors drop our caret immediately instead of waiting for the 30s awareness timeout.
        try {
            removeAwarenessStates(this.awareness, [this.doc.clientID], 'destroy');
        } catch (e) {
            // best effort during teardown
        }
        this.destroyed = true;
        this.awareness.off('update', this.handleAwarenessUpdate);
        this.awareness.destroy();
        providers.delete(keyOf(this.csId, this.path));
        this.doc.off('update', this.handleLocalUpdate);
        this.doc.destroy();
    }

    private body(extra: Record<string, unknown>): RequestInit {
        return {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({codespace_id: this.csId, channel_id: this.channelId, path: this.path, ...extra}),
        };
    }

    private post(op: 'update' | 'awareness', extra: Record<string, unknown>) {
        apiFetch(`${API}/codespace/doc/${op}`, this.body(extra)).then((r) => {
            if (!r.ok) {
                return r.text().then((t) => Promise.reject(new Error(cleanError(t))));
            }
            return undefined;
        }).catch((e) => this.onError(String(e.message || e)));
    }
}

// --- WebSocket bus: index.tsx forwards the plugin's WS events here, we route to the doc. ---

export const csReceiveDoc = (data: {codespace_id: string; path: string; update: string; origin: string}) => {
    providers.get(keyOf(data.codespace_id, data.path))?.receiveDoc(data);
};

export const csReceiveAwareness = (data: {codespace_id: string; path: string; update: string; origin: string}) => {
    providers.get(keyOf(data.codespace_id, data.path))?.receiveAwareness(data);
};

// Called on a Mattermost WebSocket reconnect — re-sync every open document so nothing is lost
// while the socket was down.
export const csResyncAll = () => {
    providers.forEach((p) => p.resync());
};
