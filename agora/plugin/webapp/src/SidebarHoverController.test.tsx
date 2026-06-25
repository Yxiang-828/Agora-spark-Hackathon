/**
 * @jest-environment jsdom
 */
// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.

import '@testing-library/jest-dom';

import {cleanup, render} from '@testing-library/react';
import React from 'react';

import SidebarHoverController from './SidebarHoverController';

afterEach(() => {
    cleanup();
    document.body.className = '';
});

test('enables and cleans up the smooth LHS hover rail body class', () => {
    const {unmount} = render(<SidebarHoverController/>);
    expect(document.body).toHaveClass('agora-lhs-hover-enabled');
    expect(document.head.textContent || document.body.textContent).toContain('cubic-bezier(.23,1,.32,1)');
    expect(document.head.textContent || document.body.textContent).toContain('--overrideLhsWidth');
    expect(document.head.textContent || document.body.textContent).toContain('SidebarChannelLinkLabel_wrapper');
    expect(document.head.textContent || document.body.textContent).toContain('#browseOrAddChannelMenuButton');

    unmount();
    expect(document.body).not.toHaveClass('agora-lhs-hover-enabled');
});
