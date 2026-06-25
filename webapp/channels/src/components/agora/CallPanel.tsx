import React, {useEffect, useState} from 'react';

import {apiFetch} from './client';
import AICall from './AICall';
import type {CallAgent} from './AICall';
import {voiceById, loadVoiceId} from './voices';

// Launcher for the AI call: pick a connected agent and call it. The agent's replies in the channel
// are then spoken aloud in your selected voice (set on the Voice tab). Mirrors starting a call with
// a person — here the callee is an AI.

const API = '/plugins/com.aegis.agora/api/v1';
const dim = (a: number) => `rgba(var(--center-channel-color-rgb),${a})`;

type Agent = {id: string; name: string; online?: boolean};

const CallPanel = ({onOpenTab}: {onOpenTab?: (id: string) => void}): JSX.Element => {
    const [agents, setAgents] = useState<Agent[] | null>(null);
    const [call, setCall] = useState<CallAgent | null>(null);
    const voice = voiceById(loadVoiceId());

    useEffect(() => {
        let alive = true;
        apiFetch(`${API}/agents`).
            then((r) => (r.ok ? r.json() : [])).
            then((list: Array<{id?: string; user_id?: string; username?: string; name?: string; online?: boolean}>) => {
                if (!alive) {
                    return;
                }
                const mapped = (Array.isArray(list) ? list : []).map((a) => ({
                    id: a.user_id || a.id || '',
                    name: a.name || a.username || 'agent',
                    online: a.online,
                })).filter((a) => a.id);
                setAgents(mapped);
            }).
            catch(() => alive && setAgents([]));
        return () => {
            alive = false;
        };
    }, []);

    return (
        <div style={{padding: 16, fontSize: 14, color: 'var(--center-channel-color)', height: '100%', overflowY: 'auto', boxSizing: 'border-box'}}>
            <div style={{fontWeight: 700, fontSize: 16}}>{'Call an agent'}</div>
            <div style={{fontSize: 12, color: dim(0.64), marginBottom: 14}}>
                {'Start a voice call with a connected agent — it speaks its replies aloud. '}
                <button
                    type='button'
                    onClick={() => onOpenTab?.('voice')}
                    style={{border: 0, background: 'none', color: 'var(--link-color,#386fe5)', cursor: 'pointer', padding: 0, font: 'inherit'}}
                >{voice ? `Voice: ${voice.name}` : 'Pick a voice'}</button>
            </div>

            {agents === null && <div style={{color: dim(0.6)}}>{'Loading agents…'}</div>}
            {agents && agents.length === 0 && (
                <div style={{color: dim(0.7), marginBottom: 14}}>
                    {'No connected agents yet. Connect one in '}
                    <button
                        type='button'
                        onClick={() => onOpenTab?.('connect')}
                        style={{border: 0, background: 'none', color: 'var(--link-color,#386fe5)', cursor: 'pointer', padding: 0, font: 'inherit'}}
                    >{'Connect AI'}</button>
                    {'. You can still try the call UI below.'}
                </div>
            )}

            {agents && agents.map((a) => (
                <div
                    key={a.id}
                    style={{display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 8, border: `1px solid ${dim(0.1)}`, marginBottom: 6}}
                >
                    <span style={{flex: 'none', width: 8, height: 8, borderRadius: 8, background: a.online ? 'var(--online-indicator,#3db887)' : dim(0.3)}}/>
                    <div style={{flex: 1, fontWeight: 600}}>{a.name}</div>
                    <button
                        type='button'
                        onClick={() => setCall({id: a.id, name: a.name})}
                        style={{minHeight: 30, padding: '0 14px', border: 0, borderRadius: 6, background: 'var(--button-bg,#1c58d9)', color: 'var(--button-color,#fff)', fontWeight: 600, cursor: 'pointer'}}
                    >{'📞 Call'}</button>
                </div>
            ))}

            {/* Try-the-UI entry so the call surface is reachable even with no agent connected */}
            <button
                type='button'
                onClick={() => setCall({id: '__demo__', name: 'Agent (demo)'})}
                style={{marginTop: 10, minHeight: 32, padding: '0 14px', borderRadius: 6, border: `1px solid ${dim(0.16)}`, background: dim(0.04), color: 'inherit', fontWeight: 600, cursor: 'pointer'}}
            >{'Try the call UI'}</button>

            {call && (
                <AICall
                    agent={call}
                    onEnd={() => setCall(null)}
                />
            )}
        </div>
    );
};

export default CallPanel;
