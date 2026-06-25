/**
 * @jest-environment jsdom
 */
// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.

import '@testing-library/jest-dom';

import React from 'react';
import {render, screen, cleanup, waitFor, fireEvent} from '@testing-library/react';

import ArchivePanel from './ArchivePanel';

type Setup = {roles?: string; proposals?: any; dict?: any; proposalsStatus?: number};

const setup = ({roles = '', proposals = {}, dict = {}, proposalsStatus = 200}: Setup = {}) => {
    (global as any).fetch = jest.fn((url: string, opts: any = {}) => {
        const u = String(url);
        const method = opts.method || 'GET';
        if (u.endsWith('/users/me')) {
            return Promise.resolve({ok: true, json: () => Promise.resolve({roles})});
        }
        if (u.endsWith('/proposals') && method === 'GET') {
            return proposalsStatus === 200 ?
                Promise.resolve({ok: true, json: () => Promise.resolve(proposals)}) :
                Promise.resolve({ok: false, status: proposalsStatus});
        }
        if (u.endsWith('/dictionary')) {
            return Promise.resolve({ok: true, json: () => Promise.resolve(dict)});
        }
        return Promise.resolve({ok: true, json: () => Promise.resolve({})}); // approve/reject
    });
};

const prop = {id: 'p1', issue: 'Charger pulses', root_cause: 'CV top-off', fix: 'no action', agent_name: 'agora-claude'};

afterEach(() => {
    cleanup();
    jest.clearAllMocks();
});

test('empty state explains how to create a proposal', async () => {
    setup({});
    render(<ArchivePanel/>);
    expect(await screen.findByText(/Nothing pending/i)).toBeInTheDocument();
    expect(screen.getByText(/No approved entries yet/i)).toBeInTheDocument();
});

test('an approver sees a pending proposal with Approve/Reject', async () => {
    setup({roles: 'system_user system_admin', proposals: {p1: prop}});
    render(<ArchivePanel/>);
    expect(await screen.findByText('Charger pulses')).toBeInTheDocument();
    expect(await screen.findByText('Approve')).toBeInTheDocument();
    expect(screen.getByText('Reject')).toBeInTheDocument();
});

test('a non-approver sees the proposal but no Approve button', async () => {
    setup({roles: 'system_user', proposals: {p1: prop}});
    render(<ArchivePanel/>);
    expect(await screen.findByText('Charger pulses')).toBeInTheDocument();
    expect(await screen.findByText(/An Operator\/Lead approves these/i)).toBeInTheDocument();
    expect(screen.queryByText('Approve')).toBeNull();
});

test('clicking Approve calls the approve endpoint', async () => {
    setup({roles: 'system_admin', proposals: {p1: prop}});
    render(<ArchivePanel/>);
    const btn = await screen.findByText('Approve');
    fireEvent.click(btn);
    await waitFor(() => {
        const calls = (global as any).fetch.mock.calls.map((c: any[]) => String(c[0]));
        expect(calls.some((u: string) => u.includes('/proposals/p1/approve'))).toBe(true);
    });
});

test('shows an error with retry when loading fails', async () => {
    setup({proposalsStatus: 500});
    render(<ArchivePanel/>);
    await waitFor(() => expect(screen.getByText(/Couldn't load/i)).toBeInTheDocument());
    expect(screen.getByText('Retry')).toBeInTheDocument();
});
