/**
 * @jest-environment jsdom
 */
// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.

import '@testing-library/jest-dom';

import React from 'react';
import {render, screen, cleanup, fireEvent} from '@testing-library/react';

import AgoraAction from './AgoraAction';

const post = (action: any, message = '') => ({message, props: {agora_action: action}});

afterEach(cleanup);

test('renders the title and summary of a done action', () => {
    render(<AgoraAction post={post({title: 'Checked charger', status: 'done', summary: 'Battery at 100%.'})}/>);
    expect(screen.getByText('Checked charger')).toBeInTheDocument();
    expect(screen.getByText('Battery at 100%.')).toBeInTheDocument();
});

test('shows a running indicator for in-progress actions', () => {
    render(<AgoraAction post={post({title: 'Working', status: 'running'})}/>);
    expect(screen.getByLabelText('running')).toBeInTheDocument();
});

test('sub-actions are hidden until expanded, then shown', () => {
    const action = {
        title: 'Diagnose',
        status: 'done',
        subactions: [
            {id: 's1', label: 'ssh into host', tool: 'ssh', status: 'done', duration_ms: 1200},
            {id: 's2', label: 'read telemetry', tool: 'ros', status: 'done'},
        ],
    };
    render(<AgoraAction post={post(action)}/>);
    const toggle = screen.getByRole('button', {name: /2 steps/i});
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('ssh into host')).toBeInTheDocument();
    expect(screen.getByText('read telemetry')).toBeInTheDocument();
    expect(screen.getByText('1200 ms')).toBeInTheDocument();
});

test('accepts a JSON-string action (props sometimes arrive stringified)', () => {
    render(<AgoraAction post={post(JSON.stringify({title: 'Strung', status: 'done'}))}/>);
    expect(screen.getByText('Strung')).toBeInTheDocument();
});

test('malformed/missing props fall back to the message, no crash', () => {
    render(<AgoraAction post={{message: 'plain fallback', props: {agora_action: '{not json'}}}/>);
    expect(screen.getByText('plain fallback')).toBeInTheDocument();
});

test('an unknown status is NOT rendered as done (no false success)', () => {
    render(<AgoraAction post={post({title: 'Weird', status: 'wat'})}/>);
    expect(screen.queryByLabelText('done')).toBeNull();
    expect(screen.getByLabelText('status: wat')).toBeInTheDocument();
});
