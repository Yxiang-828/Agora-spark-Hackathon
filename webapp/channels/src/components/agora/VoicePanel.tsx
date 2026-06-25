import React, {useEffect, useMemo, useState} from 'react';

import {previewVoice, stopSpeaking, SAMPLE_LINE} from './voiceClient';
import {QWEN_VOICES, loadVoiceId, saveVoiceId} from './voices';
import type {AgoraVoice} from './voices';

// Voice picker for the AI call: choose the voice your agent speaks in, and ▶ test each one.
// Voices render locally on the connector host running your agent (Qwen3-TTS).

const dim = (a: number) => `rgba(var(--center-channel-color-rgb),${a})`;

const Row = ({voice, selected, onSelect, onTest, testing}: {
    voice: AgoraVoice; selected: boolean; onSelect: () => void; onTest: () => void; testing: boolean;
}) => (
    <div
        onClick={onSelect}
        style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', cursor: 'pointer',
            borderRadius: 8, border: `1px solid ${selected ? 'var(--button-bg,#1c58d9)' : dim(0.1)}`,
            background: selected ? 'rgba(var(--button-bg-rgb),.08)' : dim(0.02), marginBottom: 6,
        }}
    >
        <span style={{
            flex: 'none', width: 16, height: 16, borderRadius: 16, boxSizing: 'border-box',
            border: `2px solid ${selected ? 'var(--button-bg,#1c58d9)' : dim(0.3)}`,
            background: selected ? 'var(--button-bg,#1c58d9)' : 'transparent',
            boxShadow: selected ? 'inset 0 0 0 2px var(--center-channel-bg,#fff)' : 'none',
        }}/>
        <div style={{flex: 1, minWidth: 0}}>
            <div style={{fontWeight: 600}}>{voice.name}</div>
            <div style={{fontSize: 12, color: dim(0.6), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{voice.blurb}</div>
        </div>
        <button
            type='button'
            title={`Test "${voice.name}"`}
            onClick={(e) => {
                e.stopPropagation();
                onTest();
            }}
            style={{
                flex: 'none', minHeight: 30, padding: '0 12px', borderRadius: 6, cursor: 'pointer',
                border: `1px solid ${dim(0.18)}`, background: testing ? 'rgba(var(--button-bg-rgb),.12)' : dim(0.04),
                color: 'inherit', fontWeight: 600,
            }}
        >{testing ? '■ Stop' : '▶ Test'}</button>
    </div>
);

const Group = ({title, note, voices, sel, setSel, testingId, test}: {
    title: string; note?: string; voices: AgoraVoice[]; sel: string;
    setSel: (id: string) => void; testingId: string; test: (v: AgoraVoice) => void;
}) => (
    <div style={{marginBottom: 18}}>
        <div style={{fontWeight: 700, fontSize: 13, marginBottom: 2}}>{title}</div>
        {note && <div style={{fontSize: 12, color: dim(0.6), marginBottom: 8}}>{note}</div>}
        {voices.map((v) => (
            <Row
                key={v.id}
                voice={v}
                selected={sel === v.id}
                onSelect={() => setSel(v.id)}
                onTest={() => test(v)}
                testing={testingId === v.id}
            />
        ))}
    </div>
);

const VoicePanel = (): JSX.Element => {
    const [sel, setSelState] = useState<string>(() => loadVoiceId());
    const [testingId, setTestingId] = useState<string>('');

    useEffect(() => () => stopSpeaking(), []);

    const setSel = (id: string) => {
        setSelState(id);
        saveVoiceId(id);
    };

    const enQwen = useMemo(() => QWEN_VOICES.filter((v) => v.lang === 'English'), []);
    const zhQwen = useMemo(() => QWEN_VOICES.filter((v) => v.lang === 'Chinese'), []);

    const test = async (v: AgoraVoice) => {
        if (testingId === v.id) {
            stopSpeaking();
            setTestingId('');
            return;
        }
        stopSpeaking();
        setTestingId(v.id);
        await previewVoice(v, SAMPLE_LINE);
        setTestingId((cur) => (cur === v.id ? '' : cur));
    };

    return (
        <div style={{padding: 16, fontSize: 14, color: 'var(--center-channel-color)', height: '100%', overflowY: 'auto', boxSizing: 'border-box'}}>
            <div style={{fontWeight: 700, fontSize: 16}}>{'Voice'}</div>
            <div style={{fontSize: 12, color: dim(0.64), marginBottom: 14}}>
                {'Pick the voice your agent speaks in on a call. Voices render locally on the machine running your connector. ▶ Test plays a sample.'}
            </div>

            <Group
                title='Qwen · English'
                note='Local reference voices'
                voices={enQwen}
                sel={sel}
                setSel={setSel}
                testingId={testingId}
                test={test}
            />
            <Group
                title='Qwen · Chinese (中文)'
                voices={zhQwen}
                sel={sel}
                setSel={setSel}
                testingId={testingId}
                test={test}
            />
        </div>
    );
};

export default VoicePanel;
