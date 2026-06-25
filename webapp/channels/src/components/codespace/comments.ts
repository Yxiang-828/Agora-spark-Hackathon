import {apiFetch} from './client';

// Inline code comments transport + a bus so the open editor/panel refreshes when the room
// broadcasts cs_comments (someone added or resolved a comment).

const API = `/plugins/com.aegis.agora/api/v1`;

export type Comment = {
    id: string;
    path: string;
    line: number;
    snippet: string;
    author_id: string;
    author: string;
    text: string;
    resolved: boolean;
    at: number;
};

const jsonOrEmpty = (r: Response) => (r.ok ? r.json() : Promise.resolve([]));

export const listComments = (csId: string, channelId: string): Promise<Comment[]> =>
    apiFetch(`${API}/codespace/comments?codespace=${csId}&channel=${channelId}`).then(jsonOrEmpty).then((d) => (Array.isArray(d) ? d : []));

export const addComment = (csId: string, channelId: string, path: string, line: number, snippet: string, text: string): Promise<Response> =>
    apiFetch(`${API}/codespace/comments`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({codespace_id: csId, channel_id: channelId, path, line, snippet, text}),
    });

export const resolveComment = (id: string, csId: string, channelId: string): Promise<Response> =>
    apiFetch(`${API}/codespace/comments/${id}/resolve`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({codespace_id: csId, channel_id: channelId}),
    });

let cb: ((data: {codespace_id: string}) => void) | null = null;
export const subscribeComments = (fn: (data: {codespace_id: string}) => void): (() => void) => {
    cb = fn;
    return () => {
        if (cb === fn) {
            cb = null;
        }
    };
};
export const csReceiveComments = (data: {codespace_id: string}) => {
    if (cb) {
        cb(data);
    }
};
