// Agora voice roster for the AI call feature.
//
// Qwen3-TTS reference voices render LOCALLY on the connector host (the machine running the
// agent). This file is the single source of truth for the voice list the picker shows and the
// id the call sends to the connector. Local Qwen only — no cloud TTS fallback.
//
// Names are deliberately CLEAR one-word descriptors (the raw refs carried project codenames like
// "hutao"/"emilia"/"rem" — meaningless to a user). The `ref` is the on-disk voice_actors folder
// the connector's Qwen install reads; never rename a `ref`, only the display `name`.

export type VoiceEngine = 'qwen';
export type VoiceLang = 'English' | 'Chinese';

export interface AgoraVoice {
    id: string;          // stable id sent to the connector
    engine: VoiceEngine;
    ref: string;         // qwen voice_actors folder
    name: string;        // clear display name
    lang?: VoiceLang;
    blurb: string;       // one-line character of the voice
}

// Qwen reference voices (render locally on the connector). ref = qwen3:<folder>.
export const QWEN_VOICES: AgoraVoice[] = [
    {id: 'qwen3:english/0_intro', engine: 'qwen', ref: 'english/0_intro', name: 'Narrator', lang: 'English', blurb: 'Even, broadcast-style narration'},
    {id: 'qwen3:english/1_window', engine: 'qwen', ref: 'english/1_window', name: 'Casual', lang: 'English', blurb: 'Relaxed, conversational'},
    {id: 'qwen3:english/2_amateur', engine: 'qwen', ref: 'english/2_amateur', name: 'Plain', lang: 'English', blurb: 'Unpolished, everyday'},
    {id: 'qwen3:english/3_warm', engine: 'qwen', ref: 'english/3_warm', name: 'Warm', lang: 'English', blurb: 'Friendly and reassuring'},
    {id: 'qwen3:english/4_classically_trained', engine: 'qwen', ref: 'english/4_classically_trained', name: 'Refined', lang: 'English', blurb: 'Crisp, classically trained'},
    {id: 'qwen3:english/5_monotone', engine: 'qwen', ref: 'english/5_monotone', name: 'Monotone', lang: 'English', blurb: 'Flat, deadpan'},
    {id: 'qwen3:english/6_dramatic', engine: 'qwen', ref: 'english/6_dramatic', name: 'Dramatic', lang: 'English', blurb: 'Big, expressive delivery'},
    {id: 'qwen3:english/7_juilliard', engine: 'qwen', ref: 'english/7_juilliard', name: 'Theatrical', lang: 'English', blurb: 'Stage-trained, projecting'},
    {id: 'qwen3:english/12_hutao', engine: 'qwen', ref: 'english/12_hutao', name: 'Cute', lang: 'English', blurb: 'Light, playful'},
    {id: 'qwen3:english/13_emilia', engine: 'qwen', ref: 'english/13_emilia', name: 'Heroine', lang: 'English', blurb: 'Bright lead-character voice'},
    {id: 'qwen3:english/14_rem', engine: 'qwen', ref: 'english/14_rem', name: 'Adoring', lang: 'English', blurb: 'Soft, admiring'},
    {id: 'qwen3:english/15_soothing_woman', engine: 'qwen', ref: 'english/15_soothing_woman', name: 'Soothing', lang: 'English', blurb: 'Calm, gentle'},
    {id: 'qwen3:english/16_confident_male', engine: 'qwen', ref: 'english/16_confident_male', name: 'Confident', lang: 'English', blurb: 'Assured, steady'},
    {id: 'qwen3:english/17_powerful_male', engine: 'qwen', ref: 'english/17_powerful_male', name: 'Bold', lang: 'English', blurb: 'Strong, commanding male'},
    {id: 'qwen3:english/18_powerful_female', engine: 'qwen', ref: 'english/18_powerful_female', name: 'Powerful', lang: 'English', blurb: 'Strong, commanding female'},
    {id: 'qwen3:english/19_male_mc', engine: 'qwen', ref: 'english/19_male_mc', name: 'Hero', lang: 'English', blurb: 'Lead-character male voice'},
    {id: 'qwen3:english/20_stuttering_male', engine: 'qwen', ref: 'english/20_stuttering_male', name: 'Timid', lang: 'English', blurb: 'Hesitant, shy'},
    {id: 'qwen3:chinese/8_cute_chinese', engine: 'qwen', ref: 'chinese/8_cute_chinese', name: 'Sweet', lang: 'Chinese', blurb: 'Light and sweet (中文)'},
    {id: 'qwen3:chinese/9_hutao', engine: 'qwen', ref: 'chinese/9_hutao', name: 'Playful', lang: 'Chinese', blurb: 'Mischievous, energetic (中文)'},
    {id: 'qwen3:chinese/10_ganyu', engine: 'qwen', ref: 'chinese/10_ganyu', name: 'Gentle', lang: 'Chinese', blurb: 'Soft, graceful (中文)'},
    {id: 'qwen3:chinese/11_xiangling', engine: 'qwen', ref: 'chinese/11_xiangling', name: 'Lively', lang: 'Chinese', blurb: 'Warm, spirited (中文)'},
];

export const DEFAULT_VOICE_ID = 'qwen3:english/3_warm';

export const voiceById = (id: string): AgoraVoice | undefined => QWEN_VOICES.find((v) => v.id === id);

// Pre-generated real-Qwen preview clip for this voice (served static). The connector's
// gen-voice-samples step writes <safe-id>.wav here; '/' and ':' are flattened to '_'.
export const sampleUrl = (id: string): string => `/static/voice-samples/${id.replace(/[:/]/g, '_')}.wav`;

// The chosen call voice persists per browser.
const VOICE_KEY = 'agora.call.voice';
export const loadVoiceId = (): string => {
    try {
        const v = window.localStorage.getItem(VOICE_KEY);
        return v && voiceById(v) ? v : DEFAULT_VOICE_ID;
    } catch (e) {
        return DEFAULT_VOICE_ID;
    }
};
export const saveVoiceId = (id: string) => {
    try {
        window.localStorage.setItem(VOICE_KEY, id);
    } catch (e) {
        // ignore (private mode etc.)
    }
};
