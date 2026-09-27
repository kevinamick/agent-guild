// The shell of the office: polished concrete floor with the agents' lanes inlaid,
// plaster walls and the evergreen accent wall with two big black steel factory
// windows onto the city, an exposed dark ceiling with beams and a duct, the moss
// wall with the neon "Agent Guild" sign, the oak slat media wall behind the TV,
// hexagon acoustic tiles, open shelving and hanging plants.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { ROOM, DESKS, DOOR, TV, SHELF, PLANTERS, LOUNGE, COFFEE_BAR, WALL_HEIGHT, agentPath } from '../../../shared/layout.js';
import { decorKit, box, merge, paint, rng, PALETTE } from './decor.js';
import { Instanced } from './Instanced.jsx';
import { Plants } from './Plants.jsx';
import { view } from './view.js';
import { useCameraMode } from './cameraMode.js';

const W = ROOM.maxX - ROOM.minX;
const D = ROOM.maxZ - ROOM.minZ;
const BACK = ROOM.minZ; // the back wall's inner face
export const WINDOWS = [
  { x0: -19, x1: -10.2 },
  { x0: 10.2, x1: 19 },
];
const WIN_Y0 = 1.0;
const WIN_Y1 = 7.8;
const MOSS = { x0: -2.3, x1: 2.3, y0: 0.55, y1: 8.2 };
// Hanging pothos in front of the windows: the bowl's rim height.
const HANGING = [
  { x: -17.2, y: 5.7, z: BACK + 0.65 },
  { x: -12.4, y: 6.4, z: BACK + 0.65 },
  { x: 12.6, y: 6.4, z: BACK + 0.65 },
  { x: 17.0, y: 5.8, z: BACK + 0.65 },
];

// Hide what hangs from the ceiling while you're upstairs: the camera is then
// above it, looking down through it at the floor.
function useHiddenUpstairs() {
  const ref = useRef();
  useFrame(() => {
    if (ref.current) ref.current.visible = !view.upstairs;
  });
  return ref;
}

// ------------------------------------------------------------------ geometry

function backWallGeometry() {
  const z = BACK - 0.15;
  const x0 = ROOM.minX - 0.3;
  const x1 = ROOM.maxX + 0.3;
  const [a, b] = WINDOWS;
  const piece = (xa, xb, ya, yb) => box(xb - xa, yb - ya, 0.3, [(xa + xb) / 2, (ya + yb) / 2, z]);
  return merge([
    piece(x0, x1, 0, WIN_Y0),
    piece(x0, x1, WIN_Y1, WALL_HEIGHT),
    piece(a.x1, b.x0, WIN_Y0, WIN_Y1),
    piece(x0, a.x0, WIN_Y0, WIN_Y1),
    piece(b.x1, x1, WIN_Y0, WIN_Y1),
  ]);
}

function windowFrameGeometry() {
  const parts = [];
  const z = BACK - 0.12;
  for (const { x0, x1 } of WINDOWS) {
    const w = x1 - x0;
    const h = WIN_Y1 - WIN_Y0;
    const cx = (x0 + x1) / 2;
    const cy = (WIN_Y0 + WIN_Y1) / 2;
    parts.push(box(w + 0.12, 0.12, 0.2, [cx, WIN_Y0, z]), box(w + 0.12, 0.12, 0.2, [cx, WIN_Y1, z]));
    parts.push(box(0.12, h, 0.2, [x0, cy, z]), box(0.12, h, 0.2, [x1, cy, z]));
    const cols = 6;
    const rows = 5;
    for (let i = 1; i < cols; i++) parts.push(box(0.05, h, 0.1, [x0 + (w * i) / cols, cy, z]));
    for (let j = 1; j < rows; j++) parts.push(box(w, j === 1 ? 0.09 : 0.05, 0.1, [cx, WIN_Y0 + (h * j) / rows, z]));
    // a deep steel sill inside
    parts.push(box(w + 0.3, 0.05, 0.28, [cx, WIN_Y0 - 0.03, BACK + 0.08]));
  }
  return merge(parts);
}

function sideWallGeometry() {
  return merge([ROOM.minX - 0.15, ROOM.maxX + 0.15].map((x) => box(0.3, WALL_HEIGHT, D + 0.3, [x, WALL_HEIGHT / 2, 0])));
}

// Slim steel skirting on the plaster walls.
function skirtingGeometry() {
  return merge([
    box(0.03, 0.1, D, [ROOM.minX + 0.015, 0.05, 0]),
    box(0.03, 0.1, D, [ROOM.maxX - 0.015, 0.05, 0]),
    box(W, 0.1, 0.03, [0, 0.05, BACK + 0.015]),
  ]);
}

// The inside of the front wall, with a glass double door. It only faces into the
// room, so from the follow camera outside it you see straight through it.
function frontWallGeometry() {
  const h = WALL_HEIGHT;
  const door = 1.7;
  const dh = 2.9;
  const plane = (x0, x1, y0, y1) =>
    new THREE.PlaneGeometry(x1 - x0, y1 - y0).rotateY(Math.PI).translate((x0 + x1) / 2, (y0 + y1) / 2, ROOM.maxZ);
  return merge([plane(ROOM.minX, DOOR.x - door, 0, h), plane(DOOR.x + door, ROOM.maxX, 0, h), plane(DOOR.x - door, DOOR.x + door, dh, h)]);
}

// The door's steel frame, as flat strips facing into the room (like the wall).
function doorGeometry() {
  const z = ROOM.maxZ - 0.03;
  const strip = (w, h, x, y) => new THREE.PlaneGeometry(w, h).rotateY(Math.PI).translate(x, y, z);
  return merge([
    strip(3.5, 0.1, DOOR.x, 2.9),
    strip(0.1, 2.9, DOOR.x - 1.7, 1.45),
    strip(0.1, 2.9, DOOR.x + 1.7, 1.45),
    strip(0.06, 2.9, DOOR.x, 1.45),
    strip(1.6, 0.05, DOOR.x - 0.85, 1.0),
    strip(1.6, 0.05, DOOR.x + 0.85, 1.0),
  ]);
}

function ceilingDetailGeometry() {
  const parts = [];
  for (const x of [-13.5, -4.5, 4.5, 13.5]) parts.push(box(0.2, 0.42, D, [x, WALL_HEIGHT - 0.21, 0]), box(0.34, 0.03, D, [x, WALL_HEIGHT - 0.42, 0]));
  return merge(parts);
}

function ductGeometry() {
  const parts = [new THREE.CylinderGeometry(0.34, 0.34, W, 20, 1, true).rotateZ(Math.PI / 2).translate(0, 7.9, 2.5)];
  for (let x = ROOM.minX + 1; x < ROOM.maxX; x += 1.6) parts.push(new THREE.TorusGeometry(0.345, 0.02, 4, 20).rotateY(Math.PI / 2).translate(x, 7.9, 2.5));
  for (let x = ROOM.minX + 3; x < ROOM.maxX; x += 6) parts.push(box(0.03, WALL_HEIGHT - 8.24, 0.03, [x, (WALL_HEIGHT + 8.24) / 2, 2.5]));
  return merge(parts);
}

// The agents' lanes: thin brass strips inlaid in the concrete, along the routes
// agents take to their desks (the front lane from the door and the aisles).
function lanesGeometry() {
  const aisles = new Map();
  for (const d of DESKS) {
    const [, [cx], [, wz]] = agentPath(d);
    aisles.set(cx, Math.min(aisles.get(cx) ?? Infinity, wz));
  }
  const xs = [...aisles.keys()];
  const strip = (ax, az, bx, bz) => {
    const len = Math.hypot(bx - ax, bz - az);
    return new THREE.PlaneGeometry(0.045, len + 0.045).rotateX(-Math.PI / 2).rotateY(Math.atan2(bx - ax, bz - az)).translate((ax + bx) / 2, 0, (az + bz) / 2);
  };
  const front = agentPath(DESKS[0])[1][1];
  return merge([
    strip(DOOR.x, DOOR.z - 0.8, DOOR.x, front),
    strip(Math.min(...xs), front, Math.max(...xs), front),
    ...xs.map((x) => strip(x, front, x, aisles.get(x))),
  ]);
}

function mossBumpsGeometry() {
  const r = rng(77);
  const greens = ['#4d7231', '#5f8a38', '#3b5d2a', '#7c9c46', '#9bb35a', '#2f4d27'];
  const parts = [];
  for (let i = 0; i < 170; i++) {
    const rad = 0.05 + r() * 0.11;
    const x = MOSS.x0 + rad + r() * (MOSS.x1 - MOSS.x0 - rad * 2);
    const y = MOSS.y0 + rad + r() * (MOSS.y1 - MOSS.y0 - rad * 2);
    const g = new THREE.SphereGeometry(1, 6, 4).scale(rad, rad * (0.8 + r() * 0.4), rad * 0.3).translate(x, y, BACK + 0.04);
    parts.push(paint(g, greens[i % greens.length]));
  }
  return merge(parts);
}

function frameGeometry(x0, x1, y0, y1, t, depth, z) {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  return merge([
    box(x1 - x0 + t * 2, t, depth, [cx, y0 - t / 2, z]),
    box(x1 - x0 + t * 2, t, depth, [cx, y1 + t / 2, z]),
    box(t, y1 - y0, depth, [x0 - t / 2, cy, z]),
    box(t, y1 - y0, depth, [x1 + t / 2, cy, z]),
  ]);
}

// Oak slats on a dark felt backing behind the TV.
function slatGeometry() {
  const z0 = TV.z - 3.3;
  const z1 = TV.z + 3.3;
  const parts = [];
  for (let z = z0; z <= z1; z += 0.11) parts.push(box(0.035, 6.2, 0.05, [ROOM.minX + 0.05, 3.1, z]));
  return merge(parts);
}

// Honeycomb acoustic tiles above the pictures on the right wall.
function hexItems() {
  const colors = [PALETTE.evergreen, PALETTE.terracotta, PALETTE.oat, PALETTE.sage, '#3f6b5c', PALETTE.oat];
  const out = [];
  const r = 0.42;
  const cells = [
    [0, 0], [1, 0], [2, 0], [3, 0], [5, 0], [6, 0], [8, 0],
    [0, 1], [1, 1], [2, 1], [4, 1], [5, 1], [6, 1], [7, 1],
    [1, 2], [2, 2], [3, 2], [5, 2], [6, 2],
    [2, 3], [5, 3],
  ];
  cells.forEach(([c, row], i) => {
    const z = -12.4 + c * r * Math.sqrt(3) + (row % 2) * r * (Math.sqrt(3) / 2);
    const y = 4.3 + row * r * 1.5;
    out.push({ p: [ROOM.maxX - 0.03, y, z], r: [0, 0, Math.PI / 2], color: colors[(c * 3 + row * 2 + i) % colors.length] });
  });
  return out;
}

function shelfGeometry() {
  const x = SHELF.x - SHELF.d / 2;
  const parts = [];
  for (const z of [SHELF.z0, (SHELF.z0 + SHELF.z1) / 2, SHELF.z1]) for (const dx of [-SHELF.d / 2 + 0.02, SHELF.d / 2 - 0.02]) parts.push(box(0.03, SHELF.h, 0.03, [x + dx, SHELF.h / 2, z]));
  return merge(parts);
}
const SHELF_LEVELS = [0.06, 0.7, 1.34, 1.98, 2.58];

function shelfBoards() {
  const x = SHELF.x - SHELF.d / 2;
  return merge(SHELF_LEVELS.map((y) => box(SHELF.d, 0.035, SHELF.z1 - SHELF.z0 + 0.04, [x, y, (SHELF.z0 + SHELF.z1) / 2])));
}

function bookItems() {
  const r = rng(9);
  const colors = ['#c0664a', '#2c3a52', '#e5dccb', '#8f9d7c', '#cf9f45', '#20392f', '#b98378', '#34373b', '#f2efe9', '#6b4a33'];
  const out = [];
  SHELF_LEVELS.slice(0, 4).forEach((y) => {
    let z = SHELF.z0 + 0.08;
    while (z < SHELF.z1 - 0.12) {
      if (r() < 0.14) {
        z += 0.35 + r() * 0.2; // a gap for an object
        continue;
      }
      if (r() < 0.12) {
        // a small stack lying flat
        let yy = y + 0.018;
        for (let k = 0; k < 3; k++) {
          const t = 0.035 + r() * 0.02;
          out.push({ p: [SHELF.x - 0.2, yy, z + 0.12], s: [0.22, t, 0.26], r: r() * 0.2 - 0.1, color: colors[Math.floor(r() * colors.length)] });
          yy += t;
        }
        z += 0.34;
        continue;
      }
      const w = 0.03 + r() * 0.05;
      out.push({ p: [SHELF.x - 0.19 - r() * 0.02, y + 0.018, z + w / 2], s: [0.2 + r() * 0.08, 0.2 + r() * 0.14, w], color: colors[Math.floor(r() * colors.length)] });
      z += w + 0.004;
    }
  });
  return out;
}

// ------------------------------------------------------------ neon lettering

// Outline-style neon tubes: a wide coloured halo, the tube, and a hot white core.
function drawNeon(c, { lines, font, glow, tube }) {
  const g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineCap = 'round';
  // Shrink the lettering to fit, leaving room for the glow, or the ends get clipped.
  const pad = 70;
  g.font = font;
  const widest = Math.max(...lines.map(([t]) => g.measureText(t).width));
  const fit = Math.min(1, (c.width - 2 * pad) / widest);
  g.font = font.replace(/(\d+(?:\.\d+)?)px/, (_, px) => `${Math.floor(px * fit)}px`);
  const pass = (blur, color, width, stroke) => {
    g.shadowBlur = blur;
    g.shadowColor = color;
    g.strokeStyle = stroke;
    g.lineWidth = width;
    for (const [t, y] of lines) g.strokeText(t, c.width / 2, y * c.height);
  };
  pass(70, glow, 16, glow);
  pass(30, glow, 11, tube);
  pass(10, tube, 6, '#fff1ea');
  pass(0, 'transparent', 2.5, '#fffaf6');
}

// A neon sign's texture; redrawn once the web font has loaded (the canvas falls back to a system font until then).
export function useNeonTexture(spec, w = 1024, h = 640) {
  const tex = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    drawNeon(c, spec);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
  useEffect(() => {
    let alive = true;
    document.fonts?.load(spec.font).then(() => {
      if (!alive) return;
      drawNeon(tex.image, spec);
      tex.needsUpdate = true;
    });
    return () => {
      alive = false;
      tex.dispose();
    };
  }, [tex]);
  return tex;
}

const SIGN = { lines: [['Agent', 0.3], ['Guild', 0.72]], font: 'italic 800 230px Nunito, system-ui, sans-serif', glow: 'rgba(255,104,86,1)', tube: '#ff9f86' };

function NeonSign() {
  const tex = useNeonTexture(SIGN);
  return (
    <group position={[0, 6.05, BACK + 0.2]}>
      <mesh>
        <planeGeometry args={[4.4, 2.75]} />
        <meshBasicMaterial map={tex} transparent depthWrite={false} toneMapped={false} />
      </mesh>
      {/* a soft pink spill on the moss around the sign */}
      <mesh position={[0, 0, -0.1]}>
        <planeGeometry args={[5, 3.6]} />
        <meshBasicMaterial map={glowTexture()} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} opacity={0.5} color="#ff7a64" />
      </mesh>
    </group>
  );
}

let glowTex = null;
export function glowTexture() {
  return (glowTex ??= (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,0.8)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })());
}

// -------------------------------------------------------------------- room

export function Room() {
  const firstPerson = useCameraMode((s) => s.firstPerson);
  const gl = useThree((s) => s.gl);
  const k = decorKit(gl);
  const hung = useHiddenUpstairs();
  const g = useMemo(
    () => ({
      back: backWallGeometry(),
      windows: windowFrameGeometry(),
      side: sideWallGeometry(),
      skirting: skirtingGeometry(),
      front: frontWallGeometry(),
      door: doorGeometry(),
      beams: ceilingDetailGeometry(),
      duct: ductGeometry(),
      lanes: lanesGeometry(),
      mossBumps: mossBumpsGeometry(),
      mossFrame: frameGeometry(MOSS.x0, MOSS.x1, MOSS.y0, MOSS.y1, 0.1, 0.16, BACK + 0.08),
      slats: slatGeometry(),
      hex: new THREE.CylinderGeometry(0.4, 0.4, 0.05, 6),
      shelf: shelfGeometry(),
      shelfBoards: shelfBoards(),
      book: new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
      cord: new THREE.CylinderGeometry(0.008, 0.008, 1, 4).translate(0, 0.5, 0),
      blob: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    }),
    [],
  );
  const mats = useMemo(
    () => ({
      floor: new THREE.MeshStandardMaterial({ map: k.tex.concrete, roughness: 0.55, metalness: 0.02 }),
      front: new THREE.MeshStandardMaterial({ color: PALETTE.plaster, roughness: 0.95 }),
      doorGlass: new THREE.MeshStandardMaterial({ color: '#dfe6e3', roughness: 0.3, transparent: true, opacity: 0.55 }),
      skyline: new THREE.MeshBasicMaterial({ map: k.tex.skyline, toneMapped: false, color: '#f4f4f4' }),
      lanes: new THREE.MeshStandardMaterial({ color: PALETTE.brass, roughness: 0.3, metalness: 0.9, envMap: k.env, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
      moss: new THREE.MeshStandardMaterial({ map: k.tex.moss, roughness: 1 }),
      felt: new THREE.MeshStandardMaterial({ color: '#1e2321', roughness: 1 }),
      hex: new THREE.MeshStandardMaterial({ color: '#fff', map: k.tex.weave, roughness: 1 }),
      book: new THREE.MeshStandardMaterial({ color: '#fff', roughness: 0.8 }),
      duct: new THREE.MeshStandardMaterial({ color: '#8d9296', roughness: 0.45, metalness: 0.7, envMap: k.env, envMapIntensity: 0.6 }),
      wash: new THREE.MeshBasicMaterial({ map: k.tex.wash, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
      mat: new THREE.MeshStandardMaterial({ color: '#34302b', roughness: 1 }),
      cove: k.glow(PALETTE.warmLight),
    }),
    [k],
  );
  const items = useMemo(() => {
    const blobs = [
      ...PLANTERS.map((p) => ({ p: [p.x, 0.008, p.z], s: [1.3 * p.s, 1, 1.3 * p.s] })),
      { p: [LOUNGE.sofa.x, 0.02, LOUNGE.sofa.z + 0.1], s: [LOUNGE.sofa.w + 0.8, 1, LOUNGE.sofa.d + 0.8] },
      { p: [LOUNGE.table.x, 0.02, LOUNGE.table.z], s: [1.6, 1, 1.6] },
      ...LOUNGE.chairs.map((c) => ({ p: [c.x, 0.02, c.z], s: [1.4, 1, 1.4] })),
      { p: [TV.couch.x + 0.1, 0.02, TV.couch.z], s: [TV.couch.w + 0.9, 1, TV.couch.d + 0.8] },
      { p: [(COFFEE_BAR.x0 + COFFEE_BAR.fridge.x1) / 2, 0.008, BACK + 0.4], s: [COFFEE_BAR.fridge.x1 - COFFEE_BAR.x0 + 0.6, 1, 1.2] },
      ...COFFEE_BAR.stools.map((x) => ({ p: [x, 0.008, COFFEE_BAR.stoolZ], s: [0.9, 1, 0.9] })),
      { p: [SHELF.x - SHELF.d / 2, 0.008, (SHELF.z0 + SHELF.z1) / 2], s: [1, 1, SHELF.z1 - SHELF.z0 + 0.6] },
    ];
    return {
      blobs,
      hex: hexItems(),
      books: bookItems(),
      hanging: HANGING.map((h) => ({ kind: 'pothos', ...h })),
      cords: HANGING.map((h) => ({ p: [h.x, h.y + 0.75, h.z], s: [1, WALL_HEIGHT - h.y - 0.75, 1] })),
      ferns: [-1.75, -0.6, 0.6, 1.75].map((x, i) => ({ kind: 'fern', x, y: 0.5, z: BACK + 0.28, s: 1.1 + (i % 2) * 0.2, r: i * 1.3 })),
      shelfPlants: [
        { kind: 'pothos', x: SHELF.x - 0.2, y: SHELF_LEVELS[4] + 0.2, z: SHELF.z0 + 0.5, s: 0.8 },
        { kind: 'succulent', x: SHELF.x - 0.2, y: SHELF_LEVELS[1] + 0.02, z: -0.4, s: 1.6 },
        { kind: 'succulent', x: SHELF.x - 0.2, y: SHELF_LEVELS[3] + 0.02, z: -2.1, s: 1.8 },
      ],
    };
  }, []);

  return (
    <group>
      {/* floor, and the city beyond the windows */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={mats.floor}>
        <planeGeometry args={[W, D]} />
      </mesh>
      <mesh position={[0, 5, BACK - 3]} material={mats.skyline}>
        <planeGeometry args={[52, 15.2]} />
      </mesh>
      <mesh geometry={g.lanes} material={mats.lanes} position={[0, 0.003, 0]} receiveShadow />
      {/* entrance mat */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[DOOR.x, 0.006, DOOR.z - 0.2]} material={mats.mat} receiveShadow>
        <planeGeometry args={[3.2, 1.2]} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[DOOR.x, 0.005, DOOR.z - 0.2]} material={k.brass}>
        <planeGeometry args={[3.3, 1.3]} />
      </mesh>

      {/* walls */}
      <mesh geometry={g.back} material={k.evergreen} receiveShadow />
      <mesh geometry={g.side} material={k.plaster} receiveShadow />
      <mesh geometry={g.skirting} material={k.steel} />
      {/* Only in first person: the follow camera hovers right around this wall, so it
          would keep popping in and out of view as the camera moves. */}
      {firstPerson && (
        <>
          <mesh geometry={g.front} material={mats.front} />
          <mesh geometry={g.door} material={k.steel} />
          <mesh position={[DOOR.x, 1.45, ROOM.maxZ - 0.02]} rotation={[0, Math.PI, 0]} material={mats.doorGlass}>
            <planeGeometry args={[3.3, 2.8]} />
          </mesh>
        </>
      )}
      <mesh geometry={g.windows} material={k.steel} castShadow />
      {WINDOWS.map((w) => (
        <mesh key={w.x0} position={[(w.x0 + w.x1) / 2, (WIN_Y0 + WIN_Y1) / 2, BACK - 0.12]} material={k.glass}>
          <planeGeometry args={[w.x1 - w.x0, WIN_Y1 - WIN_Y0]} />
        </mesh>
      ))}
      {/* warm light washing down the accent wall from a cove, and the cove's LED line */}
      <mesh position={[0, 6.4, BACK + 0.02]} material={mats.wash}>
        <planeGeometry args={[20.2, 5.2]} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * (ROOM.maxX - 0.02), 6.4, 0]} rotation={[0, -side * (Math.PI / 2), 0]} material={mats.wash}>
          <planeGeometry args={[D, 5.2]} />
        </mesh>
      ))}
      <mesh position={[0, WALL_HEIGHT - 0.06, BACK + 0.05]} material={mats.cove}>
        <boxGeometry args={[W, 0.04, 0.04]} />
      </mesh>

      {/* the moss wall and the neon sign */}
      <mesh position={[0, (MOSS.y0 + MOSS.y1) / 2, BACK + 0.01]} material={mats.moss}>
        <planeGeometry args={[MOSS.x1 - MOSS.x0, MOSS.y1 - MOSS.y0]} />
      </mesh>
      <mesh geometry={g.mossBumps} material={k.paintedSolid} />
      <mesh geometry={g.mossFrame} material={k.oak} castShadow />
      <NeonSign />
      <mesh position={[0, 0.25, BACK + 0.27]} material={k.oak} castShadow receiveShadow>
        <boxGeometry args={[MOSS.x1 - MOSS.x0 + 0.2, 0.5, 0.5]} />
      </mesh>
      <Plants items={items.ferns} castShadow={false} />

      {/* the TV's slat wall */}
      <mesh position={[ROOM.minX + 0.012, 3.1, TV.z]} material={mats.felt}>
        <boxGeometry args={[0.02, 6.2, 6.7]} />
      </mesh>
      <mesh geometry={g.slats} material={k.oak} />

      <Instanced geometry={g.hex} material={mats.hex} items={items.hex} />

      {/* open shelving on the right wall */}
      <mesh geometry={g.shelf} material={k.steel} castShadow />
      <mesh geometry={g.shelfBoards} material={k.oak} castShadow receiveShadow />
      <Instanced geometry={g.book} material={mats.book} items={items.books} castShadow />
      <Plants items={items.shelfPlants} castShadow={false} />

      <Instanced geometry={g.blob} material={k.blob} items={items.blobs} />

      {/* the exposed ceiling, and everything hung from it */}
      <mesh position={[0, WALL_HEIGHT, 0]} rotation={[Math.PI / 2, 0, 0]} material={k.ceiling}>
        <planeGeometry args={[W + 0.6, D + 0.3]} />
      </mesh>
      <group ref={hung}>
        <mesh geometry={g.beams} material={k.steel} />
        <mesh geometry={g.duct} material={mats.duct} />
        <Instanced geometry={g.cord} material={k.steel} items={items.cords} />
      </group>
      <Plants items={items.hanging} castShadow={false} />
    </group>
  );
}
