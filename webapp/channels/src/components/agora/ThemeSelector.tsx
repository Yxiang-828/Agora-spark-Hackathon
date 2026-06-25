import React from 'react';
import {useDispatch, useSelector} from 'react-redux';

import {saveTheme} from 'mattermost-redux/actions/preferences';
import {Preferences} from 'mattermost-redux/constants';
import type {ThemeKey} from 'mattermost-redux/selectors/entities/preferences';
import {getTheme} from 'mattermost-redux/selectors/entities/preferences';
import {getCurrentTeamId} from 'mattermost-redux/selectors/entities/teams';

import {applyTheme} from 'utils/utils';

// Agora's Dark / Light / Pixel theme switcher. The three Agora themes are real premade themes in
// Preferences.THEMES (denim = Agora dark, agoraLight = Agora light, neonPixel = Neon Pixel); we
// just surface them as big swatches and persist the choice the normal way (saveTheme preference),
// applying it immediately. They still appear in Settings → Display → Theme too.

type Option = {key: ThemeKey; label: string; sub: string; swatch: [string, string, string]};

const OPTIONS: Option[] = [
    {key: 'denim', label: 'Dark', sub: 'The default', swatch: ['#0a0c10', '#15171c', '#5d89ea']},
    {key: 'agoraLight', label: 'Light', sub: 'Daytime', swatch: ['#f4f5f7', '#ffffff', '#166de0']},
    {key: 'neonPixel', label: 'Pixel', sub: 'Neon arcade', swatch: ['#0a0612', '#0d0a16', '#ff2e97']},
];

const dim = (a: number) => `rgba(var(--center-channel-color-rgb),${a})`;

const ThemeSelector = (): JSX.Element => {
    const dispatch = useDispatch();
    const teamId = useSelector(getCurrentTeamId);
    const current = useSelector(getTheme);

    const choose = (key: ThemeKey) => {
        const theme = Preferences.THEMES[key];
        if (!theme) {
            return;
        }
        applyTheme(theme);                       // instant visual feedback
        dispatch(saveTheme(teamId, theme));      // persist (server preference)
    };

    return (
        <div>
            <div style={{fontWeight: 600, marginBottom: 8}}>{'Appearance'}</div>
            <div style={{display: 'flex', gap: 10, flexWrap: 'wrap'}}>
                {OPTIONS.map((o) => {
                    const active = current?.type === Preferences.THEMES[o.key].type;
                    return (
                        <button
                            key={o.key}
                            type='button'
                            onClick={() => choose(o.key)}
                            aria-pressed={active}
                            style={{
                                flex: '1 1 130px', minWidth: 120, padding: 10, cursor: 'pointer',
                                textAlign: 'left', font: 'inherit', color: 'inherit',
                                borderRadius: 10,
                                border: `2px solid ${active ? 'var(--button-bg,#1c58d9)' : dim(0.16)}`,
                                background: active ? 'rgba(var(--button-bg-rgb),.08)' : dim(0.03),
                            }}
                        >
                            <div style={{display: 'flex', gap: 4, marginBottom: 8}}>
                                {o.swatch.map((c, i) => (
                                    <span
                                        key={i}
                                        style={{flex: 1, height: 26, borderRadius: 4, background: c, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.25)'}}
                                    />
                                ))}
                            </div>
                            <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}>
                                <span style={{fontWeight: 700}}>{o.label}</span>
                                {active && <span style={{fontSize: 11, color: 'var(--button-bg,#1c58d9)', fontWeight: 700}}>{'● Active'}</span>}
                            </div>
                            <div style={{fontSize: 12, color: dim(0.6)}}>{o.sub}</div>
                        </button>
                    );
                })}
            </div>
        </div>
    );
};

export default ThemeSelector;
