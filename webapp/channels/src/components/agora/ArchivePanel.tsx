import React, {useCallback, useEffect, useRef, useState} from 'react';

import {apiFetch} from './client';

// The Archive: review pending proposals (the Gate) and browse the approved Dictionary.
// Approve/Reject only act for authorized users; the server enforces it regardless (403).

type Proposal = {id: string; agent_name?: string; issue: string; root_cause?: string; fix: string; created_at?: number};
type Entry = Proposal & {approved_by?: string; approved_at?: number};

const ERR = 'var(--error-text, #D24B4E)';
const OK = 'var(--online-indicator, #3FB950)';
const EASE = 'cubic-bezier(.23,1,.32,1)';
const API = '/plugins/com.aegis.agora/api/v1';

const CSS = `
.agora-ar { padding:16px; font-size:14px; color:var(--center-channel-color);
  height:100%; overflow-y:auto; box-sizing:border-box; }
.agora-ar__top { display:flex; align-items:flex-start; justify-content:space-between; gap:8px; }
.agora-ar__title { font-weight:700; }
.agora-ar__meta { font-size:12px; color:rgba(var(--center-channel-color-rgb),.64); margin-top:2px; }
.agora-ar__sec { font-weight:700; font-size:12px; text-transform:uppercase; letter-spacing:.04em;
  color:rgba(var(--center-channel-color-rgb),.6); margin:18px 0 6px; }
.agora-ar__card { border:1px solid rgba(var(--center-channel-color-rgb),.12); border-radius:8px;
  padding:10px 12px; margin:8px 0; animation: agoraInA 220ms ${EASE} both; }
.agora-ar__issue { font-weight:600; }
.agora-ar__kv { font-size:13px; margin-top:4px; color:rgba(var(--center-channel-color-rgb),.85); }
.agora-ar__from { font-size:12px; color:rgba(var(--center-channel-color-rgb),.55); margin-top:6px; }
.agora-ar__btns { display:flex; gap:8px; margin-top:10px; }
.agora-ar__btn { border:1px solid rgba(var(--center-channel-color-rgb),.18); border-radius:5px;
  padding:5px 12px; font-size:13px; font-weight:600; cursor:pointer; background:none; color:inherit;
  transition: transform 140ms ${EASE}, background 140ms ease, border-color 140ms ease; }
.agora-ar__btn:active { transform: scale(.97); }
.agora-ar__btn--approve { color:${OK}; border-color:rgba(63,185,80,.5); }
.agora-ar__btn--approve:hover { background:rgba(63,185,80,.1); }
.agora-ar__btn--reject:hover { background:rgba(210,75,78,.1); border-color:${ERR}; color:${ERR}; }
.agora-ar__note { font-size:12px; color:rgba(var(--center-channel-color-rgb),.55); margin-top:8px; font-style:italic; }
.agora-ar__refresh { flex:none; background:none; border:1px solid rgba(var(--center-channel-color-rgb),.16);
  border-radius:4px; padding:4px 9px; font-size:12px; color:inherit; cursor:pointer;
  transition: transform 140ms ${EASE}; }
.agora-ar__refresh:active { transform: scale(.96); }
.agora-ar__err { color:${ERR}; margin-top:10px; }
.agora-ar__skel { height:54px; border-radius:8px; background:rgba(var(--center-channel-color-rgb),.08);
  margin:8px 0; animation: agoraPulseA 1.1s ease-in-out infinite; }
@keyframes agoraInA { from{opacity:0; transform:translateY(4px)} to{opacity:1; transform:none} }
@keyframes agoraPulseA { 0%,100%{opacity:.5} 50%{opacity:1} }
@media (prefers-reduced-motion: reduce){ .agora-ar__card,.agora-ar__btn,.agora-ar__refresh{transition:none;animation:none} .agora-ar__skel{animation:none} }
`;

const rel = (ms?: number) => {
    if (!ms) {
        return '';
    }
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 60) {
        return `${s}s ago`;
    }
    if (s < 3600) {
        return `${Math.round(s / 60)}m ago`;
    }
    return `${Math.round(s / 3600)}h ago`;
};

const ArchivePanel = () => {
    const [proposals, setProposals] = useState<Record<string, Proposal> | null>(null);
    const [dict, setDict] = useState<Record<string, Entry> | null>(null);
    const [err, setErr] = useState('');
    const [approver, setApprover] = useState(false);
    const [actionErr, setActionErr] = useState('');
    const mounted = useRef(true);

    const load = useCallback(() => {
        Promise.all([
            apiFetch(`${API}/proposals`, {credentials: 'same-origin'}).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))),
            apiFetch(`${API}/dictionary`, {credentials: 'same-origin'}).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))),
        ]).then(([p, d]) => {
            if (!mounted.current) {
                return;
            }
            setProposals(p || {});
            setDict(d || {});
            setErr('');
        }).catch((e) => mounted.current && setErr(String(e.message || e)));
    }, []);

    useEffect(() => {
        mounted.current = true;
        apiFetch('/api/v4/users/me', {credentials: 'same-origin'}).
            then((r) => (r.ok ? r.json() : null)).
            then((u) => mounted.current && setApprover(Boolean(u && typeof u.roles === 'string' && u.roles.includes('system_admin')))).
            catch(() => undefined);
        load();
        const t = setInterval(load, 5000);
        return () => {
            mounted.current = false;
            clearInterval(t);
        };
    }, [load]);

    const act = (id: string, verb: 'approve' | 'reject') => {
        setActionErr('');
        apiFetch(`${API}/proposals/${id}/${verb}`, {method: 'POST', credentials: 'same-origin'}).
            then((r) => {
                if (r.status === 403) {
                    throw new Error('Not authorized — an Operator/Lead approves these.');
                }
                if (!r.ok) {
                    throw new Error(`HTTP ${r.status}`);
                }
                load();
            }).
            catch((e) => mounted.current && setActionErr(String(e.message || e)));
    };

    const pending = proposals ? Object.values(proposals) : [];
    const archive = dict ? Object.values(dict) : [];
    const firstLoad = proposals === null && dict === null && !err;

    return (
        <div className='agora-ar'>
            <style>{CSS}</style>
            <div className='agora-ar__top'>
                <div>
                    <div className='agora-ar__title'>{'Archive'}</div>
                    <div className='agora-ar__meta'>
                        {err ? 'last fetch failed' : `${pending.length} pending · ${archive.length} in Dictionary`}
                        {!approver && !err && ' · view only'}
                    </div>
                </div>
                <button
                    className='agora-ar__refresh'
                    onClick={load}
                    aria-label='Refresh'
                >{'Refresh'}</button>
            </div>

            {err && <div className='agora-ar__err'>{`Couldn't load: ${err} `}<button className='agora-ar__refresh' onClick={load}>{'Retry'}</button></div>}
            {actionErr && <div className='agora-ar__err'>{actionErr}</div>}
            {firstLoad && <div><div className='agora-ar__skel'/><div className='agora-ar__skel'/></div>}

            {!firstLoad && !err && (
                <>
                    <div className='agora-ar__sec'>{'Pending review'}</div>
                    {pending.length === 0 && (
                        <div className='agora-ar__meta'>{'Nothing pending. Type '}<code>{'wrap'}</code>{' when @mentioning an agent in a thread to propose a Dictionary entry.'}</div>
                    )}
                    {pending.map((p) => (
                        <div className='agora-ar__card' key={p.id}>
                            <div className='agora-ar__issue'>{p.issue}</div>
                            {p.root_cause && <div className='agora-ar__kv'><b>{'Root cause: '}</b>{p.root_cause}</div>}
                            <div className='agora-ar__kv'><b>{'Fix: '}</b>{p.fix}</div>
                            <div className='agora-ar__from'>{`from ${p.agent_name || 'agent'}${p.created_at ? ` · ${rel(p.created_at)}` : ''}`}</div>
                            {approver ? (
                                <div className='agora-ar__btns'>
                                    <button className='agora-ar__btn agora-ar__btn--approve' onClick={() => act(p.id, 'approve')}>{'Approve'}</button>
                                    <button className='agora-ar__btn agora-ar__btn--reject' onClick={() => act(p.id, 'reject')}>{'Reject'}</button>
                                </div>
                            ) : (
                                <div className='agora-ar__note'>{'An Operator/Lead approves these.'}</div>
                            )}
                        </div>
                    ))}

                    <div className='agora-ar__sec'>{'Dictionary'}</div>
                    {archive.length === 0 && <div className='agora-ar__meta'>{'No approved entries yet.'}</div>}
                    {archive.map((e) => (
                        <div className='agora-ar__card' key={e.id}>
                            <div className='agora-ar__issue'>{e.issue}</div>
                            <div className='agora-ar__kv'><b>{'Fix: '}</b>{e.fix}</div>
                            <div className='agora-ar__from'>{`approved${e.approved_at ? ` · ${rel(e.approved_at)}` : ''}`}</div>
                        </div>
                    ))}
                </>
            )}
        </div>
    );
};

export default ArchivePanel;
