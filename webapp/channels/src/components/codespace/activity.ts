// Tiny bus for the codespace activity feed: the server broadcasts cs_activity when something is
// recorded (save/commit/push/file op); index.tsx forwards it here and the open feed refetches.

type Cb = (data: {codespace_id: string}) => void;

let cb: Cb | null = null;

export const subscribeActivity = (fn: Cb): (() => void) => {
    cb = fn;
    return () => {
        if (cb === fn) {
            cb = null;
        }
    };
};

export const csReceiveActivity = (data: {codespace_id: string}) => {
    if (cb) {
        cb(data);
    }
};
