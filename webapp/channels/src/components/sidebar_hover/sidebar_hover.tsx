// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {useEffect} from 'react';

import './sidebar_hover.scss';

// Collapse the left sidebar to a slim icon rail and expand it on approach. We drive the open/
// close state from the cursor's X position (not CSS :hover on the thin rail) so the trigger is a
// generous band from the very left screen edge inward — no dead strip, no pixel-precise hover —
// and so the animation timing lives entirely in CSS (slow + smooth). Hysteresis (open near the
// edge, close only well past the expanded width) stops the flicker you'd get from a single
// threshold. Native, de-jailed replacement for the plugin's SidebarHoverController; also hides
// the "Invite Members" label when collapsed (the plugin left it visible, clipping to a "M").

const OPEN_TRIGGER_PX = 120; // cursor within this band from the left edge -> expand
const KEEP_OPEN_PX = 280;    // close as soon as the cursor leaves the expanded sidebar (264px) + a hair
const OPEN_DELAY = 0;        // no delay — open the instant the cursor enters the band
const CLOSE_DELAY = 0;       // no delay — close the instant the cursor leaves; the 160px hysteresis
                             // gap (open<=120, close>280) is what prevents flicker, not a timer

const SidebarHover = (): null => {
    useEffect(() => {
        const body = document.body;
        body.classList.add('agora-lhs-hover-enabled');

        const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
        let openT = 0;
        let closeT = 0;
        let raf = 0;
        let lastX = Number.MAX_SAFE_INTEGER;

        const open = () => {
            window.clearTimeout(closeT);
            if (!body.classList.contains('agora-lhs-open')) {
                window.clearTimeout(openT);
                openT = window.setTimeout(() => body.classList.add('agora-lhs-open'), OPEN_DELAY);
            }
        };
        const close = () => {
            window.clearTimeout(openT);
            if (body.classList.contains('agora-lhs-open')) {
                window.clearTimeout(closeT);
                closeT = window.setTimeout(() => body.classList.remove('agora-lhs-open'), CLOSE_DELAY);
            }
        };

        const evaluate = () => {
            raf = 0;
            if (!fine.matches || window.innerWidth < 769) {
                window.clearTimeout(openT);
                window.clearTimeout(closeT);
                body.classList.remove('agora-lhs-open');
                return;
            }
            if (lastX <= OPEN_TRIGGER_PX) {
                open();
            } else if (lastX > KEEP_OPEN_PX) {
                close();
            } else {
                // inside the hysteresis band: don't change state, just cancel a pending close
                window.clearTimeout(closeT);
            }
        };

        const onMove = (e: MouseEvent) => {
            lastX = e.clientX;
            if (!raf) {
                raf = window.requestAnimationFrame(evaluate);
            }
        };

        // keep it open while focus (keyboard / a search input) is inside the sidebar
        const onFocusIn = (e: FocusEvent) => {
            const sb = document.getElementById('SidebarContainer');
            if (sb && e.target instanceof Node && sb.contains(e.target)) {
                window.clearTimeout(closeT);
                window.clearTimeout(openT);
                body.classList.add('agora-lhs-open');
            }
        };

        window.addEventListener('mousemove', onMove, {passive: true});
        document.addEventListener('focusin', onFocusIn);

        return () => {
            window.removeEventListener('mousemove', onMove);
            document.removeEventListener('focusin', onFocusIn);
            window.clearTimeout(openT);
            window.clearTimeout(closeT);
            if (raf) {
                window.cancelAnimationFrame(raf);
            }
            body.classList.remove('agora-lhs-hover-enabled', 'agora-lhs-open');
        };
    }, []);
    return null;
};

export default SidebarHover;
