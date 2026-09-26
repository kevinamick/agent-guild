import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { Office } from './Office.jsx';
import { Person, Bot } from './Characters.jsx';
import { useGame, positions, localPlayer, sendMove } from '../net.js';
import { ROOM, OBSTACLES, DESKS, BOARDS, DOOR, deskById } from '../../../shared/layout.js';
import { SKILL_INFO } from '../../../shared/progression.js';

export const keys = new Set();
const SPEED = 5.5;
const RADIUS = 0.35;
const CAM_OFFSET = new THREE.Vector3(0, 5.6, 8.2);
const LOOK_AHEAD = 5;

function blocked(x, z) {
  if (x < ROOM.minX + RADIUS || x > ROOM.maxX - RADIUS || z < ROOM.minZ + 0.6 || z > ROOM.maxZ - RADIUS) return true;
  return OBSTACLES.some((o) => x > o.minX - RADIUS && x < o.maxX + RADIUS && z > o.minZ - RADIUS && z < o.maxZ + RADIUS);
}

function findFocus(x, z) {
  const { agents, desks } = useGame.getState();
  let best = null;
  let bestD = Infinity;
  const consider = (d, focus) => {
    if (d < bestD) {
      bestD = d;
      best = focus;
    }
  };
  for (const desk of DESKS) {
    const d = Math.hypot(desk.seatX - x, desk.seatZ - z);
    if (d > 1.9) continue;
    const agentId = desks[desk.id];
    if (agentId && agents[agentId]) consider(d, { type: 'agent', agentId, deskId: desk.id });
    else if (d < 1.5) consider(d + 0.2, { type: 'desk', deskId: desk.id });
  }
  for (const b of BOARDS) {
    const d = b.side ? Math.hypot(b.x - x, (b.z - z) * 0.45) : Math.hypot((b.x - x) * 0.45, b.z - z);
    if (d < 2.6) consider(d, { type: 'board', board: b.id });
  }
  return best;
}

function sameFocus(a, b) {
  return a?.type === b?.type && a?.agentId === b?.agentId && a?.deskId === b?.deskId && a?.board === b?.board;
}

function LocalPlayer() {
  const group = useRef();
  const moving = useRef(false);
  const { camera } = useThree();
  const me = useGame((s) => s.players.find((p) => p.id === s.me));
  const bubble = useBubble(me?.id);
  const target = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    camera.position.set(localPlayer.x + CAM_OFFSET.x, CAM_OFFSET.y, localPlayer.z + CAM_OFFSET.z);
  }, [camera]);

  useFrame((_, dt) => {
    dt = Math.min(dt, 0.05);
    let dx = 0;
    let dz = 0;
    if (keys.has('w') || keys.has('arrowup')) dz -= 1;
    if (keys.has('s') || keys.has('arrowdown')) dz += 1;
    if (keys.has('a') || keys.has('arrowleft')) dx -= 1;
    if (keys.has('d') || keys.has('arrowright')) dx += 1;
    moving.current = dx !== 0 || dz !== 0;
    if (moving.current) {
      const len = Math.hypot(dx, dz);
      const step = (SPEED * dt) / len;
      const nx = localPlayer.x + dx * step;
      const nz = localPlayer.z + dz * step;
      if (!blocked(nx, localPlayer.z)) localPlayer.x = nx;
      if (!blocked(localPlayer.x, nz)) localPlayer.z = nz;
      const want = Math.atan2(dx, dz);
      let diff = want - localPlayer.ry;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      localPlayer.ry += diff * Math.min(1, dt * 14);
      sendMove(localPlayer.x, localPlayer.z, localPlayer.ry);
      const focus = findFocus(localPlayer.x, localPlayer.z);
      if (!sameFocus(focus, useGame.getState().focus)) useGame.setState({ focus });
    }
    group.current.position.set(localPlayer.x, 0, localPlayer.z);
    group.current.rotation.y = localPlayer.ry;
    target.set(localPlayer.x + CAM_OFFSET.x, CAM_OFFSET.y, localPlayer.z + CAM_OFFSET.z);
    camera.position.lerp(target, Math.min(1, dt * 6));
    camera.lookAt(camera.position.x, 1.2, camera.position.z - CAM_OFFSET.z - LOOK_AHEAD);
  });

  // Focus can also change when the world changes around a standing player.
  const agents = useGame((s) => s.agents);
  const desks = useGame((s) => s.desks);
  useEffect(() => {
    const focus = findFocus(localPlayer.x, localPlayer.z);
    if (!sameFocus(focus, useGame.getState().focus)) useGame.setState({ focus });
  }, [agents, desks]);

  return (
    <group ref={group}>
      <Person name={me?.name || ''} avatar={me?.avatar} moving={moving} bubble={bubble} isMe />
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
    g.z += (p.z - g.z) * k;
    let diff = p.ry - group.current.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    group.current.rotation.y += diff * k;
  });
  const start = positions.get(player.id) || player;
  return (
    <group ref={group} position={[start.x, 0, start.z]}>
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
      <Effects />
    </Canvas>
  );
}
