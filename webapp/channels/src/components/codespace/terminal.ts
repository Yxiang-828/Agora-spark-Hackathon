import {apiFetch, cleanError} from './client';

// Codespace terminal transport + the shared "who's running what" bus. Commands are POSTed to the
// room, which serializes them per codespace, runs them on the host (jailed + gated + audited), and
// returns the output. The bus carries cs_term_busy events so every member sees the serialization.

const API = `/plugins/com.aegis.agora/api/v1`;

export type TermResult = {out: string; exit: number; cwd: string};

export const runCommand = (csId: string, channelId: string, command: string): Promise<TermResult> =>
    apiFetch(`${API}/codespace/term`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({codespace_id: csId, channel_id: channelId, command}),
    }).then((r) => (r.ok ? r.json() : r.text().then((t) => Promise.reject(new Error(cleanError(t))))));

export type TermBusy = {codespace_id: string; user_id: string; name: string; command: string; state: string; out?: string; exit?: number};

let busyCb: ((b: TermBusy) => void) | null = null;

export const subscribeTermBusy = (cb: (b: TermBusy) => void): (() => void) => {
    busyCb = cb;
    return () => {
        if (busyCb === cb) {
            busyCb = null;
        }
    };
};

// index.tsx forwards cs_term_busy here.
export const csReceiveTermBusy = (data: TermBusy) => {
    if (busyCb) {
        busyCb(data);
    }
};
