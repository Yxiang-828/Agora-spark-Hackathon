import type {Extension} from '@codemirror/state';
import {oneDark} from '@codemirror/theme-one-dark';
import {ayuLight, clouds, cobalt, coolGlow, dracula, espresso, rosePineDawn, solarizedLight, tomorrow} from 'thememirror';

// Editor color themes for the codespace. All bundle same-origin (no CDN), so they work under the
// plugin CSP. Each value is a CodeMirror extension (theme + syntax-highlight style).

export const THEMES: Record<string, Extension> = {
    'One Dark': oneDark,
    Dracula: dracula,
    Cobalt: cobalt,
    'Cool Glow': coolGlow,
    Tomorrow: tomorrow,
    Espresso: espresso,
    'Solarized Light': solarizedLight,
    'Ayu Light': ayuLight,
    'Rosé Pine Dawn': rosePineDawn,
    Clouds: clouds,
    'Plain Light': [], // CodeMirror's default light look (no theme override)
};

export const THEME_NAMES = Object.keys(THEMES);
export const DEFAULT_THEME = 'One Dark';
export const FONT_SIZES = [11, 12, 13, 14, 15, 16, 18, 20];
export const DEFAULT_FONT = 13;

export const themeExt = (name: string): Extension => THEMES[name] ?? oneDark;

// Persist display prefs per browser so they stick across sessions.
const THEME_KEY = 'agora.cs.theme';
const FONT_KEY = 'agora.cs.font';

export const loadThemePref = (): string => {
    try {
        const v = window.localStorage.getItem(THEME_KEY);
        return v && THEMES[v] !== undefined ? v : DEFAULT_THEME;
    } catch (e) {
        return DEFAULT_THEME;
    }
};
export const saveThemePref = (name: string) => {
    try {
        window.localStorage.setItem(THEME_KEY, name);
    } catch (e) {
        // ignore (private mode etc.)
    }
};
export const loadFontPref = (): number => {
    try {
        const v = parseInt(window.localStorage.getItem(FONT_KEY) || '', 10);
        return FONT_SIZES.includes(v) ? v : DEFAULT_FONT;
    } catch (e) {
        return DEFAULT_FONT;
    }
};
export const saveFontPref = (size: number) => {
    try {
        window.localStorage.setItem(FONT_KEY, String(size));
    } catch (e) {
        // ignore
    }
};

const WRAP_KEY = 'agora.cs.wrap';
export const loadWrapPref = (): boolean => {
    try {
        return window.localStorage.getItem(WRAP_KEY) === '1';
    } catch (e) {
        return false;
    }
};
export const saveWrapPref = (on: boolean) => {
    try {
        window.localStorage.setItem(WRAP_KEY, on ? '1' : '0');
    } catch (e) {
        // ignore
    }
};

// Live mouse pointers default ON; a teammate who finds them distracting can switch them off.
const POINTER_KEY = 'agora.cs.pointers';
export const loadPointerPref = (): boolean => {
    try {
        return window.localStorage.getItem(POINTER_KEY) !== '0';
    } catch (e) {
        return true;
    }
};
export const savePointerPref = (on: boolean) => {
    try {
        window.localStorage.setItem(POINTER_KEY, on ? '1' : '0');
    } catch (e) {
        // ignore
    }
};
