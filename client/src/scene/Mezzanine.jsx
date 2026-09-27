// The upper floor: floating oak stairs on black steel stringers with a glass
// balustrade, and the boss's corner office behind glass and steel railings (a
// walnut desk on steel legs, an oak herringbone floor, an evergreen rug and open
// shelving). Downstairs the office is hidden, leaving a faint outline.
import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { MEZZ, STAIRS, BOSS_DESK } from '../../../shared/layout.js';
import { view } from './view.js';
import { decorKit, box, merge, rng, PALETTE } from './decor.js';
import { Instanced } from './Instanced.jsx';
import { Plants } from './Plants.jsx';
import { workstationGeometry } from './Workstations.jsx';

export function Stairs() {
  const gl = useThree((s) => s.gl);
  const k = decorKit(gl);
  const n = 16;
  const run = (STAIRS.z1 - STAIRS.z0) / n;
  const rise = MEZZ.y / n;
  const w = STAIRS.x1 - STAIRS.x0;
  const cx = (STAIRS.x0 + STAIRS.x1) / 2;
  const len = Math.hypot(STAIRS.z1 - STAIRS.z0, MEZZ.y);
  const slope = Math.atan2(MEZZ.y, STAIRS.z1 - STAIRS.z0);
  const mid = (STAIRS.z0 + STAIRS.z1) / 2;
  const res = useMemo(
    () => ({
      tread: new THREE.BoxGeometry(w - 0.1, 0.07, run + 0.03),
      treads: Array.from({ length: n }, (_, i) => ({ p: [cx, (i + 1) * rise - 0.035, STAIRS.z0 + (i + 0.5) * run] })),
      stringers: merge([STAIRS.x0 + 0.03, STAIRS.x1 - 0.03].map((x) => box(0.05, 0.32, len, [x, MEZZ.y / 2 - 0.12, mid], [-slope, 0, 0]))),
    }),
    [],
  );
  return (
    <group>
      <Instanced geometry={res.tread} material={k.oak} items={res.treads} castShadow receiveShadow />
      <mesh geometry={res.stringers} material={k.steel} castShadow />
      {/* glass balustrade on the open side, with a steel handrail */}
      <mesh position={[STAIRS.x0, MEZZ.y / 2 + 0.5, mid]} rotation={[-slope, 0, 0]} material={k.glass}>
        <boxGeometry args={[0.03, 1.0, len]} />
      </mesh>
      <mesh position={[STAIRS.x0, MEZZ.y / 2 + 1.05, mid]} rotation={[-slope, 0, 0]} material={k.steel}>
        <boxGeometry args={[0.06, 0.05, len]} />
      </mesh>
      <Html position={[cx, 2.3, STAIRS.z0 - 0.2]} center zIndexRange={[3, 0]} style={{ pointerEvents: 'none' }}>
        <div className="floor-label up">↑ Boss's office</div>
      </Html>
    </group>
  );
}

// Open steel shelving against the right wall, facing into the room.
function Bookshelf({ k }) {
  const res = useMemo(() => {
    const r = rng(5);
    const colors = ['#c0664a', '#2c3a52', '#e5dccb', '#8f9d7c', '#cf9f45', '#20392f', '#34373b', '#f2efe9'];
    const frame = [];
    for (const x of [-1.08, 1.08]) for (const z of [-0.36, 0.36]) frame.push(box(0.04, 2.3, 0.04, [x, 1.15, z]));
    const shelves = merge([0.05, 0.75, 1.45, 2.15].map((y) => box(2.2, 0.04, 0.78, [0, y, 0])));
    const books = [];
    [0.07, 0.77, 1.47].forEach((y) => {
      let x = -1.0;
      while (x < 1.0) {
        if (r() < 0.12) {
          x += 0.3;
          continue;
        }
        const bw = 0.04 + r() * 0.05;
        books.push({ p: [x + bw / 2, y, -0.15], s: [bw, 0.3 + r() * 0.2, 0.34 + r() * 0.12], color: colors[Math.floor(r() * colors.length)] });
        x += bw + 0.005;
      }
    });
    return { frame: merge(frame), shelves, books, book: new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), bookMat: new THREE.MeshStandardMaterial({ color: '#fff', roughness: 0.8 }) };
  }, []);
  return (
    <group position={[19.45, MEZZ.y, 12.3]} rotation={[0, Math.PI / 2, 0]}>
      <mesh geometry={res.frame} material={k.steel} castShadow />
      <mesh geometry={res.shelves} material={k.oak} castShadow receiveShadow />
      <Instanced geometry={res.book} material={res.bookMat} items={res.books} />
    </group>
  );
}

function BossOffice({ k }) {
  const y = MEZZ.y;
  const desk = BOSS_DESK;
  const cx = (MEZZ.minX + MEZZ.maxX) / 2;
  const ws = workstationGeometry();
  const res = useMemo(() => {
    const legs = [];
    for (const sx of [-1, 1]) {
      const x = sx * (desk.w / 2 - 0.15);
      legs.push(box(0.06, 0.8, 0.06, [x, 0.4, -desk.d / 2 + 0.1]), box(0.06, 0.8, 0.06, [x, 0.4, desk.d / 2 - 0.1]), box(0.06, 0.06, desk.d - 0.2, [x, 0.78, 0]), box(0.07, 0.03, desk.d - 0.1, [x, 0.015, 0]));
    }
    const monitors = [];
    const stands = [];
    for (const mx of [-0.55, 0.55]) {
      const ry = mx < 0 ? 0.18 : -0.18;
      const at = (g) => g.rotateY(ry).translate(mx, 0.87, -0.2);
      monitors.push(at(new THREE.BoxGeometry(0.92, 0.56, 0.035).translate(0, 0.4, 0)));
      stands.push(at(new THREE.BoxGeometry(0.05, 0.3, 0.04).translate(0, 0.15, -0.04)), at(new THREE.BoxGeometry(0.26, 0.015, 0.2).translate(0, 0.008, -0.02)));
    }
    const screens = [-0.55, 0.55].map((mx) => new THREE.PlaneGeometry(0.86, 0.5).translate(0, 0.4, 0.019).rotateY(mx < 0 ? 0.18 : -0.18).translate(mx, 0.87, -0.2));
    const floorTex = k.tex.herringbone.clone();
    floorTex.repeat.set((MEZZ.maxX - MEZZ.minX) / 2.7, (MEZZ.z1 - MEZZ.z0) / 2.8);
    floorTex.needsUpdate = true;
    return {
      legs: merge(legs),
      monitors: merge(monitors),
      stands: merge(stands),
      screens: merge(screens),
      screen: new THREE.MeshStandardMaterial({ color: '#0d1420', emissive: '#6aa7ff', emissiveIntensity: 0.3, roughness: 0.2 }),
      floor: new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.55 }),
      rug: new THREE.MeshStandardMaterial({ color: PALETTE.evergreen, map: k.tex.weave, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
      rugEdge: new THREE.MeshStandardMaterial({ color: PALETTE.oat, roughness: 1, polygonOffset: true, polygonOffsetFactor: -0.5, polygonOffsetUnits: -0.5 }),
      leather: new THREE.MeshStandardMaterial({ color: '#1b1b1d', roughness: 0.45 }),
      chair: [{ p: [desk.x, y, desk.z + 1.2], r: 0, s: 1.15 }],
      plants: [
        { kind: 'fig', x: MEZZ.minX + 0.6, y, z: MEZZ.z1 - 0.6, s: 1.05 },
        { kind: 'snake', x: MEZZ.minX + 0.6, y, z: MEZZ.z0 + 0.6, s: 1 },
        { kind: 'pothos', x: 19.3, y: y + 2.35, z: 12.9, s: 0.75 },
      ],
    };
  }, [k]);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, y + 0.001, (MEZZ.z0 + MEZZ.z1) / 2]} material={res.floor} receiveShadow>
        <planeGeometry args={[MEZZ.maxX - MEZZ.minX, MEZZ.z1 - MEZZ.z0]} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx - 0.6, y + 0.01, 11.9]} material={res.rugEdge} receiveShadow>
        <planeGeometry args={[6.2, 3.2]} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx - 0.6, y + 0.012, 11.9]} material={res.rug} receiveShadow>
        <planeGeometry args={[6.0, 3.0]} />
      </mesh>
      {/* the boss's desk, facing out over the floor */}
      <group position={[desk.x, y, desk.z]}>
        <mesh position={[0, 0.83, 0]} material={k.walnut} castShadow receiveShadow>
          <boxGeometry args={[desk.w, 0.07, desk.d]} />
        </mesh>
        <mesh geometry={res.legs} material={k.steel} castShadow />
        <mesh position={[0, 0.5, -desk.d / 2 + 0.12]} material={k.steel}>
          <boxGeometry args={[desk.w - 0.4, 0.5, 0.02]} />
        </mesh>
        <mesh geometry={res.monitors} material={k.steel} castShadow />
        <mesh geometry={res.stands} material={k.steel} />
        <mesh geometry={res.screens} material={res.screen} />
        <mesh position={[0.95, 0.93, 0.25]} material={k.deskTop}>
          <cylinderGeometry args={[0.07, 0.06, 0.14, 12]} />
        </mesh>
      </group>
      {/* executive chair behind the desk */}
      <Instanced geometry={ws.chairFrame} material={k.chrome} items={res.chair} castShadow />
      <Instanced geometry={ws.chairSeat} material={res.leather} items={res.chair} castShadow />
      <Instanced geometry={ws.chairBack} material={res.leather} items={res.chair} />
      <Bookshelf k={k} />
      <Plants items={res.plants} />
      <Html position={[desk.x, y + 1.9, desk.z - 0.7]} center zIndexRange={[3, 0]} style={{ pointerEvents: 'none' }}>
        <div className="boss-plate">🏢 Boss's office</div>
      </Html>
    </group>
  );
}

// A glass railing from `from` to `to` (both [x, z]) at the upper floor's level:
// steel posts and cap, and the slab's black steel edge below.
function GlassRail({ from, to, k }) {
  const [x0, z0] = from;
  const [x1, z1] = to;
  const len = Math.hypot(x1 - x0, z1 - z0);
  const ry = Math.atan2(x1 - x0, z1 - z0) - Math.PI / 2;
  const posts = useMemo(() => {
    const n = Math.max(1, Math.round(len / 1.5));
    return merge(Array.from({ length: n + 1 }, (_, i) => box(0.05, 1.1, 0.05, [-len / 2 + (len * i) / n, 0.55, 0])));
  }, [len]);
  return (
    <group position={[(x0 + x1) / 2, MEZZ.y, (z0 + z1) / 2]} rotation={[0, ry, 0]}>
      <mesh position={[0, 0.55, 0]} material={k.glass}>
        <boxGeometry args={[len, 1.0, 0.03]} />
      </mesh>
      <mesh geometry={posts} material={k.steel} />
      <mesh position={[0, 1.1, 0]} material={k.steel}>
        <boxGeometry args={[len + 0.05, 0.05, 0.07]} />
      </mesh>
      <mesh position={[0, 0.03, 0]} material={k.steel}>
        <boxGeometry args={[len, 0.06, 0.07]} />
      </mesh>
      {/* edge of the slab, so the cantilever reads as solid without posts */}
      <mesh position={[0, -0.16, 0]} material={k.steel}>
        <boxGeometry args={[len, 0.34, 0.1]} />
      </mesh>
    </group>
  );
}

export function Mezzanine() {
  const gl = useThree((s) => s.gl);
  const k = decorKit(gl);
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
        <meshBasicMaterial color="#8a8f8c" transparent opacity={0.16} depthWrite={false} />
      </mesh>
      <group ref={group} visible={false}>
        <mesh position={[cx, MEZZ.y - 0.15, cz]} material={k.graphite} castShadow receiveShadow>
          <boxGeometry args={[w, 0.3, d]} />
        </mesh>
        {/* glass on the two open sides; the stairs come up through the gap */}
        <GlassRail from={[MEZZ.minX, MEZZ.z0]} to={[STAIRS.x0, MEZZ.z0]} k={k} />
        <GlassRail from={[MEZZ.minX, MEZZ.z0]} to={[MEZZ.minX, MEZZ.z1]} k={k} />
        <BossOffice k={k} />
      </group>
    </>
  );
}
