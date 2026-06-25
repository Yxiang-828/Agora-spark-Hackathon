# VC-3d-room

A 3D spatial **voice-call room** with VRM avatars. Everyone sits in a room; when you
talk, your avatar **stands, walks to the centre podium, and spins** under a spotlight —
then walks back and sits when you stop. Voice is a WebRTC mesh with spatial audio.

One Node server + three.js / three-vrm over CDN. No build step, no cloud, no accounts.

## Run

```bash
npm install            # one dependency: ws
npm start              # → http://localhost:8090
```

Open **http://localhost:8090** in up to **4 tabs** (or 4 devices on the LAN — use the
host's IP). Each tab claims one avatar. Click **push to talk** to walk to the podium and
spin; click again to sit back down.

> Four tabs on one machine share a mic → use headphones and unmute one at a time.

## What's in here (lossless)

| Path | What |
|---|---|
| `server.mjs` | static server + WebSocket signaling / state relay |
| `public/app.js` | the whole client — room, avatars, gate, voice, grounding |
| `public/motion-root.mjs` | hip-retarget + grounding helpers |
| `assets/models/*.vrm` | the 4 avatars (stelle, caelus, yinlin, chixia) |
| `assets/clips/*.json` | 112 baked Kimodo motion clips (sit, walk, spin, …) |

Swap avatars by replacing the four `.vrm` files (any humanoid VRM works).

## How it renders (the bits that matter)

- **Clip builder** applies a VRM0 quaternion mirror (negate x,z per bone) so VRM0 skins
  pose correctly, plus `retargetHipsY` for hip-height retargeting.
- **Per-frame contact grounding**: each frame the lowest posed humanoid bone (minus a skin
  clearance) is planted on the surface — floor, or the raised podium when within it. This
  is what keeps sits/stands grounded instead of floating.
- **Facing** is measured per skin from the skeleton, never assumed.
- **Speaking gate**: talk → stand, walk to centre podium, spin; stop → walk back, sit.
- **Voice**: WebRTC mesh (≤4), STUN only, per-remote `PannerNode` for spatial audio.

## Multiplayer

`server.mjs` assigns each connection a slot (0–3), relays WebRTC signaling, and rebroadcasts
each owner's avatar state (position / yaw / pose / speaking) at ~10 Hz; peers mirror it.
