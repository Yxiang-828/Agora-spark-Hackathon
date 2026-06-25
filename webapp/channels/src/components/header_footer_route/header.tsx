// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import classNames from 'classnames';
import React from 'react';
import {useSelector} from 'react-redux';
import {Link} from 'react-router-dom';

import {getConfig} from 'mattermost-redux/selectors/entities/general';

import BackButton from 'components/common/back_button';

import './header.scss';

export type HeaderProps = {
    alternateLink?: React.ReactElement;
    backButtonURL?: string;
    onBackButtonClick?: React.EventHandler<React.MouseEvent>;
};

const Header = ({alternateLink, backButtonURL, onBackButtonClick}: HeaderProps) => {
    const {SiteName} = useSelector(getConfig);

    // Agora fork: the pre-auth chrome is our own brand — never the stock Mattermost logo or
    // "TEAM EDITION" badge. Use the configured SiteName, falling back to "Agora".
    const brand = SiteName && SiteName !== 'Mattermost' ? SiteName : 'Agora';

    return (
        <div className={classNames('hfroute-header', 'has-custom-site-name')}>
            <div className='header-main'>
                <div>
                    <Link
                        className='header-logo-link agora-brand-link'
                        to='/'
                        aria-label={brand}
                    >
                        <span className='agora-wordmark'>
                            <span className='agora-wordmark__dot'/>
                            {brand}
                        </span>
                    </Link>
                </div>
                {alternateLink}
            </div>
            {onBackButtonClick && (
                <BackButton
                    className='header-back-button'
                    url={backButtonURL}
                    onClick={onBackButtonClick}
                />
            )}
        </div>
    );
};

export default Header;
