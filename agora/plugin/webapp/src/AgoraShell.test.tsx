/**
 * @jest-environment jsdom
 */
// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.

import '@testing-library/jest-dom';

import {act, cleanup, fireEvent, render, screen} from '@testing-library/react';
import React from 'react';

import {requestAgoraTab} from './agora_tab_controller';
import AgoraShell from './AgoraShell';

jest.mock('./HomePanel', () => () => <div>{'Home panel'}</div>);
jest.mock('./ConnectPanel', () => () => <div>{'Connect panel'}</div>);
jest.mock('./SkillsPanel', () => () => <div>{'Skills panel'}</div>);
jest.mock('./ArchivePanel', () => () => <div>{'Archive panel'}</div>);
jest.mock('./CodespacePanel', () => () => (
    <input
        aria-label='codespace-state'
        defaultValue='kept'
    />
));

beforeEach(() => {
    requestAgoraTab('home');
});

afterEach(cleanup);

test('opens requested panels as browser-style closable tabs', () => {
    render(<AgoraShell/>);

    act(() => requestAgoraTab('skills'));
    expect(screen.getByRole('tab', {name: /Skills/i})).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Skills panel')).toBeVisible();

    act(() => requestAgoraTab('archive'));
    expect(screen.getByRole('tab', {name: /Archive/i})).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Archive panel')).toBeVisible();

    fireEvent.click(screen.getByLabelText('Close Archive'));
    expect(screen.queryByRole('tab', {name: /Archive/i})).toBeNull();
    expect(screen.getByRole('tab', {name: /Skills/i})).toHaveAttribute('aria-selected', 'true');
});

test('keeps inactive tab content mounted while switching', () => {
    render(<AgoraShell/>);

    act(() => requestAgoraTab('codespace'));
    const input = screen.getByLabelText('codespace-state') as HTMLInputElement;
    fireEvent.change(input, {target: {value: 'dirty buffer'}});
    act(() => requestAgoraTab('home'));
    act(() => requestAgoraTab('codespace'));

    expect(screen.getByLabelText('codespace-state')).toHaveValue('dirty buffer');
});

test('empty tab state can reopen panels', () => {
    render(<AgoraShell/>);

    fireEvent.click(screen.getByLabelText('Close Home'));
    expect(screen.getByText('No Agora tabs open')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: 'Connect AI'}));
    expect(screen.getByRole('tab', {name: /Connect AI/i})).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Connect panel')).toBeVisible();
});
