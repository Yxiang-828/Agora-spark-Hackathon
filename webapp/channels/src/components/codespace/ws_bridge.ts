// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// Agora native codespace: route the Agora plugin's WebSocket relay events to the open Yjs docs.
//
// In the plugin build this was done with registry.registerWebSocketEventHandler(...). Natively we
// attach a single listener to the app's shared WebSocketClient and dispatch the codespace events
// ourselves. The plugin emits them as `custom_<pluginId>_<name>`; we match on that prefix and hand
// the payload to the collab bus (yprovider). On reconnect we re-sync every open document.

import WebSocketClient from 'client/web_websocket_client';

import {csReceiveActivity} from './activity';
import {csReceiveComments} from './comments';
import {csReceivePresence} from './presence';
import {csReceiveTermBusy} from './terminal';
import {PLUGIN_ID, csReceiveDoc, csReceiveAwareness, csResyncAll} from './yprovider';

// The plugin namespaces its events; this is the prefix every codespace event carries.
const PREFIX = `custom_${PLUGIN_ID}_`;

// A WS message is a strict union in the typed client and does not include plugin custom events,
// so we read it through a minimal structural shape.
type RawWsMessage = {event?: string; data?: any};

let started = false;

// startCodespaceWsBridge wires the listeners exactly once, however many editors mount.
export function startCodespaceWsBridge(): void {
    if (started) {
        return;
    }
    started = true;

    WebSocketClient.addMessageListener((raw: unknown) => {
        const msg = raw as RawWsMessage;
        const event = msg?.event;
        if (!event || !event.startsWith(PREFIX)) {
            return;
        }
        const name = event.slice(PREFIX.length);
        const data = msg.data || {};
        switch (name) {
        case 'cs_doc_update':
            csReceiveDoc(data);
            break;
        case 'cs_awareness':
            csReceiveAwareness(data);
            break;
        case 'cs_presence':
            csReceivePresence(data);
            break;
        case 'cs_term_busy':
            csReceiveTermBusy(data);
            break;
        case 'cs_activity':
            csReceiveActivity(data);
            break;
        case 'cs_comments':
            csReceiveComments(data);
            break;
        default:
            // unknown future event — ignore so it never throws.
            break;
        }
    });

    // After a dropped/restored socket, re-sync every open codespace doc (no lost edits).
    WebSocketClient.addReconnectListener(() => csResyncAll());
}
