import DOMPurify from 'dompurify';
import {marked} from 'marked';
import React, {useEffect, useState} from 'react';

import type {RoomProvider} from './yprovider';

// Live markdown preview of the shared doc. Renders provider.text -> HTML (marked) -> sanitized
// (DOMPurify, so untrusted file content can't inject script), and re-renders as the doc changes.
// Both libs bundle same-origin (no CDN), so they work under the plugin CSP.

let mdStyle = false;
const injectMdStyle = () => {
    if (mdStyle) {
        return;
    }
    mdStyle = true;
    const el = document.createElement('style');
    el.textContent = `
.agora-md { font-family: sans-serif; }
.agora-md h1,.agora-md h2,.agora-md h3 { margin: .6em 0 .3em; line-height: 1.2; }
.agora-md p { margin: .4em 0; }
.agora-md code { background: rgba(var(--center-channel-color-rgb),.08); padding: 1px 4px; border-radius: 3px; font-family: monospace; }
.agora-md pre { background: rgba(var(--center-channel-color-rgb),.08); padding: 8px; border-radius: 5px; overflow: auto; }
.agora-md pre code { background: none; padding: 0; }
.agora-md blockquote { border-left: 3px solid rgba(var(--center-channel-color-rgb),.25); margin: .4em 0; padding-left: 10px; opacity: .85; }
.agora-md table { border-collapse: collapse; } .agora-md td,.agora-md th { border: 1px solid rgba(var(--center-channel-color-rgb),.2); padding: 3px 8px; }
.agora-md a { color: var(--link-color, #2389d7); }
.agora-md img { max-width: 100%; }`;
    document.head.appendChild(el);
};

const MarkdownView = ({provider}: {provider: RoomProvider}) => {
    const [html, setHtml] = useState('');

    useEffect(() => {
        injectMdStyle();
        const render = () => {
            const raw = marked.parse(provider.text.toString(), {async: false}) as string;
            setHtml(DOMPurify.sanitize(raw));
        };
        render();
        const obs = () => render();
        provider.text.observe(obs);
        return () => provider.text.unobserve(obs);
    }, [provider]);

    return (
        <div
            className='agora-md'
            style={{height: '100%', overflow: 'auto', padding: '8px 14px', color: 'var(--center-channel-color)', lineHeight: 1.5}}
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{__html: html}}
        />
    );
};

export default MarkdownView;
