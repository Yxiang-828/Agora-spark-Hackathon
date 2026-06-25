import React, {useEffect, useState} from 'react';

import type {AgoraTabId} from './agora_tab_controller';
import {closeAgoraWorkspace, getWorkspaceState, subscribeAgoraWorkspace} from './agora_tab_controller';
import ArchivePanel from './ArchivePanel';
import CodespacePanel from './CodespacePanel';
import ConnectPanel from './ConnectPanel';
import HomePanel from './HomePanel';
import SettingsPanel from './SettingsPanel';
import SkillsPanel from './SkillsPanel';

// The full-page Agora Workspace: the spacious surface from the target design — a left
// rail + a top tab strip + full-width content — so Codespace and the tools are real
// workspaces, not panels jammed into the right sidebar. Tabs reuse the existing panels;
// content is Mattermost-wired (each panel already reads channel/user/state from redux).

type TabDef = {id: AgoraTabId; label: string; Component: React.ComponentType};

const TABS: TabDef[] = [
    {id: 'codespace', label: 'Codespace', Component: CodespacePanel},
    {id: 'skills', label: 'Skills', Component: SkillsPanel},
    {id: 'archive', label: 'Archive', Component: ArchivePanel},
    {id: 'connect', label: 'Connect AI', Component: ConnectPanel},
    {id: 'home', label: 'Home', Component: HomePanel},
    {id: 'settings', label: 'Settings', Component: SettingsPanel},
];
const BY_ID = TABS.reduce<Record<string, TabDef>>((acc, t) => {
    acc[t.id] = t;
    return acc;
}, {});

const CSS = `
.agora-ws { position:fixed; inset:0; z-index:1000; display:flex;
  background:var(--center-channel-bg); color:var(--center-channel-color); font:inherit; }
.agora-ws__rail { width:212px; flex:none; display:flex; flex-direction:column;
  padding:12px 8px; border-right:1px solid rgba(var(--center-channel-color-rgb),.12);
  background:rgba(var(--center-channel-color-rgb),.03); }
.agora-ws__brand { display:flex; align-items:center; gap:8px; font-weight:800;
  font-size:18px; letter-spacing:.5px; padding:6px 8px 14px; }
.agora-ws__dot { width:10px; height:10px; border-radius:50%; background:var(--button-bg,#1c58d9); }
.agora-ws__nav { display:flex; flex-direction:column; gap:2px; flex:1; min-height:0; overflow-y:auto; }
.agora-ws__navbtn { display:flex; align-items:center; text-align:left; padding:8px 10px;
  border:0; border-radius:6px; background:transparent; color:inherit; cursor:pointer;
  font:inherit; font-size:13px; transition:background .12s ease; }
.agora-ws__navbtn:hover { background:rgba(var(--center-channel-color-rgb),.07); }
.agora-ws__navbtn.is-active { background:rgba(var(--button-bg-rgb),.12);
  color:var(--button-bg); font-weight:600; }
.agora-ws__back { margin-top:10px; padding:8px 10px; border:1px solid rgba(var(--center-channel-color-rgb),.16);
  border-radius:6px; background:transparent; color:inherit; cursor:pointer; font:inherit; font-size:12px; }
.agora-ws__back:hover { background:rgba(var(--center-channel-color-rgb),.07); }
.agora-ws__main { flex:1; min-width:0; display:flex; flex-direction:column; }
.agora-ws__tabs { height:40px; flex:none; display:flex; align-items:flex-end; gap:2px;
  padding:0 8px; border-bottom:1px solid rgba(var(--center-channel-color-rgb),.12);
  overflow-x:auto; scrollbar-width:thin; }
.agora-ws__tab { display:flex; align-items:center; height:32px;
  border:1px solid rgba(var(--center-channel-color-rgb),.12); border-bottom:0;
  border-radius:6px 6px 0 0; background:rgba(var(--center-channel-color-rgb),.03); }
.agora-ws__tab.is-active { background:var(--center-channel-bg);
  border-top:2px solid var(--button-bg,#1c58d9); }
.agora-ws__tablabel { max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  padding:0 4px 0 12px; border:0; background:transparent; color:inherit; cursor:pointer;
  font:inherit; font-size:12px; }
.agora-ws__tabx { display:inline-flex; align-items:center; padding:0 8px; border:0;
  background:transparent; color:inherit; cursor:pointer; opacity:.55; font-size:15px; line-height:1; }
.agora-ws__tabx:hover { opacity:1; }
.agora-ws__body { position:relative; flex:1; min-height:0; }
.agora-ws__panel { height:100%; min-height:0; }
.agora-ws__panel[hidden] { display:none; }
`;

const AgoraWorkspace = () => {
    const initial = getWorkspaceState();
    const [open, setOpen] = useState(initial.open);
    const [openTabs, setOpenTabs] = useState<AgoraTabId[]>([initial.tab]);
    const [active, setActive] = useState<AgoraTabId>(initial.tab);

    useEffect(() => subscribeAgoraWorkspace((isOpen, tab) => {
        setOpen(isOpen);
        if (isOpen) {
            setOpenTabs((tabs) => (tabs.includes(tab) ? tabs : [...tabs, tab]));
            setActive(tab);
        }
    }), []);

    // Esc returns to chat — a full-page takeover should always be escapable.
    useEffect(() => {
        if (!open) {
            return undefined;
        }
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                closeAgoraWorkspace();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open]);

    if (!open) {
        return null;
    }

    const openTab = (id: AgoraTabId) => {
        setOpenTabs((tabs) => (tabs.includes(id) ? tabs : [...tabs, id]));
        setActive(id);
    };

    const closeTab = (id: AgoraTabId) => {
        setOpenTabs((tabs) => {
            const next = tabs.filter((t) => t !== id);
            if (next.length === 0) {
                closeAgoraWorkspace();
            } else if (active === id) {
                setActive(next[next.length - 1]);
            }
            return next;
        });
    };

    return (
        <div
            className='agora-ws'
            role='dialog'
            aria-label='Agora workspace'
        >
            <style>{CSS}</style>
            <aside className='agora-ws__rail'>
                <div className='agora-ws__brand'>
                    <span className='agora-ws__dot'/>
                    {'Agora'}
                </div>
                <nav className='agora-ws__nav'>
                    {TABS.map((t) => (
                        <button
                            key={t.id}
                            type='button'
                            className={`agora-ws__navbtn${active === t.id ? ' is-active' : ''}`}
                            onClick={() => openTab(t.id)}
                        >{t.label}</button>
                    ))}
                </nav>
                <button
                    type='button'
                    className='agora-ws__back'
                    onClick={() => closeAgoraWorkspace()}
                >{'← Back to chat'}</button>
            </aside>
            <main className='agora-ws__main'>
                <div
                    className='agora-ws__tabs'
                    role='tablist'
                    aria-label='Open workspaces'
                >
                    {openTabs.map((id) => {
                        const t = BY_ID[id];
                        return (
                            <div
                                key={id}
                                className={`agora-ws__tab${active === id ? ' is-active' : ''}`}
                            >
                                <button
                                    type='button'
                                    role='tab'
                                    aria-selected={active === id}
                                    className='agora-ws__tablabel'
                                    onClick={() => setActive(id)}
                                >{t.label}</button>
                                <button
                                    type='button'
                                    aria-label={`Close ${t.label}`}
                                    className='agora-ws__tabx'
                                    onClick={() => closeTab(id)}
                                >{'×'}</button>
                            </div>
                        );
                    })}
                </div>
                <div className='agora-ws__body'>
                    {openTabs.map((id) => {
                        const Panel = BY_ID[id].Component;
                        return (
                            <div
                                key={id}
                                className='agora-ws__panel'
                                role='tabpanel'
                                hidden={active !== id}
                            >
                                <Panel/>
                            </div>
                        );
                    })}
                </div>
            </main>
        </div>
    );
};

export default AgoraWorkspace;
