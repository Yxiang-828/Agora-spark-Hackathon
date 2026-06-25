// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useEffect, useState} from 'react';
import {useDispatch, useSelector} from 'react-redux';

import type {GlobalState} from '@mattermost/types/store';

import {getChannel, getCurrentChannelId} from 'mattermost-redux/selectors/entities/channels';
import {getCurrentTeamId} from 'mattermost-redux/selectors/entities/teams';

import {switchToChannelById} from 'actions/views/channel';

import './channel_tabs.scss';

// Native channel tabs: a browser-style tab strip above the channel content for the channels
// you've opened. The de-jailed, fixed version of the plugin's ChannelTabStrip — it navigates
// the router properly (switchToChannelById, not a bare selectChannel that left the view stale)
// and renders natively in #channel_view (no MutationObserver/portal churn that pegged the UI).

const KEY = (teamId: string) => `agora.channeltabs.${teamId}`;

const load = (teamId: string): string[] => {
    try {
        const raw = JSON.parse(window.localStorage.getItem(KEY(teamId)) || '[]');
        return Array.isArray(raw) ? raw.filter((x) => typeof x === 'string') : [];
    } catch (e) {
        return [];
    }
};
const persist = (teamId: string, ids: string[]) => {
    try {
        window.localStorage.setItem(KEY(teamId), JSON.stringify(ids));
    } catch (e) {
        // ignore
    }
};

const nextActive = (tabs: string[], closed: string, active: string): string | null => {
    const idx = tabs.indexOf(closed);
    const remaining = tabs.filter((id) => id !== closed);
    if (!remaining.length) {
        return null;
    }
    return remaining[Math.max(0, idx - 1)] || remaining[0];
};

type TabProps = {channelId: string; active: boolean; closable: boolean; onSelect: (id: string) => void; onClose: (id: string) => void};

const Tab = ({channelId, active, closable, onSelect, onClose}: TabProps) => {
    const label = useSelector((state: GlobalState) => {
        const c = getChannel(state, channelId);
        return c?.display_name || c?.name || 'Channel';
    });
    return (
        <div className={`agora-channel-tabs__tab${active ? ' is-active' : ''}`} role='presentation'>
            <button
                className='agora-channel-tabs__select'
                type='button'
                role='tab'
                aria-selected={active}
                onClick={() => onSelect(channelId)}
            >
                <span className='agora-channel-tabs__label'>{label}</span>
            </button>
            {closable && (
                <button
                    className='agora-channel-tabs__close'
                    type='button'
                    aria-label={`Close ${label}`}
                    onClick={(e) => {
                        e.stopPropagation();
                        onClose(channelId);
                    }}
                >{'×'}</button>
            )}
        </div>
    );
};

const ChannelTabs = (): JSX.Element | null => {
    const dispatch = useDispatch();
    const teamId = useSelector(getCurrentTeamId) || '';
    const current = useSelector(getCurrentChannelId);
    const [openIds, setOpenIds] = useState<string[]>([]);

    // hydrate per team
    useEffect(() => {
        if (teamId) {
            setOpenIds(load(teamId));
        }
    }, [teamId]);

    // auto-open the current channel
    useEffect(() => {
        if (!teamId || !current) {
            return;
        }
        setOpenIds((ids) => (ids.includes(current) ? ids : [...ids, current]));
    }, [current, teamId]);

    // persist
    useEffect(() => {
        if (teamId) {
            persist(teamId, openIds);
        }
    }, [openIds, teamId]);

    const tabs = openIds.length ? openIds : (current ? [current] : []);
    if (!teamId || tabs.length === 0) {
        return null;
    }

    const select = (id: string) => {
        if (id !== current) {
            dispatch(switchToChannelById(id));
        }
    };
    const close = (id: string) => setOpenIds((ids) => {
        const next = ids.filter((x) => x !== id);
        if (id === current) {
            const n = nextActive(ids, id, current);
            if (n) {
                dispatch(switchToChannelById(n));
            }
        }
        return next;
    });

    return (
        <div
            className='agora-channel-tabs'
            role='tablist'
            aria-label='Open channels'
        >
            {tabs.map((id) => (
                <Tab
                    key={id}
                    channelId={id}
                    active={id === current}
                    closable={tabs.length > 1}
                    onSelect={select}
                    onClose={close}
                />
            ))}
        </div>
    );
};

export default ChannelTabs;
