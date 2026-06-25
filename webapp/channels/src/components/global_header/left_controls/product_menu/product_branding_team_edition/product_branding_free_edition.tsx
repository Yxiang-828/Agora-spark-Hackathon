// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// Agora fork: the product header wordmark. Replaces the Mattermost logo + edition badge.

import React from 'react';
import styled from 'styled-components';

const ProductBrandingFreeEditionContainer = styled.span`
    display: flex;
    align-items: center;
`;

const Wordmark = styled.span`
    font-family: 'Metropolis', 'Open Sans', sans-serif;
    font-size: 18px;
    font-weight: 700;
    letter-spacing: 0.01em;
    color: rgba(var(--sidebar-text-rgb), 0.92);
`;

const ProductBrandingFreeEdition = (): JSX.Element => {
    return (
        <ProductBrandingFreeEditionContainer tabIndex={-1}>
            <Wordmark>Agora</Wordmark>
        </ProductBrandingFreeEditionContainer>
    );
};

export default ProductBrandingFreeEdition;
