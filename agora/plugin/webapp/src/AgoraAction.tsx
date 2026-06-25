import React, {useState} from 'react';

// Renders a custom post of type `custom_agora_action`: an agent's work as a main
// action + collapsible sub-actions, updated live as the connector PATCHes the post.
// Shape (post.props.agora_action) — see docs/TASKS.md contract:
//   { case_id, agent_id, title, status: running|done|error, summary,
//     subactions: [ { id, label, tool, status, result, duration_ms } ] }

type Sub = {id?: string; label: string; tool?: string; status?: string; result?: string; duration_ms?: number};
type Action = {title?: string; status?: string; summary?: string; subactions?: Sub[]; agent_id?: string};

const OK = 'var(--online-indicator, #3FB950)';
const ERR = 'var(--error-text, #D24B4E)';
const MUTE = 'rgba(var(--center-channel-color-rgb,61,60,64),0.56)';
const EASE = 'cubic-bezier(.23,1,.32,1)';

const CSS = `
.agora-act { border:1px solid rgba(var(--center-channel-color-rgb),.12); border-radius:8px;
  padding:10px 12px; margin:2px 0; max-width:min(680px,100%); }
.agora-act__main { display:flex; align-items:center; gap:9px; }
.agora-act__title { font-weight:600; flex:1; }
.agora-act__sum { white-space:pre-wrap; margin:6px 0 2px 27px; color: var(--center-channel-color); }
.agora-act__toggle { background:none; border:0; color:${MUTE}; cursor:pointer; font-size:12px;
  padding:4px 6px; border-radius:4px; margin-left:27px; margin-top:4px;
  transition: transform 120ms ${EASE}, background 120ms ease; }
.agora-act__toggle:hover { background: rgba(var(--center-channel-color-rgb),.06); }
.agora-act__toggle:active { transform: scale(.97); }
.agora-act__subs { display:grid; grid-template-rows:0fr; transition: grid-template-rows 200ms ${EASE}; }
.agora-act__subs--open { grid-template-rows:1fr; }
.agora-act__subsin { overflow:hidden; min-height:0; }
.agora-act__sub { display:flex; align-items:baseline; gap:8px; padding:5px 0 5px 27px; font-size:13px;
  animation: agoraIn 220ms ${EASE} both; }
.agora-act__sublabel { flex:1; }
.agora-act__tool { font-size:11px; color:${MUTE}; border:1px solid rgba(var(--center-channel-color-rgb),.16);
  border-radius:4px; padding:0 5px; }
.agora-act__dur { font-size:11px; color:${MUTE}; }
.agora-act__res { white-space:pre-wrap; color:${MUTE}; font-size:12px; margin:2px 0 0 27px; }
.agora-dot2 { width:9px; height:9px; border-radius:9px; flex:none; }
.agora-spin { width:13px; height:13px; flex:none; border-radius:50%;
  border:2px solid rgba(var(--center-channel-color-rgb),.2); border-top-color: var(--button-bg,#1c58d9);
  animation: agoraSpin .7s linear infinite; }
@keyframes agoraSpin { to { transform: rotate(360deg); } }
@keyframes agoraIn { from { opacity:0; transform: translateY(4px); } to { opacity:1; transform:none; } }
@media (prefers-reduced-motion: reduce) {
  .agora-act__toggle,.agora-act__subs{transition:none}
  .agora-act__sub{animation:none}
  .agora-spin{animation-duration:0s; }
}
`;

const statusGlyph = (s?: string) => {
    if (s === 'running') {
        return <span className='agora-spin' aria-label='running'/>;
    }
    if (s === 'done') {
        return <span className='agora-dot2' style={{background: OK}} aria-label='done'/>;
    }
    if (s === 'error') {
        return <span className='agora-dot2' style={{background: ERR}} aria-label='error'/>;
    }
    // Unknown/malformed status must NOT look like success — neutral, labelled with the raw value.
    return <span className='agora-dot2' style={{background: MUTE}} aria-label={s ? `status: ${s}` : 'unknown'}/>;
};

const SubRow = ({s}: {s: Sub}) => (
    <div>
        <div className='agora-act__sub'>
            {statusGlyph(s.status)}
            <span className='agora-act__sublabel'>{s.label}</span>
            {s.tool && <span className='agora-act__tool'>{s.tool}</span>}
            {typeof s.duration_ms === 'number' && <span className='agora-act__dur'>{`${s.duration_ms} ms`}</span>}
        </div>
        {s.result && <div className='agora-act__res'>{s.result}</div>}
    </div>
);

const parseAction = (post: any): Action | null => {
    let a = post?.props?.agora_action;
    if (typeof a === 'string') {
        try {
            a = JSON.parse(a);
        } catch {
            return null;
        }
    }
    return a && typeof a === 'object' ? a : null;
};

const AgoraAction = ({post}: {post: any}) => {
    const a = parseAction(post);
    const subs = Array.isArray(a?.subactions) ? a!.subactions : [];
    const running = a?.status === 'running';
    const [open, setOpen] = useState(false);

    // Defensive: malformed/missing props must not break the timeline (fall back to text).
    if (!a) {
        return <div style={{whiteSpace: 'pre-wrap'}}>{post?.message || ''}</div>;
    }

    return (
        <div className='agora-act'>
            <style>{CSS}</style>
            <div className='agora-act__main'>
                {statusGlyph(a.status)}
                <span className='agora-act__title'>{a.title || (running ? 'Working…' : 'Action')}</span>
            </div>
            {a.summary && <div className='agora-act__sum'>{a.summary}</div>}
            {subs.length > 0 && (
                <>
                    <button
                        className='agora-act__toggle'
                        aria-expanded={open}
                        onClick={() => setOpen((o) => !o)}
                    >
                        {open ? '▾ ' : '▸ '}
                        {`${subs.length} step${subs.length === 1 ? '' : 's'}`}
                    </button>
                    <div className={`agora-act__subs${open ? ' agora-act__subs--open' : ''}`}>
                        <div className='agora-act__subsin'>
                            {subs.map((s, i) => <SubRow key={s.id || i} s={s}/>)}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

export default AgoraAction;
