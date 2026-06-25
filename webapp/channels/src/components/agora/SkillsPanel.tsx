import React, {useCallback, useEffect, useRef, useState} from 'react';

import {apiFetch} from './client';

type Compat = {status: string; detail: string};
type Reason = {clause: string; os?: string | null; detail: string};
type Verdict = {
    skill: string;
    verdict: 'ADMIT' | 'REJECT';
    reasons: Reason[];
    compat: Record<string, Compat>;
    host_selfcheck?: string;
    host_selfcheck_detail?: string;
    manifest?: any;
};
type Report = {
    agent: {id: string; name: string};
    reported_at: number;
    admitted: Verdict[];
    rejected: Verdict[];
};

const EASE = 'cubic-bezier(.23,1,.32,1)';
const OK = 'var(--online-indicator, #3FB950)';
const ERR = 'var(--error-text, #D24B4E)';
const AMBER = '#E0A15E';
const GREY = 'rgba(var(--center-channel-color-rgb,61,60,64),0.45)';

const CSS = `
.agora-sk { padding: 16px; font-size: 14px; color: var(--center-channel-color);
  height:100%; overflow-y:auto; box-sizing:border-box; }
.agora-sk__top { display:flex; align-items:flex-start; justify-content:space-between; gap:8px; }
.agora-sk__title { font-weight:700; }
.agora-sk__meta { font-size:12px; color: rgba(var(--center-channel-color-rgb),.64); margin-top:2px; }
.agora-sk__refresh { flex:none; background:none; border:1px solid rgba(var(--center-channel-color-rgb),.16);
  border-radius:4px; padding:4px 9px; font-size:12px; color:inherit; cursor:pointer;
  transition: transform 140ms ${EASE}, background 140ms ease; }
.agora-sk__refresh:hover { background: rgba(var(--center-channel-color-rgb),.06); }
.agora-sk__refresh:active { transform: scale(.96); }
.agora-sk__refresh[disabled] { opacity:.5; cursor:default; }
.agora-sk__agent { margin-top:18px; }
.agora-sk__agentname { font-weight:600; display:flex; align-items:center; gap:6px; }
.agora-badge { display:inline-flex; align-items:center; gap:4px; font-size:11px; line-height:1;
  padding:3px 7px; border-radius:10px; font-weight:600; }
.agora-skill { width:100%; text-align:left; background:none; border:0;
  border-top:1px solid rgba(var(--center-channel-color-rgb),.08); padding:9px 2px; cursor:pointer;
  color:inherit; display:flex; align-items:center; gap:8px; font-size:13px;
  transition: transform 120ms ${EASE}; }
.agora-skill:hover { background: rgba(var(--center-channel-color-rgb),.04); }
.agora-skill:active { transform: scale(.99); }
.agora-skill__chev { flex:none; opacity:.45; transition: transform 180ms ${EASE}; }
.agora-skill[aria-expanded="true"] .agora-skill__chev { transform: rotate(90deg); }
.agora-skill__name { flex:1; font-weight:600; }
.agora-dot { width:8px; height:8px; border-radius:8px; flex:none; }
.agora-detail { display:grid; grid-template-rows:0fr; transition: grid-template-rows 200ms ${EASE}; }
.agora-detail--open { grid-template-rows:1fr; }
.agora-detail__in { overflow:hidden; min-height:0; }
.agora-detail__pad { padding:6px 2px 12px 22px; font-size:12px;
  color: rgba(var(--center-channel-color-rgb),.8); }
.agora-os { display:grid; grid-template-columns:auto auto 1fr; gap:5px 10px; align-items:center; margin:6px 0; }
.agora-kv { margin:8px 0; }
.agora-kv b { font-weight:600; }
.agora-empty { margin-top:8px; line-height:1.5; }
.agora-empty ol { margin:8px 0 0 18px; padding:0; }
.agora-empty li { margin:3px 0; }
.agora-err { color: ${ERR}; margin-top:10px; }
.agora-skel { height:14px; border-radius:4px; background: rgba(var(--center-channel-color-rgb),.08);
  margin:10px 0; animation: agorapulse 1.1s ease-in-out infinite; }
@keyframes agorapulse { 0%,100%{opacity:.5} 50%{opacity:1} }
@media (prefers-reduced-motion: reduce) {
  .agora-skill,.agora-skill__chev,.agora-detail,.agora-sk__refresh{transition:none}
  .agora-skel{animation:none}
}
`;

const dotColor = (s: string) => (s === 'ok' ? OK : s === 'graceful' ? AMBER : GREY);

const Badge = ({children, fg, bg}: {children: React.ReactNode; fg: string; bg: string}) => (
    <span className='agora-badge' style={{color: fg, background: bg}}>{children}</span>
);

const rel = (ms: number) => {
    if (!ms) {
        return 'never';
    }
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 5) {
        return 'just now';
    }
    if (s < 60) {
        return `${s}s ago`;
    }
    if (s < 3600) {
        return `${Math.round(s / 60)}m ago`;
    }
    return `${Math.round(s / 3600)}h ago`;
};

const SkillRow = ({v, agentId}: {v: Verdict; agentId: string}) => {
    const [open, setOpen] = useState(false);
    const admit = v.verdict === 'ADMIT';
    const m = v.manifest || {};
    return (
        <div>
            <button
                className='agora-skill'
                aria-expanded={open}
                onClick={() => setOpen((o) => !o)}
            >
                <span className='agora-skill__chev'>{'▸'}</span>
                <span className='agora-skill__name'>{v.skill}</span>
                {admit ? (
                    <Badge fg={OK} bg='rgba(63,185,80,.14)'>{'ADMIT'}</Badge>
                ) : (
                    <Badge fg={ERR} bg='rgba(210,75,78,.14)'>{`REJECT · ${v.reasons.length}`}</Badge>
                )}
            </button>
            <div className={`agora-detail${open ? ' agora-detail--open' : ''}`}>
                <div className='agora-detail__in'>
                    <div className='agora-detail__pad'>
                        {m.description?.what && (
                            <div className='agora-kv'>{m.description.what}</div>
                        )}
                        <div className='agora-os'>
                            {['windows', 'macos', 'linux'].map((os) => {
                                const c = v.compat?.[os];
                                if (!c) {
                                    return null;
                                }
                                return [
                                    <span
                                        key={`${os}-d`}
                                        className='agora-dot'
                                        style={{background: dotColor(c.status)}}
                                    />,
                                    <span key={`${os}-o`}>{os}</span>,
                                    <span
                                        key={`${os}-s`}
                                        style={{color: 'rgba(var(--center-channel-color-rgb),.6)'}}
                                        title={c.detail}
                                    >{c.status === 'ok' ? c.detail : c.status}</span>,
                                ];
                            })}
                        </div>
                        {v.host_selfcheck && v.host_selfcheck !== 'none' && (
                            <div className='agora-kv'>
                                <b>{'self-check (host): '}</b>
                                <span style={{color: v.host_selfcheck === 'pass' ? OK : ERR}}>
                                    {v.host_selfcheck}
                                </span>
                                {v.host_selfcheck_detail ? ` — ${v.host_selfcheck_detail}` : ''}
                            </div>
                        )}
                        {!admit && v.reasons.length > 0 && (
                            <ul style={{margin: '6px 0 0 16px', color: ERR}}>
                                {v.reasons.map((r, i) => (
                                    <li key={i}>{`${r.clause}${r.os ? ` [${r.os}]` : ''}: ${r.detail}`}</li>
                                ))}
                            </ul>
                        )}
                        {Array.isArray(m.inputs) && m.inputs.length > 0 && (
                            <div className='agora-kv'>
                                <b>{'inputs: '}</b>
                                {m.inputs.map((x: any) => `${x.name}:${x.type}`).join(', ')}
                            </div>
                        )}
                        {Array.isArray(m.errors) && m.errors.length > 0 && (
                            <div className='agora-kv'>
                                <b>{'errors: '}</b>
                                {m.errors.map((x: any) => x.code).join(', ')}
                            </div>
                        )}
                        <div style={{opacity: .5, marginTop: 6}}>
                            {`gated server-side by skill_law · v${m.version || '?'}`}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const SkillsPanel = () => {
    const [reports, setReports] = useState<Record<string, Report> | null>(null);
    const [err, setErr] = useState('');
    const [fetchedAt, setFetchedAt] = useState(0);
    const [loading, setLoading] = useState(false);
    const [, force] = useState(0);
    const mounted = useRef(true);

    const load = useCallback(() => {
        setLoading(true);
        apiFetch('/plugins/com.aegis.agora/api/v1/skills', {credentials: 'same-origin'}).
            then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))).
            then((d) => {
                if (!mounted.current) {
                    return;
                }
                setReports(d || {});
                setErr('');
                setFetchedAt(Date.now());
            }).
            catch((e) => mounted.current && setErr(String(e.message || e))).
            finally(() => mounted.current && setLoading(false));
    }, []);

    useEffect(() => {
        mounted.current = true;
        load();
        const poll = setInterval(load, 5000);
        const tick = setInterval(() => force((n) => n + 1), 1000); // keep "updated Xs ago" live
        return () => {
            mounted.current = false;
            clearInterval(poll);
            clearInterval(tick);
        };
    }, [load]);

    const agents = reports ? Object.values(reports) : [];
    const totalAdmit = agents.reduce((n, a) => n + (a.admitted?.length || 0), 0);
    const totalReject = agents.reduce((n, a) => n + (a.rejected?.length || 0), 0);

    return (
        <div className='agora-sk'>
            <style>{CSS}</style>
            <div className='agora-sk__top'>
                <div>
                    <div className='agora-sk__title'>{'Agents & skills'}</div>
                    <div className='agora-sk__meta'>
                        {reports === null && !err ? 'loading…' : err ? 'last fetch failed' :
                            `${agents.length} agent(s) · ${totalAdmit} admitted · ${totalReject} rejected · updated ${rel(fetchedAt)}`}
                    </div>
                </div>
                <button
                    className='agora-sk__refresh'
                    onClick={load}
                    disabled={loading}
                    aria-label='Refresh skills'
                >{loading ? 'refreshing…' : 'Refresh'}</button>
            </div>

            {/* loading skeleton (first load only) */}
            {reports === null && !err && (
                <div>
                    <div className='agora-skel' style={{width: '60%'}}/>
                    <div className='agora-skel' style={{width: '85%'}}/>
                    <div className='agora-skel' style={{width: '40%'}}/>
                </div>
            )}

            {/* error state with retry */}
            {err && (
                <div className='agora-err'>
                    {`Couldn't load skills: ${err}.`}
                    <div style={{marginTop: 6}}>
                        <button
                            className='agora-sk__refresh'
                            onClick={load}
                        >{'Retry'}</button>
                    </div>
                </div>
            )}

            {/* empty state with recovery steps (H9) */}
            {reports !== null && !err && agents.length === 0 && (
                <div className='agora-empty'>
                    {'No agents have reported skills yet. To populate this panel:'}
                    <ol>
                        <li>{'Run a connector: '}<code>{'scripts/run.sh'}</code>{' (or '}<code>{'python3 connector/connector.py'}</code>{')'}</li>
                        <li>{'Confirm this plugin is enabled (System Console → Plugins → Growth Agent)'}</li>
                        <li>{'Expected bot: '}<code>{'agora-claude'}</code></li>
                    </ol>
                    <div className='agora-sk__meta' style={{marginTop: 8}}>{`Last checked ${rel(fetchedAt)}.`}</div>
                </div>
            )}

            {/* data */}
            {agents.map((rep) => (
                <div
                    className='agora-sk__agent'
                    key={rep.agent?.id}
                >
                    <div className='agora-sk__agentname'>
                        {rep.agent?.name || rep.agent?.id}
                        <Badge fg={OK} bg='rgba(63,185,80,.14)'>{`${rep.admitted?.length || 0} admitted`}</Badge>
                        {(rep.rejected?.length || 0) > 0 &&
                            <Badge fg={ERR} bg='rgba(210,75,78,.14)'>{`${rep.rejected.length} rejected`}</Badge>}
                    </div>
                    <div className='agora-sk__meta'>{`reported ${rel(rep.reported_at)}`}</div>
                    {(rep.admitted || []).map((v) => <SkillRow key={v.skill} v={v} agentId={rep.agent?.id}/>)}
                    {(rep.rejected || []).map((v) => <SkillRow key={`r-${v.skill}`} v={v} agentId={rep.agent?.id}/>)}
                </div>
            ))}
        </div>
    );
};

export default SkillsPanel;
