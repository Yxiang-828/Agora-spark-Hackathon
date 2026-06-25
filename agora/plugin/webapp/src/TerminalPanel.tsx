import React, {useEffect, useRef, useState} from 'react';

import {runCommand, subscribeTermBusy} from './terminal';
import type {TermBusy} from './terminal';

// A lightweight per-member terminal with two tabs (VSCode-style):
//  - "Terminal": this member's own shell session (own cwd + scrollback).
//  - "Shared":   a live feed of EVERY member's commands and their output (the room serializes
//                execution, so this is the shared activity log).

type Line = {kind: 'cmd' | 'out' | 'err'; text: string};
type Shared = {id: number; name: string; command: string; out: string; exit: number};

const lineColor = (k: Line['kind']): string => {
    if (k === 'cmd') {
        return 'var(--center-channel-color)';
    }
    if (k === 'err') {
        return 'var(--error-text,#D24B4E)';
    }
    return 'inherit';
};

const tabStyle = (on: boolean): React.CSSProperties => ({
    padding: '3px 10px',
    fontSize: 11.5,
    cursor: 'pointer',
    color: '#d4d4d4',
    background: on ? '#1e1e1e' : 'transparent',
    borderRadius: '4px 4px 0 0',
    border: 0,
    borderBottom: on ? '2px solid #61afef' : '2px solid transparent',
});

const TerminalPanel = ({csId, channelId, selfId}: {csId: string; channelId: string; selfId: string}) => {
    const [tab, setTab] = useState<'term' | 'shared'>('term');
    const [lines, setLines] = useState<Line[]>([]);
    const [cwd, setCwd] = useState('');
    const [input, setInput] = useState('');
    const [running, setRunning] = useState(false);
    const [busy, setBusy] = useState<TermBusy | null>(null); // someone else is running a command
    const [shared, setShared] = useState<Shared[]>([]);
    const [unseen, setUnseen] = useState(0); // shared items while not on the shared tab
    const scrollRef = useRef<HTMLDivElement>(null);
    const sharedRef = useRef<HTMLDivElement>(null);
    const seq = useRef(0);

    useEffect(() => subscribeTermBusy((b) => {
        if (b.codespace_id !== csId) {
            return;
        }
        if (b.state === 'done') {
            if (b.user_id !== selfId) {
                setBusy((cur) => (cur && cur.user_id === b.user_id ? null : cur));
            }
            if (b.out !== undefined) { // a finished command + its output -> shared activity feed
                seq.current += 1;
                setShared((s) => [...s, {id: seq.current, name: b.name, command: b.command, out: b.out || '', exit: b.exit || 0}].slice(-200));
                setTab((t) => {
                    if (t !== 'shared') {
                        setUnseen((u) => u + 1);
                    }
                    return t;
                });
            }
            return;
        }
        if (b.user_id !== selfId) { // running/queued by someone else
            setBusy(b);
        }
    }), [csId, selfId]);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [lines]);
    useEffect(() => {
        if (sharedRef.current) {
            sharedRef.current.scrollTop = sharedRef.current.scrollHeight;
        }
    }, [shared, tab]);

    const submit = () => {
        const cmd = input;
        setInput('');
        setLines((l) => [...l, {kind: 'cmd', text: `${cwd || '~'} $ ${cmd}`}]);
        if (!cmd.trim()) {
            return;
        }
        setRunning(true);
        runCommand(csId, channelId, cmd).then((res) => {
            if (res.out) {
                setLines((l) => [...l, {kind: res.exit === 0 ? 'out' : 'err', text: res.out.replace(/\n+$/, '')}]);
            }
            setCwd(res.cwd);
            setRunning(false);
        }).catch((e) => {
            setLines((l) => [...l, {kind: 'err', text: String(e.message || e)}]);
            setRunning(false);
        });
    };

    return (
        <div style={{display: 'flex', flexDirection: 'column', height: '100%', background: '#1e1e1e', borderRadius: 4, overflow: 'hidden', fontFamily: 'monospace', fontSize: 12.5}}>
            <div style={{display: 'flex', alignItems: 'center', gap: 2, padding: '2px 4px 0', background: '#181818', flex: 'none'}}>
                <button
                    style={tabStyle(tab === 'term')}
                    onClick={() => setTab('term')}
                >{'Terminal'}</button>
                <button
                    style={tabStyle(tab === 'shared')}
                    onClick={() => {
                        setTab('shared');
                        setUnseen(0);
                    }}
                >{`Shared${unseen ? ` (${unseen})` : ''}`}</button>
                {busy && <span style={{marginLeft: 'auto', padding: '0 8px', fontSize: 11, color: '#e5c07b'}}>{`${busy.name}: ${busy.command} …`}</span>}
            </div>

            {tab === 'term' ? (
                <>
                    <div
                        ref={scrollRef}
                        style={{flex: 1, overflowY: 'auto', padding: '6px 8px', color: '#d4d4d4', whiteSpace: 'pre-wrap', wordBreak: 'break-all', minHeight: 0}}
                    >
                        {lines.length === 0 && <div style={{opacity: 0.5}}>{'Your terminal — runs on the host, jailed to the codespace root. Tip: “ai <prompt>” asks the host’s AI to work in this codespace. Commands across members run one at a time.'}</div>}
                        {lines.map((l, i) => (
                            <div
                                key={i}
                                style={{color: lineColor(l.kind)}}
                            >{l.text}</div>
                        ))}
                        {running && <div style={{opacity: 0.6}}>{'…running'}</div>}
                    </div>
                    <div style={{display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', borderTop: '1px solid #333', flex: 'none'}}>
                        <span style={{color: '#98c379'}}>{`${cwd || '~'} $`}</span>
                        <input
                            style={{flex: 1, background: 'none', border: 0, outline: 'none', color: '#d4d4d4', fontFamily: 'monospace', fontSize: 12.5}}
                            value={input}
                            autoFocus={true}
                            spellCheck={false}
                            placeholder={running ? 'running…' : 'type a command, Enter to run'}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => {
                                e.stopPropagation();
                                if (e.key === 'Enter' && !running) {
                                    submit();
                                }
                            }}
                        />
                    </div>
                </>
            ) : (
                <div
                    ref={sharedRef}
                    style={{flex: 1, overflowY: 'auto', padding: '6px 8px', color: '#d4d4d4', whiteSpace: 'pre-wrap', wordBreak: 'break-all', minHeight: 0}}
                >
                    {shared.length === 0 && <div style={{opacity: 0.5}}>{'Everyone’s commands and their output show here as they run.'}</div>}
                    {shared.map((s) => (
                        <div
                            key={s.id}
                            style={{marginBottom: 6}}
                        >
                            <div style={{color: '#61afef'}}>{`${s.name} $ ${s.command}`}</div>
                            {s.out && <div style={{color: s.exit === 0 ? '#d4d4d4' : 'var(--error-text,#D24B4E)'}}>{s.out.replace(/\n+$/, '')}</div>}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default TerminalPanel;
