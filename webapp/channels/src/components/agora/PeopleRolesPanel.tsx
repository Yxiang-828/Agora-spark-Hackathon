import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';

import {apiFetch, cleanError} from './client';

// People & Roles — the Discord-like surface for the agent model.
//
// Three live things, all backed by the plugin's roles API (roles.go):
//   1. Roles & permissions matrix  (role × capability scope)  — GET/POST /roles, GET /scopes
//   2. Roster                      (members + their agents, with role pills) — GET /agents
//   3. Inline role assignment per agent — GET/POST /agents/{id}/role
//
// Writes are Operator-only server-side; a non-operator simply gets a 403 we surface inline
// (the controls still render so the host sees the full shape; the server is the gate, not the UI).

const API = '/plugins/com.aegis.agora/api/v1';

type Role = {
    id: string;
    name: string;
    color: string;
    class: string;
    tier: string;
    scopes: string[];
    builtin: boolean;
};

type Agent = {
    bot_user_id: string;
    bot_username: string;
    agent: string;
    owner_id: string;
    owner_name: string;
    online: boolean;
    mine: boolean;
    desired: string;
};

type AgentRole = {
    bot_user_id: string;
    role: Role;
    effective_tier: string;
    scopes: string[];
};

const TIERS = ['operator', 'lead', 'member', 'guest'];

// Short human labels for the scope catalog (keys come from the server's /scopes).
const SCOPE_LABELS: Record<string, string> = {
    'codespace.read': 'Read codespace',
    'codespace.write': 'Write codespace',
    'git.commit': 'Commit',
    'git.push': 'Push',
    'channel.run': 'Run channel function',
    'channel.moderate': 'Moderate channel',
    'channel.route': 'Route tasks',
    'channel.memory': 'Channel memory',
    'skills.add': 'Add own skills',
    'members.manage': 'Manage members',
    'orchestrate': 'Orchestrate work',
};

const CLASS_LABELS: Record<string, string> = {
    personal: 'Personal',
    gm: 'Game Master',
    orchestrator: 'Orchestrator',
    custom: 'Custom',
};

const EASE = 'cubic-bezier(.23,1,.32,1)';

const CSS = `
.agora-pr { padding:16px; font-size:14px; color:var(--center-channel-color);
  height:100%; overflow-y:auto; box-sizing:border-box; }
.agora-pr__title { font-weight:700; font-size:16px; }
.agora-pr__sub { font-size:12px; color:rgba(var(--center-channel-color-rgb),.64); margin:2px 0 16px; }
.agora-pr__sec { font-weight:700; font-size:13px; margin:22px 0 8px; display:flex; align-items:center; gap:8px; }
.agora-pr__hint { font-weight:400; font-size:12px; color:rgba(var(--center-channel-color-rgb),.55); }
.agora-pr__err { color:var(--error-text,#D24B4E); margin:8px 0; font-size:13px; }
.agora-pr__note { font-size:12px; color:rgba(var(--center-channel-color-rgb),.6); margin:6px 0; }

.agora-pr__matrix { width:100%; border-collapse:collapse; font-size:12px; }
.agora-pr__matrix th, .agora-pr__matrix td { padding:6px 8px; border-bottom:1px solid rgba(var(--center-channel-color-rgb),.08); text-align:center; }
.agora-pr__matrix th.role { text-align:left; }
.agora-pr__matrix td.scope { text-align:left; color:rgba(var(--center-channel-color-rgb),.85); white-space:nowrap; }
.agora-pr__pill { display:inline-flex; align-items:center; gap:6px; padding:3px 9px; border-radius:11px;
  font-size:11px; font-weight:700; color:#fff; }
.agora-pr__pilltier { font-size:10px; opacity:.85; font-weight:600; }
.agora-pr__chk { width:16px; height:16px; cursor:pointer; accent-color:var(--button-bg,#1c58d9); }
.agora-pr__chk[disabled] { cursor:default; opacity:.4; }

.agora-pr__owner { margin-top:14px; }
.agora-pr__ownername { font-weight:600; display:flex; align-items:center; gap:8px; }
.agora-pr__agent { display:flex; align-items:center; gap:10px; padding:8px 2px;
  border-top:1px solid rgba(var(--center-channel-color-rgb),.07); }
.agora-pr__dot { width:8px; height:8px; border-radius:8px; flex:none; }
.agora-pr__aname { font-weight:600; }
.agora-pr__ameta { font-size:11px; color:rgba(var(--center-channel-color-rgb),.55); }
.agora-pr__spacer { flex:1; }
.agora-pr__cap { font-size:11px; color:rgba(var(--center-channel-color-rgb),.55); }
.agora-pr__sel { background:var(--center-channel-bg); color:inherit; font-size:12px;
  border:1px solid rgba(var(--center-channel-color-rgb),.2); border-radius:6px; padding:4px 8px; cursor:pointer; }
.agora-pr__sel[disabled] { opacity:.5; cursor:default; }
.agora-pr__btn { background:none; border:1px solid rgba(var(--center-channel-color-rgb),.16);
  border-radius:5px; padding:4px 10px; font-size:12px; color:inherit; cursor:pointer;
  transition:background 140ms ease, transform 120ms ${EASE}; }
.agora-pr__btn:hover { background:rgba(var(--center-channel-color-rgb),.06); }
.agora-pr__btn:active { transform:scale(.97); }
.agora-pr__btn[disabled] { opacity:.5; cursor:default; }
.agora-pr__new { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-top:10px; }
.agora-pr__in { background:var(--center-channel-bg); color:inherit; font-size:12px;
  border:1px solid rgba(var(--center-channel-color-rgb),.2); border-radius:6px; padding:5px 8px; }
.agora-pr__skel { height:14px; border-radius:4px; background:rgba(var(--center-channel-color-rgb),.08);
  margin:10px 0; animation:agorapulse 1.1s ease-in-out infinite; }
@keyframes agorapulse { 0%,100%{opacity:.5} 50%{opacity:1} }
@media (prefers-reduced-motion: reduce) { .agora-pr__btn,.agora-pr__skel{transition:none;animation:none} }
`;

const RolePill = ({role}: {role: Role}) => (
    <span
        className='agora-pr__pill'
        style={{background: role.color || '#7a7a7a'}}
        title={`${CLASS_LABELS[role.class] || role.class} · ceiling ${role.tier}`}
    >
        {role.name}
        <span className='agora-pr__pilltier'>{role.tier}</span>
    </span>
);

const PeopleRolesPanel = (): JSX.Element => {
    const [roles, setRoles] = useState<Role[] | null>(null);
    const [scopes, setScopes] = useState<string[]>([]);
    const [agents, setAgents] = useState<Agent[]>([]);
    const [agentRoles, setAgentRoles] = useState<Record<string, AgentRole>>({});
    const [err, setErr] = useState('');
    const [saving, setSaving] = useState('');         // id of role/agent currently saving
    const [denied, setDenied] = useState(false);      // last write was 403 (not operator)
    const [newName, setNewName] = useState('');
    const [newTier, setNewTier] = useState('member');
    const mounted = useRef(true);

    const load = useCallback(async () => {
        try {
            const [rR, sR, aR] = await Promise.all([
                apiFetch(`${API}/roles`, {credentials: 'include'}),
                apiFetch(`${API}/scopes`, {credentials: 'include'}),
                apiFetch(`${API}/agents`, {credentials: 'include'}),
            ]);
            if (!rR.ok) {
                throw new Error(`roles HTTP ${rR.status}`);
            }
            const rolesData: Role[] = await rR.json();
            const scopesData: string[] = sR.ok ? await sR.json() : [];
            const agentsData: Agent[] = aR.ok ? await aR.json() : [];

            // each agent's assigned role (effective view) — parallel, best-effort
            const pairs = await Promise.all(agentsData.map(async (a) => {
                try {
                    const r = await apiFetch(`${API}/agents/${a.bot_user_id}/role`, {credentials: 'include'});
                    return r.ok ? [a.bot_user_id, await r.json()] as const : null;
                } catch {
                    return null;
                }
            }));
            if (!mounted.current) {
                return;
            }
            setRoles(rolesData || []);
            setScopes(scopesData || []);
            setAgents(agentsData || []);
            const map: Record<string, AgentRole> = {};
            for (const p of pairs) {
                if (p) {
                    map[p[0]] = p[1];
                }
            }
            setAgentRoles(map);
            setErr('');
        } catch (e: any) {
            if (mounted.current) {
                setErr(cleanError(String(e?.message || e)));
            }
        }
    }, []);

    useEffect(() => {
        mounted.current = true;
        load();
        const poll = setInterval(load, 6000);
        return () => {
            mounted.current = false;
            clearInterval(poll);
        };
    }, [load]);

    const saveRole = useCallback(async (role: Role) => {
        setSaving(role.id || role.name);
        try {
            const r = await apiFetch(`${API}/roles`, {
                method: 'POST',
                credentials: 'include',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(role),
            });
            if (r.status === 403) {
                setDenied(true);
                return;
            }
            if (!r.ok) {
                throw new Error(cleanError(await r.text()));
            }
            setDenied(false);
            await load();
        } catch (e: any) {
            setErr(cleanError(String(e?.message || e)));
        } finally {
            if (mounted.current) {
                setSaving('');
            }
        }
    }, [load]);

    const toggleScope = (role: Role, scope: string) => {
        if (saving) {
            return;
        }
        const has = role.scopes?.includes(scope);
        const next = {...role, scopes: has ? role.scopes.filter((s) => s !== scope) : [...(role.scopes || []), scope]};
        // optimistic
        setRoles((cur) => (cur || []).map((x) => (x.id === role.id ? next : x)));
        saveRole(next);
    };

    const assignRole = useCallback(async (botID: string, roleID: string) => {
        setSaving(botID);
        try {
            const r = await apiFetch(`${API}/agents/${botID}/role`, {
                method: 'POST',
                credentials: 'include',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({role_id: roleID}),
            });
            if (r.status === 403) {
                setDenied(true);
                return;
            }
            if (!r.ok) {
                throw new Error(cleanError(await r.text()));
            }
            setDenied(false);
            await load();
        } catch (e: any) {
            setErr(cleanError(String(e?.message || e)));
        } finally {
            if (mounted.current) {
                setSaving('');
            }
        }
    }, [load]);

    const createRole = () => {
        const name = newName.trim();
        if (!name) {
            return;
        }
        saveRole({id: '', name, color: '#5865F2', class: 'custom', tier: newTier, scopes: [], builtin: false});
        setNewName('');
    };

    const deleteRole = useCallback(async (role: Role) => {
        if (role.builtin) {
            return;
        }
        setSaving(role.id);
        try {
            const r = await apiFetch(`${API}/roles/${role.id}`, {method: 'DELETE', credentials: 'include'});
            if (r.status === 403) {
                setDenied(true);
                return;
            }
            if (!r.ok) {
                throw new Error(cleanError(await r.text()));
            }
            setDenied(false);
            await load();
        } catch (e: any) {
            setErr(cleanError(String(e?.message || e)));
        } finally {
            if (mounted.current) {
                setSaving('');
            }
        }
    }, [load]);

    // roster grouped by owner
    const byOwner = useMemo(() => {
        const g: Record<string, {name: string; agents: Agent[]}> = {};
        for (const a of agents) {
            (g[a.owner_id] ||= {name: a.owner_name || a.owner_id, agents: []}).agents.push(a);
        }
        return Object.values(g).sort((x, y) => x.name.localeCompare(y.name));
    }, [agents]);

    const scopeList = scopes.length ? scopes : Object.keys(SCOPE_LABELS);

    if (roles === null && !err) {
        return (
            <div className='agora-pr'>
                <style>{CSS}</style>
                <div className='agora-pr__title'>{'People & Roles'}</div>
                <div className='agora-pr__skel' style={{width: '55%'}}/>
                <div className='agora-pr__skel' style={{width: '80%'}}/>
                <div className='agora-pr__skel' style={{width: '40%'}}/>
            </div>
        );
    }

    return (
        <div className='agora-pr'>
            <style>{CSS}</style>
            <div className='agora-pr__title'>{'People & Roles'}</div>
            <div className='agora-pr__sub'>
                {'Host-controlled roles, capped authority, and who holds what. An agent never outranks its owner — '}
                {'every role is a ceiling, capped to the owner’s tier.'}
            </div>

            {err && <div className='agora-pr__err'>{`Couldn’t reach the roles API: ${err}`}</div>}
            {denied && (
                <div className='agora-pr__note'>
                    {'You’re viewing as a non-operator — changes are Operator-only and the server rejected the write. '}
                    {'Ask the host to grant roles.'}
                </div>
            )}

            {/* ---- Roles & permission matrix ---- */}
            <div className='agora-pr__sec'>
                {'Roles & permissions'}
                <span className='agora-pr__hint'>{'role × capability — toggle to grant'}</span>
            </div>

            {roles && roles.length > 0 ? (
                <div style={{overflowX: 'auto'}}>
                    <table className='agora-pr__matrix'>
                        <thead>
                            <tr>
                                <th className='role'>{'Capability'}</th>
                                {roles.map((r) => (
                                    <th key={r.id}>
                                        <RolePill role={r}/>
                                        {!r.builtin && (
                                            <div>
                                                <button
                                                    className='agora-pr__btn'
                                                    style={{marginTop: 6, fontSize: 10, padding: '2px 6px'}}
                                                    disabled={saving === r.id}
                                                    onClick={() => deleteRole(r)}
                                                >{'delete'}</button>
                                            </div>
                                        )}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {scopeList.map((scope) => (
                                <tr key={scope}>
                                    <td className='scope'>{SCOPE_LABELS[scope] || scope}</td>
                                    {roles.map((r) => (
                                        <td key={r.id + scope}>
                                            <input
                                                type='checkbox'
                                                className='agora-pr__chk'
                                                checked={r.scopes?.includes(scope) || false}
                                                disabled={Boolean(saving)}
                                                onChange={() => toggleScope(r, scope)}
                                            />
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : (
                <div className='agora-pr__note'>{'No roles yet — the built-ins seed on first load. Refreshing…'}</div>
            )}

            <div className='agora-pr__new'>
                <input
                    className='agora-pr__in'
                    placeholder='New role name'
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && createRole()}
                />
                <select
                    className='agora-pr__sel'
                    value={newTier}
                    onChange={(e) => setNewTier(e.target.value)}
                >
                    {TIERS.map((t) => <option key={t} value={t}>{`ceiling: ${t}`}</option>)}
                </select>
                <button
                    className='agora-pr__btn'
                    disabled={!newName.trim() || Boolean(saving)}
                    onClick={createRole}
                >{'+ Create role'}</button>
            </div>

            {/* ---- Roster ---- */}
            <div className='agora-pr__sec'>
                {'Roster'}
                <span className='agora-pr__hint'>{`${agents.length} agent(s) across ${byOwner.length} owner(s)`}</span>
            </div>

            {byOwner.length === 0 && (
                <div className='agora-pr__note'>
                    {'No agents have paired yet. Pair a connector (Connect AI tab), then assign it a role here.'}
                </div>
            )}

            {byOwner.map((o) => (
                <div className='agora-pr__owner' key={o.name}>
                    <div className='agora-pr__ownername'>{o.name}</div>
                    {o.agents.map((a) => {
                        const ar = agentRoles[a.bot_user_id];
                        const curRoleID = ar?.role?.id || 'personal';
                        return (
                            <div className='agora-pr__agent' key={a.bot_user_id}>
                                <span
                                    className='agora-pr__dot'
                                    style={{background: a.online ? 'var(--online-indicator,#3FB950)' : 'rgba(var(--center-channel-color-rgb),.3)'}}
                                    title={a.online ? 'online' : 'offline'}
                                />
                                <span className='agora-pr__aname'>{a.agent}</span>
                                {ar?.role && <RolePill role={ar.role}/>}
                                <span className='agora-pr__spacer'/>
                                {ar && (
                                    <span className='agora-pr__cap' title='effective authority after the owner-tier cap'>
                                        {`acts as: ${ar.effective_tier}`}
                                    </span>
                                )}
                                <select
                                    className='agora-pr__sel'
                                    value={curRoleID}
                                    disabled={saving === a.bot_user_id}
                                    onChange={(e) => assignRole(a.bot_user_id, e.target.value)}
                                >
                                    {(roles || []).map((r) => (
                                        <option key={r.id} value={r.id}>{r.name}</option>
                                    ))}
                                </select>
                            </div>
                        );
                    })}
                </div>
            ))}
        </div>
    );
};

export default PeopleRolesPanel;
