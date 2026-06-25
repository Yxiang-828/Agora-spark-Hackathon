// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// import '@mattermost/webapp/tests/setup';

// jsdom doesn't expose Web Crypto, which lib0 (a Yjs dependency) needs at import time.
// The browser and Node both provide it; polyfill it for the test environment.
/* eslint-disable */
if (typeof (global as any).crypto === 'undefined') {
    (global as any).crypto = require('crypto').webcrypto;
}
/* eslint-enable */

export {};
