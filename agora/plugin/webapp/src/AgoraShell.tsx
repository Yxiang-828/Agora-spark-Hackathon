import React, {useEffect, useState} from 'react';
import {useDispatch} from 'react-redux';

import type {AgoraTabId} from './agora_tab_controller';
import {getRequestedAgoraTab, requestAgoraTab, subscribeAgoraTabRequests} from './agora_tab_controller';
import ArchivePanel from './ArchivePanel';
import CodespacePanel from './CodespacePanel';
import ConnectPanel from './ConnectPanel';
import HomePanel from './HomePanel';
import SettingsPanel from './SettingsPanel';
import SkillsPanel from './SkillsPanel';

const EASE_OUT = 'cubic-bezier(.23,1,.32,1)';

type TabDefinition = {
    id: AgoraTabId;
    label: string;
    Component: React.ComponentType;
};

// Order matters: the shell reads left-to-right as the onboarding path —
// Settings (start here) → Connect AI (onboarding) → Home/Channels guide → the rest.
const TAB_DEFS: TabDefinition[] = [
    {id: 'settings', label: 'Settings', Component: SettingsPanel},
    {id: 'connect', label: 'Connect AI', Component: ConnectPanel},
    {id: 'home', label: 'Home', Component: HomePanel},
    {id: 'skills', label: 'Skills', Component: SkillsPanel},
    {id: 'archive', label: 'Archive', Component: ArchivePanel},
    {id: 'codespace', label: 'Codespace', Component: CodespacePanel},
];

const TAB_BY_ID = TAB_DEFS.reduce<Record<AgoraTabId, TabDefinition>>((acc, tab) => {
    acc[tab.id] = tab;
    return acc;
}, {} as Record<AgoraTabId, TabDefinition>);

const CSS = `
.agora-shell {
  display:flex;
  flex-direction:column;
  min-height:0;
  height:100%;
  color:var(--center-channel-color);
  background:var(--center-channel-bg);
}
.agora-shell__tabs {
  display:flex;
  flex:none;
  align-items:center;
  gap:4px;
  min-height:40px;
  padding:6px 8px;
  border-bottom:1px solid rgba(var(--center-channel-color-rgb),.12);
  overflow-x:auto;
  scrollbar-width:thin;
}
.agora-shell__tab-wrap {
  display:inline-flex;
  flex:none;
  align-items:center;
  max-width:168px;
  min-height:28px;
  border:1px solid rgba(var(--center-channel-color-rgb),.12);
  border-radius:6px 6px 4px 4px;
  background:rgba(var(--center-channel-color-rgb),.04);
  color:inherit;
  transition:transform 140ms ${EASE_OUT}, background 140ms ease, border-color 140ms ease;
}
.agora-shell__tab-wrap:hover {
  background:rgba(var(--center-channel-color-rgb),.07);
}
.agora-shell__tab-wrap:active {
  transform:scale(.98);
}
.agora-shell__tab-wrap.is-active {
  border-color:rgba(var(--button-bg-rgb),.38);
  background:rgba(var(--button-bg-rgb),.1);
  color:var(--button-bg);
  font-weight:600;
}
.agora-shell__tab {
  display:inline-flex;
  flex:1 1 auto;
  align-items:center;
  min-width:0;
  min-height:28px;
  padding:4px 4px 4px 10px;
  border:0;
  background:transparent;
  color:inherit;
  cursor:pointer;
  font:inherit;
  font-size:12px;
  line-height:1;
}
.agora-shell__tab-label {
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}
.agora-shell__close {
  display:inline-flex;
  align-items:center;
  justify-content:center;
  width:18px;
  height:18px;
  padding:0;
  border:0;
  border-radius:4px;
  background:transparent;
  color:inherit;
  font-size:15px;
  line-height:1;
  cursor:pointer;
  opacity:.68;
  transition:transform 120ms ${EASE_OUT}, background 120ms ease, opacity 120ms ease;
}
.agora-shell__close:hover {
  background:rgba(var(--center-channel-color-rgb),.1);
  opacity:1;
}
.agora-shell__close:active {
  transform:scale(.9);
}
.agora-shell__body {
  position:relative;
  flex:1 1 auto;
  min-height:0;
}
.agora-shell__panel {
  height:100%;
  min-height:0;
}
.agora-shell__panel[hidden] {
  display:none;
}
.agora-shell__empty {
  padding:16px;
  font-size:14px;
}
.agora-shell__empty-title {
  font-weight:700;
  margin-bottom:4px;
}
.agora-shell__empty-meta {
  color:rgba(var(--center-channel-color-rgb),.64);
  font-size:12px;
  margin-bottom:12px;
}
.agora-shell__empty-grid {
  display:grid;
  grid-template-columns:repeat(auto-fit, minmax(116px, 1fr));
  gap:8px;
}
.agora-shell__empty-btn {
  min-height:34px;
  border:1px solid rgba(var(--center-channel-color-rgb),.14);
  border-radius:6px;
  background:rgba(var(--center-channel-color-rgb),.04);
  color:inherit;
  cursor:pointer;
  font-weight:600;
  transition:transform 140ms ${EASE_OUT}, background 140ms ease;
}
.agora-shell__empty-btn:hover {
  background:rgba(var(--center-channel-color-rgb),.08);
}
.agora-shell__empty-btn:active {
  transform:scale(.98);
}
@media (prefers-reduced-motion: reduce) {
  .agora-shell__tab-wrap,
  .agora-shell__close,
  .agora-shell__empty-btn {
    transition:none;
  }
}
`;

const nextActiveTab = (tabs: AgoraTabId[], closed: AgoraTabId, active: AgoraTabId | null) => {
    if (active !== closed) {
        return active;
    }
    const idx = tabs.indexOf(closed);
    const remaining = tabs.filter((tab) => tab !== closed);
    if (remaining.length === 0) {
        return null;
    }
    return remaining[Math.max(0, idx - 1)] || remaining[0];
};

const AgoraShell = () => {
    const dispatch = useDispatch();
    const initialTab = getRequestedAgoraTab();
    const [openTabs, setOpenTabs] = useState<AgoraTabId[]>([initialTab]);
    const [activeTab, setActiveTab] = useState<AgoraTabId | null>(initialTab);

    const openTab = (tab: AgoraTabId) => {
        setOpenTabs((tabs) => (tabs.includes(tab) ? tabs : [...tabs, tab]));
        setActiveTab(tab);
    };

    useEffect(() => subscribeAgoraTabRequests(openTab), []);

    // Codespace is a real editor, not a chat sidebar — auto-expand the RHS to the
    // full-width view when it's active, and hand the room back when you leave it.
    // Guarded: an unknown action type is a harmless no-op, never wedges the shell.
    useEffect(() => {
        try {
            dispatch({type: 'SET_RHS_EXPANDED', expanded: activeTab === 'codespace'});
        } catch (e) {
            /* expansion is a nicety, never load-bearing */
        }
        if (activeTab === 'codespace') {
            window.setTimeout(() => window.dispatchEvent(new Event('resize')), 0);
        }
    }, [activeTab, dispatch]);

    const closeTab = (tab: AgoraTabId) => {
        setOpenTabs((tabs) => {
            setActiveTab((active) => nextActiveTab(tabs, tab, active));
            return tabs.filter((t) => t !== tab);
        });
    };

    return (
        <div className='agora-shell'>
            <style>{CSS}</style>
            {openTabs.length > 0 && (
                <div
                    className='agora-shell__tabs'
                    role='tablist'
                    aria-label='Agora panels'
                >
                    {openTabs.map((tabId) => {
                        const tab = TAB_BY_ID[tabId];
                        return (
                            <div
                                key={tab.id}
                                className={`agora-shell__tab-wrap${activeTab === tab.id ? ' is-active' : ''}`}
                                role='presentation'
                            >
                                <button
                                    className='agora-shell__tab'
                                    type='button'
                                    role='tab'
                                    aria-selected={activeTab === tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                >
                                    <span className='agora-shell__tab-label'>{tab.label}</span>
                                </button>
                                <button
                                    className='agora-shell__close'
                                    type='button'
                                    aria-label={`Close ${tab.label}`}
                                    onClick={() => closeTab(tab.id)}
                                >
                                    {'×'}
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}
            <div className='agora-shell__body'>
                {openTabs.length === 0 ? (
                    <div className='agora-shell__empty'>
                        <div className='agora-shell__empty-title'>{'No Agora tabs open'}</div>
                        <div className='agora-shell__empty-meta'>{'Open a workspace panel from the channel header.'}</div>
                        <div className='agora-shell__empty-grid'>
                            {TAB_DEFS.map((tab) => (
                                <button
                                    key={tab.id}
                                    className='agora-shell__empty-btn'
                                    onClick={() => requestAgoraTab(tab.id)}
                                >
                                    {tab.label}
                                </button>
                            ))}
                        </div>
                    </div>
                ) : openTabs.map((tabId) => {
                    const tab = TAB_BY_ID[tabId];
                    const Panel = tab.Component;
                    return (
                        <div
                            key={tab.id}
                            className='agora-shell__panel'
                            role='tabpanel'
                            hidden={activeTab !== tab.id}
                        >
                            <Panel/>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default AgoraShell;
