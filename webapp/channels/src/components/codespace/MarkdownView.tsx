import React, {useEffect, useState} from 'react';

import Markdown from 'components/markdown';

import type {RoomProvider} from './yprovider';

// Live markdown preview of the shared doc. Renders provider.text through the host's own
// Markdown component (which formats + sanitizes safely — no extra deps, no dangerouslySetInnerHTML),
// and re-renders as the doc changes.

const MarkdownView = ({provider}: {provider: RoomProvider}) => {
    const [text, setText] = useState('');

    useEffect(() => {
        const render = () => setText(provider.text.toString());
        render();
        const obs = () => render();
        provider.text.observe(obs);
        return () => provider.text.unobserve(obs);
    }, [provider]);

    return (
        <div
            className='agora-md'
            style={{height: '100%', overflow: 'auto', padding: '8px 14px', color: 'var(--center-channel-color)', lineHeight: 1.5}}
        >
            <Markdown message={text}/>
        </div>
    );
};

export default MarkdownView;
