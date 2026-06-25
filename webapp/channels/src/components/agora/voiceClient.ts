// Voice playback for the call + picker.
//
// Real audio is synthesized on the connector host (local Qwen3-TTS) and delivered
// as base64 — see playAudioBase64(). Until a TTS-capable connector is paired, previewVoice() falls
// back to the browser's built-in SpeechSynthesis so the picker's ▶ test and the call still SPEAK
// (a local stand-in, clearly not the Qwen reference voice). speakText() is the call's entry point:
// it plays connector audio when given, else speaks the text locally.

import type {AgoraVoice} from './voices';

export const SAMPLE_LINE = 'Hey — I just pushed the fix. Want me to walk you through it?';

let currentAudio: HTMLAudioElement | null = null;

export function stopSpeaking(): void {
    try {
        if (currentAudio) {
            currentAudio.pause();
            currentAudio = null;
        }
        if (typeof window !== 'undefined' && window.speechSynthesis) {
            window.speechSynthesis.cancel();
        }
    } catch (e) {
        // ignore
    }
}

// Play connector-synthesized audio (base64). Resolves when playback ends.
export function playAudioBase64(base64: string, mime = 'audio/mpeg'): Promise<void> {
    return new Promise((resolve) => {
        stopSpeaking();
        try {
            const audio = new Audio(`data:${mime};base64,${base64}`);
            currentAudio = audio;
            audio.onended = () => resolve();
            audio.onerror = () => resolve();
            audio.play().catch(() => resolve());
        } catch (e) {
            resolve();
        }
    });
}

// Heuristic: pick a browser voice roughly matching the chosen voice's language + gender, so the
// local fallback at least sounds plausible per selection.
const femaleHints = ['cute', 'heroine', 'adoring', 'soothing', 'powerful', 'sweet', 'playful', 'gentle', 'lively', 'warm', 'sarah', 'laura', 'alice', 'matilda', 'jessica', 'bella', 'lily'];

function pickBrowserVoice(voice?: AgoraVoice): SpeechSynthesisVoice | undefined {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
        return undefined;
    }
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) {
        return undefined;
    }
    const wantZh = voice?.lang === 'Chinese';
    const byLang = voices.filter((v) => (wantZh ? /zh/i.test(v.lang) : /en/i.test(v.lang)));
    const pool = byLang.length ? byLang : voices;
    const name = (voice?.name || '').toLowerCase();
    const wantFemale = femaleHints.some((h) => name.includes(h));
    const gendered = pool.find((v) => (wantFemale ? /female|zira|samantha|aria|jenny|woman/i.test(v.name) : /male|david|mark|guy|man/i.test(v.name)));
    return gendered || pool[0];
}

export function browserSpeak(text: string, voice?: AgoraVoice): Promise<void> {
    return new Promise((resolve) => {
        try {
            if (typeof window === 'undefined' || !window.speechSynthesis) {
                resolve();
                return;
            }
            stopSpeaking();
            const u = new SpeechSynthesisUtterance(text);
            const bv = pickBrowserVoice(voice);
            if (bv) {
                u.voice = bv;
                u.lang = bv.lang;
            }
            u.onend = () => resolve();
            u.onerror = () => resolve();
            window.speechSynthesis.speak(u);
        } catch (e) {
            resolve();
        }
    });
}

// Play a static audio URL; resolves true if it actually played, false on load error (e.g. 404).
function playUrl(url: string): Promise<boolean> {
    return new Promise((resolve) => {
        stopSpeaking();
        try {
            const a = new Audio(url);
            currentAudio = a;
            let started = false;
            a.onplaying = () => {
                started = true;
            };
            a.onended = () => resolve(started);
            a.onerror = () => resolve(false);
            a.play().then(() => undefined).catch(() => resolve(false));
        } catch (e) {
            resolve(false);
        }
    });
}

// previewVoice — the picker's ▶: play the REAL pre-generated Qwen clip; only if it isn't
// available (not generated yet) fall back to the browser voice so the button still does something.
export async function previewVoice(voice: AgoraVoice, text = SAMPLE_LINE): Promise<{engine: string}> {
    const {sampleUrl} = await import('./voices');
    const played = await playUrl(sampleUrl(voice.id));
    if (played) {
        return {engine: `qwen:${voice.name}`};
    }
    await browserSpeak(text, voice);
    return {engine: 'browser-fallback'};
}
