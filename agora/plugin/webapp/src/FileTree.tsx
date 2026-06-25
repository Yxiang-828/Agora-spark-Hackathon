import React, {useMemo, useState} from 'react';

import Avatar from './Avatar';

// A real folder tree over the codespace's file list: expand/collapse folders, and create /
// rename / delete files and folders. Paths are relative ("src/main.go"); folders are inferred
// from the paths plus any empty dirs the host reports with a trailing "/".

type TreeNode = {name: string; path: string; dir: boolean; children: TreeNode[]};

const build = (files: string[]): TreeNode => {
    const root: TreeNode = {name: '', path: '', dir: true, children: []};
    for (const raw of files) {
        const isDirMarker = raw.endsWith('/');
        const parts = raw.replace(/\/$/, '').split('/').filter(Boolean);
        let cur = root;
        let acc = '';
        parts.forEach((part, i) => {
            acc = acc ? acc + '/' + part : part;
            const isFile = i === parts.length - 1 && !isDirMarker;
            let child = cur.children.find((c) => c.name === part && c.dir === !isFile);
            if (!child) {
                child = {name: part, path: acc, dir: !isFile, children: []};
                cur.children.push(child);
            }
            cur = child;
        });
    }
    const sortRec = (n: TreeNode) => {
        n.children.sort((a, b) => {
            if (a.dir === b.dir) {
                return a.name.localeCompare(b.name);
            }
            return a.dir ? -1 : 1; // folders before files
        });
        n.children.forEach(sortRec);
    };
    sortRec(root);
    return root;
};

type Viewer = {id: string; name: string; color: string};

type Props = {
    files: string[];
    selected: string;
    presence?: Record<string, Viewer[]>; // path -> teammates currently viewing it
    onOpen: (path: string) => void;
    onNewFile: (dir: string) => void;
    onNewFolder: (dir: string) => void;
    onRename: (path: string) => void;
    onDelete: (path: string, isDir: boolean) => void;
};

const rowBtn: React.CSSProperties = {
    background: 'none', border: 0, color: 'inherit', cursor: 'pointer', fontSize: 11, opacity: 0.55, padding: '0 3px',
};

const Row = ({node, depth, p, expanded, toggle}: {node: TreeNode; depth: number; p: Props; expanded: Set<string>; toggle: (path: string) => void}) => {
    const [hover, setHover] = useState(false);
    const isOpen = expanded.has(node.path);
    const pad = 4 + (depth * 12);
    const sel = !node.dir && node.path === p.selected;
    const viewers = (!node.dir && p.presence && p.presence[node.path]) || [];
    let marker = '·';
    if (node.dir) {
        marker = isOpen ? '▾' : '▸';
    }
    let bg = 'none';
    if (sel) {
        bg = 'rgba(var(--center-channel-color-rgb),.10)';
    } else if (viewers.length) {
        bg = 'rgba(var(--center-channel-color-rgb),.05)'; // a teammate is in this file
    }
    return (
        <div>
            <div
                onMouseEnter={() => setHover(true)}
                onMouseLeave={() => setHover(false)}
                style={{display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '1px 2px',
                    paddingLeft: pad,
                    borderRadius: 3,
                    background: bg}}
            >
                <button
                    onClick={() => (node.dir ? toggle(node.path) : p.onOpen(node.path))}
                    title={node.path}
                    style={{flex: 1,
                        textAlign: 'left',
                        border: 0,
                        background: 'none',
                        color: 'inherit',
                        cursor: 'pointer',
                        fontSize: 12.5,
                        fontWeight: sel ? 600 : 400,
                        fontFamily: 'inherit',
                        padding: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'}}
                >
                    <span style={{opacity: 0.6, marginRight: 3}}>{marker}</span>
                    {node.name}
                </button>
                {viewers.length > 0 && (
                    <span
                        style={{display: 'flex', gap: 2, flex: 'none', alignItems: 'center'}}
                        title={viewers.map((vw) => vw.name).join(', ') + ' here'}
                    >
                        {viewers.slice(0, 4).map((vw) => (
                            <Avatar
                                key={vw.id}
                                id={vw.id}
                                name={vw.name}
                                color={vw.color}
                                size={15}
                            />
                        ))}
                    </span>
                )}
                {hover && node.dir && (
                    <>
                        <button
                            style={rowBtn}
                            title='New file in folder'
                            onClick={() => p.onNewFile(node.path)}
                        >{'+f'}</button>
                        <button
                            style={rowBtn}
                            title='New subfolder'
                            onClick={() => p.onNewFolder(node.path)}
                        >{'+▸'}</button>
                    </>
                )}
                {hover && (
                    <>
                        <button
                            style={rowBtn}
                            title='Rename'
                            onClick={() => p.onRename(node.path)}
                        >{'✎'}</button>
                        <button
                            style={rowBtn}
                            title='Delete'
                            onClick={() => p.onDelete(node.path, node.dir)}
                        >{'🗑'}</button>
                    </>
                )}
            </div>
            {node.dir && isOpen && node.children.map((c) => (
                <Row
                    key={c.path}
                    node={c}
                    depth={depth + 1}
                    p={p}
                    expanded={expanded}
                    toggle={toggle}
                />
            ))}
        </div>
    );
};

const FileTree = (p: Props) => {
    const root = useMemo(() => build(p.files), [p.files]);

    // Folders holding the open file start expanded so the selection is visible.
    const initial = useMemo(() => {
        const s = new Set<string>();
        const parts = p.selected.split('/');
        let acc = '';
        for (let i = 0; i < parts.length - 1; i++) {
            acc = acc ? acc + '/' + parts[i] : parts[i];
            s.add(acc);
        }
        return s;
    }, [p.selected]);
    const [expanded, setExpanded] = useState<Set<string>>(initial);
    const toggle = (path: string) => setExpanded((prev) => {
        const n = new Set(prev);
        if (n.has(path)) {
            n.delete(path);
        } else {
            n.add(path);
        }
        return n;
    });

    if (root.children.length === 0) {
        return <div style={{opacity: 0.5, fontSize: 12, padding: 4}}>{'(no files)'}</div>;
    }
    return (
        <div style={{fontSize: 13}}>
            {root.children.map((c) => (
                <Row
                    key={c.path}
                    node={c}
                    depth={0}
                    p={p}
                    expanded={expanded}
                    toggle={toggle}
                />
            ))}
        </div>
    );
};

export default FileTree;
