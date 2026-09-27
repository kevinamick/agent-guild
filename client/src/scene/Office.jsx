import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { ROOM, PODS, DESKS, BOARDS, DOOR, MEZZ, STAIRS, WALL_HEIGHT, BOSS_DESK } from '../../../shared/layout.js';
import { view } from './view.js';
import { Pictures } from './Pictures.jsx';
import { useGame } from '../net.js';
import { Tv } from './Tv.jsx';

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
      <mesh position={[0, WALL_HEIGHT / 2, ROOM.minZ - 0.15]} receiveShadow>
        <boxGeometry args={[W + 0.6, WALL_HEIGHT, 0.3]} />
        <meshStandardMaterial color="#f5ead7" />
      </mesh>
      <mesh position={[0, 0.2, ROOM.minZ + 0.02]}>
        <boxGeometry args={[W, 0.4, 0.06]} />
        <meshStandardMaterial color="#e8834a" />
      </mesh>
      {/* side walls */}
      {[ROOM.minX - 0.15, ROOM.maxX + 0.15].map((x) => (
        <group key={x}>
          <mesh position={[x, WALL_HEIGHT / 2, 0]} receiveShadow>
            <boxGeometry args={[0.3, WALL_HEIGHT, D + 0.3]} />
            <meshStandardMaterial color="#efe2cc" />
          </mesh>
          <mesh position={[x + (x < 0 ? 0.17 : -0.17), 0.2, 0]}>
            <boxGeometry args={[0.06, 0.4, D]} />
            <meshStandardMaterial color="#e8834a" />
          </mesh>
        </group>
      ))}
      {/* windows */}
      {[-15, -10.5, 10.5, 15].flatMap((x) => [3.2, 6.9].map((y) => [x, y])).map(([x, y]) => (
        <group key={`${x}-${y}`} position={[x, y, ROOM.minZ + 0.02]}>
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

      <Stairs />
      <Mezzanine />

      <Corkboard board={provider === 'ado' ? { ...BOARDS[0], label: 'Work Items' } : BOARDS[0]} items={openIssues} />
      <Corkboard board={BOARDS[1]} items={openPrs} />
      <GuildHall board={BOARDS[2]} agents={agents} />
      <Pictures />
      <Tv />

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

// ---------------------------------------------------------------- upper floor

function Stairs() {
  const n = 16;
  const run = (STAIRS.z1 - STAIRS.z0) / n;
  const rise = MEZZ.y / n;
  const w = STAIRS.x1 - STAIRS.x0;
  const cx = (STAIRS.x0 + STAIRS.x1) / 2;
  const len = Math.hypot(STAIRS.z1 - STAIRS.z0, MEZZ.y);
  const slope = Math.atan2(MEZZ.y, STAIRS.z1 - STAIRS.z0);
  return (
    <group>
      {Array.from({ length: n }, (_, i) => (
        <mesh key={i} position={[cx, ((i + 1) * rise) / 2, STAIRS.z0 + (i + 0.5) * run]} castShadow receiveShadow>
          <boxGeometry args={[w, (i + 1) * rise, run]} />
          <meshStandardMaterial color={i % 2 ? '#c8894f' : '#d19459'} roughness={0.8} />
        </mesh>
      ))}
      {/* Glass rail on the open side */}
      <mesh position={[STAIRS.x0, MEZZ.y / 2 + 0.55, (STAIRS.z0 + STAIRS.z1) / 2]} rotation={[-slope, 0, 0]}>
        <boxGeometry args={[0.05, 1.1, len]} />
        <meshStandardMaterial color="#bfe3fb" transparent opacity={0.35} />
      </mesh>
      <mesh position={[STAIRS.x0, MEZZ.y / 2 + 1.1, (STAIRS.z0 + STAIRS.z1) / 2]} rotation={[-slope, 0, 0]}>
        <boxGeometry args={[0.1, 0.08, len]} />
        <meshStandardMaterial color="#8a5a2b" />
      </mesh>
      <Html position={[cx, 2.3, STAIRS.z0 - 0.2]} center zIndexRange={[3, 0]} style={{ pointerEvents: 'none' }}>
        <div className="floor-label up">↑ Boss's office</div>
      </Html>
    </group>
  );
}

// Against a side wall, turned to face into the room (and toward the camera).
function Bookshelf({ side }) {
  const colors = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7', '#f97316', '#14b8a6'];
  return (
    <group position={[side * 19.45, MEZZ.y, 12.3]} rotation={[0, side < 0 ? -Math.PI / 2 : Math.PI / 2, 0]}>
      <mesh position={[0, 1.1, 0]} castShadow>
        <boxGeometry args={[2.2, 2.2, 0.8]} />
        <meshStandardMaterial color="#8a5a2b" />
      </mesh>
      {[0.45, 1.15, 1.85].map((y, row) =>
        Array.from({ length: 8 }, (_, i) => (
          <mesh key={`${row}-${i}`} position={[-0.85 + i * 0.24, y, -0.3]}>
            <boxGeometry args={[0.18, 0.5 - ((i + row) % 3) * 0.06, 0.4]} />
            <meshStandardMaterial color={colors[(i * 3 + row) % colors.length]} />
          </mesh>
        )),
      )}
    </group>
  );
}

function BossOffice() {
  const y = MEZZ.y;
  const desk = BOSS_DESK;
  const cx = (MEZZ.minX + MEZZ.maxX) / 2;
  return (
    <group>
      {/* rug */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx - 0.6, y + 0.012, 11.9]} receiveShadow>
        <planeGeometry args={[7, 3.6]} />
        <meshStandardMaterial color="#7c3aed" roughness={1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[desk.x, y + 0.014, desk.z + 0.5]}>
        <ringGeometry args={[1.5, 1.65, 40]} />
        <meshStandardMaterial color="#fde68a" />
      </mesh>
      {/* the boss's desk, facing out over the floor */}
      <group position={[desk.x, y, desk.z]}>
        <mesh position={[0, 0.82, 0]} castShadow receiveShadow>
          <boxGeometry args={[desk.w, 0.1, desk.d]} />
          <meshStandardMaterial color="#5b3a1e" roughness={0.4} />
        </mesh>
        <mesh position={[0, 0.4, -desk.d / 2 + 0.05]} castShadow>
          <boxGeometry args={[desk.w, 0.8, 0.08]} />
          <meshStandardMaterial color="#4a2f18" />
        </mesh>
        {[-1, 1].map((sd) => (
          <mesh key={sd} position={[sd * (desk.w / 2 - 0.05), 0.4, 0]} castShadow>
            <boxGeometry args={[0.1, 0.8, desk.d]} />
            <meshStandardMaterial color="#4a2f18" />
          </mesh>
        ))}
        {[-0.55, 0.55].map((mx) => (
          <group key={mx} position={[mx, 0.87, -0.2]} rotation={[0, mx < 0 ? 0.18 : -0.18, 0]}>
            <mesh position={[0, 0.35, 0]}>
              <boxGeometry args={[0.9, 0.55, 0.05]} />
              <meshStandardMaterial color="#1f2937" />
            </mesh>
            <mesh position={[0, 0.35, 0.03]}>
              <planeGeometry args={[0.82, 0.47]} />
              <meshStandardMaterial color="#0f172a" emissive="#60a5fa" emissiveIntensity={0.35} />
            </mesh>
            <mesh position={[0, 0.05, 0]}>
              <boxGeometry args={[0.08, 0.12, 0.08]} />
              <meshStandardMaterial color="#334155" />
            </mesh>
          </group>
        ))}
        <mesh position={[0.95, 0.93, 0.25]}>
          <cylinderGeometry args={[0.07, 0.06, 0.14, 12]} />
          <meshStandardMaterial color="#fde68a" />
        </mesh>
      </group>
      {/* executive chair behind the desk */}
      <group position={[desk.x, y, desk.z + 1.2]}>
        <mesh position={[0, 0.55, 0]} castShadow>
          <boxGeometry args={[0.75, 0.14, 0.7]} />
          <meshStandardMaterial color="#111827" />
        </mesh>
        <mesh position={[0, 1.15, 0.32]} castShadow>
          <boxGeometry args={[0.75, 1.1, 0.14]} />
          <meshStandardMaterial color="#111827" />
        </mesh>
        <mesh position={[0, 0.25, 0]}>
          <cylinderGeometry args={[0.05, 0.05, 0.45, 8]} />
          <meshStandardMaterial color="#6b7280" />
        </mesh>
      </group>
      <Bookshelf side={1} />
      <Plant position={[MEZZ.minX + 0.6, y, MEZZ.z1 - 0.6]} scale={1.2} />
      <Plant position={[MEZZ.minX + 0.6, y, MEZZ.z0 + 0.6]} />
      <Html position={[desk.x, y + 1.9, desk.z - 0.7]} center zIndexRange={[3, 0]} style={{ pointerEvents: 'none' }}>
        <div className="boss-plate">🏢 Boss's office</div>
      </Html>
    </group>
  );
}

function GlassRail({ from, to }) {
  // A glass pane from `from` to `to` (both [x, z]) at the upper floor's level.
  const [x0, z0] = from;
  const [x1, z1] = to;
  const len = Math.hypot(x1 - x0, z1 - z0);
  const ry = Math.atan2(x1 - x0, z1 - z0) - Math.PI / 2;
  return (
    <group position={[(x0 + x1) / 2, MEZZ.y, (z0 + z1) / 2]} rotation={[0, ry, 0]}>
      <mesh position={[0, 0.55, 0]}>
        <boxGeometry args={[len, 1.1, 0.05]} />
        <meshStandardMaterial color="#bfe3fb" transparent opacity={0.3} depthWrite={false} />
      </mesh>
      <mesh position={[0, 1.12, 0]}>
        <boxGeometry args={[len, 0.08, 0.12]} />
        <meshStandardMaterial color="#8a5a2b" />
      </mesh>
      {/* edge of the slab, so the cantilever reads as solid without posts */}
      <mesh position={[0, -0.22, 0]}>
        <boxGeometry args={[len, 0.44, 0.16]} />
        <meshStandardMaterial color="#e8834a" />
      </mesh>
    </group>
  );
}

function Mezzanine() {
  const group = useRef();
  const ghost = useRef();
  const w = MEZZ.maxX - MEZZ.minX;
  const d = MEZZ.z1 - MEZZ.z0;
  const cx = (MEZZ.minX + MEZZ.maxX) / 2;
  const cz = (MEZZ.z0 + MEZZ.z1) / 2;
  useFrame(({ camera }) => {
    // Downstairs, the office would sit between the camera and the floor, so it's
    // hidden (like cutaway views in building games); a faint outline stays while
    // the camera isn't right above it.
    if (group.current) group.current.visible = view.upstairs;
    if (ghost.current) ghost.current.visible = !view.upstairs && !(camera.position.z > MEZZ.z0 && camera.position.x > MEZZ.minX - 2);
  });
  return (
    <>
      <mesh ref={ghost} position={[cx, MEZZ.y - 0.15, cz]}>
        <boxGeometry args={[w, 0.3, d]} />
        <meshBasicMaterial color="#c9b79c" transparent opacity={0.18} depthWrite={false} />
      </mesh>
      <group ref={group} visible={false}>
        <mesh position={[cx, MEZZ.y - 0.15, cz]} castShadow receiveShadow>
          <boxGeometry args={[w, 0.3, d]} />
          <meshStandardMaterial color="#e9d9bf" roughness={0.9} />
        </mesh>
        {/* glass on the two open sides; the stairs come up through the gap */}
        <GlassRail from={[MEZZ.minX, MEZZ.z0]} to={[STAIRS.x0, MEZZ.z0]} />
        <GlassRail from={[MEZZ.minX, MEZZ.z0]} to={[MEZZ.minX, MEZZ.z1]} />
        <BossOffice />
      </group>
    </>
  );
}
