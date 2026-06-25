import manifest from 'manifest';
import React, {useEffect, useState} from 'react';

import {subscribeActivity} from './activity';
import Avatar from './Avatar';
import {apiFetch} from './client';

// The codespace activity feed: who did what (saved / committed / pushed / file ops), when. Lives
// off the server's append-only log and refreshes whenever the room broadcasts cs_activity.

const API = `/plugins/${manifest.id}/api/v1`;

type Item = {kind: string; user_id: string; name: string; detail: string; at: number};

const VERB: Record<string, string> = {
    save: 'saved',
    commit: 'committed',
    push: 'pushed',
    write: 'wrote',
    rename: 'renamed',
    delete: 'deleted',
    mkdir: 'created folder',
    rmdir: 'deleted folder',
    ai: 'asked the AI',
};

const ago = (ms: number): string => {
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 60) {
        return `${s}s ago`;
    }
    if (s < 3600) {
        return `${Math.round(s / 60)}m ago`;
    }
    if (s < 86400) {
        return `${Math.round(s / 3600)}h ago`;
    }
    return `${Math.round(s / 86400)}d ago`;
};

const ActivityFeed = ({csId, channelId, onClose}: {csId: string; channelId: string; onClose: () => void}) => {
    const [items, setItems] = useState<Item[]>([]);

    useEffect(() => {
        let alive = true;
        const load = () => apiFetch(`${API}/codespaces/${csId}/activity?channel=${channelId}`).
            then((r) => (r.ok ? r.json() : [])).
            then((d) => {
                if (alive) {
                    setItems(Array.isArray(d) ? d : []);
                }
            }).
            catch(() => undefined);
        load();
        const unsub = subscribeActivity((data) => {
            if (data.codespace_id === csId) {
                load();
            }
        });
        return () => {
            alive = false;
            unsub();
        };
    }, [csId, channelId]);

    const recent = items.slice(-60).reverse();
    return (
        <div style={{marginTop: 6, border: '1px solid rgba(var(--center-channel-color-rgb),.15)', borderRadius: 5, overflow: 'hidden'}}>
            <div style={{display: 'flex', alignItems: 'center', padding: '3px 8px', fontSize: 11, background: 'rgba(var(--center-channel-color-rgb),.06)'}}>
                <b>{'Activity'}</b>
                <span style={{flex: 1}}/>
                <button
                    style={{background: 'none', border: 0, color: 'inherit', cursor: 'pointer', opacity: 0.6}}
                    onClick={onClose}
                >{'×'}</button>
            </div>
            <div style={{maxHeight: 220, overflow: 'auto', padding: '4px 8px', fontSize: 12}}>
                {recent.length === 0 && <div style={{opacity: 0.6, padding: '4px 0'}}>{'No activity yet — saves, commits and file changes show here.'}</div>}
                {recent.map((it, i) => (
                    <div
                        key={i}
                        style={{display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0'}}
                    >
                        <Avatar
                            id={it.user_id}
                            name={it.name}
                            color='#888'
                            size={16}
                        />
                        <span style={{fontWeight: 600}}>{it.name}</span>
                        <span style={{opacity: 0.75}}>{VERB[it.kind] || it.kind}</span>
                        {it.detail && <span style={{opacity: 0.9, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220}}>{it.detail.split('\n')[0]}</span>}
                        <span style={{flex: 1}}/>
                        <span style={{opacity: 0.5, fontSize: 11, flex: 'none'}}>{ago(it.at)}</span>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default ActivityFeed;
