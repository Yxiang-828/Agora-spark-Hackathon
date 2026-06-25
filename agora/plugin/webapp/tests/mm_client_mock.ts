// jest stub for mattermost-redux/client (the webpack build resolves the real module;
// jest doesn't). apiFetch only needs Client4.getToken().
export const Client4 = {
    getToken: () => '',
};
