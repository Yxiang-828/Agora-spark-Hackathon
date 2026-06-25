// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import manifest from 'manifest';
import React from 'react';
import type {Store} from 'redux';

import type {GlobalState} from '@mattermost/types/store';

import type {PluginRegistry} from 'types/mattermost-webapp';

import {csReceiveActivity} from './activity';
import type {AgoraTabId} from './agora_tab_controller';
import {openAgoraWorkspace, requestAgoraTab} from './agora_tab_controller';
import AgoraAction from './AgoraAction';
import AgoraShell from './AgoraShell';
import AgoraWorkspace from './AgoraWorkspace';
import {csReceiveComments} from './comments';
import {csReceivePresence} from './presence';
import {csReceiveTermBusy} from './terminal';
import {csReceiveDoc, csReceiveAwareness, csResyncAll} from './yprovider';

// A real signifier (checklist + check), not a text slot. role/aria-label give it an
// accessible name (WCAG 2.2 — name, role, value for non-text controls).
const SkillsIcon = () => (
    <svg
        width='20'
        height='20'
        viewBox='0 0 24 24'
        fill='none'
        role='img'
        aria-label='Skills'
        xmlns='http://www.w3.org/2000/svg'
        style={{display: 'block'}}
    >
        <title>{'Skills'}</title>
        <path
            d='M4 6h10M4 12h10M4 18h6'
            stroke='currentColor'
            strokeWidth='2'
            strokeLinecap='round'
        />
        <path
            d='M16.5 17.2l1.7 1.8 3.3-4'
            stroke='currentColor'
            strokeWidth='2'
            strokeLinecap='round'
            strokeLinejoin='round'
        />
    </svg>
);

const ArchiveIcon = () => (
    <svg
        width='20'
        height='20'
        viewBox='0 0 24 24'
        fill='none'
        role='img'
        aria-label='Archive'
        xmlns='http://www.w3.org/2000/svg'
        style={{display: 'block'}}
    >
        <title>{'Archive'}</title>
        <rect
            x='3'
            y='4'
            width='18'
            height='4'
            rx='1'
            stroke='currentColor'
            strokeWidth='2'
        />
        <path
            d='M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8'
            stroke='currentColor'
            strokeWidth='2'
        />
        <path
            d='M10 12h4'
            stroke='currentColor'
            strokeWidth='2'
            strokeLinecap='round'
        />
    </svg>
);

const HomeIcon = () => (
    <svg
        width='20'
        height='20'
        viewBox='0 0 24 24'
        fill='none'
        role='img'
        aria-label='Home'
        xmlns='http://www.w3.org/2000/svg'
        style={{display: 'block'}}
    >
        <title>{'Home'}</title>
        <path
            d='M4 11l8-6 8 6'
            stroke='currentColor'
            strokeWidth='2'
            strokeLinecap='round'
            strokeLinejoin='round'
        />
        <path
            d='M6 10v9h12v-9'
            stroke='currentColor'
            strokeWidth='2'
            strokeLinecap='round'
            strokeLinejoin='round'
        />
    </svg>
);

const ConnectIcon = () => (
    <svg
        width='20'
        height='20'
        viewBox='0 0 24 24'
        fill='none'
        role='img'
        aria-label='Connect your AI'
        xmlns='http://www.w3.org/2000/svg'
        style={{display: 'block'}}
    >
        <title>{'Connect your AI'}</title>
        <path
            d='M9 15l6-6'
            stroke='currentColor'
            strokeWidth='2'
            strokeLinecap='round'
        />
        <path
            d='M13 5l1-1a3.5 3.5 0 015 5l-1 1'
            stroke='currentColor'
            strokeWidth='2'
            strokeLinecap='round'
            strokeLinejoin='round'
        />
        <path
            d='M11 19l-1 1a3.5 3.5 0 01-5-5l1-1'
            stroke='currentColor'
            strokeWidth='2'
            strokeLinecap='round'
            strokeLinejoin='round'
        />
    </svg>
);

const SettingsIcon = () => (
    <svg
        width='20'
        height='20'
        viewBox='0 0 24 24'
        fill='none'
        role='img'
        aria-label='Setup'
        xmlns='http://www.w3.org/2000/svg'
        style={{display: 'block'}}
    >
        <title>{'Setup'}</title>
        <circle
            cx='12'
            cy='12'
            r='3'
            stroke='currentColor'
            strokeWidth='2'
        />
        <path
            d='M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1'
            stroke='currentColor'
            strokeWidth='2'
            strokeLinecap='round'
        />
    </svg>
);

const CodeIcon = () => (
    <svg
        width='20'
        height='20'
        viewBox='0 0 24 24'
        fill='none'
        role='img'
        aria-label='Codespace'
        xmlns='http://www.w3.org/2000/svg'
        style={{display: 'block'}}
    >
        <title>{'Codespace'}</title>
        <path
            d='M9 8l-4 4 4 4M15 8l4 4-4 4'
            stroke='currentColor'
            strokeWidth='2'
            strokeLinecap='round'
            strokeLinejoin='round'
        />
    </svg>
);

export default class Plugin {
    public async initialize(registry: PluginRegistry, store: Store<GlobalState>) {
        try {
            this.register(registry, store);
        } catch (e) {
            // A registration error must never reject init and wedge the Mattermost app load.
            /* eslint-disable-next-line no-console */
            console.error('[Agora] plugin init failed:', e);
        }
    }

    private register(registry: PluginRegistry, store: Store<GlobalState>) {
        const reg = registry as any;

        // Rich rendering of agent work (main action + live collapsible sub-actions).
        reg.registerPostTypeComponent('custom_agora_action', AgoraAction);

        // De-jailed: the Agora experience (Codespace + Connect/Skills/Archive/Settings/Home) is now
        // NATIVE in the host webapp (left-sidebar entries → full-width /:team/codespace and /:team/agora).
        // The plugin no longer injects ANY UI chrome — no RHS shell, no channel-header buttons, and no
        // root components (the old ChannelTabStrip channel-tab bar caused constant re-render/refetch and
        // its tabs didn't route; the SidebarHoverController collapsed the sidebar). It keeps only the
        // backend, the agent-post renderer, and the realtime WS relay handlers below.

        // Realtime codespace: route the plugin's WS events to the open Yjs doc. Plugin events
        // arrive as custom_<pluginid>_<name>; the bus matches them to the right document.
        reg.registerWebSocketEventHandler(`custom_${manifest.id}_cs_doc_update`, (msg: any) => csReceiveDoc(msg.data));
        reg.registerWebSocketEventHandler(`custom_${manifest.id}_cs_awareness`, (msg: any) => csReceiveAwareness(msg.data));
        reg.registerWebSocketEventHandler(`custom_${manifest.id}_cs_presence`, (msg: any) => csReceivePresence(msg.data));
        reg.registerWebSocketEventHandler(`custom_${manifest.id}_cs_term_busy`, (msg: any) => csReceiveTermBusy(msg.data));
        reg.registerWebSocketEventHandler(`custom_${manifest.id}_cs_activity`, (msg: any) => csReceiveActivity(msg.data));
        reg.registerWebSocketEventHandler(`custom_${manifest.id}_cs_comments`, (msg: any) => csReceiveComments(msg.data));

        // After a dropped/restored WebSocket, re-sync every open codespace doc (no lost edits).
        reg.registerReconnectHandler(() => csResyncAll());
    }
}

declare global {
    interface Window {
        registerPlugin(pluginId: string, plugin: Plugin): void;
    }
}

window.registerPlugin(manifest.id, new Plugin());
