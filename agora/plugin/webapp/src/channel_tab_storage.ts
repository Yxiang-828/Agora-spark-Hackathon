const storageKey = (teamId: string) => `agora.channelTabs.${teamId}`;

export const loadOpenChannelIds = (teamId: string): string[] => {
    try {
        const raw = localStorage.getItem(storageKey(teamId));
        if (!raw) {
            return [];
        }
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
    } catch {
        return [];
    }
};

export const saveOpenChannelIds = (teamId: string, channelIds: string[]) => {
    try {
        localStorage.setItem(storageKey(teamId), JSON.stringify(channelIds));
    } catch {
        // ignore quota / private mode
    }
};
