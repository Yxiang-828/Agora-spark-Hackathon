/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom';

import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import React from 'react';
import {Provider} from 'react-redux';
import {createStore} from 'redux';

import ChannelTabStrip from './ChannelTabStrip';
import {loadOpenChannelIds, saveOpenChannelIds} from './channel_tab_storage';

jest.mock('mattermost-redux/actions/channels', () => ({
    selectChannel: (channelId: string) => ({type: 'SELECT_CHANNEL', data: channelId}),
}), {virtual: true});

jest.mock('mattermost-redux/selectors/entities/channels', () => ({
    getChannel: (state: {entities: {channels: {channels: Record<string, unknown>}}}, id: string) =>
        state.entities.channels.channels[id],
    getCurrentChannelId: (state: {entities: {channels: {currentChannelId: string}}}) =>
        state.entities.channels.currentChannelId,
}), {virtual: true});

jest.mock('mattermost-redux/selectors/entities/teams', () => ({
    getCurrentTeamId: (state: {entities: {teams: {currentTeamId: string}}}) =>
        state.entities.teams.currentTeamId,
}), {virtual: true});

jest.mock('./channel_tab_storage', () => ({
    loadOpenChannelIds: jest.fn(() => ['ch-a', 'ch-b']),
    saveOpenChannelIds: jest.fn(),
}));

const channels = {
    'ch-a': {id: 'ch-a', name: 'alpha', display_name: 'Alpha'},
    'ch-b': {id: 'ch-b', name: 'beta', display_name: 'Beta'},
    'ch-c': {id: 'ch-c', name: 'gamma', display_name: 'Gamma'},
};

const makeStore = (currentChannelId = 'ch-a') => createStore((state = {
    entities: {
        channels: {
            channels,
            currentChannelId,
        },
        teams: {
            currentTeamId: 'team-1',
        },
    },
}) => state);

beforeEach(() => {
    document.body.innerHTML = '<div id="channel_view"></div>';
    document.body.className = '';
    (loadOpenChannelIds as jest.Mock).mockReturnValue(['ch-a', 'ch-b']);
    (saveOpenChannelIds as jest.Mock).mockClear();
});

afterEach(cleanup);

test('emits layout css so center channel fills the grid track', () => {
    render(
        <Provider store={makeStore()}>
            <ChannelTabStrip/>
        </Provider>,
    );

    const css = document.head.textContent || document.body.textContent || '';
    expect(css).toContain('body.agora-channel-tabs-enabled #channel_view');
    expect(css).toContain('min-width: 0');
    expect(css).toContain('.container-fluid.channel-view-inner');
});

test('renders open channels as tabs and switches on click', () => {
    const store = makeStore('ch-a');
    const dispatchSpy = jest.spyOn(store, 'dispatch');

    render(
        <Provider store={store}>
            <ChannelTabStrip/>
        </Provider>,
    );

    expect(screen.getByRole('tab', {name: 'Alpha'})).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('tab', {name: 'Beta'}));
    expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({data: 'ch-b'}));
});

test('closes a tab and activates the neighbor', () => {
    const store = makeStore('ch-b');
    const dispatchSpy = jest.spyOn(store, 'dispatch');

    render(
        <Provider store={store}>
            <ChannelTabStrip/>
        </Provider>,
    );

    fireEvent.click(screen.getByLabelText('Close Beta'));
    expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({data: 'ch-a'}));
    expect(screen.queryByRole('tab', {name: 'Beta'})).toBeNull();
});

test('reorders tabs via drag and drop', async () => {
    const store = makeStore('ch-a');

    render(
        <Provider store={store}>
            <ChannelTabStrip/>
        </Provider>,
    );

    const betaTab = screen.getByRole('tab', {name: 'Beta'}).closest('.agora-channel-tabs__tab') as HTMLElement;
    const alphaTab = screen.getByRole('tab', {name: 'Alpha'}).closest('.agora-channel-tabs__tab') as HTMLElement;

    fireEvent.dragStart(betaTab, {dataTransfer: {effectAllowed: 'move', setData: jest.fn()}});
    fireEvent.dragOver(alphaTab, {clientX: 10});
    fireEvent.drop(alphaTab);
    fireEvent.dragEnd(betaTab);

    await waitFor(() => {
        expect(saveOpenChannelIds).toHaveBeenCalledWith('team-1', ['ch-b', 'ch-a']);
    });
});
