// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {memo, useCallback} from 'react';
import {NavLink, useRouteMatch} from 'react-router-dom';

// Native left-sidebar entry for the full-width Codespace surface (/:team/codespace).
// Mirrors the Drafts/Threads sidebar-link structure so it sits inline with them.
function CodespaceLink() {
    const {url} = useRouteMatch();
    const isCodespaceMatch = useRouteMatch('/:team/codespace');
    const isActive = useCallback(() => Boolean(isCodespaceMatch), [isCodespaceMatch]);

    return (
        <ul className='SidebarCodespace NavGroupContent nav nav-pills__container'>
            <li
                className='SidebarChannel'
                tabIndex={-1}
                id='sidebar-codespace-button'
            >
                <NavLink
                    to={`${url}/codespace`}
                    id='sidebarItem_codespace'
                    activeClassName='active'
                    draggable='false'
                    className='SidebarLink sidebar-item'
                    tabIndex={0}
                    isActive={isActive}
                >
                    <i className='icon icon-code-tags'/>
                    <div className='SidebarChannelLinkLabel_wrapper'>
                        <span className='SidebarChannelLinkLabel sidebar-item__name'>
                            {'Codespace'}
                        </span>
                    </div>
                </NavLink>
            </li>
        </ul>
    );
}

export default memo(CodespaceLink);
