import React, {useEffect, useRef, useState} from 'react';

import {apiFetch} from './client';

// "Connect your AI" — the wrapper a new user actually reads. It tells them WHICH AIs are
// accepted, WHAT each needs, lets them PICK, then mints a one-time code and shows the exact
// command. Each chosen AI joins as its OWN bot; ones not installed/logged-in are skipped
// with a reason by the local host.

const EASE = 'cubic-bezier(.23,1,.32,1)';
const OK = 'var(--online-indicator, #3FB950)';
const ERR = 'var(--error-text, #D24B4E)';
const API = '/plugins/com.aegis.agora/api/v1';

const AGENTS = [
    {id: 'claude', name: 'Claude', desc: 'Anthropic Claude Code', need: 'install the `claude` CLI, then `claude auth login` (verify: `claude auth status`)'},
    {id: 'codex', name: 'Codex', desc: 'OpenAI Codex', need: 'install the `codex` CLI, then `codex login` (verify: `codex login status`)'},
    {id: 'antigravity', name: 'Antigravity', desc: 'Google Antigravity (agy)', need: 'install Antigravity (provides the `agy` CLI), then run `agy` once to log in'},
    {id: 'gemini', name: 'Gemini', desc: 'Google Gemini — deprecated (rate-limited; prefer Antigravity)', need: 'install the `gemini` CLI, then run `gemini` once to log in (or set GEMINI_API_KEY)'},
];

const CSS = `
.agora-cx { padding:16px; font-size:14px; color:var(--center-channel-color); height:100%;
  overflow-y:auto; box-sizing:border-box; }
.agora-cx__title { font-weight:700; }
.agora-cx__sub { font-size:12px; color:rgba(var(--center-channel-color-rgb),.64); margin:2px 0 14px; }
.agora-cx__note { margin:8px 0 14px; padding:9px 11px; border-radius:6px; font-size:12.5px; line-height:1.5;
  border:1px solid rgba(var(--center-channel-color-rgb),.18); background:rgba(var(--center-channel-color-rgb),.045); }
.agora-cx__note b { font-weight:700; }
.agora-cx__note ul { margin:5px 0 0; padding-left:16px; }
.agora-cx__note li { margin:3px 0; }
.agora-cx__h { font-size:13px; font-weight:600; margin:14px 0 6px; }
.agora-cx__row { display:flex; align-items:center; gap:8px; padding:6px 2px; font-size:13px;
  border-bottom:1px solid rgba(var(--center-channel-color-rgb),.07); }
.agora-cx__dot { width:8px; height:8px; border-radius:50%; flex:none; }
.agora-cx__agent { display:flex; gap:9px; align-items:flex-start; padding:8px; border-radius:6px;
  border:1px solid rgba(var(--center-channel-color-rgb),.12); margin-bottom:6px; cursor:pointer;
  transition: background 120ms ease; }
.agora-cx__agent:hover { background:rgba(var(--center-channel-color-rgb),.04); }
.agora-cx__agent input { margin-top:3px; }
.agora-cx__aname { font-weight:600; }
.agora-cx__aneed { font-size:12px; color:rgba(var(--center-channel-color-rgb),.62); margin-top:1px; }
.agora-cx__wd { width:100%; margin-top:8px; padding:5px 8px; font-size:12px; font-family:monospace;
  border-radius:4px; border:1px solid rgba(var(--center-channel-color-rgb),.25);
  background:var(--center-channel-bg); color:inherit; box-sizing:border-box; }
.agora-cx__btn { background:var(--button-bg,#1c58d9); color:var(--button-color,#fff); border:0;
  border-radius:5px; padding:9px 14px; font-size:14px; font-weight:600; cursor:pointer;
  transition: transform 140ms ${EASE}, filter 140ms ease; }
.agora-cx__btn:hover { filter:brightness(1.06); }
.agora-cx__btn:active { transform: scale(.97); }
.agora-cx__btn[disabled] { opacity:.55; cursor:default; }
.agora-cx__cmd { display:flex; align-items:center; gap:8px; background:rgba(var(--center-channel-color-rgb),.06);
  border:1px solid rgba(var(--center-channel-color-rgb),.12); border-radius:6px; padding:8px 10px;
  font-family:monospace; font-size:12.5px; overflow-x:auto; }
.agora-cx__copy { flex:none; background:none; border:1px solid rgba(var(--center-channel-color-rgb),.2);
  border-radius:4px; padding:2px 8px; font-size:11px; color:inherit; cursor:pointer; }
.agora-cx__copy:active { transform: scale(.95); }
.agora-cx__wait { display:flex; align-items:center; gap:8px; margin-top:12px; font-size:13px;
  color:rgba(var(--center-channel-color-rgb),.7); }
.agora-cx__spin { width:13px; height:13px; border-radius:50%; border:2px solid rgba(var(--center-channel-color-rgb),.2);
  border-top-color:var(--button-bg,#1c58d9); animation: agoraCxSpin .7s linear infinite; }
.agora-cx__ok { margin-top:12px; color:${OK}; font-weight:600; }
.agora-cx__err { margin-top:10px; color:${ERR}; }
@keyframes agoraCxSpin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce){ .agora-cx__btn,.agora-cx__copy{transition:none} .agora-cx__spin{animation:none} }
`;

const ConnectPanel = () => {
    const [picked, setPicked] = useState<Record<string, boolean>>({claude: true, codex: true, antigravity: true});
    const [workdirs, setWorkdirs] = useState<Record<string, string>>({});
    const [code, setCode] = useState('');
    const [connected, setConnected] = useState(false);
    const [expired, setExpired] = useState(false);
    const [failed, setFailed] = useState(false);
    const [err, setErr] = useState('');
    const [busy, setBusy] = useState(false);
    const [agents, setAgents] = useState<any[]>([]);
    const mounted = useRef(true);
    const origin = (typeof window !== 'undefined' && window.location ? window.location.origin : 'http://localhost:8065');

    const sel = AGENTS.filter((a) => picked[a.id]).map((a) => a.id);
    const allSel = sel.length === AGENTS.length;
    const isWin = typeof navigator !== 'undefined' && /win/i.test(navigator.platform || '');
    // Cross-OS: everything is a python ARG — identical on Windows/macOS/Linux (no $env: vs
    // export, no .ps1 vs .sh). python itself is the only requirement.
    const args: string[] = [];
    if (!allSel) {
        args.push(`--agents ${sel.join(',')}`);
    }
    AGENTS.forEach((a) => {
        const wd = (workdirs[a.id] || '').trim();
        if (picked[a.id] && wd) {
            args.push(`--workdir "${a.id}=${wd}"`);
        }
    });
    const cmd = code ? `python connector/pair.py ${code} ${origin}${args.length ? ' ' + args.join(' ') : ''}` : '';

    useEffect(() => () => {
        mounted.current = false;
    }, []);

    // Dashboard: who's in the room + online state. Polls so connect/disconnect reflects fast.
    const loadAgents = () => apiFetch(`${API}/agents`).
        then((r) => (r.ok ? r.json() : [])).
        then((a) => mounted.current && setAgents(a || [])).catch(() => undefined);
    useEffect(() => {
        loadAgents();
        const t = setInterval(loadAgents, 4000);
        return () => clearInterval(t);
    }, []);
    const setDesire = (botID: string, want: string) => apiFetch(`${API}/agents/${botID}/desire`, {
        method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({want}),
    }).then(() => loadAgents()).catch((e) => setErr(String(e.message || e)));

    useEffect(() => {
        if (!code || connected || expired || failed) {
            return undefined;
        }
        const t = setInterval(() => {
            apiFetch(`${API}/pair/status?code=${code}`, {credentials: 'same-origin'}).
                then((r) => (r.ok ? r.json() : null)).
                then((d) => {
                    if (!mounted.current || !d) {
                        return;
                    }
                    if (d.claimed) {
                        setConnected(true);
                    } else if (d.failed) {
                        setFailed(true);
                    } else if (d.expired) {
                        setExpired(true);
                    }
                }).catch(() => undefined);
        }, 2000);
        return () => clearInterval(t);
    }, [code, connected, expired, failed]);

    const start = () => {
        setBusy(true);
        setErr('');
        setConnected(false);
        setExpired(false);
        setFailed(false);
        apiFetch(`${API}/pair/start`, {method: 'POST', credentials: 'same-origin'}).
            then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))).
            then((d) => mounted.current && setCode(d.code)).
            catch((e) => mounted.current && setErr(String(e.message || e))).
            finally(() => mounted.current && setBusy(false));
    };

    const copy = () => {
        try {
            navigator.clipboard?.writeText(cmd);
        } catch {
            /* clipboard may be unavailable; the command is visible to copy manually */
        }
    };

    // Download a self-contained connector (source + per-OS double-click launchers with the
    // code/URL/agents baked in). The user unzips and double-clicks — no git, no terminal.
    const downloadBundle = () => {
        const params = new URLSearchParams({code});
        if (!allSel) {
            params.set('agents', sel.join(','));
        }
        AGENTS.forEach((a) => {
            const wd = (workdirs[a.id] || '').trim();
            if (picked[a.id] && wd) {
                params.append('workdir', `${a.id}=${wd}`);
            }
        });
        apiFetch(`${API}/connector/bundle?${params.toString()}`).
            then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`)))).
            then((blob) => {
                const u = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = u;
                a.download = 'agora-connector.zip';
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(u);
            }).catch((e) => setErr(String(e.message || e)));
    };


    return (
        <div className='agora-cx'>
            <style>{CSS}</style>
            <div className='agora-cx__title'>{'Connect your AI'}</div>
            <div className='agora-cx__sub'>{'Your AI runs on YOUR machine, on YOUR subscription. The room never sees its login — it just relays messages. Each AI you pick joins as its own bot.'}</div>

            <div className='agora-cx__note'>
                <b>{'Before you connect'}</b>
                <ul>
                    <li>{'Install the CLI for each AI you’ll use — and log in. A CLI that isn’t logged in will not connect: the host skips it and prints the reason in its window.'}</li>
                    <li>{'Only tick AIs you actually have installed and use. Ticking one you don’t own does nothing — it’s skipped.'}</li>
                    <li>{'Your machine needs Python 3 and Node.js. Exact install + login commands are under Home → Getting Started.'}</li>
                </ul>
            </div>

            {agents.length > 0 && (
                <>
                    <div className='agora-cx__h' style={{marginTop: 4}}>{'In the room'}</div>
                    {agents.map((a) => (
                        <div
                            key={a.bot_user_id}
                            className='agora-cx__row'
                        >
                            <span
                                className='agora-cx__dot'
                                style={{background: a.online ? OK : 'rgba(var(--center-channel-color-rgb),.3)'}}
                                title={a.online ? 'online' : 'offline'}
                            />
                            <span style={{flex: 1, minWidth: 0}}>
                                <b>{a.agent || a.bot_username}</b>
                                <span style={{opacity: 0.6}}>{` · ${a.owner_name}`}</span>
                                <span style={{opacity: 0.5, fontSize: 11}}>{a.online ? ' · online' : (a.desired === 'stop' ? ' · disconnected' : ' · offline')}</span>
                            </span>
                            {a.mine && (a.desired === 'stop' ? (
                                <button className='agora-cx__copy' onClick={() => setDesire(a.bot_user_id, 'run')}>{'Connect'}</button>
                            ) : (
                                <button className='agora-cx__copy' onClick={() => setDesire(a.bot_user_id, 'stop')}>{'Disconnect'}</button>
                            ))}
                        </div>
                    ))}
                </>
            )}

            <div className='agora-cx__h'>{agents.length > 0 ? '1. Add an AI — pick which' : '1. Pick which AI(s) to bring in'}</div>
            {AGENTS.map((a) => (
                <div
                    key={a.id}
                    className='agora-cx__agent'
                    style={{display: 'block'}}
                >
                    <label style={{display: 'flex', gap: 9, alignItems: 'flex-start', cursor: 'pointer'}}>
                        <input
                            type='checkbox'
                            checked={!!picked[a.id]}
                            onChange={(e) => setPicked({...picked, [a.id]: e.target.checked})}
                            style={{marginTop: 3}}
                        />
                        <span>
                            <span className='agora-cx__aname'>{a.name}</span>
                            <span style={{opacity: 0.6}}>{` — ${a.desc}`}</span>
                            <div className='agora-cx__aneed'>{`needs ${a.need}`}</div>
                        </span>
                    </label>
                    {picked[a.id] && (
                        <>
                            <input
                                className='agora-cx__wd'
                                placeholder={isWin ? 'workspace folder (optional) — e.g. C:\\Users\\me\\project' : 'workspace folder (optional) — e.g. /home/me/project'}
                                value={workdirs[a.id] || ''}
                                onChange={(e) => setWorkdirs({...workdirs, [a.id]: e.target.value})}
                            />
                            <div className='agora-cx__aneed' style={{marginTop: 3}}>{'runs the agent in this folder so it picks up its CLAUDE.md / config / prompts. Blank = a clean per-agent folder.'}</div>
                        </>
                    )}
                </div>
            ))}
            <div className='agora-cx__sub' style={{marginTop: 2}}>{'Don’t have one installed/logged-in? It’s skipped (with a reason) — the others still start.'}</div>

            <div className='agora-cx__h'>{'2. Generate a pairing code'}</div>
            <button
                className='agora-cx__btn'
                onClick={start}
                disabled={busy || sel.length === 0}
            >{busy ? 'Generating…' : (code ? 'New code' : 'Generate pairing code')}</button>
            {sel.length === 0 && <div className='agora-cx__sub' style={{marginTop: 6}}>{'Pick at least one AI above.'}</div>}
            {err && <div className='agora-cx__err'>{`Couldn't start pairing: ${err}`}</div>}

            {code && (
                <>
                    <div className='agora-cx__h'>{'3. Get your connector & run it'}</div>
                    <button className='agora-cx__btn' onClick={downloadBundle}>{'⬇ Download connector (.zip)'}</button>
                    <div className='agora-cx__sub' style={{marginTop: 6}}>{'Unzip it, then double-click the launcher for your OS — start-windows.bat / start-macos.command / start-linux.sh. No terminal, no git. Your picked AIs join as bots; @mention them here. (Needs Python + the CLIs above installed & logged in. Code is single-use, 10 min.)'}</div>
                    <details style={{marginTop: 8}}>
                        <summary style={{cursor: 'pointer', fontSize: 12, color: 'rgba(var(--center-channel-color-rgb),.7)'}}>{'Prefer the command line?'}</summary>
                        <div className='agora-cx__cmd' style={{marginTop: 6}}>
                            <span style={{flex: 1}}>{cmd}</span>
                            <button className='agora-cx__copy' onClick={copy}>{'Copy'}</button>
                        </div>
                        <div className='agora-cx__sub' style={{marginTop: 4}}>{'Same on Windows / macOS / Linux (run from a clone of the repo).'}</div>
                    </details>

                    {connected ? (
                        <div className='agora-cx__ok'>{'✓ Connected — your agent bot(s) are in the room. @mention them.'}</div>
                    ) : failed ? (
                        <div className='agora-cx__err'>{'Pairing failed on the server — click “New code” and try again.'}</div>
                    ) : expired ? (
                        <div className='agora-cx__err'>{'This code expired — click “New code”.'}</div>
                    ) : (
                        <div className='agora-cx__wait'>
                            <span className='agora-cx__spin'/>
                            {'Waiting for your machine to pair…'}
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

export default ConnectPanel;
