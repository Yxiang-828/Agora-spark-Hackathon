// One scoped stylesheet for the Codespace toolbar/tabs: quiet bordered controls that light up on
// hover, a clear accent for the active state, and clean tabs — all driven by Mattermost's theme
// variables so it looks right in light and dark. Scoped under `.agora-cs` so it never leaks into
// the rest of the app.
let panelStyled = false;
export const injectPanelStyles = () => {
    if (panelStyled) {
        return;
    }
    panelStyled = true;
    const el = document.createElement('style');
    el.textContent = `
.agora-cs { --acs-bd: rgba(var(--center-channel-color-rgb),.16); --acs-hov: rgba(var(--center-channel-color-rgb),.08); }
.agora-cs .acs-btn { display:inline-flex; align-items:center; gap:5px; background:transparent; border:1px solid var(--acs-bd); border-radius:6px; padding:4px 10px; font-size:12px; color:inherit; cursor:pointer; line-height:1.45; white-space:nowrap; transition:background .12s ease, border-color .12s ease; }
.agora-cs .acs-btn:hover:not(:disabled) { background:var(--acs-hov); }
.agora-cs .acs-btn:disabled { opacity:.45; cursor:default; }
.agora-cs .acs-btn.acs-on { background:rgba(var(--center-channel-color-rgb),.12); border-color:rgba(var(--center-channel-color-rgb),.32); }
.agora-cs .acs-inp { padding:5px 9px; font-size:13px; border-radius:6px; color:inherit; border:1px solid rgba(var(--center-channel-color-rgb),.22); background:var(--center-channel-bg); }
.agora-cs .acs-inp:focus { outline:none; border-color:var(--button-bg,#1c58d9); }
.agora-cs .acs-select { padding:4px 22px 4px 8px; font-size:12px; border-radius:6px; color:inherit; border:1px solid var(--acs-bd); background:transparent; cursor:pointer; }
.agora-cs .acs-sep { width:1px; align-self:stretch; min-height:18px; margin:0 2px; background:var(--acs-bd); }
.agora-cs .acs-tab { display:flex; align-items:center; gap:5px; padding:5px 6px 5px 10px; font-size:12px; border-radius:6px 6px 0 0; cursor:pointer; color:inherit; border-bottom:2px solid transparent; transition:background .12s ease; }
.agora-cs .acs-tab:hover { background:var(--acs-hov); }
.agora-cs .acs-tab.acs-on { background:var(--acs-hov); border-bottom-color:var(--button-bg,#1c58d9); font-weight:600; }
.agora-cs .acs-x { display:inline-flex; opacity:.4; padding:0 3px; border-radius:4px; cursor:pointer; }
.agora-cs .acs-x:hover { opacity:1; background:rgba(var(--center-channel-color-rgb),.15); }
.agora-cs .acs-pop { position:absolute; right:0; top:118%; z-index:6; background:var(--center-channel-bg); border:1px solid var(--acs-bd); border-radius:8px; padding:9px; display:flex; flex-direction:column; gap:8px; min-width:180px; box-shadow:0 8px 24px rgba(0,0,0,.18); }
.agora-cs .acs-pop label { display:flex; align-items:center; justify-content:space-between; gap:10px; font-size:12px; }
.agora-cs .acs-card { border:1px solid var(--acs-bd); border-radius:8px; overflow:hidden; background:rgba(var(--center-channel-color-rgb),.02); }`;
    document.head.appendChild(el);
};
