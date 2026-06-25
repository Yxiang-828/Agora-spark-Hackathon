/* eslint-disable @typescript-eslint/no-explicit-any */
import manifest from 'manifest';
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useSelector} from 'react-redux';

import {getCurrentChannelId} from 'mattermost-redux/selectors/entities/channels';
import {getCurrentUser} from 'mattermost-redux/selectors/entities/users';

import ActivityFeed from './ActivityFeed';
import Avatar from './Avatar';
import {apiFetch, cleanError} from './client';
import CodeEditor from './CodeEditor';
import {listComments, addComment, resolveComment, subscribeComments} from './comments';
import type {Comment} from './comments';
import CommentsPane from './CommentsPane';
import DiffView from './DiffView';
import FileTree from './FileTree';
import MarkdownView from './MarkdownView';
import {injectPanelStyles} from './panelStyles';
import {joinPresence, leavePresence} from './presence';
import type {PresenceMap, PresenceCtl} from './presence';
import TerminalPanel from './TerminalPanel';
import {THEME_NAMES, FONT_SIZES, loadThemePref, saveThemePref, loadFontPref, saveFontPref, loadWrapPref, saveWrapPref, loadPointerPref, savePointerPref} from './themes';
import {RoomProvider, colorFor} from './yprovider';
import type {PeerInfo} from './yprovider';

// The Codespace: a Google-Docs-style, real-time editor over a REAL git repo served by a
// connector. The live layer (Yjs CRDT) is instant and shared; it debounce-flushes to the real
// file on disk (disk mirrors live), while git commit/push stay deliberate. Files open in tabs,
// each with its own live doc; .md files get a rendered preview toggle.

const API = `/plugins/${manifest.id}/api/v1`;
const j = (r: Response) => (r.ok ? r.json() : r.text().then((t) => Promise.reject(new Error(cleanError(t) || `HTTP ${r.status}`))));

const baseName = (p: string) => p.split('/').pop() || p;
const isMarkdown = (p: string) => (/\.(md|markdown)$/i).test(p);

type Codespace = {id: string; name: string; host_user_id?: string; root?: string; source?: string};

const rand = () => Math.random().toString(36).slice(2, 10);
const cx = (...xs: Array<string | false | undefined>) => xs.filter(Boolean).join(' ');

const CodespacePanel = () => {
    const [spaces, setSpaces] = useState<Codespace[] | null>(null);
    const [cs, setCs] = useState<Codespace | null>(null);
    const [files, setFiles] = useState<string[]>([]);
    const [tabs, setTabs] = useState<string[]>([]); // open files
    const [active, setActive] = useState(''); // active tab path
    const [previewPaths, setPreviewPaths] = useState<Set<string>>(new Set()); // md files shown as preview
    const [busy, setBusy] = useState('');
    const [err, setErr] = useState('');
    const [banner, setBanner] = useState('');
    const [peersByPath, setPeersByPath] = useState<Record<string, PeerInfo[]>>({}); // per-file co-editors
    const [presence, setPresence] = useState<PresenceMap>({}); // who's in which file (codespace-wide)
    const [showTerm, setShowTerm] = useState(false);
    const [disp, setDisp] = useState(false); // Display-settings popover open
    const [theme, setTheme] = useState<string>(() => loadThemePref());
    const [fontSize, setFontSize] = useState<number>(() => loadFontPref());
    const [wrap, setWrap] = useState<boolean>(() => loadWrapPref());
    const [pointers, setPointers] = useState<boolean>(() => loadPointerPref());
    const [dirty, setDirty] = useState<Set<string>>(new Set()); // paths with unsaved edits
    const [gitOut, setGitOut] = useState('');
    const [infoPane, setInfoPane] = useState<'none' | 'diff' | 'activity' | 'comments'>('none');
    const [diffText, setDiffText] = useState('');
    const [comments, setComments] = useState<Comment[]>([]);
    const [cursorLine, setCursorLine] = useState(1);
    const [commitMsg, setCommitMsg] = useState('');
    const [bound, setBound] = useState('');
    const [creating, setCreating] = useState(false);
    const [hosts, setHosts] = useState<Array<{id: string; label: string}>>([]);
    const [nName, setNName] = useState('');
    const [nHost, setNHost] = useState('');
    const [nRoot, setNRoot] = useState('');
    const [nSource, setNSource] = useState('local');
    const [nRepo, setNRepo] = useState('');
    const [nSsh, setNSsh] = useState('');
    const [nFile, setNFile] = useState<string | null>(null);

    const channelId = useSelector(getCurrentChannelId);
    const user = useSelector(getCurrentUser);

    const providers = useRef<Map<string, RoomProvider>>(new Map());
    const flushTimers = useRef<Map<RoomProvider, number>>(new Map());
    const presenceCtl = useRef<PresenceCtl | null>(null);
    const activeViewRef = useRef<any>(null); // the active CodeMirror view (for jump-to-line)

    injectPanelStyles();

    const fail = (e: any) => {
        setErr(cleanError(String(e.message || e)));
        setBusy('');
    };

    const op = useCallback((id: string, name: string, args: Record<string, any> = {}) =>
        apiFetch(`${API}/codespace/op`, {method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({codespace_id: id, channel_id: channelId, op: name, args})}).then(j), [channelId]);

    const loadSpaces = () => apiFetch(`${API}/codespaces`).then(j).then((s) => setSpaces(s || [])).catch(fail);
    useEffect(() => {
        loadSpaces();
    }, []);

    const loadHosts = () => apiFetch(`${API}/skills`).then(j).then((rep: any) => {
        setHosts(Object.keys(rep || {}).map((id) => {
            // The connector reports the bot's display name as `name` (see SkillsPanel).
            const a = (rep[id] || {}).agent || {};
            return {id, label: a.name || a.username || a.owner || id.slice(0, 8)};
        }));
    }).catch(() => setHosts([]));

    const loadTree = useCallback((c: Codespace) => {
        setBusy('loading…');
        op(c.id, 'tree').then((r) => {
            setFiles(r.files || []);
            setBusy('');
        }).catch(fail);
    }, [op]);

    // --- live editing lifecycle (one RoomProvider per open tab) ---

    const scheduleFlush = useCallback((prov: RoomProvider) => {
        const prev = flushTimers.current.get(prov);
        if (prev) {
            window.clearTimeout(prev);
        }
        flushTimers.current.set(prov, window.setTimeout(() => {
            setBusy('saving…');
            prov.flush().then(() => {
                setBanner('');
                setBusy('saved');
                setDirty((d) => {
                    const n = new Set(d);
                    n.delete(prov.path);
                    return n;
                });
                window.setTimeout(() => setBusy(''), 1000);
            }).catch((e) => {
                setBusy('');
                setBanner('Host offline — your edits are kept locally and will sync when it’s back. ' + cleanError(String(e.message || e)));
            });
        }, 1500));
    }, []);

    const destroyProvider = useCallback((p: string) => {
        const prov = providers.current.get(p);
        if (!prov) {
            return;
        }
        const t = flushTimers.current.get(prov);
        if (t) {
            window.clearTimeout(t);
        }
        flushTimers.current.delete(prov);
        prov.destroy();
        providers.current.delete(p);
    }, []);

    const destroyAll = useCallback(() => {
        for (const p of Array.from(providers.current.keys())) {
            destroyProvider(p);
        }
        setTabs([]);
        setActive('');
        setPeersByPath({});
    }, [destroyProvider]);

    useEffect(() => () => {
        destroyAll();
        leavePresence();
    }, [destroyAll]);

    const activate = useCallback((p: string) => {
        setActive(p);
        presenceCtl.current?.setFile(p);
    }, []);

    const openFile = useCallback(async (p: string, allowMissing = false) => {
        if (!cs || !cs.host_user_id) {
            return;
        }
        if (providers.current.has(p)) { // already open — just focus its tab
            activate(p);
            return;
        }
        setErr('');
        setBanner('');
        setBusy('opening…');
        const sessionId = `${user?.id || 'anon'}-${rand()}`;
        const prov: RoomProvider = new RoomProvider({
            csId: cs.id,
            channelId,
            path: p,
            sessionId,
            user: {id: user?.id || '', name: user?.username || 'someone', color: colorFor(user?.id || sessionId)},
            onPeers: (list) => setPeersByPath((m) => ({...m, [p]: list})),
            onError: (m) => setBanner(cleanError(m)),
            onLocalEdit: () => {
                setDirty((d) => (d.has(p) ? d : new Set(d).add(p)));
                scheduleFlush(prov);
            },
        });
        providers.current.set(p, prov);
        try {
            const role = await prov.open();
            if (role === 'seed') {
                let content = '';
                try {
                    const r = await op(cs.id, 'read', {path: p});
                    content = r.content || '';
                } catch (e) {
                    if (!allowMissing) {
                        throw e;
                    }
                }
                prov.seedFromDisk(content);
            }
            setTabs((t) => (t.includes(p) ? t : [...t, p]));
            activate(p);
            setBusy('');
        } catch (e) {
            destroyProvider(p);
            fail(e);
        }
    }, [cs, channelId, user, op, activate, scheduleFlush, destroyProvider]);

    const closeTab = useCallback((p: string) => {
        destroyProvider(p);
        setPreviewPaths((s) => {
            const n = new Set(s);
            n.delete(p);
            return n;
        });
        setTabs((t) => {
            const next = t.filter((x) => x !== p);
            if (active === p) {
                const idx = t.indexOf(p);
                const neighbor = next[idx] || next[idx - 1] || '';
                activate(neighbor);
            }
            return next;
        });
    }, [active, destroyProvider, activate]);

    const openCs = (c: Codespace | null) => {
        if (!c) {
            return;
        }
        destroyAll();
        setCs(c);
        setErr('');
        setBanner('');
        setGitOut('');
        setFiles([]);
        setPresence({});
        presenceCtl.current = joinPresence(c.id, channelId, user?.id || '', colorFor(user?.id || ''), setPresence);
        if (c.host_user_id) {
            loadTree(c);
        }
    };

    const flushNow = () => {
        const prov = active ? providers.current.get(active) : null;
        if (!prov) {
            return;
        }
        setBusy('saving…');
        prov.flush().then(() => {
            setBanner('');
            setBusy('saved');
            loadTree(cs as Codespace); // a brand-new file now shows in the tree
            window.setTimeout(() => setBusy(''), 1000);
        }).catch(fail);
    };

    const pickTheme = (t: string) => {
        setTheme(t);
        saveThemePref(t);
    };
    const pickFont = (n: number) => {
        setFontSize(n);
        saveFontPref(n);
    };
    const toggleWrap = () => setWrap((w) => {
        saveWrapPref(!w);
        return !w;
    });
    const togglePointers = () => setPointers((on) => {
        savePointerPref(!on);
        return !on;
    });
    const saveActive = useCallback(() => {
        const prov = active ? providers.current.get(active) : null;
        if (!prov) {
            return;
        }
        setBusy('saving…');
        prov.flush().then(() => {
            setBusy('saved');
            setDirty((d) => {
                const n = new Set(d);
                n.delete(prov.path);
                return n;
            });
            window.setTimeout(() => setBusy(''), 1000);
        }).catch(fail);
    }, [active]);

    const togglePreview = (p: string) => setPreviewPaths((s) => {
        const n = new Set(s);
        if (n.has(p)) {
            n.delete(p);
        } else {
            n.add(p);
        }
        return n;
    });

    // --- directory tree CRUD ---

    const newFileAt = (dir: string) => setNFile(dir ? dir + '/' : '');
    const createFile = () => {
        const p = (nFile || '').trim();
        setNFile(null);
        if (p && cs) {
            openFile(p, true);
        }
    };
    const newFolderAt = (dir: string) => {
        // eslint-disable-next-line no-alert
        const name = window.prompt('New folder path' + (dir ? ` under ${dir}` : '') + ':', dir ? dir + '/' : '');
        if (name && name.trim() && cs) {
            op(cs.id, 'mkdir', {path: name.trim()}).then(() => loadTree(cs)).catch(fail);
        }
    };
    const renamePath = (from: string) => {
        // eslint-disable-next-line no-alert
        const to = window.prompt(`Rename / move "${from}" to:`, from);
        if (to && to.trim() && to.trim() !== from && cs) {
            op(cs.id, 'rename', {path: from, to: to.trim()}).then(() => {
                if (providers.current.has(from)) {
                    closeTab(from);
                }
                loadTree(cs);
            }).catch(fail);
        }
    };
    const deletePath = (p: string, isDir: boolean) => {
        // eslint-disable-next-line no-alert
        if (!cs || !window.confirm(`Delete ${isDir ? 'folder' : 'file'} "${p}"? This removes it from the host disk.`)) {
            return;
        }
        op(cs.id, isDir ? 'rmdir' : 'delete', {path: p}).then(() => {
            if (!isDir && providers.current.has(p)) {
                closeTab(p);
            }
            loadTree(cs);
        }).catch(fail);
    };

    // --- git ---

    const gitStatus = () => cs && op(cs.id, 'status').then((r) => setGitOut(r.status || '(clean)')).catch(fail);
    const showDiff = () => cs && op(cs.id, 'diff').then((r) => {
        setDiffText(r.diff || '');
        setInfoPane('diff');
    }).catch(fail);

    // --- inline comments ---

    const reloadComments = useCallback(() => {
        if (cs?.id) {
            listComments(cs.id, channelId).then(setComments).catch(() => undefined);
        }
    }, [cs, channelId]);

    useEffect(() => {
        if (!cs?.id) {
            setComments([]);
            return undefined;
        }
        reloadComments();
        return subscribeComments((d) => {
            if (d.codespace_id === cs.id) {
                reloadComments();
            }
        });
    }, [cs?.id, reloadComments]);

    const addCommentHere = () => {
        if (!cs || !active) {
            return;
        }
        // eslint-disable-next-line no-alert
        const text = window.prompt(`Comment on ${baseName(active)} line ${cursorLine} (use @name to ping someone in chat):`, '');
        if (!text || !text.trim()) {
            return;
        }
        const prov = providers.current.get(active);
        const snippet = prov ? (prov.text.toString().split('\n')[cursorLine - 1] || '').slice(0, 160) : '';
        addComment(cs.id, channelId, active, cursorLine, snippet, text.trim()).then(() => {
            reloadComments();
            setInfoPane('comments');
        }).catch(fail);
    };
    const resolveC = (id: string) => cs && resolveComment(id, cs.id, channelId).then(reloadComments).catch(fail);
    const jumpToLine = (lineNum: number) => {
        const v = activeViewRef.current;
        if (!v) {
            return;
        }
        const line = v.state.doc.line(Math.max(1, Math.min(lineNum, v.state.doc.lines)));
        v.dispatch({selection: {anchor: line.from}, scrollIntoView: true});
        v.focus();
    };
    const commit = () => {
        if (!cs || !commitMsg.trim()) {
            return;
        }
        setBusy('committing…');
        op(cs.id, 'commit', {message: commitMsg.trim()}).then((r) => {
            setGitOut(r.out || '');
            setCommitMsg('');
            setBusy('');
        }).catch(fail);
    };
    const push = () => {
        if (!cs) {
            return;
        }
        setBusy('pushing…');
        op(cs.id, 'push').then((r) => {
            setGitOut(r.out || '');
            setBusy('');
        }).catch(fail);
    };

    // --- create / bind ---

    const createCs = () => {
        if (!nName.trim() || !nHost) {
            return;
        }
        const b: Record<string, string> = {name: nName.trim(), host_user_id: nHost, source: nSource};
        if (nSource === 'local') {
            if (!nRoot.trim()) {
                return;
            }
            b.root = nRoot.trim();
        } else if (nSource === 'git') {
            if (!nRepo.trim()) {
                return;
            }
            b.repo_url = nRepo.trim();
            if (nSsh.trim()) {
                b.ssh_target = nSsh.trim();
            }
        } else if (nSource === 'ssh') {
            if (!nSsh.trim() || !nRoot.trim()) {
                return;
            }
            b.ssh_target = nSsh.trim();
            b.root = nRoot.trim();
        }
        setBusy(nSource === 'git' ? 'cloning…' : 'creating…');
        apiFetch(`${API}/codespaces`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(b)}).
            then(j).then((c: Codespace) => {
                setBusy('');
                setCreating(false);
                setNName('');
                setNRoot('');
                setNRepo('');
                setNSsh('');
                loadSpaces();
                openCs(c);
            }).catch(fail);
    };

    useEffect(() => {
        if (!channelId || !spaces) {
            return;
        }
        apiFetch(`${API}/workspace?channel=${channelId}`).then(j).then((d) => {
            if (d.codespace_id) {
                setBound(d.codespace_id);
                const c = spaces.find((x) => x.id === d.codespace_id);
                if (c && !cs) {
                    openCs(c);
                }
            }
        }).catch(() => undefined);
    }, [channelId, spaces]);

    const bindHere = () => cs && apiFetch(`${API}/workspace`, {method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({channel_id: channelId, codespace_id: cs.id})}).
        then(j).then(() => setBound(cs.id)).catch(fail);

    const list = spaces || [];
    const peerList = peersByPath[active] || [];
    const activeProvider = active ? providers.current.get(active) : null;
    const previewing = isMarkdown(active) && previewPaths.has(active);
    const commentLines = useMemo(() => comments.filter((c) => c.path === active && !c.resolved).map((c) => c.line), [comments, active]);
    const presenceByPath = useMemo(() => {
        const m: Record<string, Array<{id: string; name: string; color: string}>> = {};
        for (const id of Object.keys(presence)) {
            const v = presence[id];
            if (!v.path) {
                continue;
            }
            (m[v.path] = m[v.path] || []).push({id: v.id, name: v.name, color: v.color});
        }
        return m;
    }, [presence]);

    return (
        <div
            className='agora-cs'
            style={{padding: 12, fontSize: 14, color: 'var(--center-channel-color)', display: 'flex', flexDirection: 'column', height: '100%'}}
        >
            <div style={{display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap'}}>
                <b>{'Codespace'}</b>
                <select
                    value={cs ? cs.id : ''}
                    onChange={(e) => openCs(list.find((x) => x.id === e.target.value) || null)}
                    className='acs-select'
                >
                    <option value=''>{spaces === null ? 'loading…' : 'select…'}</option>
                    {list.map((s) => (
                        <option
                            key={s.id}
                            value={s.id}
                        >{s.name}</option>
                    ))}
                </select>
                <button
                    className='acs-btn'
                    onClick={() => {
                        setCreating(true);
                        loadHosts();
                    }}
                >{'+ New'}</button>
                {cs && cs.host_user_id && (
                    <button
                        className='acs-btn'
                        onClick={() => newFileAt('')}
                    >{'+ File'}</button>
                )}
                {cs && cs.id === bound && <span style={{fontSize: 11, color: 'var(--online-indicator,#3FB950)'}}>{'✓ this channel'}</span>}
                {cs && cs.id !== bound && (
                    <button
                        className='acs-btn'
                        onClick={bindHere}
                        title='Bind to this channel; its agent writes code here'
                    >{'Use here'}</button>
                )}
                <span style={{flex: 1}}/>
                {peerList.length > 0 && (
                    <span
                        style={{display: 'flex', alignItems: 'center', gap: 3, fontSize: 11}}
                        title={peerList.map((p) => p.name).join(', ')}
                    >
                        {peerList.slice(0, 5).map((p) => (
                            <Avatar
                                key={p.id}
                                id={p.id}
                                name={p.name}
                                color={p.color || colorFor(p.id)}
                                size={16}
                            />
                        ))}
                        <span style={{opacity: 0.6}}>{'editing'}</span>
                    </span>
                )}
                {busy && <span style={{fontSize: 11, opacity: 0.7}}>{busy}</span>}
                {cs && cs.host_user_id && <span className='acs-sep'/>}
                {cs && cs.host_user_id && (
                    <span style={{position: 'relative'}}>
                        <button
                            className={cx('acs-btn', disp && 'acs-on')}
                            onClick={() => setDisp((d) => !d)}
                            title='Display settings — theme, font size, word wrap'
                        >{'Aa ▾'}</button>
                        {disp && (
                            <>
                                <div
                                    onClick={() => setDisp(false)}
                                    style={{position: 'fixed', inset: 0, zIndex: 5}}
                                />
                                <div className='acs-pop'>
                                    <label>{'Theme'}
                                        <select
                                            className='acs-select'
                                            value={theme}
                                            onChange={(e) => pickTheme(e.target.value)}
                                        >
                                            {THEME_NAMES.map((t) => (
                                                <option
                                                    key={t}
                                                    value={t}
                                                >{t}</option>
                                            ))}
                                        </select>
                                    </label>
                                    <label>{'Font size'}
                                        <select
                                            className='acs-select'
                                            value={fontSize}
                                            onChange={(e) => pickFont(parseInt(e.target.value, 10))}
                                        >
                                            {FONT_SIZES.map((s) => (
                                                <option
                                                    key={s}
                                                    value={s}
                                                >{`${s}px`}</option>
                                            ))}
                                        </select>
                                    </label>
                                    <label>{'Word wrap'}
                                        <input
                                            type='checkbox'
                                            checked={wrap}
                                            onChange={toggleWrap}
                                        />
                                    </label>
                                    <label>{'Live pointers'}
                                        <input
                                            type='checkbox'
                                            checked={pointers}
                                            onChange={togglePointers}
                                        />
                                    </label>
                                </div>
                            </>
                        )}
                    </span>
                )}
                {cs && cs.host_user_id && (
                    <button
                        className={cx('acs-btn', showTerm && 'acs-on')}
                        onClick={() => setShowTerm((s) => !s)}
                        title='Toggle the codespace terminal'
                    >{'Terminal'}</button>
                )}
                {activeProvider && (
                    <button
                        className='acs-btn'
                        onClick={flushNow}
                        title='Save to disk now (auto-saves as you type)'
                    >{'Save'}</button>
                )}
            </div>

            {nFile !== null && (
                <div style={{display: 'flex', gap: 6, marginTop: 8}}>
                    <input
                        className='acs-inp'
                        style={{flex: 1}}
                        autoFocus={true}
                        placeholder='new file path, e.g. src/new.go (folders auto-created on save)'
                        value={nFile}
                        onChange={(e) => setNFile(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                createFile();
                            } else if (e.key === 'Escape') {
                                setNFile(null);
                            }
                        }}
                    />
                    <button
                        className='acs-btn'
                        onClick={createFile}
                    >{'Open'}</button>
                    <button
                        className='acs-btn'
                        onClick={() => setNFile(null)}
                    >{'Cancel'}</button>
                </div>
            )}

            {creating && (
                <div style={{display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8, padding: 8, border: '1px solid rgba(var(--center-channel-color-rgb),.15)', borderRadius: 6}}>
                    <div style={{fontSize: 12, opacity: 0.7}}>{'New codespace — a real, git-driven folder served by a connected machine.'}</div>
                    <div style={{fontSize: 11.5, lineHeight: 1.5, padding: '6px 8px', borderRadius: 5, border: '1px solid rgba(var(--center-channel-color-rgb),.18)', background: 'rgba(var(--center-channel-color-rgb),.04)'}}>
                        {'Needs a connected agent as the host. The path/repo lives on THAT machine — a local folder must already exist there, and cloning a private repo or using SSH needs that host’s own git/SSH access (the room can’t supply it).'}
                    </div>
                    <input
                        className='acs-inp'
                        placeholder='name'
                        value={nName}
                        onChange={(e) => setNName(e.target.value)}
                    />
                    <select
                        className='acs-inp'
                        value={nHost}
                        onChange={(e) => setNHost(e.target.value)}
                    >
                        <option value=''>{hosts.length ? 'choose host (a connected agent)…' : 'no connected agents — start a connector'}</option>
                        {hosts.map((h) => (
                            <option
                                key={h.id}
                                value={h.id}
                            >{h.label}</option>
                        ))}
                    </select>
                    <select
                        className='acs-inp'
                        value={nSource}
                        onChange={(e) => setNSource(e.target.value)}
                    >
                        <option value='local'>{'local folder on the host'}</option>
                        <option value='git'>{'clone a git URL'}</option>
                        <option value='ssh'>{'folder on another machine over SSH'}</option>
                    </select>
                    {nSource === 'local' && (
                        <input
                            className='acs-inp'
                            placeholder='absolute folder path on the host, e.g. C:\\Users\\me\\project'
                            value={nRoot}
                            onChange={(e) => setNRoot(e.target.value)}
                        />
                    )}
                    {nSource === 'git' && (
                        <>
                            <input
                                className='acs-inp'
                                placeholder='git repo URL, e.g. https://github.com/me/proj.git'
                                value={nRepo}
                                onChange={(e) => setNRepo(e.target.value)}
                            />
                            <input
                                className='acs-inp'
                                placeholder='(optional) clone on a remote box — user@host'
                                value={nSsh}
                                onChange={(e) => setNSsh(e.target.value)}
                            />
                        </>
                    )}
                    {nSource === 'ssh' && (
                        <>
                            <input
                                className='acs-inp'
                                placeholder='ssh target — user@host'
                                value={nSsh}
                                onChange={(e) => setNSsh(e.target.value)}
                            />
                            <input
                                className='acs-inp'
                                placeholder='absolute folder path on that remote machine'
                                value={nRoot}
                                onChange={(e) => setNRoot(e.target.value)}
                            />
                        </>
                    )}
                    <div style={{display: 'flex', gap: 6}}>
                        <button
                            className='acs-btn'
                            onClick={createCs}
                        >{'Create'}</button>
                        <button
                            className='acs-btn'
                            onClick={() => setCreating(false)}
                        >{'Cancel'}</button>
                    </div>
                </div>
            )}

            {err && <div style={{color: 'var(--error-text,#D24B4E)', marginTop: 8, fontSize: 12, whiteSpace: 'pre-wrap'}}>{`Error: ${err}`}</div>}
            {banner && <div style={{marginTop: 8, fontSize: 12, padding: '6px 8px', borderRadius: 5, background: 'rgba(229,192,123,.15)', border: '1px solid rgba(229,192,123,.5)'}}>{banner}</div>}

            {spaces !== null && list.length === 0 && !creating && !err && (
                <div style={{marginTop: 12, opacity: 0.7}}>{'No codespaces yet. Click '}<b>{'+ New'}</b>{' to point one at a folder on a connected machine.'}</div>
            )}

            {cs && cs.host_user_id && (
                <>
                    <div style={{display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 12}}>
                        <span style={{opacity: 0.6}}>{'git:'}</span>
                        <button
                            className='acs-btn'
                            onClick={gitStatus}
                        >{'Status'}</button>
                        <input
                            className='acs-inp'
                            style={{flex: 1, minWidth: 60}}
                            placeholder='commit message'
                            value={commitMsg}
                            onChange={(e) => setCommitMsg(e.target.value)}
                        />
                        <button
                            className='acs-btn'
                            onClick={commit}
                            disabled={!commitMsg.trim()}
                        >{'Commit'}</button>
                        <button
                            className='acs-btn'
                            onClick={push}
                        >{'Push'}</button>
                        <button
                            className='acs-btn'
                            onClick={showDiff}
                            title='Review your working changes'
                        >{'Diff'}</button>
                        <button
                            className={cx('acs-btn', infoPane === 'activity' && 'acs-on')}
                            onClick={() => setInfoPane((v) => (v === 'activity' ? 'none' : 'activity'))}
                            title='Who did what, when'
                        >{'Activity'}</button>
                        <button
                            className={cx('acs-btn', infoPane === 'comments' && 'acs-on')}
                            onClick={() => setInfoPane((v) => (v === 'comments' ? 'none' : 'comments'))}
                            title='Inline comments on the open file'
                        >{`Comments${commentLines.length ? ` (${commentLines.length})` : ''}`}</button>
                    </div>
                    {gitOut && <pre style={{margin: '6px 0 0', padding: 6, fontSize: 11, maxHeight: 90, overflow: 'auto', background: 'rgba(var(--center-channel-color-rgb),.05)', borderRadius: 4, whiteSpace: 'pre-wrap'}}>{gitOut}</pre>}
                    {infoPane === 'diff' && (
                        <DiffView
                            text={diffText}
                            onClose={() => setInfoPane('none')}
                        />
                    )}
                    {infoPane === 'activity' && cs && (
                        <ActivityFeed
                            csId={cs.id}
                            channelId={channelId}
                            onClose={() => setInfoPane('none')}
                        />
                    )}
                    {infoPane === 'comments' && (
                        <CommentsPane
                            comments={comments}
                            path={active}
                            onResolve={resolveC}
                            onJump={jumpToLine}
                            onClose={() => setInfoPane('none')}
                        />
                    )}

                    <div style={{display: 'flex', gap: 10, marginTop: 10, flex: 1, minHeight: 0}}>
                        <div style={{width: 220, flex: 'none', overflowY: 'auto', borderRight: '1px solid rgba(var(--center-channel-color-rgb),.12)', paddingRight: 6}}>
                            <FileTree
                                files={files}
                                selected={active}
                                presence={presenceByPath}
                                onOpen={(p) => openFile(p)}
                                onNewFile={newFileAt}
                                onNewFolder={newFolderAt}
                                onRename={renamePath}
                                onDelete={deletePath}
                            />
                        </div>
                        <div style={{flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6}}>
                            {tabs.length > 0 && (
                                <div style={{display: 'flex', alignItems: 'stretch', gap: 2, flexWrap: 'wrap', flex: 'none'}}>
                                    {tabs.map((t) => (
                                        <div
                                            key={t}
                                            className={cx('acs-tab', t === active && 'acs-on')}
                                            onClick={() => activate(t)}
                                            title={t}
                                        >
                                            <span style={{maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{baseName(t)}</span>
                                            {dirty.has(t) && (
                                                <span
                                                    title='unsaved'
                                                    style={{width: 6, height: 6, borderRadius: '50%', background: 'currentColor', opacity: 0.5, flex: 'none'}}
                                                />
                                            )}
                                            <span
                                                role='button'
                                                tabIndex={0}
                                                aria-label={`Close ${t}`}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    closeTab(t);
                                                }}
                                                className='acs-x'
                                            >{'×'}</span>
                                        </div>
                                    ))}
                                    <span style={{flex: 1}}/>
                                    {active && !previewing && (
                                        <button
                                            className='acs-btn'
                                            onClick={addCommentHere}
                                            title={`Comment on line ${cursorLine} (use @name to ping in chat)`}
                                        >{'Comment'}</button>
                                    )}
                                    {isMarkdown(active) && (
                                        <button
                                            className='acs-btn'
                                            onClick={() => togglePreview(active)}
                                        >{previewing ? 'Edit' : 'Preview'}</button>
                                    )}
                                </div>
                            )}
                            <div
                                className={cx(Boolean(activeProvider) && 'acs-card')}
                                style={{flex: 1, minHeight: 0}}
                            >
                                {!activeProvider && (
                                    <div style={{opacity: 0.6, paddingTop: 20}}>{'Pick a file from the tree — it opens in a tab and syncs live with everyone here. Codespace opens full-width automatically for a roomy editor.'}</div>
                                )}
                                {activeProvider && previewing && <MarkdownView provider={activeProvider}/>}
                                {activeProvider && !previewing && (
                                    <CodeEditor
                                        key={active}
                                        provider={activeProvider}
                                        path={active}
                                        readOnly={false}
                                        theme={theme}
                                        fontSize={fontSize}
                                        wrap={wrap}
                                        pointers={pointers}
                                        onSave={saveActive}
                                        commentLines={commentLines}
                                        onCursorLine={setCursorLine}
                                        onView={(v) => {
                                            activeViewRef.current = v;
                                        }}
                                    />
                                )}
                            </div>
                            {showTerm && (
                                <div style={{height: 220, flex: 'none'}}>
                                    <TerminalPanel
                                        csId={cs.id}
                                        channelId={channelId}
                                        selfId={user?.id || ''}
                                    />
                                </div>
                            )}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

export default CodespacePanel;
