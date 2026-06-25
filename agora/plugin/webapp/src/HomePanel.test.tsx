/**
 * @jest-environment jsdom
 */
// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.

import '@testing-library/jest-dom';

import React from 'react';
import {render, screen, cleanup} from '@testing-library/react';

import HomePanel from './HomePanel';

afterEach(cleanup);

test('Home teaches the workflow: connect, claim, wrap', () => {
    render(<HomePanel/>);
    expect(screen.getByText(/Welcome to Agora/i)).toBeInTheDocument();
    expect(screen.getByText(/Connect your AI/i)).toBeInTheDocument();
    expect(screen.getAllByText(/claim/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Capture what you learned/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Codespace/i).length).toBeGreaterThan(0);
});
