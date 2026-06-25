/**
 * @jest-environment jsdom
 */
// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.

import '@testing-library/jest-dom';

import {cleanup, fireEvent, render, screen} from '@testing-library/react';
import React from 'react';

import {getRequestedAgoraTab, requestAgoraTab} from './agora_tab_controller';
import SettingsPanel from './SettingsPanel';

beforeEach(() => {
    window.localStorage.clear();
    requestAgoraTab('settings');
});

afterEach(cleanup);

test('walks the ordered Settings → Onboarding → Channels path', () => {
    render(<SettingsPanel/>);

    // Lands on step 1 (Settings).
    expect(screen.getByText(/Room settings/i)).toBeInTheDocument();

    // Step 1 → 2.
    fireEvent.click(screen.getByRole('button', {name: /Next: connect your AI/i}));
    expect(screen.getByText(/Onboarding — connect your AI/i)).toBeInTheDocument();

    // Onboarding step opens the Connect tab.
    fireEvent.click(screen.getByRole('button', {name: /Open Connect AI/i}));
    expect(getRequestedAgoraTab()).toBe('connect');

    // Step 2 → 3, then finish.
    fireEvent.click(screen.getByRole('button', {name: /Done — next step/i}));
    expect(screen.getByText(/Channels — where work happens/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: /Finish setup/i}));
    expect(screen.getByText('✓ Setup complete')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: /Re-run/i})).toBeInTheDocument();
});

test('remembers where you were via localStorage', () => {
    const first = render(<SettingsPanel/>);
    fireEvent.click(screen.getByRole('button', {name: /Next: connect your AI/i}));
    first.unmount();

    render(<SettingsPanel/>);
    expect(screen.getByText(/Onboarding — connect your AI/i)).toBeInTheDocument();
});
