import React, {useEffect, useState} from 'react';

// Settings = the "start here" surface. Agora's shell has a deliberate order:
//   1. Settings  →  2. Onboarding (connect your AI)  →  3. Channels (where work happens)
// A new member should never wonder what to do first. This panel walks that order and
// remembers where they are, so the room feels guided, not dumped-in-the-deep-end.

type SetupStep = 1 | 2 | 3;

const STORE_KEY = 'agora.setup.v1';

type SetupState = {step: SetupStep; done: boolean};

const readState = (): SetupState => {
    try {
        const raw = window.localStorage.getItem(STORE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw) as Partial<SetupState>;
            const step = (parsed.step === 1 || parsed.step === 2 || parsed.step === 3) ? parsed.step : 1;
            return {step, done: Boolean(parsed.done)};
        }
    } catch (e) {
        // Corrupt/blocked storage must never break the panel — fall back to step 1.
    }
    return {step: 1, done: false};
};

const writeState = (state: SetupState) => {
    try {
        window.localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) {
        // Best-effort persistence; a private-mode browser just won't remember the step.
    }
};

const STEPS: Array<{n: SetupStep; label: string}> = [
    {n: 1, label: 'Settings'},
    {n: 2, label: 'Onboarding'},
    {n: 3, label: 'Channels'},
];

const dim = (a: number) => `rgba(var(--center-channel-color-rgb),${a})`;

const Fact = ({k, v}: {k: string; v: string}) => (
    <div style={{display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 0', borderBottom: `1px solid ${dim(0.08)}`}}>
        <span style={{color: dim(0.66)}}>{k}</span>
        <span style={{fontWeight: 600, textAlign: 'right'}}>{v}</span>
    </div>
);

const primaryBtn: React.CSSProperties = {
    minHeight: 34, padding: '0 14px', border: 0, borderRadius: 6,
    background: 'var(--button-bg,#1c58d9)', color: 'var(--button-color,#fff)',
    fontWeight: 600, cursor: 'pointer',
};
const ghostBtn: React.CSSProperties = {
    minHeight: 34, padding: '0 14px', borderRadius: 6, cursor: 'pointer',
    border: `1px solid ${dim(0.16)}`, background: dim(0.04), color: 'inherit', fontWeight: 600,
};

const SettingsPanel = ({onOpenTab}: {onOpenTab?: (id: string) => void}) => {
    const [{step, done}, setState] = useState<SetupState>(readState);

    useEffect(() => {
        writeState({step, done});
    }, [step, done]);

    const go = (n: SetupStep) => setState((s) => ({...s, step: n}));

    return (
        <div style={{padding: 16, fontSize: 14, color: 'var(--center-channel-color)', height: '100%', overflowY: 'auto', boxSizing: 'border-box'}}>
            <div style={{fontWeight: 700, fontSize: 16}}>{'Setup'}</div>
            <div style={{fontSize: 12, color: dim(0.64), marginBottom: 14}}>
                {done ? 'Setup complete — these steps stay here if you need them.' : 'Three steps, in order. We saved your place.'}
            </div>

            {/* Ordered stepper */}
            <div
                role='tablist'
                aria-label='Setup steps'
                style={{display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16}}
            >
                {STEPS.map((s, i) => {
                    const active = s.n === step;
                    const complete = done || s.n < step;
                    return (
                        <React.Fragment key={s.n}>
                            <button
                                role='tab'
                                type='button'
                                aria-selected={active}
                                onClick={() => go(s.n)}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 7, minHeight: 30,
                                    padding: '0 10px', borderRadius: 16, cursor: 'pointer', font: 'inherit',
                                    border: `1px solid ${active ? 'var(--button-bg,#1c58d9)' : dim(0.14)}`,
                                    background: active ? 'rgba(var(--button-bg-rgb),.1)' : dim(0.03),
                                    color: active ? 'var(--button-bg,#1c58d9)' : 'inherit',
                                    fontWeight: active ? 700 : 500,
                                }}
                            >
                                <span style={{
                                    flex: 'none', width: 20, height: 20, borderRadius: 20, fontSize: 11, fontWeight: 700,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    background: complete ? '#3db887' : (active ? 'var(--button-bg,#1c58d9)' : dim(0.12)),
                                    color: (complete || active) ? '#fff' : dim(0.7),
                                }}>{complete ? '✓' : s.n}</span>
                                <span>{s.label}</span>
                            </button>
                            {i < STEPS.length - 1 && (
                                <span style={{flex: '1 1 auto', height: 1, background: dim(0.14), minWidth: 8}}/>
                            )}
                        </React.Fragment>
                    );
                })}
            </div>

            {/* Step body */}
            {step === 1 && (
                <div>
                    <div style={{fontWeight: 600, marginBottom: 6}}>{'1 · Room settings'}</div>
                    <div style={{fontSize: 13, color: dim(0.78), marginBottom: 10}}>
                        {'The room is configured by the host. Quick read of what matters before you bring your AI in:'}
                    </div>
                    <Fact k='Room' v='Agora'/>
                    <Fact k='Sign-in' v='Open — anyone with the link can join'/>
                    <Fact k='Your AI' v='Runs locally, on your own subscription'/>
                    <Fact k='Secrets' v='Never sent to the AI'/>
                    <div style={{marginTop: 16}}>
                        <button type='button' style={primaryBtn} onClick={() => go(2)}>{'Next: connect your AI →'}</button>
                    </div>
                </div>
            )}

            {step === 2 && (
                <div>
                    <div style={{fontWeight: 600, marginBottom: 6}}>{'2 · Onboarding — connect your AI'}</div>
                    <div style={{fontSize: 13, color: dim(0.78), marginBottom: 12}}>
                        {'Bring your own AI (Claude, Codex, Antigravity) into the room. Open Connect to pair it — '}
                        {'install once, then join with a code. No zip to re-download each time.'}
                    </div>
                    <div style={{display: 'flex', gap: 8, flexWrap: 'wrap'}}>
                        <button type='button' style={primaryBtn} onClick={() => onOpenTab?.('connect')}>{'Open Connect AI'}</button>
                        <button type='button' style={ghostBtn} onClick={() => go(3)}>{'Done — next step'}</button>
                    </div>
                </div>
            )}

            {step === 3 && (
                <div>
                    <div style={{fontWeight: 600, marginBottom: 6}}>{'3 · Channels — where work happens'}</div>
                    <div style={{fontSize: 13, color: dim(0.78), marginBottom: 12}}>
                        {'Pick a channel from the left to start. In '}<b>{'#features'}</b>{', run '}
                        <code>{'/claim'}</code>{' to mark your area, open a thread, and '}<b>{'@your-agent'}</b>{' to put it to work.'}
                    </div>
                    {done ? (
                        <div style={{display: 'flex', alignItems: 'center', gap: 8, color: '#3db887', fontWeight: 600}}>
                            <span>{'✓ Setup complete'}</span>
                            <button type='button' style={ghostBtn} onClick={() => setState({step: 1, done: false})}>{'Re-run'}</button>
                        </div>
                    ) : (
                        <button type='button' style={primaryBtn} onClick={() => setState({step: 3, done: true})}>{'Finish setup'}</button>
                    )}
                </div>
            )}
        </div>
    );
};

export default SettingsPanel;
