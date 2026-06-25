/**
 * @jest-environment jsdom
 */
// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.

import '@testing-library/jest-dom';

import React from 'react';
import {render, screen, cleanup, waitFor} from '@testing-library/react';

import SkillsPanel from './SkillsPanel';

const mockFetch = (impl: any) => {
    (global as any).fetch = jest.fn(impl);
};

const okJson = (data: any) => Promise.resolve({ok: true, json: () => Promise.resolve(data)});

const report = (over: any = {}) => ({
    a1: {
        agent: {id: 'a1', name: 'agora-claude'},
        reported_at: Date.now(),
        admitted: [],
        rejected: [],
        ...over,
    },
});

const ssh = {
    skill: 'ssh-access',
    verdict: 'ADMIT',
    reasons: [],
    compat: {windows: {status: 'ok', detail: 'plink'}, macos: {status: 'ok', detail: 'ssh'}, linux: {status: 'ok', detail: 'ssh'}},
    host_selfcheck: 'none',
    manifest: {version: '1.0.0', description: {what: 'run remote cmd'}},
};

const badSkill = {
    skill: 'bad-creds',
    verdict: 'REJECT',
    reasons: [{clause: 'CREDS_IN_MANIFEST', os: null, detail: "credentials[0] embeds 'password'"}],
    compat: {windows: {status: 'ok', detail: ''}, macos: {status: 'ok', detail: ''}, linux: {status: 'ok', detail: ''}},
    manifest: {version: '0.1.0'},
};

afterEach(() => {
    cleanup();
    jest.clearAllMocks();
});

test('shows a loading state before data arrives', () => {
    mockFetch(() => new Promise(() => { /* never resolves */ }));
    render(<SkillsPanel/>);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
});

test('empty state explains recovery steps', async () => {
    mockFetch(() => okJson({}));
    render(<SkillsPanel/>);
    expect(await screen.findByText(/No agents have reported skills yet/i)).toBeInTheDocument();
    expect(screen.getByText(/Run a connector/i)).toBeInTheDocument();
    expect(screen.getByText('agora-claude')).toBeInTheDocument(); // expected bot name in recovery list
});

test('renders an admitted skill with its agent and verdict', async () => {
    mockFetch(() => okJson(report({admitted: [ssh]})));
    render(<SkillsPanel/>);
    expect(await screen.findByText('ssh-access')).toBeInTheDocument();
    expect(screen.getByText('ADMIT')).toBeInTheDocument();
    expect(screen.getAllByText(/1 admitted/).length).toBeGreaterThan(0); // header summary + agent badge
});

test('renders a rejected skill with a REJECT badge', async () => {
    mockFetch(() => okJson(report({rejected: [badSkill]})));
    render(<SkillsPanel/>);
    expect(await screen.findByText('bad-creds')).toBeInTheDocument();
    expect(screen.getByText(/REJECT/)).toBeInTheDocument();
});

test('API failure shows an error with retry', async () => {
    mockFetch(() => Promise.resolve({ok: false, status: 500}));
    render(<SkillsPanel/>);
    await waitFor(() => expect(screen.getByText(/Couldn't load skills/i)).toBeInTheDocument());
    expect(screen.getByText('Retry')).toBeInTheDocument();
});
