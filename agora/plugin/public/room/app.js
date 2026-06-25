// Voice Room — 4 VRM avatars. Silent → seated at your spot. Talk → stand, walk to
// the centre podium and SPIN. Stop → walk back and sit. Built on the proven core:
// VRM0-mirror clip builder + retargetHipsY + per-frame contact grounding + computeFacing.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { retargetHipsY, sourceUprightHipsY } from './motion-root.mjs';

const $ = (s) => document.querySelector(s);
const status = (t) => { $('#status').textContent = t; };

// ── Agora integration ────────────────────────────────────────────────────────
// Served from /plugins/com.aegis.agora/public/room/, embedded per voice channel.
// The channel id arrives as ?channel=<id>; the WS relay + agent-speak live on the plugin API.
const PLUGIN = '/plugins/com.aegis.agora';
const CHANNEL = new URLSearchParams(location.search).get('channel') || '';
const AGENT_MODEL = 'stelle';          // the avatar agents wear; badged by a ring + violet spotlight
const AGENT_RING = 0x8a6bff;           // agents glow violet; humans get warm white

// ── config ───────────────────────────────────────────────────────────────────
const MODELS = ['stelle', 'caelus', 'yinlin', 'chixia'];
const SEATS  = [[-2.6, -1.9], [2.6, -1.9], [-2.6, 1.9], [2.6, 1.9]];
const ROOM = 6.0, SPEED = 1.8, SPIN_SPEED = 2.6;
const STAGE_R = 1.4, STAGE_TOP = 0.22;                  // central podium
const podiumSpot = (slot) => { const a = slot * Math.PI / 2; return [Math.cos(a) * 0.5, Math.sin(a) * 0.5]; };
const GROUNDED_IDLE = 'sit_idle', UPRIGHT_IDLE = 'cross_arms_idle', WALK = 'walk_cycle', STAND_UP = 'stand_up';
const CONTACT = {
  hips: 0.055, spine: 0.055, chest: 0.060, upperChest: 0.060, neck: 0.035, head: 0.075,
  leftUpperArm: 0.035, rightUpperArm: 0.035, leftLowerArm: 0.030, rightLowerArm: 0.030,
  leftHand: 0.025, rightHand: 0.025,
  leftUpperLeg: 0.045, rightUpperLeg: 0.045, leftLowerLeg: 0.035, rightLowerLeg: 0.035,
  leftFoot: 0.025, rightFoot: 0.025, leftToes: 0.015, rightToes: 0.015,
};

// ── three setup ──────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ canvas: $('#c'), antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14171e);
scene.fog = new THREE.Fog(0x14171e, 14, 30);

const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 4.6, 8.4);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.9, 0); controls.enablePan = false;
controls.minDistance = 4; controls.maxDistance = 18; controls.maxPolarAngle = 1.45;
controls.update();

scene.add(new THREE.HemisphereLight(0xc6d2ff, 0x2a2638, 1.15));
const key = new THREE.DirectionalLight(0xfff2e0, 1.1); key.position.set(3, 7, 4); scene.add(key);

let stageGlow;
function buildRoom() {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM * 2 + 2, ROOM * 2 + 2),
    new THREE.MeshStandardMaterial({ color: 0x222636, roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2; floor.name = 'floor'; scene.add(floor);
  const grid = new THREE.GridHelper(ROOM * 2 + 2, 16, 0x4a4f7a, 0x2c3050);
  grid.position.y = 0.01; scene.add(grid);
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x191526, roughness: 1 });
  const H = 3.2, T = 0.3, S = ROOM + 1;
  for (const [x, z, w, d] of [[0, -S, S * 2, T], [0, S, S * 2, T], [-S, 0, T, S * 2], [S, 0, T, S * 2]]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, H, d), wallMat);
    wall.position.set(x, H / 2, z); scene.add(wall);
  }
  const neon = (color, x, z, w, d) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.07, d),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2.2 }));
    m.position.set(x, 2.6, z); scene.add(m);
    const l = new THREE.PointLight(color, 5, 10); l.position.set(x, 2.2, z); scene.add(l);
  };
  neon(0xff3ea5, 0, -S + 0.2, S * 2 - 1, 0.06);
  neon(0x3ea5ff, -S + 0.2, 0, 0.06, S * 2 - 1);
  // central podium / stage
  const stage = new THREE.Mesh(new THREE.CylinderGeometry(STAGE_R, STAGE_R + 0.15, STAGE_TOP, 40),
    new THREE.MeshStandardMaterial({ color: 0x2b2350, roughness: 0.6, metalness: 0.3 }));
  stage.position.set(0, STAGE_TOP / 2, 0); scene.add(stage);
  stageGlow = new THREE.Mesh(new THREE.TorusGeometry(STAGE_R, 0.05, 10, 48),
    new THREE.MeshStandardMaterial({ color: 0x8effd1, emissive: 0x8effd1, emissiveIntensity: 1.3 }));
  stageGlow.rotation.x = Math.PI / 2; stageGlow.position.set(0, STAGE_TOP + 0.02, 0); scene.add(stageGlow);
  for (const [x, z] of SEATS) {
    const mat = new THREE.Mesh(new THREE.CircleGeometry(0.7, 24),
      new THREE.MeshStandardMaterial({ color: 0x2e2a4a, roughness: 0.9 }));
    mat.rotation.x = -Math.PI / 2; mat.position.set(x, 0.015, z); scene.add(mat);
  }
  return floor;
}
const floorMesh = buildRoom();
const surfaceYAt = (x, z) => (Math.hypot(x, z) < STAGE_R ? STAGE_TOP : 0);   // stand on stage when within it

// ── proven rendering core ────────────────────────────────────────────────────
function computeFacing(vrm) {
  const h = vrm.humanoid;
  const L = h.getNormalizedBoneNode('leftUpperArm'), R = h.getNormalizedBoneNode('rightUpperArm');
  const hips = h.getNormalizedBoneNode('hips'), head = h.getNormalizedBoneNode('head') || h.getNormalizedBoneNode('neck');
  if (!L || !R || !hips || !head) return 0;
  const sc = vrm.scene, save = sc.rotation.y; sc.rotation.y = 0; sc.updateMatrixWorld(true);
  const lw = L.getWorldPosition(new THREE.Vector3()), rw = R.getWorldPosition(new THREE.Vector3());
  const hw = hips.getWorldPosition(new THREE.Vector3()), hd = head.getWorldPosition(new THREE.Vector3());
  sc.rotation.y = save; sc.updateMatrixWorld(true);
  const front = new THREE.Vector3().crossVectors(hd.sub(hw), rw.sub(lw)).normalize();
  return front.z < 0 ? Math.PI : 0;
}
function makeClip(vrm, name, motion) {
  const times = Array.from({ length: motion.frames }, (_, i) => i / motion.fps);
  const tracks = [];
  const isVrm0 = `${vrm.meta?.metaVersion ?? ''}` === '0';
  for (const [boneName, values] of Object.entries(motion.rotations)) {
    const node = vrm.humanoid.getNormalizedBoneNode(boneName);
    if (!node) continue;
    let vals = values;
    if (isVrm0) { vals = values.slice(); for (let i = 0; i < vals.length; i += 4) { vals[i] = -vals[i]; vals[i + 2] = -vals[i + 2]; } }
    tracks.push(new THREE.QuaternionKeyframeTrack(`${node.name}.quaternion`, times, vals));
  }
  const hips = vrm.humanoid.getNormalizedBoneNode('hips');
  if (hips) {
    const tRest = vrm.humanoid.normalizedRestPose.hips.position, hv = [];
    for (let i = 0; i < motion.frames; i++)
      hv.push(tRest[0], retargetHipsY(tRest[1], motion.hipsPositions[i * 3 + 1], motion), tRest[2]);
    tracks.push(new THREE.VectorKeyframeTrack(`${hips.name}.position`, times, hv));
  }
  return new THREE.AnimationClip(name, motion.duration, tracks);
}
function faceCentre(x, z) { return Math.atan2(-x, -z); }

// ── avatar ───────────────────────────────────────────────────────────────────
const loader = new GLTFLoader();
loader.register((p) => new VRMLoaderPlugin(p));

async function makeAvatar(slot, agentSpec) {
  const isAgent = !!agentSpec;
  const model = isAgent ? AGENT_MODEL : MODELS[slot];
  const [sx, sz] = isAgent ? agentSpec.seat : SEATS[slot];
  const gltf = await loader.loadAsync(`assets/models/${model}.vrm`);
  const vrm = gltf.userData.vrm;
  VRMUtils.removeUnnecessaryVertices(vrm.scene);
  VRMUtils.combineSkeletons(vrm.scene);
  VRMUtils.combineMorphs(vrm);
  VRMUtils.rotateVRM0(vrm);
  vrm.scene.traverse((o) => { o.frustumCulled = false; });
  vrm.scene.position.set(sx, 0, sz);
  const facing = computeFacing(vrm), yaw0 = faceCentre(sx, sz);
  vrm.scene.rotation.y = yaw0 + facing;
  scene.add(vrm.scene);

  const contactBones = Object.entries(CONTACT)
    .map(([n, clr]) => ({ bone: vrm.humanoid.getRawBoneNode(n), clr })).filter((b) => b.bone);
  vrm.scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(vrm.scene);
  const bodyH = Math.max(0.5, box.max.y - box.min.y);

  const spot = new THREE.SpotLight(isAgent ? AGENT_RING : 0xfff2d0, 0, 16, Math.PI / 7, 0.5, 1.1);
  spot.position.set(sx, 6, sz); spot.target.position.set(sx, 0, sz);
  scene.add(spot.target); scene.add(spot);

  const mixer = new THREE.AnimationMixer(vrm.scene);
  const clipCache = new Map();
  const av = {
    slot, isAgent, name: isAgent ? agentSpec.name : MODELS[slot],
    vrm, mixer, facing, spot, contactBones, bodyH,
    seat: new THREE.Vector3(sx, 0, sz), pos: new THREE.Vector3(sx, 0, sz),
    yaw: yaw0, sceneY: 0, mode: 'seated', target: null, ring: null,
    speaking: false, level: 0, mouth: 0, poseAction: null, poseName: null,
  };
  async function loadClip(name) {
    if (clipCache.has(name)) return clipCache.get(name);
    let clip = null;
    try { const m = await fetch(`assets/clips/${name}.json`).then((r) => { if (!r.ok) throw 0; return r.json(); }); clip = makeClip(vrm, name, m); } catch { clip = null; }
    clipCache.set(name, clip); return clip;
  }
  async function setPose(name) {
    if (name === av.poseName) return;
    const clip = await loadClip(name) || await loadClip(GROUNDED_IDLE);
    if (!clip) return;
    const next = mixer.clipAction(clip); next.reset(); next.setLoop(THREE.LoopRepeat); next.enabled = true; next.setEffectiveWeight(1).play();
    if (av.poseAction) next.crossFadeFrom(av.poseAction, 0.3, false); else next.fadeIn(0.3);
    av.poseAction = next; av.poseName = name;
  }
  async function playBeat(name) {
    const clip = await loadClip(name); if (!clip) return;
    const beat = mixer.clipAction(clip); beat.reset(); beat.setLoop(THREE.LoopOnce); beat.clampWhenFinished = true; beat.enabled = true; beat.setEffectiveWeight(1).play();
    if (av.poseAction) beat.crossFadeFrom(av.poseAction, 0.2, false);
    const onDone = (e) => { if (e.action !== beat) return; mixer.removeEventListener('finished', onDone); if (av.poseAction) { av.poseAction.reset().play(); av.poseAction.crossFadeFrom(beat, 0.25, false); } };
    mixer.addEventListener('finished', onDone);
  }
  av.setPose = setPose; av.playBeat = playBeat;
  if (isAgent) {
    // violet ground ring so a bot reads instantly vs a human's plain seat
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.04, 8, 36),
      new THREE.MeshStandardMaterial({ color: AGENT_RING, emissive: AGENT_RING, emissiveIntensity: 1.4 }));
    ring.rotation.x = Math.PI / 2; scene.add(ring); av.ring = ring;
  }
  await setPose(GROUNDED_IDLE);
  return av;
}

// ── agents: badged avatars that speak via the connector's Qwen TTS clip ───────
const agentAvatars = new Map(); // botId -> av
const AGENT_SEATS = [[0, -3.6], [3.6, 0], [0, 3.6], [-3.6, 0], [2.6, -3.0], [-2.6, 3.0]];
let agentSeatN = 0;
async function ensureAgentAvatar(botId, name) {
  if (agentAvatars.has(botId)) return agentAvatars.get(botId);
  const seat = AGENT_SEATS[agentSeatN % AGENT_SEATS.length]; agentSeatN++;
  const av = await makeAvatar(-1, { name: name || 'agent', seat });
  avatars.push(av); agentAvatars.set(botId, av);
  return av;
}
async function onAgentSpeak(m) {
  try { const av = await ensureAgentAvatar(m.bot_user_id, m.name); await playAgentClip(av, m.audio_url); }
  catch (e) { console.error('agent-speak', e); }
}
// Play the agent's TTS clip, spatialized at its avatar; amplitude drives lip-sync; spin while it talks.
async function playAgentClip(av, url) {
  await initAudio(); if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  av.speaking = true; av.setPose(UPRIGHT_IDLE);
  if (!url) { setTimeout(() => { av.speaking = false; av.level = 0; av.setPose(GROUNDED_IDLE); }, 1500); return; }
  const done = () => { av.speaking = false; av.level = 0; av.setPose(GROUNDED_IDLE); };
  try {
    const a = new Audio(url); a.crossOrigin = 'use-credentials';
    let an = null;
    if (audioCtx) {
      const src = audioCtx.createMediaElementSource(a);
      an = audioCtx.createAnalyser(); an.fftSize = 256;
      const pan = audioCtx.createPanner(); pan.panningModel = 'HRTF'; pan.distanceModel = 'inverse'; pan.refDistance = 1.5; pan.maxDistance = 20;
      if (pan.positionX) { pan.positionX.value = av.pos.x; pan.positionY.value = 1.2; pan.positionZ.value = av.pos.z; } else pan.setPosition(av.pos.x, 1.2, av.pos.z);
      src.connect(an); an.connect(pan); pan.connect(audioCtx.destination);
    }
    const loop = () => {
      if (an && av.speaking) { const b = new Uint8Array(an.fftSize); an.getByteTimeDomainData(b); let s = 0; for (const v of b) { const x = (v - 128) / 128; s += x * x; } av.level = Math.min(1, Math.sqrt(s / b.length) * 4); }
      if (!a.ended && av.speaking) requestAnimationFrame(loop);
    };
    a.onended = done; a.onerror = done;
    await a.play().catch(() => {}); loop();
  } catch (e) { done(); }
}

// LOCAL gate: talk → head to podium; stop → head back to seat
function setSpeaking(av, on) {
  av.speaking = on;
  if (on && av.mode === 'seated') {
    av.mode = 'to_podium'; av.target = new THREE.Vector3(podiumSpot(av.slot)[0], 0, podiumSpot(av.slot)[1]);
    av.playBeat(STAND_UP); av.setPose(WALK);
  } else if (!on && (av.mode === 'to_podium' || av.mode === 'spinning')) {
    av.mode = 'to_seat'; av.target = av.seat.clone(); av.setPose(WALK);
  }
}

// ── networking + WebRTC mesh ─────────────────────────────────────────────────
const avatars = [];
let localSlot = -1, myId = null;
const peerSlot = new Map(), pcs = new Map(), remoteAudio = new Map();
let localStream = null, analyser = null, audioCtx = null, ws = null;

async function initAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    for (const t of localStream.getAudioTracks()) t.enabled = false;
    const src = audioCtx.createMediaStreamSource(localStream);
    analyser = audioCtx.createAnalyser(); analyser.fftSize = 256; src.connect(analyser);
  } catch { status('no mic — push-to-talk still works (silent)'); }
}
function micLevel() {
  if (!analyser) return 0;
  const b = new Uint8Array(analyser.fftSize); analyser.getByteTimeDomainData(b);
  let s = 0; for (const v of b) { const x = (v - 128) / 128; s += x * x; } return Math.min(1, Math.sqrt(s / b.length) * 4);
}
function makePC(peerId, initiator) {
  const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  pcs.set(peerId, pc);
  if (localStream) for (const t of localStream.getTracks()) pc.addTrack(t, localStream);
  pc.onicecandidate = (e) => { if (e.candidate) sig({ type: 'ice', to: peerId, candidate: e.candidate }); };
  pc.ontrack = (e) => attachRemoteAudio(peerId, e.streams[0]);
  if (initiator) (async () => { const o = await pc.createOffer({ offerToReceiveAudio: true }); await pc.setLocalDescription(o); sig({ type: 'offer', to: peerId, sdp: pc.localDescription }); })();
  return pc;
}
function attachRemoteAudio(peerId, stream) {
  let el = remoteAudio.get(peerId);
  if (!el) { el = new Audio(); el.muted = true; el.autoplay = true; el.srcObject = stream; el.play().catch(() => {}); remoteAudio.set(peerId, el); }
  if (!audioCtx) return;
  const src = audioCtx.createMediaStreamSource(stream);
  const pan = audioCtx.createPanner(); pan.panningModel = 'HRTF'; pan.distanceModel = 'inverse'; pan.refDistance = 1.5; pan.maxDistance = 20;
  src.connect(pan); pan.connect(audioCtx.destination);
  pcs.get(peerId)._panner = pan; pcs.get(peerId)._slot = peerSlot.get(peerId);
}
function sig(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  // The session cookie rides the WS handshake; the plugin checks channel membership before upgrade.
  ws = new WebSocket(`${proto}://${location.host}${PLUGIN}/api/v1/room/ws?channel=${encodeURIComponent(CHANNEL)}`);
  ws.onopen = () => status('connected'); ws.onclose = () => status('disconnected');
  ws.onmessage = async (ev) => {
    const m = JSON.parse(ev.data);
    if (m.type === 'full') return status('room full (4/4)');
    if (m.type === 'welcome') {
      myId = m.id; localSlot = m.slot; $('#who').textContent = `${m.username || MODELS[localSlot]} · ${MODELS[localSlot]}`;
      for (const p of m.peers) { peerSlot.set(p.id, p.slot); makePC(p.id, true); } renderRoster();
    } else if (m.type === 'peer-join') { peerSlot.set(m.id, m.slot); renderRoster(); }
    else if (m.type === 'peer-leave') {
      const slot = peerSlot.get(m.id); peerSlot.delete(m.id);
      const pc = pcs.get(m.id); if (pc) { pc.close(); pcs.delete(m.id); }
      const el = remoteAudio.get(m.id); if (el) { el.srcObject = null; remoteAudio.delete(m.id); }
      const av = avatars[slot]; if (av && slot !== localSlot) { av.speaking = false; av.mode = 'seated'; av.pos.copy(av.seat); av.setPose(GROUNDED_IDLE); } renderRoster();
    } else if (m.type === 'offer') {
      const pc = pcs.get(m.from) || makePC(m.from, false);
      await pc.setRemoteDescription(m.sdp); const a = await pc.createAnswer(); await pc.setLocalDescription(a); sig({ type: 'answer', to: m.from, sdp: pc.localDescription });
    } else if (m.type === 'answer') { const pc = pcs.get(m.from); if (pc) await pc.setRemoteDescription(m.sdp); }
    else if (m.type === 'ice') { const pc = pcs.get(m.from); if (pc) try { await pc.addIceCandidate(m.candidate); } catch {} }
    else if (m.type === 'state') {                          // remotes mirror the owner's broadcast
      const av = avatars[m.slot]; if (!av || m.slot === localSlot) return;
      av.netPos = new THREE.Vector3(m.x, 0, m.z); av.yaw = m.yaw; av.speaking = m.speaking; av.level = m.level;
      if (m.pose) av.setPose(m.pose);
    } else if (m.type === 'agent-speak') {                  // a bot is speaking its Qwen TTS clip
      onAgentSpeak(m);
    }
  };
}
function renderRoster() {
  const occ = new Set([localSlot, ...peerSlot.values()]);
  $('#roster').innerHTML = MODELS.map((name, slot) => {
    const live = occ.has(slot), me = slot === localSlot, av = avatars[slot];
    return `<div class="row ${live ? 'live' : ''} ${av && av.speaking ? 'speaking' : ''}"><span class="dot"></span>${name}${me ? ' (you)' : ''}${live ? '' : ' · empty'}</div>`;
  }).join('');
}

let talking = false;
$('#talk').addEventListener('click', async () => {
  await initAudio(); if (audioCtx.state === 'suspended') audioCtx.resume();
  talking = !talking; $('#talk').classList.toggle('on', talking);
  $('#talk').textContent = talking ? 'talking — click to stop' : 'push to talk';
  if (localStream) for (const t of localStream.getAudioTracks()) t.enabled = talking;
  const me = avatars[localSlot]; if (me) setSpeaking(me, talking);
});

let lastSent = 0;
function broadcastState(t) {
  const me = avatars[localSlot]; if (!me || localSlot < 0 || t - lastSent < 100) return; lastSent = t;
  sig({ type: 'state', slot: localSlot, x: me.pos.x, z: me.pos.z, yaw: me.yaw, speaking: me.speaking, level: me.level, pose: me.poseName });
}
function updateListener() {
  if (!audioCtx) return; const L = audioCtx.listener, p = camera.position, fwd = new THREE.Vector3(); camera.getWorldDirection(fwd);
  if (L.positionX) { L.positionX.value = p.x; L.positionY.value = p.y; L.positionZ.value = p.z; L.forwardX.value = fwd.x; L.forwardY.value = fwd.y; L.forwardZ.value = fwd.z; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
  else { L.setPosition(p.x, p.y, p.z); L.setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0); }
}

// ── main loop ────────────────────────────────────────────────────────────────
window.__room = { avatars, camera, controls, scene, get slot() { return localSlot; } };
const clock = new THREE.Clock(), bw = new THREE.Vector3();
function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05), t = performance.now();
  controls.update();
  const me = avatars[localSlot];
  if (me && talking) me.level = Math.max(0.15, micLevel());

  for (const av of avatars) {
    if (!av) continue;
    if (av.slot === localSlot) {
      // LOCAL state machine: walk to podium → spin → walk back → sit
      if (av.mode === 'to_podium' || av.mode === 'to_seat') {
        const to = new THREE.Vector3(av.target.x - av.pos.x, 0, av.target.z - av.pos.z), d = to.length();
        if (d < 0.06) {
          av.pos.copy(av.target);
          if (av.mode === 'to_podium') { av.mode = 'spinning'; av.setPose(UPRIGHT_IDLE); }
          else { av.mode = 'seated'; av.setPose(GROUNDED_IDLE); }
        } else { to.normalize(); av.pos.addScaledVector(to, Math.min(SPEED * dt, d)); av.yaw = Math.atan2(to.x, to.z); av.setPose(WALK); }
      } else if (av.mode === 'spinning') {
        av.yaw += SPIN_SPEED * dt; av.setPose(UPRIGHT_IDLE);
      }
    } else if (av.isAgent) {
      if (av.speaking) av.yaw += SPIN_SPEED * dt * 0.5;     // agents spin in place while talking
    } else if (av.netPos) {
      av.pos.lerp(av.netPos, Math.min(1, dt * 8));
    }
    av.mixer.update(dt);
    av.vrm.update(dt);
    // GROUND: plant lowest posed contact bone on the surface (floor 0 / stage top)
    let lowest = Infinity;
    for (const { bone, clr } of av.contactBones) { const y = bone.getWorldPosition(bw).y - clr * av.bodyH; if (y < lowest) lowest = y; }
    const surf = surfaceYAt(av.pos.x, av.pos.z);
    if (isFinite(lowest)) { const target = av.sceneY + surf - lowest; av.sceneY += (target - av.sceneY) * Math.min(1, dt * 10); }
    av.vrm.scene.position.set(av.pos.x, av.sceneY, av.pos.z);
    if (av.ring) av.ring.position.set(av.pos.x, av.sceneY + 0.03, av.pos.z);
    let dRot = (av.yaw + av.facing) - av.vrm.scene.rotation.y; dRot = Math.atan2(Math.sin(dRot), Math.cos(dRot));
    av.vrm.scene.rotation.y += dRot * Math.min(1, dt * 10);
    // lip-sync + spotlight
    av.mouth += (((av.speaking ? av.level : 0)) - av.mouth) * Math.min(1, dt * 16);
    const em = av.vrm.expressionManager; if (em && em.getExpression('aa')) em.setValue('aa', av.mouth);
    av.spot.intensity += ((av.speaking ? 40 : 0) - av.spot.intensity) * Math.min(1, dt * 6);
    av.spot.position.set(av.pos.x, 6, av.pos.z); av.spot.target.position.set(av.pos.x, 0, av.pos.z);
    for (const pc of pcs.values()) if (pc._panner && pc._slot === av.slot) { const pn = pc._panner; if (pn.positionX) { pn.positionX.value = av.pos.x; pn.positionY.value = 1.2; pn.positionZ.value = av.pos.z; } else pn.setPosition(av.pos.x, 1.2, av.pos.z); }
  }
  if (stageGlow) stageGlow.material.emissiveIntensity = 1.0 + Math.sin(t * 0.003) * 0.4;
  updateListener(); broadcastState(t);
  if (t % 250 < 17) renderRoster();
  renderer.render(scene, camera);
}

addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

(async () => {
  status('loading avatars…');
  for (let s = 0; s < MODELS.length; s++) avatars[s] = await makeAvatar(s);
  status('getting mic…'); await initAudio();
  status('connecting…'); connect(); tick();
})().catch((e) => { status('ERR ' + e.message); console.error(e); });
