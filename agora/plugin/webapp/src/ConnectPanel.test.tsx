/**
 * @jest-environment jsdom
 */
// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.

import '@testing-library/jest-dom';

import React from 'react';
import {render, screen, cleanup, fireEvent, waitFor} from '@testing-library/react';

import ConnectPanel from './ConnectPanel';

const setup = ({code = 'CODE123', claimed = false, expired = false, failed = false, startStatus = 200}: {code?: string; claimed?: boolean; expired?: boolean; failed?: boolean; startStatus?: number} = {}) => {
    (global as any).fetch = jest.fn((url: string, opts: any = {}) => {
        const u = String(url);
        if (u.includes('/pair/start') && (opts.method === 'POST')) {
            return startStatus === 200 ?
                Promise.resolve({ok: true, json: () => Promise.resolve({code})}) :
                Promise.resolve({ok: false, status: startStatus});
        }
        if (u.includes('/pair/status')) {
            return Promise.resolve({ok: true, json: () => Promise.resolve({claimed, expired, failed})});
        }
        return Promise.resolve({ok: true, json: () => Promise.resolve({})});
    });
};

afterEach(() => {
    cleanup();
    jest.clearAllMocks();
});

test('idle: offers to generate a pairing code', () => {
    setup();
    render(<ConnectPanel/>);
    expect(screen.getByText('Connect your AI')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: /Generate pairing code/i})).toBeInTheDocument();
});

test('generating a code shows the one command + a waiting state', async () => {
    setup({code: 'ABC999'});
    render(<ConnectPanel/>);
    fireEvent.click(screen.getByRole('button', {name: /Generate pairing code/i}));
    expect(await screen.findByText(/pair\.py ABC999/)).toBeInTheDocument();
    expect(screen.getByText(/Waiting for your machine to pair/i)).toBeInTheDocument();
});

test('flips to Connected once the connector claims the code', async () => {
    setup({code: 'XYZ', claimed: true});
    render(<ConnectPanel/>);
    fireEvent.click(screen.getByRole('button', {name: /Generate pairing code/i}));
    await screen.findByText(/pair\.py XYZ/);
    await waitFor(() => expect(screen.getByText(/Connected/i)).toBeInTheDocument(), {timeout: 3000});
});

test('stops waiting and reports an expired code', async () => {
    setup({code: 'OLD', expired: true});
    render(<ConnectPanel/>);
    fireEvent.click(screen.getByRole('button', {name: /Generate pairing code/i}));
    await screen.findByText(/pair\.py OLD/);
    await waitFor(() => expect(screen.getByText(/expired/i)).toBeInTheDocument(), {timeout: 3000});
    expect(screen.queryByText(/Waiting for your machine to pair/i)).toBeNull();
});

test('shows a failure (not Connected) if provisioning fails after claim', async () => {
    setup({code: 'F1', failed: true});
    render(<ConnectPanel/>);
    fireEvent.click(screen.getByRole('button', {name: /Generate pairing code/i}));
    await screen.findByText(/pair\.py F1/);
    await waitFor(() => expect(screen.getByText(/Pairing failed/i)).toBeInTheDocument(), {timeout: 3000});
    expect(screen.queryByText(/Connected/i)).toBeNull();
});

test('shows an error if starting pairing fails', async () => {
    setup({startStatus: 500});
    render(<ConnectPanel/>);
    fireEvent.click(screen.getByRole('button', {name: /Generate pairing code/i}));
    expect(await screen.findByText(/Couldn't start pairing/i)).toBeInTheDocument();
});
