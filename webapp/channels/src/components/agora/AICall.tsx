import React, {useCallback, useEffect, useRef, useState} from 'react';
import {useSelector} from 'react-redux';

import {Client4} from 'mattermost-redux/client';
import {getCurrentChannelId} from 'mattermost-redux/selectors/entities/channels';

import WebSocketClient from 'client/web_websocket_client';

import {playAudioBase64, browserSpeak, stopSpeaking, SAMPLE_LINE} from './voiceClient';
import {voiceById, loadVoiceId} from './voices';
import type {AgoraVoice} from './voices';

// The AI call surface — a person-to-person-style call window, but you're calling an agent and it
// speaks its replies aloud. While the call is live it listens for the agent's posts in the current
// channel: if a post carries synthesized audio (connector → Qwen/ElevenLabs, delivered as a file)
// it plays that; otherwise it speaks the post text locally so the call still talks. Mirrors the
// real call UI (avatar, caption, waveform, mute/end) with its own AI accent.

export type CallAgent = {id: string; name: string};

// Strip markdown/code so speech sounds natural (a trim of the zip's speech-sanitizer).
const sanitize = (raw: string): string => (raw || '').
    replace(/```[\s\S]*?```/g, ' code block ').
    replace(/`[^`]*`/g, ' ').
    replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').
    replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').
    replace(/[*_>#~|]/g, ' ').
    replace(/https?:\/\/\S+/g, ' link ').
    replace(/\s+/g, ' ').
    trim();

type RawWs = {event?: string; data?: {post?: string}};

const AICall = ({agent, onEnd}: {agent: CallAgent; onEnd: () => void}): JSX.Element => {
    const channelId = useSelector(getCurrentChannelId);
    const [voice] = useState<AgoraVoice | undefined>(() => voiceById(loadVoiceId()));
    const [speaking, setSpeaking] = useState(false);
    const [muted, setMuted] = useState(false);
    const [caption, setCaption] = useState('');
    const [elapsed, setElapsed] = useState(0);
    const [minimized, setMinimized] = useState(false);
    const [pos, setPos] = useState<{x: number; y: number}>(() => ({x: window.innerWidth - 320, y: window.innerHeight - 380}));
    const mutedRef = useRef(false);
    mutedRef.current = muted;
    const drag = useRef<{dx: number; dy: number} | null>(null);

    // Drag the widget by its header — it floats above the app and never blocks it.
    const onDragStart = (e: React.MouseEvent) => {
        drag.current = {dx: e.clientX - pos.x, dy: e.clientY - pos.y};
        const move = (ev: MouseEvent) => {
            if (!drag.current) {
                return;
            }
            const x = Math.max(8, Math.min(window.innerWidth - 80, ev.clientX - drag.current.dx));
            const y = Math.max(8, Math.min(window.innerHeight - 60, ev.clientY - drag.current.dy));
            setPos({x, y});
        };
        const up = () => {
            drag.current = null;
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', up);
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
    };

    // call timer
    useEffect(() => {
        const t = window.setInterval(() => setElapsed((s) => s + 1), 1000);
        return () => window.clearInterval(t);
    }, []);

    const say = useCallback(async (text: string, audioFileId?: string) => {
        const clean = sanitize(text);
        if (!clean || mutedRef.current) {
            return;
        }
        setCaption(clean);
        setSpeaking(true);
        try {
            if (audioFileId) {
                // connector-synthesized audio delivered as a file on the post
                const url = Client4.getFileUrl(audioFileId, Date.now());
                await new Promise<void>((res) => {
                    const a = new Audio(url);
                    a.onended = () => res();
                    a.onerror = () => res();
                    a.play().catch(() => res());
                });
            } else {
                await browserSpeak(clean, voice);
            }
        } finally {
            setSpeaking(false);
        }
    }, [voice]);

    // listen for the agent's posts/edits in this channel and voice them. The connector posts a
    // placeholder then PATCHes the answer (+ attaches synthesized audio), so we watch BOTH
    // 'posted' and 'post_edited'. Any file the agent attaches mid-call is its voice clip.
    useEffect(() => {
        const spoken = new Set<string>();
        const onMsg = (raw: unknown) => {
            const msg = raw as RawWs;
            if ((msg?.event !== 'posted' && msg?.event !== 'post_edited') || !msg.data?.post) {
                return;
            }
            try {
                const post = JSON.parse(msg.data.post);
                if (post.user_id !== agent.id || (channelId && post.channel_id !== channelId)) {
                    return;
                }
                const message: string = post.message || '';
                if (!message || /working…|^_…/.test(message)) {
                    return; // skip the "…working…" placeholder
                }
                const fileIds: string[] = post.file_ids || (post.metadata?.files || []).map((f: {id: string}) => f.id) || [];
                const audioId = fileIds.length ? fileIds[0] : undefined;
                const key = `${post.id}:${post.edit_at || post.update_at || ''}:${audioId ? 'a' : 't'}`;
                if (spoken.has(key)) {
                    return;
                }
                spoken.add(key);
                say(message, audioId);
            } catch (e) {
                // ignore malformed
            }
        };
        WebSocketClient.addMessageListener(onMsg);
        return () => {
            WebSocketClient.removeMessageListener?.(onMsg);
            stopSpeaking();
        };
    }, [agent.id, channelId, say]);

    const toggleMute = () => setMuted((m) => {
        if (!m) {
            stopSpeaking();
            setSpeaking(false);
        }
        return !m;
    });

    const end = () => {
        stopSpeaking();
        onEnd();
    };

    const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
    const initial = (agent.name || 'A').slice(0, 1).toUpperCase();

    // Minimized: a small draggable pill that floats over the app (move it anywhere).
    if (minimized) {
        return (
            <div
                className={`aicall-pip${speaking ? ' is-speaking' : ''}`}
                style={{left: pos.x, top: pos.y}}
                onMouseDown={onDragStart}
                onClick={() => setMinimized(false)}
                title={`${agent.name} — click to expand`}
            >
                <span className='aicall-pip__avatar'>{initial}</span>
                <span className='aicall-pip__meta'>
                    <b>{agent.name}</b>
                    <span>{muted ? 'muted' : (speaking ? 'speaking…' : mmss)}</span>
                </span>
                <button
                    type='button'
                    className='aicall-pip__end'
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                        e.stopPropagation();
                        end();
                    }}
                    title='End call'
                >{'✕'}</button>
            </div>
        );
    }

    // Expanded: a compact floating card (NOT a blocking modal). Drag by the header.
    return (
        <div
            className='aicall-widget'
            style={{left: pos.x, top: pos.y}}
        >
            <div
                className='aicall-widget__head'
                onMouseDown={onDragStart}
            >
                <span className='aicall-widget__badge'>{'AI CALL'}</span>
                <span className='aicall-widget__grip'>{'⠿'}</span>
                <span style={{flex: 1}}/>
                <button
                    type='button'
                    className='aicall-widget__icon'
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => setMinimized(true)}
                    title='Minimize'
                >{'—'}</button>
            </div>
            <div className='aicall-widget__body'>
                <div className={`aicall__avatar${speaking ? ' is-speaking' : ''}`}>
                    <span>{initial}</span>
                    {speaking && (
                        <div className='aicall__wave' aria-hidden='true'>
                            <i/><i/><i/><i/><i/>
                        </div>
                    )}
                </div>
                <div className='aicall__name'>{agent.name}</div>
                <div className='aicall__status'>
                    {muted ? 'Muted' : (speaking ? 'Speaking…' : 'In call')}
                    <span className='aicall__timer'>{mmss}</span>
                </div>
                <div className='aicall__voice'>{voice ? `Voice: ${voice.name}` : 'No voice selected'}</div>
                <div className='aicall__caption'>{caption || 'Listening — the agent will speak its replies here.'}</div>
                <div className='aicall__controls'>
                    <button
                        type='button'
                        className={`aicall__btn${muted ? ' is-on' : ''}`}
                        onClick={toggleMute}
                        title={muted ? 'Unmute' : 'Mute'}
                    >{muted ? '🔇' : '🔊'}</button>
                    <button
                        type='button'
                        className='aicall__btn'
                        onClick={() => say(SAMPLE_LINE)}
                        title='Test the voice'
                    >{'▶'}</button>
                    <button
                        type='button'
                        className='aicall__btn aicall__btn--end'
                        onClick={end}
                        title='End call'
                    >{'✕'}</button>
                </div>
            </div>
        </div>
    );
};

export default AICall;
