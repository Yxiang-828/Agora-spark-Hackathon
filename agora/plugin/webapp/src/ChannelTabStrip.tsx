import React, {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {useDispatch, useSelector} from 'react-redux';

import type {GlobalState} from '@mattermost/types/store';

import {selectChannel} from 'mattermost-redux/actions/channels';
import {getChannel, getCurrentChannelId} from 'mattermost-redux/selectors/entities/channels';
import {getCurrentTeamId} from 'mattermost-redux/selectors/entities/teams';

import {loadOpenChannelIds, saveOpenChannelIds} from './channel_tab_storage';

const EASE_OUT = 'cubic-bezier(.23,1,.32,1)';
const MOUNT_ID = 'agora-channel-tabs-mount';

const CSS = `
body.agora-channel-tabs-enabled #channel_view {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  width: 100%;
  overflow: hidden;
}
body.agora-channel-tabs-enabled #agora-channel-tabs-mount {
  flex: none;
  order: -1;
  width: 100%;
  min-width: 0;
}
body.agora-channel-tabs-enabled #channel_view > .container-fluid.channel-view-inner {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  width: 100%;
  height: auto;
  overflow: hidden;
}
body.agora-channel-tabs-enabled #channel_view .inner-wrap.channel__wrap,
body.agora-channel-tabs-enabled #channel_view .inner-wrap.channel__wrap > .row.main,
body.agora-channel-tabs-enabled #channel_view #app-content.app__content {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  width: 100%;
}
body.agora-channel-tabs-enabled #channel_view .inner-wrap.channel__wrap > .row.main {
  display: flex;
  flex-direction: column;
}
.agora-channel-tabs {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  min-height: 36px;
  padding: 4px 8px 0;
  border-bottom: 1px solid rgba(var(--center-channel-color-rgb),.12);
  background: var(--center-channel-bg);
  overflow-x: auto;
  scrollbar-width: thin;
}
.agora-channel-tabs__tab {
  display: inline-flex;
  flex: none;
  align-items: center;
  max-width: 200px;
  min-width: 72px;
  min-height: 30px;
  border: 1px solid rgba(var(--center-channel-color-rgb),.12);
  border-bottom: 0;
  border-radius: 8px 8px 0 0;
  background: rgba(var(--center-channel-color-rgb),.04);
  color: inherit;
  cursor: grab;
  transition: transform 140ms ${EASE_OUT}, background 140ms ease, border-color 140ms ease;
}
.agora-channel-tabs__tab.is-dragging {
  opacity: .55;
  cursor: grabbing;
}
.agora-channel-tabs__tab.is-drop-before {
  box-shadow: -2px 0 0 0 var(--button-bg, #1c58d9);
}
.agora-channel-tabs__tab.is-drop-after {
  box-shadow: 2px 0 0 0 var(--button-bg, #1c58d9);
}
.agora-channel-tabs__tab:hover {
  background: rgba(var(--center-channel-color-rgb),.07);
}
.agora-channel-tabs__tab.is-active {
  border-color: rgba(var(--button-bg-rgb),.38);
  background: rgba(var(--button-bg-rgb),.1);
  color: var(--button-bg);
  font-weight: 600;
}
.agora-channel-tabs__select {
  display: inline-flex;
  flex: 1 1 auto;
  align-items: center;
  min-width: 0;
  min-height: 30px;
  padding: 4px 4px 4px 10px;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  line-height: 1;
}
.agora-channel-tabs__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.agora-channel-tabs__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  margin-right: 4px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
  opacity: .68;
}
.agora-channel-tabs__close:hover {
  background: rgba(var(--center-channel-color-rgb),.1);
  opacity: 1;
}
@media (prefers-reduced-motion: reduce) {
  .agora-channel-tabs__tab {
    transition: none;
  }
}
`;

const nextActiveChannelId = (tabs: string[], closed: string, active: string | null) => {
    if (active !== closed) {
        return active;
    }
    const idx = tabs.indexOf(closed);
    const remaining = tabs.filter((id) => id !== closed);
    if (remaining.length === 0) {
        return null;
    }
    return remaining[Math.max(0, idx - 1)] || remaining[0];
};

const reorder = (tabs: string[], from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= tabs.length || to >= tabs.length) {
        return tabs;
    }
    const next = [...tabs];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
};

const attachMount = (): HTMLElement | null => {
    const channelView = document.querySelector('#channel_view');
    if (!channelView) {
        return null;
    }
    let node = channelView.querySelector(`#${MOUNT_ID}`) as HTMLElement | null;
    if (!node) {
        node = document.createElement('div');
        node.id = MOUNT_ID;
        channelView.insertBefore(node, channelView.firstChild);
    }
    return node;
};

type ChannelTabProps = {
    channelId: string;
    isActive: boolean;
    closable: boolean;
    dropClass: string;
    isDragging: boolean;
    onSelect: (channelId: string) => void;
    onClose: (channelId: string) => void;
    onDragStart: (event: React.DragEvent) => void;
    onDragOver: (event: React.DragEvent) => void;
    onDrop: (event: React.DragEvent) => void;
    onDragEnd: () => void;
};

const ChannelTab = ({
    channelId,
    isActive,
    closable,
    dropClass,
    isDragging,
    onSelect,
    onClose,
    onDragStart,
    onDragOver,
    onDrop,
    onDragEnd,
}: ChannelTabProps) => {
    const label = useSelector((state: GlobalState) => {
        const channel = getChannel(state, channelId);
        return channel?.display_name || channel?.name || 'Channel';
    });

    return (
        <div
            className={`agora-channel-tabs__tab${isActive ? ' is-active' : ''}${isDragging ? ' is-dragging' : ''}${dropClass}`}
            role='presentation'
            draggable
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onDragEnd={onDragEnd}
        >
            <button
                className='agora-channel-tabs__select'
                type='button'
                role='tab'
                aria-selected={isActive}
                onClick={() => onSelect(channelId)}
            >
                <span className='agora-channel-tabs__label'>{label}</span>
            </button>
            {closable && (
                <button
                    className='agora-channel-tabs__close'
                    type='button'
                    aria-label={`Close ${label}`}
                    onClick={() => onClose(channelId)}
                >
                    {'×'}
                </button>
            )}
        </div>
    );
};

const ChannelTabStrip = () => {
    const dispatch = useDispatch();
    const teamId = useSelector(getCurrentTeamId) || '';
    const currentChannelId = useSelector(getCurrentChannelId);
    const [openChannelIds, setOpenChannelIds] = useState<string[]>([]);
    const [mount, setMount] = useState<HTMLElement | null>(null);
    const [dragIndex, setDragIndex] = useState<number | null>(null);
    const [dropIndex, setDropIndex] = useState<number | null>(null);
    const [dropAfter, setDropAfter] = useState(false);
    const hydratedTeam = useRef<string | null>(null);
    const mountRef = useRef<HTMLElement | null>(null);
    const channelViewObserverRef = useRef<MutationObserver | null>(null);
    const saveTimerRef = useRef<number | null>(null);

    const syncMount = useCallback(() => {
        const next = attachMount();
        if (!next) {
            return;
        }
        if (next !== mountRef.current) {
            mountRef.current = next;
            setMount(next);
        }

        const channelView = document.querySelector('#channel_view');
        if (!channelView || channelViewObserverRef.current) {
            return;
        }

        channelViewObserverRef.current = new MutationObserver(() => {
            if (!document.getElementById(MOUNT_ID)) {
                const restored = attachMount();
                if (restored && restored !== mountRef.current) {
                    mountRef.current = restored;
                    setMount(restored);
                }
            }
        });
        channelViewObserverRef.current.observe(channelView, {childList: true});
    }, []);

    useEffect(() => {
        document.body.classList.add('agora-channel-tabs-enabled');
        return () => {
            document.body.classList.remove('agora-channel-tabs-enabled');
        };
    }, []);

    useEffect(() => {
        syncMount();

        const wrapper = document.querySelector('.main-wrapper');
        const wrapperObserver = wrapper ? new MutationObserver((mutations) => {
            const channelViewChanged = mutations.some((mutation) => {
                return [...mutation.addedNodes, ...mutation.removedNodes].some((node) => {
                    return node instanceof Element && node.id === 'channel_view';
                });
            });
            if (channelViewChanged) {
                channelViewObserverRef.current?.disconnect();
                channelViewObserverRef.current = null;
                syncMount();
            }
        }) : null;

        wrapperObserver?.observe(wrapper!, {childList: true, subtree: false});

        return () => {
            wrapperObserver?.disconnect();
            channelViewObserverRef.current?.disconnect();
            channelViewObserverRef.current = null;
            if (saveTimerRef.current !== null) {
                window.clearTimeout(saveTimerRef.current);
            }
            document.getElementById(MOUNT_ID)?.remove();
            mountRef.current = null;
        };
    }, [syncMount]);

    useLayoutEffect(() => {
        if (!mountRef.current?.isConnected) {
            syncMount();
        }
    }, [currentChannelId, syncMount]);

    useEffect(() => {
        if (!teamId || hydratedTeam.current === teamId) {
            return;
        }
        hydratedTeam.current = teamId;
        setOpenChannelIds(loadOpenChannelIds(teamId));
    }, [teamId]);

    useEffect(() => {
        if (!teamId || !currentChannelId) {
            return;
        }
        setOpenChannelIds((tabs) => {
            if (tabs.includes(currentChannelId)) {
                return tabs;
            }
            return [...tabs, currentChannelId];
        });
    }, [currentChannelId, teamId]);

    useEffect(() => {
        if (!teamId) {
            return;
        }
        if (saveTimerRef.current !== null) {
            window.clearTimeout(saveTimerRef.current);
        }
        saveTimerRef.current = window.setTimeout(() => {
            saveOpenChannelIds(teamId, openChannelIds);
        }, 250);
    }, [openChannelIds, teamId]);

    const tabsToShow = openChannelIds.length > 0 ? openChannelIds : (currentChannelId ? [currentChannelId] : []);

    const activateChannel = (channelId: string) => {
        if (channelId === currentChannelId) {
            return;
        }
        dispatch(selectChannel(channelId));
    };

    const closeTab = (channelId: string) => {
        if (tabsToShow.length <= 1) {
            return;
        }
        setOpenChannelIds((tabs) => {
            const nextTabs = tabs.filter((id) => id !== channelId);
            if (currentChannelId === channelId) {
                const nextActive = nextActiveChannelId(tabs, channelId, currentChannelId);
                if (nextActive) {
                    dispatch(selectChannel(nextActive));
                }
            }
            return nextTabs;
        });
    };

    const onDragStart = (index: number) => (event: React.DragEvent) => {
        setDragIndex(index);
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', tabsToShow[index]);
    };

    const onDragOver = (index: number) => (event: React.DragEvent) => {
        event.preventDefault();
        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
        const after = event.clientX > rect.left + (rect.width / 2);
        setDropIndex(index);
        setDropAfter(after);
    };

    const onDrop = (index: number) => (event: React.DragEvent) => {
        event.preventDefault();
        if (dragIndex === null) {
            return;
        }
        let target = index + (dropAfter ? 1 : 0);
        if (dragIndex < target) {
            target -= 1;
        }
        setOpenChannelIds((tabs) => reorder(tabs, dragIndex, target));
        setDragIndex(null);
        setDropIndex(null);
    };

    const onDragEnd = () => {
        setDragIndex(null);
        setDropIndex(null);
    };

    const strip = (
        <div
            className='agora-channel-tabs'
            role='tablist'
            aria-label='Open channels'
        >
            {tabsToShow.map((channelId, index) => {
                const isActive = currentChannelId === channelId;
                const dropClass = dropIndex === index ? (dropAfter ? ' is-drop-after' : ' is-drop-before') : '';
                return (
                    <ChannelTab
                        key={channelId}
                        channelId={channelId}
                        isActive={isActive}
                        closable={tabsToShow.length > 1}
                        dropClass={dropClass}
                        isDragging={dragIndex === index}
                        onSelect={activateChannel}
                        onClose={closeTab}
                        onDragStart={onDragStart(index)}
                        onDragOver={onDragOver(index)}
                        onDrop={onDrop(index)}
                        onDragEnd={onDragEnd}
                    />
                );
            })}
        </div>
    );

    return (
        <>
            <style>{CSS}</style>
            {mount ? createPortal(strip, mount) : null}
        </>
    );
};

export default ChannelTabStrip;
