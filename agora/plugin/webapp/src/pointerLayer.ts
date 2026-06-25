/* eslint-disable @typescript-eslint/no-explicit-any */
import {ViewPlugin} from '@codemirror/view';
import type {ViewUpdate, EditorView} from '@codemirror/view';
import type {Awareness} from 'y-protocols/awareness';

// Canva-style live mouse pointers. yCollab already shows each peer's *text caret* (where they're
// editing); this adds the *mouse pointer* — the little arrow that floats over the editor following
// someone's mouse, even when they're just reading and not typing.
//
// The hard part is that two people have different scroll positions, window sizes, and font metrics,
// so raw screen pixels don't translate. We anchor instead to a document position: broadcast the doc
// offset under the local mouse (+ a small pixel delta so the arrow tip lands exactly, not snapped to
// a character), and each peer re-derives the on-screen point from that offset. Anchoring to content
// means the pointer stays meaningful when anyone scrolls — it sticks to the code, like the caret does.
//
// Smoothness, the Canva way: the network only delivers a position every THROTTLE_MS, which on its
// own looks steppy. So we never render the raw target — a per-frame requestAnimationFrame loop eases
// each pointer toward its target (a simple lerp), turning coarse network samples into buttery motion.

const THROTTLE_MS = 50; // local broadcast rate (~20/sec) — the rAF lerp fills in the rest
const EASE = 0.28; // per-frame approach toward target; lower = smoother/laggier, higher = snappier
const SNAP = 0.5; // px below which we stop easing and settle exactly

let stylesInjected = false;
const injectStyles = () => {
    if (stylesInjected) {
        return;
    }
    stylesInjected = true;
    const el = document.createElement('style');
    el.textContent = `
.cm-remote-pointers { position:absolute; inset:0; overflow:hidden; pointer-events:none; z-index:4; }
.cm-rp { position:absolute; top:0; left:0; will-change:transform; }
.cm-rp-arrow { display:block; filter:drop-shadow(0 1px 1px rgba(0,0,0,.35)); }
.cm-rp-label { position:absolute; left:12px; top:14px; padding:1px 6px; border-radius:9px; font-size:11px;
    line-height:1.5; font-family:sans-serif; color:#fff; white-space:nowrap; box-shadow:0 1px 2px rgba(0,0,0,.3); }`;
    document.head.appendChild(el);
};

type PointerState = {pos: number; dx: number; dy: number};
type Peer = {el: HTMLDivElement; curX: number; curY: number; tgtX: number; tgtY: number; placed: boolean};

const ARROW = '<path d="M1 1 L1 16 L5 12 L8 18 L11 17 L8 11 L13 11 Z" fill="COLOR" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/>';

export const remotePointers = (awareness: Awareness) => ViewPlugin.fromClass(class {
    private readonly layer: HTMLDivElement;
    private readonly peers = new Map<number, Peer>();
    private lastSent = 0;
    private raf = 0;

    constructor(private readonly view: EditorView) {
        injectStyles();

        // Our absolute coords are measured against view.dom's box, so it must be the offset parent.
        if (getComputedStyle(view.dom).position === 'static') {
            view.dom.style.position = 'relative';
        }
        this.layer = document.createElement('div');
        this.layer.className = 'cm-remote-pointers';
        view.dom.appendChild(this.layer);
        view.scrollDOM.addEventListener('mousemove', this.onMove);
        view.scrollDOM.addEventListener('mouseleave', this.onLeave);
        awareness.on('change', this.sync);
        this.sync();
    }

    update(u: ViewUpdate) {
        // Re-derive targets when geometry changes or anyone scrolls (coordsAtPos tracks scroll).
        if (u.geometryChanged || u.viewportChanged || u.docChanged) {
            this.sync();
        }
    }

    destroy() {
        this.view.scrollDOM.removeEventListener('mousemove', this.onMove);
        this.view.scrollDOM.removeEventListener('mouseleave', this.onLeave);
        awareness.off('change', this.sync);
        awareness.setLocalStateField('pointer', null);
        if (this.raf) {
            cancelAnimationFrame(this.raf);
        }
        this.layer.remove();
    }

    private onMove = (e: MouseEvent) => {
        const now = performance.now();
        if (now - this.lastSent < THROTTLE_MS) {
            return;
        }
        this.lastSent = now;
        const pos = this.view.posAtCoords({x: e.clientX, y: e.clientY}, false);
        const c = this.view.coordsAtPos(pos);
        const dx = c ? Math.round(e.clientX - c.left) : 0;
        const dy = c ? Math.round(e.clientY - c.top) : 0;
        awareness.setLocalStateField('pointer', {pos, dx, dy});
    };

    private onLeave = () => {
        awareness.setLocalStateField('pointer', null);
    };

    // sync reconciles the DOM + targets with awareness state (who's here, where they point).
    private sync = () => {
        const rect = this.view.dom.getBoundingClientRect();
        const docLen = this.view.state.doc.length;
        const seen = new Set<number>();
        awareness.getStates().forEach((st: any, cid: number) => {
            if (cid === awareness.clientID || !st || !st.pointer || !st.user) {
                return;
            }
            const p = st.pointer as PointerState;
            const c = this.view.coordsAtPos(Math.max(0, Math.min(p.pos, docLen)));
            if (!c) {
                return; // scrolled out of view — nothing to draw
            }
            seen.add(cid);
            const tgtX = (c.left - rect.left) + (p.dx || 0);
            const tgtY = (c.top - rect.top) + (p.dy || 0);
            let peer = this.peers.get(cid);
            if (!peer) {
                peer = this.make(cid, st.user);
            }
            peer.tgtX = tgtX;
            peer.tgtY = tgtY;
            if (!peer.placed) {
                // First sighting: jump straight there so it doesn't slide in from the corner.
                peer.curX = tgtX;
                peer.curY = tgtY;
                peer.placed = true;
                peer.el.style.transform = `translate(${tgtX}px, ${tgtY}px)`;
            }
        });
        this.peers.forEach((peer, cid) => {
            if (!seen.has(cid)) {
                peer.el.remove();
                this.peers.delete(cid);
            }
        });
        this.ensureLoop();
    };

    private make(cid: number, user: any): Peer {
        const el = document.createElement('div');
        el.className = 'cm-rp';
        const color = user.color || '#888';
        el.innerHTML =
            `<svg class="cm-rp-arrow" width="16" height="20" viewBox="0 0 16 20">${ARROW.replace('COLOR', color)}</svg>` +
            '<span class="cm-rp-label"></span>';
        const label = el.querySelector('.cm-rp-label') as HTMLElement;
        label.style.background = color;
        label.textContent = user.name || 'anon';
        this.layer.appendChild(el);
        const peer: Peer = {el, curX: 0, curY: 0, tgtX: 0, tgtY: 0, placed: false};
        this.peers.set(cid, peer);
        return peer;
    }

    private ensureLoop() {
        if (!this.raf && this.peers.size > 0) {
            this.raf = requestAnimationFrame(this.tick);
        }
    }

    // tick eases every pointer toward its target once per frame; idles (cancels rAF) once settled.
    private tick = () => {
        let moving = false;
        this.peers.forEach((peer) => {
            const dx = peer.tgtX - peer.curX;
            const dy = peer.tgtY - peer.curY;
            if (Math.abs(dx) < SNAP && Math.abs(dy) < SNAP) {
                peer.curX = peer.tgtX;
                peer.curY = peer.tgtY;
            } else {
                peer.curX += dx * EASE;
                peer.curY += dy * EASE;
                moving = true;
            }
            peer.el.style.transform = `translate(${peer.curX}px, ${peer.curY}px)`;
        });
        this.raf = moving ? requestAnimationFrame(this.tick) : 0;
    };
});
