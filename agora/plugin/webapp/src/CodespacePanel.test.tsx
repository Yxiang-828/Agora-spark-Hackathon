/**
 * @jest-environment jsdom
 */
// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.

import '@testing-library/jest-dom';

import {render, screen, cleanup, fireEvent, waitFor} from '@testing-library/react';
import React from 'react';

// The CodeMirror editor needs a real DOM/layout; in tests we stub it (the live Yjs sync is
// exercised by codespace_convergence_probe.test.ts, not jsdom).
jest.mock('./CodeEditor', () => ({
    __esModule: true,
    default: () => <div data-testid='code-editor'/>,
}));
jest.mock('./MarkdownView', () => ({
    __esModule: true,
    default: () => <div data-testid='md-view'/>,
}));
jest.mock('./themes', () => ({
    THEME_NAMES: ['One Dark'],
    FONT_SIZES: [13],
    loadThemePref: () => 'One Dark',
    saveThemePref: () => undefined,
    loadFontPref: () => 13,
    saveFontPref: () => undefined,
    loadWrapPref: () => false,
    saveWrapPref: () => undefined,
    loadPointerPref: () => true,
    savePointerPref: () => undefined,
}));
jest.mock('react-redux', () => ({useSelector: (sel: any) => sel()}));
jest.mock('mattermost-redux/selectors/entities/channels', () => ({getCurrentChannelId: () => 'test-channel'}), {virtual: true});
jest.mock('mattermost-redux/selectors/entities/users', () => ({getCurrentUser: () => ({id: 'u1', username: 'tester'})}), {virtual: true});

import CodespacePanel from './CodespacePanel';

const ok = (x: any) => Promise.resolve({ok: true, json: () => Promise.resolve(x), text: () => Promise.resolve('')});

const setup = ({spaces = [], files = [], content = ''}: {spaces?: any[]; files?: string[]; content?: string} = {}) => {
    (global as any).fetch = jest.fn((url: string, opts?: any) => {
        const u = String(url);
        if (u.endsWith('/codespaces') && (!opts || opts.method !== 'POST')) {
            return ok(spaces);
        }
        if (u.includes('/skills')) {
            return ok({});
        }
        if (u.includes('/workspace')) {
            return ok({codespace_id: ''});
        }
        if (u.includes('/codespace/doc/open')) {
            return ok({role: 'join', updates: []});
        }
        if (u.includes('/codespace/doc/')) {
            return ok({ok: true}); // update / awareness / flush
        }
        if (u.endsWith('/codespace/op')) {
            const b = JSON.parse(opts.body);
            if (b.op === 'tree') {
                return ok({files, is_git: true});
            }
            if (b.op === 'read') {
                return ok({content});
            }
            if (b.op === 'status') {
                return ok({status: '## main'});
            }
            if (b.op === 'commit') {
                return ok({out: 'committed'});
            }
            return ok({});
        }
        return ok({});
    });
};

const hostCs = {id: 'c1', name: 'demo', host_user_id: 'h1', root: '/repo', source: 'local'};

afterEach(() => {
    cleanup();
    jest.clearAllMocks();
});

test('empty state invites pointing at a folder', async () => {
    setup({spaces: []});
    render(<CodespacePanel/>);
    expect(await screen.findByText(/No codespaces yet/i)).toBeInTheDocument();
});

test('lists codespaces in the selector', async () => {
    setup({spaces: [hostCs]});
    render(<CodespacePanel/>);
    expect(await screen.findByText('demo')).toBeInTheDocument();
});

test('selecting a host-backed codespace loads its real tree into the folder view', async () => {
    setup({spaces: [hostCs], files: ['a.txt']});
    render(<CodespacePanel/>);
    await screen.findByText('demo');
    fireEvent.change(screen.getByRole('combobox'), {target: {value: 'c1'}});
    expect(await screen.findByText('a.txt')).toBeInTheDocument();
});

test('opening a file joins the live document (doc/open)', async () => {
    setup({spaces: [hostCs], files: ['a.txt'], content: 'hi'});
    render(<CodespacePanel/>);
    await screen.findByText('demo');
    fireEvent.change(screen.getByRole('combobox'), {target: {value: 'c1'}});
    fireEvent.click(await screen.findByText('a.txt'));
    await waitFor(() => {
        const calls = (global as any).fetch.mock.calls;
        expect(calls.some(([u]: [string]) => String(u).includes('/codespace/doc/open'))).toBe(true);
    });
});

test('commit sends a git commit op to the host', async () => {
    setup({spaces: [hostCs], files: ['a.txt']});
    render(<CodespacePanel/>);
    await screen.findByText('demo');
    fireEvent.change(screen.getByRole('combobox'), {target: {value: 'c1'}});
    await screen.findByText('a.txt'); // tree loaded → git bar present
    fireEvent.change(screen.getByPlaceholderText('commit message'), {target: {value: 'fix things'}});
    fireEvent.click(screen.getByRole('button', {name: 'Commit'}));
    await waitFor(() => {
        const calls = (global as any).fetch.mock.calls;
        const committed = calls.some(([u, o]: [string, any]) => String(u).endsWith('/codespace/op') && o && JSON.parse(o.body).op === 'commit');
        expect(committed).toBe(true);
    });
});
