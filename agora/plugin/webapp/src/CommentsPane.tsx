import React from 'react';

import Avatar from './Avatar';
import type {Comment} from './comments';

// Shows the comments on the active file: line, author, text, with resolve + jump-to-line.
const CommentsPane = ({comments, path, onResolve, onJump, onClose}: {
    comments: Comment[];
    path: string;
    onResolve: (id: string) => void;
    onJump: (line: number) => void;
    onClose: () => void;
}) => {
    const mine = comments.filter((c) => c.path === path).sort((a, b) => a.line - b.line || a.at - b.at);
    return (
        <div style={{marginTop: 6, border: '1px solid rgba(var(--center-channel-color-rgb),.15)', borderRadius: 5, overflow: 'hidden'}}>
            <div style={{display: 'flex', alignItems: 'center', padding: '3px 8px', fontSize: 11, background: 'rgba(var(--center-channel-color-rgb),.06)'}}>
                <b>{`Comments — ${path.split('/').pop() || path}`}</b>
                <span style={{flex: 1}}/>
                <button
                    style={{background: 'none', border: 0, color: 'inherit', cursor: 'pointer', opacity: 0.6}}
                    onClick={onClose}
                >{'×'}</button>
            </div>
            <div style={{maxHeight: 240, overflow: 'auto', padding: '4px 8px', fontSize: 12}}>
                {mine.length === 0 && <div style={{opacity: 0.6, padding: '4px 0'}}>{'No comments on this file. Put the cursor on a line and click “Comment”. Use @name to ping someone in chat.'}</div>}
                {mine.map((c) => (
                    <div
                        key={c.id}
                        style={{padding: '4px 0', borderBottom: '1px solid rgba(var(--center-channel-color-rgb),.08)', opacity: c.resolved ? 0.5 : 1}}
                    >
                        <div style={{display: 'flex', alignItems: 'center', gap: 6}}>
                            <Avatar
                                id={c.author_id}
                                name={c.author}
                                color='#888'
                                size={15}
                            />
                            <span style={{fontWeight: 600}}>{c.author}</span>
                            <button
                                style={{background: 'none', border: 0, color: 'var(--link-color,#2389d7)', cursor: 'pointer', fontSize: 11, padding: 0}}
                                onClick={() => onJump(c.line)}
                            >{`line ${c.line}`}</button>
                            <span style={{flex: 1}}/>
                            <button
                                style={{background: 'none', border: '1px solid rgba(var(--center-channel-color-rgb),.2)', borderRadius: 3, color: 'inherit', cursor: 'pointer', fontSize: 10, padding: '1px 5px'}}
                                onClick={() => onResolve(c.id)}
                            >{c.resolved ? 'Reopen' : 'Resolve'}</button>
                        </div>
                        {c.snippet && <div style={{opacity: 0.55, fontFamily: 'monospace', fontSize: 11, margin: '2px 0', whiteSpace: 'pre', overflow: 'hidden', textOverflow: 'ellipsis'}}>{c.snippet}</div>}
                        <div style={{whiteSpace: 'pre-wrap', wordBreak: 'break-word'}}>{c.text}</div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default CommentsPane;
