import React from 'react';

// Home = the "how to use Agora" guide. Always one click away (app-bar Home), so anyone
// entering the app knows how to get their agent in, where to work, and the daily loop.

const Step = ({n, title, children}: {n: number; title: string; children: React.ReactNode}) => (
    <div style={{display: 'flex', gap: 10, margin: '12px 0'}}>
        <div style={{
            flex: 'none', width: 22, height: 22, borderRadius: 22, fontSize: 12, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--button-bg,#1c58d9)', color: 'var(--button-color,#fff)',
        }}>{n}</div>
        <div>
            <div style={{fontWeight: 600}}>{title}</div>
            <div style={{fontSize: 13, color: 'rgba(var(--center-channel-color-rgb),.75)', marginTop: 2}}>{children}</div>
        </div>
    </div>
);

const HomePanel = () => (
    <div style={{padding: 16, fontSize: 14, color: 'var(--center-channel-color)', height: '100%', overflowY: 'auto', boxSizing: 'border-box'}}>
        <div style={{fontWeight: 700, fontSize: 16}}>{'Welcome to Agora'}</div>
        <div style={{fontSize: 12, color: 'rgba(var(--center-channel-color-rgb),.64)', marginBottom: 6}}>
            {'A room where your team and your AIs build together. Here’s the loop:'}
        </div>

        <Step n={1} title='Connect your AI'>
            {'Top bar → '}<b>{'Connect AI'}</b>{' → run the one command it shows. Your agent joins the room on your own subscription (any OS). No token to copy.'}
        </Step>
        <Step n={2} title='Go to a Features channel & claim your area'>
            {'In '}<b>{'#features'}</b>{', run '}<code>{'/claim src/auth'}</code>{' to declare what you’re working on. If it overlaps a teammate, Agora flags it so you coordinate before colliding.'}
        </Step>
        <Step n={3} title='Start a thread per task'>
            {'Open a thread for the task, then '}<b>{'@your-agent'}</b>{' to put it to work. Teammates and their agents join in. Use '}<code>{'/ai mute'}</code>{' or reactions to control the noise.'}
        </Step>
        <Step n={4} title='Observe the code'>
            {'Open the '}<b>{'Codespace'}</b>{' to browse and edit the shared project — the whole tree, in an editor.'}
        </Step>
        <Step n={5} title='Capture what you learned'>
            {'Type '}<code>{'wrap'}</code>{' (@mention an agent) to turn a solved thread into a proposed Dictionary entry. A Lead approves it in '}<b>{'Archive'}</b>{', and it joins the shared brain.'}
        </Step>

        <div style={{fontWeight: 700, fontSize: 13, marginTop: 18, marginBottom: 4}}>{'What’s where'}</div>
        <ul style={{margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6, color: 'rgba(var(--center-channel-color-rgb),.8)'}}>
            <li><b>{'Connect AI'}</b>{' — get your agent into the room'}</li>
            <li><b>{'Skills'}</b>{' — who’s connected and what they can do'}</li>
            <li><b>{'Archive'}</b>{' — pending knowledge to approve + the Dictionary'}</li>
            <li><b>{'#features'}</b>{' — where work happens (claim → thread → wrap)'}</li>
            <li><b>{'Codespace'}</b>{' — browse/edit the project’s code'}</li>
        </ul>
    </div>
);

export default HomePanel;
