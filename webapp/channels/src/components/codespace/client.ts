import {Client4} from 'mattermost-redux/client';

// cleanError turns an error body into a short human message. The room sits behind a proxy/tunnel
// that can return a full HTML 504 page; never surface that wall of markup — collapse it to a
// concise reason, prefer a typed {reason}/{error}, and cap length.
export const cleanError = (raw: string): string => {
    const t = (raw || '').trim();
    if (!t) {
        return 'request failed';
    }
    if (t.startsWith('<')) { // an HTML error page (e.g. a Cloudflare/nginx gateway timeout)
        return 'the room timed out (gateway/tunnel) — your work is kept locally and will retry';
    }
    try {
        const o = JSON.parse(t);
        return o.reason || o.error || JSON.stringify(o);
    } catch (e) {
        return t.length > 200 ? t.slice(0, 200) + '…' : t;
    }
};

// Authenticated fetch for the plugin API.
//
// Mattermost sessions can be cookie-based OR token-based. Plain
// fetch(url, {credentials: 'same-origin'}) only covers the cookie case, so on a
// token-based instance (no MMAUTHTOKEN cookie set) every plugin call 401s. This helper
// covers both: it sends the webapp's bearer token when Client4 has one, always sends
// same-origin cookies, and adds X-Requested-With so Mattermost accepts the session.
export const apiFetch = (url: string, opts: RequestInit = {}): Promise<Response> => {
    let token = '';
    try {
        token = Client4.getToken();
    } catch (e) {
        token = '';
    }
    return fetch(url, {
        ...opts,
        credentials: 'include',
        headers: {
            'X-Requested-With': 'XMLHttpRequest',
            ...(token ? {Authorization: `Bearer ${token}`} : {}),
            ...(opts.headers || {}),
        },
    });
};
