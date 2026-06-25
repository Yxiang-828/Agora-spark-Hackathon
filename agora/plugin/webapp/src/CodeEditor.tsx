import {Compartment, EditorState} from '@codemirror/state';
import {EditorView, GutterMarker, gutter, keymap} from '@codemirror/view';
import {basicSetup} from 'codemirror';
import React, {useEffect, useRef} from 'react';
import {yCollab, yUndoManagerKeymap} from 'y-codemirror.next';
import * as Y from 'yjs';

import {langExtension} from './cmLang';
import {remotePointers} from './pointerLayer';
import {themeExt} from './themes';
import type {RoomProvider} from './yprovider';

// CodeMirror 6 editor bound to the shared Yjs doc via y-codemirror.next (yCollab handles live
// text sync + remote cursors/selections from the awareness states). CodeMirror bundles to pure
// same-origin JS with no web workers and no CDN, so it loads under Mattermost's strict
// `script-src 'self'` CSP — unlike Monaco, which is fetched from a CDN the CSP blocks.
//
// Theme, font size, and word-wrap are swappable live (via Compartments) without rebuilding the
// editor, so changing a Display setting doesn't lose your cursor or scroll position.

// Canva-style remote cursors: show the name label (`.cm-ySelectionInfo`) always, not just on hover.
let stylesInjected = false;
const injectCursorStyles = () => {
    if (stylesInjected) {
        return;
    }
    stylesInjected = true;
    const el = document.createElement('style');
    el.textContent = `
.cm-ySelectionInfo { opacity: 1 !important; transition: none !important; padding: 1px 4px !important;
    font-size: 10px !important; border-radius: 3px !important; top: -1.2em !important; font-family: sans-serif; }
.cm-ySelectionCaret { border-left-width: 2px !important; }`;
    document.head.appendChild(el);
};

const fontTheme = (size: number) => EditorView.theme({
    '&': {height: '100%'},
    '.cm-scroller': {overflow: 'auto', fontFamily: 'monospace', fontSize: `${size}px`},
});

// A gutter that shows a 💬 marker on lines that have a comment.
class CommentMarker extends GutterMarker {
    toDOM() {
        const s = document.createElement('span');
        s.textContent = '💬';
        s.style.fontSize = '10px';
        return s;
    }
}
const commentGutter = (lines: Set<number>) => gutter({
    class: 'cm-comment-gutter',
    lineMarker: (view, block) => (lines.has(view.state.doc.lineAt(block.from).number) ? new CommentMarker() : null),
});

type Props = {
    provider: RoomProvider; path: string; readOnly: boolean; theme: string; fontSize: number;
    wrap: boolean; pointers: boolean; onSave: () => void; commentLines: number[];
    onCursorLine: (line: number) => void; onView: (v: EditorView | null) => void;
};

const CodeEditor = ({provider, path, readOnly, theme, fontSize, wrap, pointers, onSave, commentLines, onCursorLine, onView}: Props) => {
    const ref = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const themeComp = useRef(new Compartment());
    const fontComp = useRef(new Compartment());
    const wrapComp = useRef(new Compartment());
    const commentComp = useRef(new Compartment());
    const pointerComp = useRef(new Compartment());
    const onSaveRef = useRef(onSave);
    onSaveRef.current = onSave;
    const onCursorRef = useRef(onCursorLine);
    onCursorRef.current = onCursorLine;
    const onViewRef = useRef(onView);
    onViewRef.current = onView;

    useEffect(() => {
        const host = ref.current;
        if (!host) {
            return undefined;
        }
        injectCursorStyles();
        const undoManager = new Y.UndoManager(provider.text);
        const saveKey = keymap.of([{
            key: 'Mod-s',
            preventDefault: true,
            run: () => {
                onSaveRef.current();
                return true;
            },
        }]);
        const view = new EditorView({
            parent: host,
            state: EditorState.create({
                doc: provider.text.toString(),
                extensions: [
                    basicSetup,
                    saveKey,
                    keymap.of(yUndoManagerKeymap),
                    themeComp.current.of(themeExt(theme)),
                    fontComp.current.of(fontTheme(fontSize)),
                    wrapComp.current.of(wrap ? EditorView.lineWrapping : []),
                    commentComp.current.of(commentGutter(new Set(commentLines))),
                    EditorView.updateListener.of((u) => {
                        if (u.selectionSet || u.docChanged) {
                            onCursorRef.current(u.state.doc.lineAt(u.state.selection.main.head).number);
                        }
                    }),
                    langExtension(path),
                    yCollab(provider.text, provider.awareness, {undoManager}),
                    pointerComp.current.of(pointers ? remotePointers(provider.awareness) : []),
                    EditorView.editable.of(!readOnly),
                    EditorState.readOnly.of(readOnly),
                ],
            }),
        });
        viewRef.current = view;
        onViewRef.current(view);
        view.focus(); // grab focus on mount so the first keystroke lands here, not the chat box
        return () => {
            onViewRef.current(null);
            view.destroy();
            viewRef.current = null;
        };
    }, [provider, path, readOnly]);

    useEffect(() => {
        viewRef.current?.dispatch({effects: themeComp.current.reconfigure(themeExt(theme))});
    }, [theme]);
    useEffect(() => {
        viewRef.current?.dispatch({effects: fontComp.current.reconfigure(fontTheme(fontSize))});
    }, [fontSize]);
    useEffect(() => {
        viewRef.current?.dispatch({effects: wrapComp.current.reconfigure(wrap ? EditorView.lineWrapping : [])});
    }, [wrap]);
    useEffect(() => {
        viewRef.current?.dispatch({effects: commentComp.current.reconfigure(commentGutter(new Set(commentLines)))});
    }, [commentLines]);
    useEffect(() => {
        viewRef.current?.dispatch({effects: pointerComp.current.reconfigure(pointers ? remotePointers(provider.awareness) : [])});
    }, [pointers, provider]);

    // Keep keystrokes from bubbling to Mattermost's document handler (the "typing goes to the chat
    // box" bug in the narrow RHS); the editor already handled the key at its contenteditable.
    const swallow = (e: React.KeyboardEvent) => e.stopPropagation();

    return (
        <div
            ref={ref}
            style={{height: '100%', overflow: 'hidden'}}
            onKeyDown={swallow}
            onKeyUp={swallow}
            onKeyPress={swallow}
        />
    );
};

export default CodeEditor;
