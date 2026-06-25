import React from 'react';
import {useSelector} from 'react-redux';

import {getCurrentChannelId} from 'mattermost-redux/selectors/entities/channels';

// 3D spatial Voice Room tab — embeds the plugin-served room (public/room) scoped to the
// current channel. Humans join with a mic (WebRTC mesh, relayed by the plugin); agents are
// rendered as badged avatars and speak via their Qwen TTS clip. The iframe isolates the
// three.js / importmap app from the webapp's bundler.

const RoomPanel = (): JSX.Element => {
    const channelId = useSelector(getCurrentChannelId);

    if (!channelId) {
        return (
            <div style={{padding: 16, fontSize: 14, color: 'var(--center-channel-color)'}}>
                {'Open a channel first — each channel has its own 3D voice room.'}
            </div>
        );
    }

    // Served as room.html (NOT index.html): Mattermost's plugin static server redirects
    // `/index.html` → the directory and then 404s the dir listing, so a non-index name is required.
    const src = `/plugins/com.aegis.agora/public/room/room.html?channel=${encodeURIComponent(channelId)}`;
    return (
        <iframe
            title='Agora Voice Room'
            src={src}
            allow='microphone; autoplay'
            style={{border: 0, width: '100%', height: '100%', display: 'block'}}
        />
    );
};

export default RoomPanel;
