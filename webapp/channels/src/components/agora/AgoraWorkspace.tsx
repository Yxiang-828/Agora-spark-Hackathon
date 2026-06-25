// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useState} from 'react';
import {useLocation} from 'react-router-dom';

import ArchivePanel from './ArchivePanel';
import CallPanel from './CallPanel';
import ConnectPanel from './ConnectPanel';
import HomePanel from './HomePanel';
import PeopleRolesPanel from './PeopleRolesPanel';
import RoomPanel from './RoomPanel';
import SettingsPanel from './SettingsPanel';
import SkillsPanel from './SkillsPanel';
import VoicePanel from './VoicePanel';

// The native Agora Workspace: the spacious surface from the target design — a left rail of
// tabs + a full-width content area. The de-jailed port of the plugin's AgoraWorkspace; instead
// of a fixed-position, Esc-to-close overlay it renders as a normal routed in-app page. Each tab
// reuses the existing panels (each already reads channel/user/state from redux / the plugin API).

type AgoraTabId = 'connect' | 'call' | 'voice' | 'room' | 'skills' | 'people' | 'archive' | 'settings' | 'home';

type TabDef = {id: AgoraTabId; label: string; Component: React.ComponentType<{onOpenTab?: (id: string) => void}>};

const TABS: TabDef[] = [
    {id: 'connect', label: 'Connect AI', Component: ConnectPanel},
    {id: 'call', label: 'Call', Component: CallPanel},
    {id: 'voice', label: 'Voice', Component: VoicePanel},
    {id: 'room', label: '3D Room', Component: RoomPanel},
    {id: 'skills', label: 'Skills', Component: SkillsPanel},
    {id: 'people', label: 'People & Roles', Component: PeopleRolesPanel},
    {id: 'archive', label: 'Archive', Component: ArchivePanel},
    {id: 'settings', label: 'Settings', Component: SettingsPanel},
    {id: 'home', label: 'Home', Component: HomePanel},
];

const DEFAULT_TAB: AgoraTabId = 'connect';

const AgoraWorkspace = () => {
    // Deep-link support: /:team/agora?tab=room lands directly on a tab (used by the channel-header
    // "3D Room" button and any other in-context entry point).
    const {search} = useLocation();
    const requested = new URLSearchParams(search).get('tab') as AgoraTabId | null;
    const initial = requested && TABS.some((t) => t.id === requested) ? requested : DEFAULT_TAB;
    const [active, setActive] = useState<AgoraTabId>(initial);

    const openTab = (id: string) => {
        if (TABS.some((t) => t.id === id)) {
            setActive(id as AgoraTabId);
        }
    };

    return (
        <div className='agora-ws'>
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
                            onClick={() => setActive(t.id)}
                        >{t.label}</button>
                    ))}
                </nav>
            </aside>
            <main className='agora-ws__main'>
                <div className='agora-ws__body'>
                    {TABS.map((t) => {
                        const Panel = t.Component;
                        return (
                            <div
                                key={t.id}
                                className='agora-ws__panel'
                                role='tabpanel'
                                hidden={active !== t.id}
                            >
                                <Panel onOpenTab={openTab}/>
                            </div>
                        );
                    })}
                </div>
            </main>
        </div>
    );
};

export default AgoraWorkspace;
