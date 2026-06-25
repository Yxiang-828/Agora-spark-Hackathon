import React from 'react';

// A small circular user avatar (Mattermost serves /api/v4/users/<id>/image). Falls back to a
// solid color circle if the image can't load, so we never show a broken-image icon.
const Avatar = ({id, name, color, size = 16}: {id: string; name: string; color: string; size?: number}) => (
    <span
        title={name}
        style={{width: size,
            height: size,
            borderRadius: '50%',
            background: color || '#888',
            display: 'inline-block',
            position: 'relative',
            overflow: 'hidden',
            flex: 'none',
            boxShadow: `0 0 0 1.5px ${color || '#888'}`}}
    >
        <img
            src={`/api/v4/users/${id}/image`}
            alt=''
            onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
            }}
            style={{width: '100%', height: '100%', objectFit: 'cover'}}
        />
    </span>
);

export default Avatar;
