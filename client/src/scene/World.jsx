import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { Office } from './Office.jsx';
import { view } from './view.js';
import { Person, Bot } from './Characters.jsx';
import { useGame, positions, localPlayer, sendMove } from '../net.js';
import { DESKS, BOARDS, DOOR, deskById, step, BOSS_DESK, PICTURE_SPOTS, MEZZ, TV } from '../../../shared/layout.js';
import { SKILL_INFO } from '../../../shared/progression.js';
import { tvReach } from '../../../shared/tv.js';
import { useCameraMode, look as fpView } from './cameraMode.js';
import { EYE_HEIGHT, moveVector, pickTarget, wrapAngle, ease } from './firstPerson.js';
import { LookControls } from './LookControls.jsx';

export const keys = new Set();
const SPEED = 5.5;
const CAM_OFFSET = new THREE.Vector3(0, 5.6, 8.2);
const LOOK_AHEAD = 5;
// Upstairs the camera rises into the corner and looks diagonally across the
// whole lower level, a little wider (kept inside the right wall so it can't clip it).
const CAM_OFFSET_UP = new THREE.Vector3(3.5, 7.4, 7.2);
const CAM_MAX_X_UP = 19.3;
const LOOK_UP = { dx: -10, y: 0.3, dz: -13 };
const FOV = 55;
const FOV_UP = 62;
const FOV_FP = 70;
const BLEND_TIME = 0.7; // seconds for the camera to glide between third and first person
const UP = new THREE.Vector3(0, 1, 0);


function applyStep(nx, nz) {
  const next = step(localPlayer, nx, nz);
  if (next) Object.assign(localPlayer, next);
}

// Everything within reach of (x, z): { focus, d (reach distance), x, y, z (a point
// to aim at), wall? (flat wall items: which way they span and how far) }.
function focusTargets(x, z, level) {
  const out = [];
  if (level === 'stairs') return out;
  if (level === 'mezz') {
    const d = Math.hypot(BOSS_DESK.x - x, (BOSS_DESK.z - z) * 0.8);
    if (d < 2.6) out.push({ focus: { type: 'boss' }, d, x: BOSS_DESK.x, y: MEZZ.y + 0.8, z: BOSS_DESK.z });
    return out;
  }
  const { agents, desks } = useGame.getState();
  for (const desk of DESKS) {
    const d = Math.hypot(desk.seatX - x, desk.seatZ - z);
    if (d > 1.9) continue;
    const agentId = desks[desk.id];
    if (agentId && agents[agentId]) out.push({ focus: { type: 'agent', agentId, deskId: desk.id }, d, x: desk.seatX, y: 1.2, z: desk.seatZ });
    else if (d < 1.5) out.push({ focus: { type: 'desk', deskId: desk.id }, d: d + 0.2, x: desk.x, y: 0.8, z: desk.z });
  }
  for (const b of BOARDS) {
    const d = b.side ? Math.hypot(b.x - x, (b.z - z) * 0.45) : Math.hypot((b.x - x) * 0.45, b.z - z);
    if (d < 2.6) out.push({ focus: { type: 'board', board: b.id }, d, x: b.x, y: 2.6, z: b.z, wall: { axis: b.side ? 'z' : 'x', half: b.side ? 2.7 : 3.2, halfH: 1.6 } });
  }
  for (const s of PICTURE_SPOTS) {
    if (Math.abs(s.x - x) > 2.6 || Math.abs(s.z - z) > 1.3) continue;
    out.push({ focus: { type: 'picture', spot: s.id }, d: Math.hypot((s.x - x) * 0.5, s.z - z), x: s.x, y: s.y, z: s.z, wall: { axis: 'z', half: 1.1, halfH: 0.8 } });
  }
  const tv = tvReach(x, z);
  if (tv !== null) out.push({ focus: { type: 'tv' }, d: tv, x: TV.x, y: TV.y, z: TV.z, wall: { axis: 'z', half: TV.w / 2, halfH: TV.h / 2 } });
  return out;
}

// Third person: the nearest thing in reach.
function findFocus(x, z, level) {
  let best = null;
  for (const t of focusTargets(x, z, level)) if (!best || t.d < best.d) best = t;
  return best ? best.focus : null;
}

// First person prefers what you're looking at (see pickTarget).
function updateFocus() {
  const { x, y, z, level } = localPlayer;
  let focus;
  let aimed = false;
  if (useCameraMode.getState().firstPerson) ({ focus, aimed } = pickTarget(focusTargets(x, z, level), { x, y: y + EYE_HEIGHT, z }, fpView.yaw, fpView.pitch));
  else focus = findFocus(x, z, level);
  if (!sameFocus(focus, useGame.getState().focus)) useGame.setState({ focus });
  if (aimed !== useCameraMode.getState().aimed) useCameraMode.setState({ aimed });
}

// Third person: keys walk in screen (world) directions and you turn to face the way you go.
function thirdPersonStep(dt) {
  let dx = 0;
  let dz = 0;
  if (keys.has('w') || keys.has('arrowup')) dz -= 1;
  if (keys.has('s') || keys.has('arrowdown')) dz += 1;
  if (keys.has('a') || keys.has('arrowleft')) dx -= 1;
  if (keys.has('d') || keys.has('arrowright')) dx += 1;
  if (dx === 0 && dz === 0) return false;
  const len = Math.hypot(dx, dz);
  const stride = (SPEED * dt) / len;
  applyStep(localPlayer.x + dx * stride, localPlayer.z);
  applyStep(localPlayer.x, localPlayer.z + dz * stride);
  const want = Math.atan2(dx, dz);
  let diff = want - localPlayer.ry;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  localPlayer.ry += diff * Math.min(1, dt * 14);
  sendMove(localPlayer.x, localPlayer.y, localPlayer.z, localPlayer.ry);
  updateFocus();
  return true;
}

// First person: the mouse turns you and WASD walks relative to where you look.
// Returns whether you're walking.
const sent = { x: 0, z: 0, ry: 0, at: 0 };
function firstPersonStep(dt) {
  const k = Math.min(1, dt * 20);
  fpView.yaw += (fpView.wantYaw - fpView.yaw) * k;
  fpView.pitch += (fpView.wantPitch - fpView.pitch) * k;
  localPlayer.ry = wrapAngle(fpView.yaw);
  const mv = moveVector(fpView.yaw, keys);
  if (mv) {
    const stride = SPEED * dt;
    applyStep(localPlayer.x + mv.dx * stride, localPlayer.z);
    applyStep(localPlayer.x, localPlayer.z + mv.dz * stride);
  }
  // Turning in place is news too (others see you face things), at the usual move rate.
  const p = localPlayer;
  const now = performance.now();
  if (now - sent.at > 80 && (p.x !== sent.x || p.z !== sent.z || Math.abs(wrapAngle(p.ry - sent.ry)) > 0.01)) {
    sendMove(p.x, p.y, p.z, p.ry);
    Object.assign(sent, { x: p.x, z: p.z, ry: p.ry, at: now });
  }
  updateFocus();
  return Boolean(mv);
}

function sameFocus(a, b) {
  return a?.type === b?.type && a?.agentId === b?.agentId && a?.deskId === b?.deskId && a?.board === b?.board && a?.spot === b?.spot;
}

function LocalPlayer() {
  const group = useRef();
  const moving = useRef(false);
  const { camera } = useThree();
  const me = useGame((s) => s.players.find((p) => p.id === s.me));
  const bubble = useBubble(me?.id);
  const target = useMemo(() => new THREE.Vector3(), []);
  const firstPerson = useCameraMode((s) => s.firstPerson);

  const look = useMemo(() => new THREE.Vector3(), []);
  const wantLook = useMemo(() => new THREE.Vector3(), []);
  // The third-person camera keeps following in first person too (unseen), so
  // switching back glides from the eye to where it belongs.
  const tpPos = useMemo(() => new THREE.Vector3(), []);
  const eye = useMemo(() => new THREE.Vector3(), []);
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), fq: new THREE.Quaternion(), e: new THREE.Euler(0, 0, 0, 'YXZ') }), []);
  useEffect(() => {
    tpPos.set(localPlayer.x + CAM_OFFSET.x, CAM_OFFSET.y, localPlayer.z + CAM_OFFSET.z);
    camera.position.copy(tpPos);
    look.set(localPlayer.x, 1.2, localPlayer.z - LOOK_AHEAD);
    fpView.blend = useCameraMode.getState().firstPerson ? 1 : 0;
  }, [camera]);

  useFrame((_, dt) => {
    dt = Math.min(dt, 0.05);
    const fp = useCameraMode.getState().firstPerson;
    moving.current = fp ? firstPersonStep(dt) : thirdPersonStep(dt);
    // The upper floor appears once you start up the stairs.
    const upstairs = localPlayer.level !== 'ground';
    if (upstairs !== view.upstairs) {
      view.upstairs = upstairs;
      // Page overlays (desk markers, signs) can't be hidden by 3D geometry, so CSS does it.
      document.body.dataset.upstairs = upstairs ? '1' : '';
    }
    group.current.position.set(localPlayer.x, localPlayer.y, localPlayer.z);
    group.current.rotation.y = localPlayer.ry;
    const up = localPlayer.level === 'mezz';
    const off = up ? CAM_OFFSET_UP : CAM_OFFSET;
    target.set(localPlayer.x + off.x, localPlayer.y + off.y, localPlayer.z + off.z);
    if (up) target.x = Math.min(target.x, CAM_MAX_X_UP);
    tpPos.lerp(target, Math.min(1, dt * 5));
    if (up) wantLook.set(localPlayer.x + LOOK_UP.dx, LOOK_UP.y, localPlayer.z + LOOK_UP.dz);
    else wantLook.set(localPlayer.x, localPlayer.y + 1.2, localPlayer.z - LOOK_AHEAD);
    look.lerp(wantLook, Math.min(1, dt * 5));
    // Glide between the follow camera and the eye: position lerps, rotation slerps
    // (lerping look-at points could swing through the camera and flip the view).
    fpView.blend = Math.min(1, Math.max(0, fpView.blend + (fp ? dt : -dt) / BLEND_TIME));
    const b = ease(fpView.blend);
    eye.set(localPlayer.x, localPlayer.y + EYE_HEIGHT, localPlayer.z);
    if (b === 0) {
      camera.position.copy(tpPos);
      camera.lookAt(look);
    } else {
      camera.position.lerpVectors(tpPos, eye, b);
      tmp.q.setFromRotationMatrix(tmp.m.lookAt(tpPos, look, UP));
      tmp.fq.setFromEuler(tmp.e.set(fpView.pitch, fpView.yaw + Math.PI, 0));
      camera.quaternion.slerpQuaternions(tmp.q, tmp.fq, b);
    }
    // Your own head would fill the view; everyone else stays visible.
    group.current.visible = camera.position.distanceTo(eye) > 0.9;
    const fov = fp ? FOV_FP : up ? FOV_UP : FOV;
    if (Math.abs(camera.fov - fov) > 0.05) {
      camera.fov += (fov - camera.fov) * Math.min(1, dt * 4);
      camera.updateProjectionMatrix();
    }
  });

  // Focus can also change when the world changes around a standing player.
  const agents = useGame((s) => s.agents);
  const desks = useGame((s) => s.desks);
  useEffect(updateFocus, [agents, desks, firstPerson]);

  return (
    <group ref={group}>
      {/* in first person your own speech bubble would hang just above the eye */}
      <Person name={firstPerson ? undefined : me?.name || ''} avatar={me?.avatar} moving={moving} bubble={bubble} isMe />
    </group>
  );
}

function useBubble(playerId) {
  const bubble = useGame((s) => s.bubbles[playerId]);
  const [, rerender] = useState(0);
  useEffect(() => {
    if (!bubble) return;
    const t = setTimeout(() => rerender((n) => n + 1), 6100);
    return () => clearTimeout(t);
  }, [bubble]);
  return bubble && Date.now() - bubble.at < 6000 ? bubble.text : null;
}

function RemotePlayer({ player }) {
  const group = useRef();
  const moving = useRef(false);
  const bubble = useBubble(player.id);
  useFrame((_, dt) => {
    const p = positions.get(player.id);
    if (!p || !group.current) return;
    const g = group.current.position;
    const dist = Math.hypot(p.x - g.x, p.z - g.z);
    moving.current = dist > 0.02;
    const k = Math.min(1, dt * 10);
    g.x += (p.x - g.x) * k;
    g.y += ((p.y || 0) - g.y) * k;
    g.z += (p.z - g.z) * k;
    let diff = p.ry - group.current.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    group.current.rotation.y += diff * k;
  });
  const start = positions.get(player.id) || player;
  return (
    <group ref={group} position={[start.x, start.y || 0, start.z]}>
      <Person name={player.name} avatar={player.avatar} moving={moving} bubble={bubble} />
    </group>
  );
}

function walkPath(desk) {
  const outward = desk.ry === 0 ? -1 : 1;
  const wz = desk.seatZ + outward * 0.9;
  const cx = [-5.5, 5.5, -16.5, 16.5].reduce((a, b) => (Math.abs(b - desk.seatX) < Math.abs(a - desk.seatX) ? b : a));
  return [
    [DOOR.x, DOOR.z],
    [cx, 12],
    [cx, wz],
    [desk.seatX, wz],
    [desk.seatX, desk.seatZ],
  ].map(([x, z]) => new THREE.Vector2(x, z));
}

function AgentAtDesk({ agent, desk }) {
  const group = useRef();
  const fresh = agent.spawnedAt && Date.now() - agent.spawnedAt < 4000;
  const path = useMemo(() => walkPath(desk), [desk]);
  const walk = useRef({ done: !fresh, dist: 0 });
  const [, setSeated] = useState(!fresh);

  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    if (walk.current.done) {
      g.position.set(desk.seatX, 0, desk.seatZ);
      g.rotation.y = desk.ry;
      return;
    }
    walk.current.dist += dt * 3.4;
    let remaining = walk.current.dist;
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i];
      const b = path[i + 1];
      const seg = a.distanceTo(b);
      if (remaining <= seg) {
        const t = remaining / seg;
        g.position.set(a.x + (b.x - a.x) * t, 0, a.y + (b.y - a.y) * t);
        g.rotation.y = Math.atan2(b.x - a.x, b.y - a.y);
        return;
      }
      remaining -= seg;
    }
    walk.current.done = true;
    setSeated(true);
  });

  return (
    <group ref={group} position={fresh ? [DOOR.x, 0, DOOR.z] : [desk.seatX, 0, desk.seatZ]}>
      <Bot agent={agent} seated={walk.current.done} walking={!walk.current.done} />
    </group>
  );
}

function Agents() {
  const agents = useGame((s) => s.agents);
  const desks = useGame((s) => s.desks);
  return Object.entries(desks).map(([deskId, agentId]) => {
    const agent = agents[agentId];
    const desk = deskById(+deskId);
    if (!agent || !desk) return null;
    return <AgentAtDesk key={`${agentId}-${deskId}`} agent={agent} desk={desk} />;
  });
}

function LevelRing({ position, color }) {
  const ref = useRef();
  const start = useRef(performance.now());
  useFrame(() => {
    const t = (performance.now() - start.current) / 1400;
    if (!ref.current) return;
    const s = 0.4 + t * 3;
    ref.current.scale.set(s, s, s);
    ref.current.material.opacity = Math.max(0, 0.9 - t);
  });
  return (
    <mesh ref={ref} position={position} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.8, 1, 48]} />
      <meshBasicMaterial color={color} transparent side={THREE.DoubleSide} />
    </mesh>
  );
}

function Effects() {
  const fx = useGame((s) => s.fx);
  const desks = useGame((s) => s.desks);
  const deskOf = useMemo(() => Object.fromEntries(Object.entries(desks).map(([d, a]) => [a, deskById(+d)])), [desks]);
  return fx.map((f) => {
    const desk = deskOf[f.agentId];
    if (!desk) return null;
    const color = f.skill ? SKILL_INFO[f.skill].color : '#facc15';
    return (
      <group key={f.id} position={[desk.seatX, 0, desk.seatZ]}>
        {f.kind === 'levelup' && <LevelRing position={[0, 0.1, 0]} color={color} />}
        <Html position={[0, 2.9, 0]} center zIndexRange={[30, 0]} style={{ pointerEvents: 'none' }}>
          {f.kind === 'xp' ? (
            <div className="fx-xp" style={{ color }}>+{f.amount} XP</div>
          ) : (
            <div className="fx-levelup">
              <div className="fx-levelup-title">LEVEL UP!</div>
              <div>{f.overall ? `Lv ${f.level}` : `${SKILL_INFO[f.skill].label} ${f.level}`}</div>
            </div>
          )}
        </Html>
      </group>
    );
  });
}

function Players() {
  const players = useGame((s) => s.players);
  const me = useGame((s) => s.me);
  return players.filter((p) => p.id !== me).map((p) => <RemotePlayer key={p.id} player={p} />);
}

export function World() {
  return (
    <Canvas shadows dpr={[1, 2]} camera={{ fov: 55, near: 0.1, far: 200 }} gl={{ antialias: true }}>
      <color attach="background" args={['#f3e9d8']} />
      <hemisphereLight args={['#fffaf0', '#d9c7a8', 0.9]} />
      <ambientLight intensity={0.35} />
      <directionalLight
        position={[8, 18, 10]}
        intensity={1.5}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-24}
        shadow-camera-right={24}
        shadow-camera-top={18}
        shadow-camera-bottom={-18}
        shadow-bias={-0.0005}
      />
      <Office />
      <Agents />
      <Players />
      <LocalPlayer />
      <LookControls />
      <Effects />
    </Canvas>
  );
}
