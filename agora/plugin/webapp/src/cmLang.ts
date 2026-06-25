import {cpp} from '@codemirror/lang-cpp';
import {css} from '@codemirror/lang-css';
import {go} from '@codemirror/lang-go';
import {html} from '@codemirror/lang-html';
import {java} from '@codemirror/lang-java';
import {javascript} from '@codemirror/lang-javascript';
import {json} from '@codemirror/lang-json';
import {markdown} from '@codemirror/lang-markdown';
import {php} from '@codemirror/lang-php';
import {python} from '@codemirror/lang-python';
import {rust} from '@codemirror/lang-rust';
import {sql} from '@codemirror/lang-sql';
import {xml} from '@codemirror/lang-xml';
import {yaml} from '@codemirror/lang-yaml';
import type {Extension} from '@codemirror/state';

// Rich syntax highlighting via CodeMirror's modern Lezer language parsers — keywords, strings,
// comments, types, functions, etc. each get their own highlight tag, which the active theme then
// colors (VSCode-style). All bundle same-origin (no CDN/workers), so they load under the plugin
// CSP. Languages with no parser here just render as plain text.

const byExt: Record<string, () => Extension> = {
    js: () => javascript(),
    jsx: () => javascript({jsx: true}),
    ts: () => javascript({typescript: true}),
    tsx: () => javascript({jsx: true, typescript: true}),
    mjs: () => javascript(),
    cjs: () => javascript(),
    py: () => python(),
    go: () => go(),
    rs: () => rust(),
    json: () => json(),
    md: () => markdown(),
    markdown: () => markdown(),
    html: () => html(),
    htm: () => html(),
    css: () => css(),
    scss: () => css(),
    xml: () => xml(),
    svg: () => xml(),
    sql: () => sql(),
    yml: () => yaml(),
    yaml: () => yaml(),
    java: () => java(),
    c: () => cpp(),
    h: () => cpp(),
    cpp: () => cpp(),
    cc: () => cpp(),
    hpp: () => cpp(),
    cxx: () => cpp(),
    php: () => php(),
};

export const langExtension = (path: string): Extension => {
    const ext = (path.split('.').pop() || '').toLowerCase();
    const make = byExt[ext];
    return make ? make() : [];
};
