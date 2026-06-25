// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {memo, useCallback} from 'react';
import {NavLink, useRouteMatch} from 'react-router-dom';

// Native left-sidebar entry for the full-width Agora workspace (/:team/agora) —
// Connect AI, Skills, Archive, Settings, Home. Mirrors the Drafts sidebar-link structure.
function AgoraLink() {
    const {url} = useRouteMatch();
    const isAgoraMatch = useRouteMatch('/:team/agora');
    const isActive = useCallback(() => Boolean(isAgoraMatch), [isAgoraMatch]);

    return (
        <ul className='SidebarAgora NavGroupContent nav nav-pills__container'>
            <li
                className='SidebarChannel'
                tabIndex={-1}
                id='sidebar-agora-button'
            >
                <NavLink
                    to={`${url}/agora`}
                    id='sidebarItem_agora'
                    activeClassName='active'
                    draggable='false'
                    className='SidebarLink sidebar-item'
                    tabIndex={0}
                    isActive={isActive}
                >
                    <i className='icon icon-creation-outline'/>
                    <div className='SidebarChannelLinkLabel_wrapper'>
                        <span className='SidebarChannelLinkLabel sidebar-item__name'>
                            {'Agora'}
                        </span>
                    </div>
                </NavLink>
            </li>
        </ul>
    );
}

export default memo(AgoraLink);
