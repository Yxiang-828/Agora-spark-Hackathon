export type AgoraTabId = 'settings' | 'home' | 'connect' | 'skills' | 'archive' | 'codespace';

// Settings is the ordered "start here" surface (Settings → Onboarding → Channels), so it's
// what the shell lands on first.
export const DEFAULT_AGORA_TAB: AgoraTabId = 'settings';

const listeners = new Set<(tab: AgoraTabId) => void>();
let requestedTab: AgoraTabId = DEFAULT_AGORA_TAB;

export const getRequestedAgoraTab = () => requestedTab;

export const requestAgoraTab = (tab: AgoraTabId) => {
    requestedTab = tab;
    listeners.forEach((listener) => listener(tab));
};

export const subscribeAgoraTabRequests = (listener: (tab: AgoraTabId) => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};

// --- Full-page workspace (the spacious surface) ---------------------------------
// A separate channel from the RHS tab requests: this drives the full-screen Agora
// Workspace overlay (codespace + tools as full-width tabs), not the right sidebar.
type WorkspaceListener = (open: boolean, tab: AgoraTabId) => void;
const wsListeners = new Set<WorkspaceListener>();
let wsOpen = false;
let wsTab: AgoraTabId = 'codespace';

export const getWorkspaceState = () => ({open: wsOpen, tab: wsTab});

export const openAgoraWorkspace = (tab: AgoraTabId = 'codespace') => {
    wsOpen = true;
    wsTab = tab;
    wsListeners.forEach((listener) => listener(wsOpen, wsTab));
};

export const closeAgoraWorkspace = () => {
    wsOpen = false;
    wsListeners.forEach((listener) => listener(wsOpen, wsTab));
};

export const subscribeAgoraWorkspace = (listener: WorkspaceListener) => {
    wsListeners.add(listener);
    return () => {
        wsListeners.delete(listener);
    };
};
