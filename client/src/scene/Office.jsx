import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { ROOM, PODS, DESKS, BOARDS, DOOR } from '../../../shared/layout.js';
import { useGame } from '../net.js';

const W = ROOM.maxX - ROOM.minX;
const D = ROOM.maxZ - ROOM.minZ;

function usePlankTexture() {
  return useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 512;
    const g = c.getContext('2d');
    const rows = 8;
    for (let r = 0; r < rows; r++) {
      let x = (r % 2) * -128;
      while (x < 512) {
        const len = 180 + ((r * 97 + x) % 140);
        const shade = 238 - ((r * 13 + x) % 18);
        g.fillStyle = `rgb(${shade},${shade - 18},${shade - 58})`;
        g.fillRect(x, r * 64, len, 64);
        g.fillStyle = 'rgba(160,120,60,0.25)';
        g.fillRect(x, r * 64, 2, 64);
        x += len;
      }
      g.fillStyle = 'rgba(160,120,60,0.3)';
      g.fillRect(0, r * 64, 512, 2);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(W / 8, D / 8);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  }, []);
}

function Plant({ position, scale = 1 }) {
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.3, 0]} castShadow>
        <cylinderGeometry args={[0.28, 0.22, 0.6, 16]} />
        <meshStandardMaterial color="#e2553b" roughness={0.8} />
      </mesh>
      {[[0, 0.95, 0, 0.42], [0.2, 1.2, 0.1, 0.32], [-0.18, 1.15, -0.05, 0.3], [0, 1.4, -0.1, 0.26]].map(([x, y, z, r], i) => (
        <mesh key={i} position={[x, y, z]} castShadow>
          <sphereGeometry args={[r, 14, 12]} />
          <meshStandardMaterial color={i % 2 ? '#4ade80' : '#22c55e'} roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

function Chair({ color }) {
  return (
    <group>
      <mesh position={[0, 0.5, 0]} castShadow>
        <boxGeometry args={[0.55, 0.1, 0.55]} />
        <meshStandardMaterial color={color} roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.9, 0.26]} castShadow>
        <boxGeometry args={[0.55, 0.7, 0.1]} />
        <meshStandardMaterial color={color} roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.25, 0]}>
        <cylinderGeometry args={[0.04, 0.04, 0.45, 8]} />
        <meshStandardMaterial color="#334155" />
      </mesh>
      <mesh position={[0, 0.04, 0]}>
        <cylinderGeometry args={[0.28, 0.28, 0.05, 5]} />
        <meshStandardMaterial color="#334155" />
      </mesh>
    </group>
  );
}

function Laptop({ active }) {
  const screen = useRef();
  useFrame(({ clock }) => {
    if (!screen.current) return;
    screen.current.material.emissiveIntensity = active === 'working' ? 0.5 + Math.sin(clock.elapsedTime * 10) * 0.15 : active ? 0.35 : 0.05;
  });
  return (
    <group>
      <mesh position={[0, 0.02, 0]} castShadow>
        <boxGeometry args={[0.7, 0.04, 0.48]} />
        <meshStandardMaterial color="#cbd5e1" metalness={0.4} roughness={0.4} />
      </mesh>
      <group position={[0, 0.02, -0.22]} rotation={[-0.25, 0, 0]}>
        <mesh position={[0, 0.24, 0]} castShadow>
          <boxGeometry args={[0.7, 0.48, 0.03]} />
          <meshStandardMaterial color="#cbd5e1" metalness={0.4} roughness={0.4} />
        </mesh>
        <mesh ref={screen} position={[0, 0.24, 0.017]}>
          <planeGeometry args={[0.64, 0.42]} />
          <meshStandardMaterial color="#0f172a" emissive={active ? '#4ade80' : '#1e293b'} emissiveIntensity={0.2} />
        </mesh>
      </group>
    </group>
  );
}

const CHAIR_COLORS = ['#a78bfa', '#7dd3fc', '#fb923c', '#a3e635', '#f472b6', '#fbbf24'];

function Pod({ pod, occupancy }) {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[pod.x, 0.012, pod.z]} receiveShadow>
        <planeGeometry args={[pod.w, pod.d]} />
        <meshStandardMaterial color={pod.color} roughness={1} />
      </mesh>
      {DESKS.filter((d) => d.pod === pod.id).map((d, i) => {
        const status = occupancy[d.id];
        return (
          <group key={d.id}>
            <group position={[d.x, 0, d.z]}>
              <mesh position={[0, 0.78, 0]} castShadow receiveShadow>
                <boxGeometry args={[1.85, 0.07, 1.05]} />
                <meshStandardMaterial color="#f8fafc" roughness={0.5} />
              </mesh>
              {[[-0.85, -0.45], [0.85, -0.45], [-0.85, 0.45], [0.85, 0.45]].map(([x, z], k) => (
                <mesh key={k} position={[x, 0.38, z]}>
                  <boxGeometry args={[0.06, 0.76, 0.06]} />
                  <meshStandardMaterial color="#94a3b8" />
                </mesh>
              ))}
              <group position={[0, 0.82, d.ry === 0 ? -0.05 : 0.05]} rotation={[0, d.ry === 0 ? Math.PI : 0, 0]}>
                <Laptop active={status} />
              </group>
              {i % 3 === 0 && (
                <mesh position={[0.65, 0.88, 0]} castShadow>
                  <cylinderGeometry args={[0.07, 0.06, 0.14, 12]} />
                  <meshStandardMaterial color="#c4b5fd" />
                </mesh>
              )}
            </group>
            <group position={[d.seatX, 0, d.seatZ]} rotation={[0, d.ry === 0 ? Math.PI : 0, 0]}>
              <Chair color={CHAIR_COLORS[(d.id * 7) % CHAIR_COLORS.length]} />
            </group>
            {!status && (
              <Html position={[d.seatX, 1.5, d.seatZ]} center distanceFactor={14} zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
                <div className="desk-free">+</div>
              </Html>
            )}
          </group>
        );
      })}
    </group>
  );
}

function StickyNote({ item, index, color }) {
  const col = index % 3;
  const row = Math.floor(index / 3);
  return (
    <group position={[-1.9 + col * 1.9, 0.75 - row * 1.35, 0.06]} rotation={[0, 0, ((index * 37) % 7 - 3) * 0.015]}>
      <mesh>
        <planeGeometry args={[1.55, 1.15]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh position={[0, 0.5, 0.03]}>
        <sphereGeometry args={[0.06, 10, 8]} />
        <meshStandardMaterial color="#e11d48" />
      </mesh>
      <Html transform position={[0, 0, 0.01]} scale={0.38} zIndexRange={[4, 0]} style={{ pointerEvents: 'none' }}>
        <div className="note-3d">
          <b>#{item.number}</b>
          <span>{item.title}</span>
        </div>
      </Html>
    </group>
  );
}

function Corkboard({ board, items }) {
  const rot = board.side ? [0, Math.PI / 2, 0] : [0, 0, 0];
  return (
    <group position={[board.x, 2.6, board.z]} rotation={rot}>
      <mesh castShadow>
        <boxGeometry args={[6.4, 3.3, 0.12]} />
        <meshStandardMaterial color="#e8834a" />
      </mesh>
      <mesh position={[0, 0, 0.07]}>
        <planeGeometry args={[6.0, 2.95]} />
        <meshStandardMaterial color="#c9955c" roughness={1} />
      </mesh>
      <Html transform position={[0, 1.95, 0.1]} scale={0.7} zIndexRange={[4, 0]} style={{ pointerEvents: 'none' }}>
        <div className="board-title-3d">{board.label}</div>
      </Html>
      {items.slice(0, 6).map((item, i) => (
        <StickyNote key={item.number} item={item} index={i} color={board.color} />
      ))}
    </group>
  );
}

function GuildHall({ board, agents }) {
  const top = Object.values(agents).sort((a, b) => b.total - a.total).slice(0, 5);
  return (
    <group position={[board.x, 2.6, board.z]} rotation={[0, Math.PI / 2, 0]}>
      <mesh castShadow>
        <boxGeometry args={[5.4, 3.3, 0.12]} />
        <meshStandardMaterial color="#7c3aed" />
      </mesh>
      <mesh position={[0, 0, 0.07]}>
        <planeGeometry args={[5.0, 2.95]} />
        <meshStandardMaterial color="#312e81" roughness={1} />
      </mesh>
      <Html transform position={[0, 0, 0.1]} scale={0.4} zIndexRange={[4, 0]} style={{ pointerEvents: 'none' }}>
        <div className="guild-3d">
          <div className="guild-3d-title">🏆 Guild Hall</div>
          {top.length === 0 && <div className="guild-3d-empty">No agents yet. Hire one at a desk!</div>}
          {top.map((a, i) => (
            <div key={a.id} className="guild-3d-row">
              <span>{['🥇', '🥈', '🥉', '4', '5'][i]}</span>
              <span className="dot" style={{ background: a.color }} />
              <b>{a.name}</b>
              <em>Lv {a.level}</em>
              <small>{a.owner}</small>
            </div>
          ))}
        </div>
      </Html>
    </group>
  );
}

export function Office() {
  const planks = usePlankTexture();
  const agents = useGame((s) => s.agents);
  const desks = useGame((s) => s.desks);
  const boards = useGame((s) => s.boards);
  const occupancy = useMemo(() => {
    const o = {};
    for (const [deskId, agentId] of Object.entries(desks)) o[deskId] = agents[agentId]?.status || 'starting';
    return o;
  }, [desks, agents]);

  const provider = useGame((s) => s.office.provider);
  const openIssues = (boards.issues?.items || []).filter((i) => i.state === 'OPEN');
  const openPrs = (boards.prs?.items || []).filter((p) => p.state === 'OPEN');

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[W, D]} />
        <meshStandardMaterial map={planks} roughness={0.85} />
      </mesh>
      {/* back wall */}
      <mesh position={[0, 2.5, ROOM.minZ - 0.15]} receiveShadow>
        <boxGeometry args={[W + 0.6, 5, 0.3]} />
        <meshStandardMaterial color="#f5ead7" />
      </mesh>
      <mesh position={[0, 0.2, ROOM.minZ + 0.02]}>
        <boxGeometry args={[W, 0.4, 0.06]} />
        <meshStandardMaterial color="#e8834a" />
      </mesh>
      {/* side walls */}
      {[ROOM.minX - 0.15, ROOM.maxX + 0.15].map((x) => (
        <group key={x}>
          <mesh position={[x, 2.5, 0]} receiveShadow>
            <boxGeometry args={[0.3, 5, D + 0.3]} />
            <meshStandardMaterial color="#efe2cc" />
          </mesh>
          <mesh position={[x + (x < 0 ? 0.17 : -0.17), 0.2, 0]}>
            <boxGeometry args={[0.06, 0.4, D]} />
            <meshStandardMaterial color="#e8834a" />
          </mesh>
        </group>
      ))}
      {/* windows */}
      {[-15, -10.5, 10.5, 15].map((x) => (
        <group key={x} position={[x, 3.2, ROOM.minZ + 0.02]}>
          <mesh>
            <planeGeometry args={[2.6, 1.6]} />
            <meshStandardMaterial color="#bfe3fb" emissive="#bfe3fb" emissiveIntensity={0.3} />
          </mesh>
          <mesh position={[0, 0, 0.01]}>
            <planeGeometry args={[0.08, 1.6]} />
            <meshStandardMaterial color="#fff" />
          </mesh>
        </group>
      ))}
      {/* door */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[DOOR.x, 0.015, DOOR.z]}>
        <planeGeometry args={[3, 1]} />
        <meshStandardMaterial color="#d97706" />
      </mesh>
      <Html position={[DOOR.x, 0.2, DOOR.z]} center zIndexRange={[3, 0]} style={{ pointerEvents: 'none' }}>
        <div className="floor-label">entrance</div>
      </Html>

      {PODS.map((pod) => (
        <Pod key={pod.id} pod={pod} occupancy={occupancy} />
      ))}

      <Corkboard board={provider === 'ado' ? { ...BOARDS[0], label: 'Work Items' } : BOARDS[0]} items={openIssues} />
      <Corkboard board={BOARDS[1]} items={openPrs} />
      <GuildHall board={BOARDS[2]} agents={agents} />

      {[[-18.6, -12.6], [18.6, -12.6], [-18.6, 12.4], [18.6, 12.4], [-16.5, 0.3], [16.5, 0.3], [-2.5, -12.9], [2.5, -12.9]].map(([x, z], i) => (
        <Plant key={i} position={[x, 0, z]} scale={i < 4 ? 1.4 : 1} />
      ))}
      {/* water cooler */}
      <group position={[18.8, 0, -3]}>
        <mesh position={[0, 0.55, 0]} castShadow>
          <boxGeometry args={[0.7, 1.1, 0.7]} />
          <meshStandardMaterial color="#e2e8f0" />
        </mesh>
        <mesh position={[0, 1.4, 0]} castShadow>
          <cylinderGeometry args={[0.28, 0.28, 0.6, 16]} />
          <meshStandardMaterial color="#7dd3fc" transparent opacity={0.8} />
        </mesh>
      </group>
    </group>
  );
}
