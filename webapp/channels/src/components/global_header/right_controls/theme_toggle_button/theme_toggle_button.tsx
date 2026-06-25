// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// Agora fork: a one-click light/dark theme toggle in the global header.

import React, {useCallback} from 'react';
import {useDispatch, useSelector} from 'react-redux';

import {savePreferences} from 'mattermost-redux/actions/preferences';
import {Preferences} from 'mattermost-redux/constants';
import {getTheme} from 'mattermost-redux/selectors/entities/preferences';
import {getCurrentTeamId} from 'mattermost-redux/selectors/entities/teams';
import {getCurrentUserId} from 'mattermost-redux/selectors/entities/users';

import {WithTooltip} from '@mattermost/shared/components/tooltip';

import IconButton from 'components/global_header/header_icon_button';

// Luminance check on the center-channel background — robust to any custom theme.
function isDark(hex?: string): boolean {
    if (!hex) {
        return true;
    }
    const m = hex.replace('#', '');
    const r = parseInt(m.substring(0, 2), 16);
    const g = parseInt(m.substring(2, 4), 16);
    const b = parseInt(m.substring(4, 6), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) < 128;
}

const ThemeToggleButton = (): JSX.Element => {
    const dispatch = useDispatch();
    const theme = useSelector(getTheme);
    const userId = useSelector(getCurrentUserId);
    const teamId = useSelector(getCurrentTeamId);

    const dark = isDark(theme.centerChannelBg);

    const onClick = useCallback(() => {
        const next = dark ? Preferences.THEMES.agoraLight : Preferences.THEMES.denim;
        dispatch(savePreferences(userId, [{
            user_id: userId,
            category: Preferences.CATEGORY_THEME,
            name: teamId,
            value: JSON.stringify(next),
        }]));
    }, [dispatch, dark, userId, teamId]);

    const label = dark ? 'Switch to light mode' : 'Switch to dark mode';

    return (
        <WithTooltip title={label}>
            <IconButton
                icon={dark ? 'weather-sunny-outline' : 'weather-night-outline'}
                onClick={onClick}
                aria-label={label}
            />
        </WithTooltip>
    );
};

export default ThemeToggleButton;
