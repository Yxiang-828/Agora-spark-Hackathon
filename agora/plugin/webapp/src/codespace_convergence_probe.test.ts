/**
 * @jest-environment jsdom
 */
// Codespace convergence probe — the repo mandate: "two headless clients edit the same file
// concurrently → assert convergence AND host-disk persistence." This exercises the REAL Yjs
// provider (yprovider.ts) against a faithful in-memory hub that implements the exact contract
// of codespace_doc.go: seed election on open, append-or-replace update log, broadcast to the
// other peers, catch-up on join, and flush-to-disk. If the CRDT layer or the provider's
// send/receive/seed wiring regressed, these fail.

import {RoomProvider} from './yprovider';

type Stored = {updates: string[]; opened: boolean};

let store: Record<string, Stored>;
let peers: RoomProvider[];
let lastFlush: Record<string, string>;

const ok = (x: any) => Promise.resolve({ok: true, json: () => Promise.resolve(x), text: () => Promise.resolve('')});

// The hub: append + broadcast + catch-up + flush, matching codespace_doc.go's semantics.
const hub = (url: string, opts?: any) => {
    const u = String(url);
    const body = opts && opts.body ? JSON.parse(opts.body) : {};
    const key = `${body.codespace_id}::${body.path}`;
    if (u.endsWith('/codespace/doc/open')) {
        store[key] = store[key] || {updates: [], opened: false};
        const s = store[key];
        const role = s.opened ? 'join' : 'seed';
        s.opened = true;
        return ok({role, updates: s.updates});
    }
    if (u.endsWith('/codespace/doc/update')) {
        store[key] = store[key] || {updates: [], opened: true};
        const s = store[key];
        if (body.replace) {
            s.updates = [body.update]; // compaction
        } else {
            s.updates.push(body.update);
        }
        for (const p of peers) {
            if (p.sessionId !== body.origin) {
                p.receiveDoc({update: body.update, origin: body.origin}); // broadcast to others
            }
        }
        return ok({ok: true});
    }
    if (u.endsWith('/codespace/doc/flush')) {
        lastFlush[key] = body.content;
        return ok({ok: true});
    }
    return ok({ok: true}); // awareness etc.
};

const tick = () => new Promise((r) => setTimeout(r, 0));

// Let the fire-and-forget posts/broadcasts drain (a handful of sequential turns).
const settle = () => tick().then(tick).then(tick).then(tick).then(tick);

const makePeer = (name: string) => {
    const p = new RoomProvider({
        csId: 'cs1',
        channelId: 'ch1',
        path: 'src/main.go',
        sessionId: name,
        user: {id: name, name, color: '#fff'},
        onPeers: () => undefined,
        onError: () => undefined,
        onLocalEdit: () => undefined,
    });
    peers.push(p);
    return p;
};

beforeEach(() => {
    store = {};
    peers = [];
    lastFlush = {};
    (global as any).fetch = jest.fn(hub);
});

afterEach(() => {
    peers.forEach((p) => p.destroy());
});

test('first opener is elected seeder, second joins and catches up to the seeded content', async () => {
    const a = makePeer('A');
    expect(await a.open()).toBe('seed');
    a.seedFromDisk('hello world\n');
    await settle();

    const b = makePeer('B');
    expect(await b.open()).toBe('join');
    await settle();

    expect(b.text.toString()).toBe('hello world\n'); // joiner caught up, no re-seed
    expect(a.text.toString()).toBe('hello world\n');
});

test('concurrent edits by two clients converge to identical text (no overwrites)', async () => {
    const a = makePeer('A');
    await a.open();
    a.seedFromDisk('hello world\n');
    await settle();

    const b = makePeer('B');
    await b.open();
    await settle();

    // Two people type at the same time in different places.
    a.doc.transact(() => a.text.insert(0, 'AAA '), a.localOrigin());
    b.doc.transact(() => b.text.insert(b.text.length, ' BBB'), b.localOrigin());
    await settle();

    // Convergence: both replicas agree, and nobody's edit was lost.
    expect(a.text.toString()).toBe(b.text.toString());
    expect(a.text.toString()).toContain('AAA ');
    expect(a.text.toString()).toContain('hello world');
    expect(a.text.toString()).toContain(' BBB');
});

test('a flush sends the converged text to disk', async () => {
    const a = makePeer('A');
    await a.open();
    a.seedFromDisk('x');
    await settle();
    const b = makePeer('B');
    await b.open();
    await settle();

    b.doc.transact(() => b.text.insert(b.text.length, 'y'), b.localOrigin());
    await settle();

    await a.flush(); // disk mirrors live — the converged text is written
    expect(lastFlush['cs1::src/main.go']).toBe(a.text.toString());
    expect(a.text.toString()).toBe(b.text.toString());
});
