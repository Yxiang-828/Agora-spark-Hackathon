import React from 'react';

// A colored unified-diff viewer for `git diff HEAD` (review your working changes before committing).
// Additions green, deletions red, hunk headers blue, file headers dim.

const lineColor = (l: string): {color?: string; opacity?: number} => {
    if (l.startsWith('+') && !l.startsWith('+++')) {
        return {color: '#3fb950'};
    }
    if (l.startsWith('-') && !l.startsWith('---')) {
        return {color: '#f85149'};
    }
    if (l.startsWith('@@')) {
        return {color: '#58a6ff'};
    }
    if (l.startsWith('diff ') || l.startsWith('index ') || l.startsWith('+++') || l.startsWith('---')) {
        return {opacity: 0.6};
    }
    return {};
};

const DiffView = ({text, onClose}: {text: string; onClose: () => void}) => {
    const lines = (text || '').split('\n');
    const empty = !text.trim();
    return (
        <div style={{marginTop: 6, border: '1px solid rgba(var(--center-channel-color-rgb),.15)', borderRadius: 5, overflow: 'hidden'}}>
            <div style={{display: 'flex', alignItems: 'center', padding: '3px 8px', fontSize: 11, background: 'rgba(var(--center-channel-color-rgb),.06)'}}>
                <b>{'Working changes (vs last commit)'}</b>
                <span style={{flex: 1}}/>
                <button
                    style={{background: 'none', border: 0, color: 'inherit', cursor: 'pointer', opacity: 0.6}}
                    onClick={onClose}
                >{'×'}</button>
            </div>
            <pre style={{margin: 0, padding: 8, fontSize: 11.5, fontFamily: 'monospace', maxHeight: 260, overflow: 'auto', background: '#0d1117', color: '#c9d1d9', whiteSpace: 'pre-wrap', wordBreak: 'break-all'}}>
                {empty ? <span style={{opacity: 0.6}}>{'(no uncommitted changes)'}</span> : lines.map((l, i) => (
                    <div
                        key={i}
                        style={lineColor(l)}
                    >{l || ' '}</div>
                ))}
            </pre>
        </div>
    );
};

export default DiffView;
