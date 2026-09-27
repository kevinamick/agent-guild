// The lounge nook (back-left: a boucle sofa under the window, two cognac leather
// armchairs, a travertine coffee table on a Beni-style rug and an arc lamp) and
// the coffee bar (back-right: fluted oak counter with a terrazzo top, espresso
// machine, globe pendants, stools, a fridge column and a little neon sign).
// Also exports the sofa, so the TV couch matches.
import { useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { ROOM, LOUNGE, COFFEE_BAR, WALL_HEIGHT } from '../../../shared/layout.js';
import { decorKit, box, merge, paint, place, rng, PALETTE } from './decor.js';
import { Instanced } from './Instanced.jsx';
import { useNeonTexture, glowTexture } from './Room.jsx';

const BACK = ROOM.minZ;
const rbox = (w, h, d, r, pos, rot) => place(new RoundedBoxGeometry(w, h, d, 3, r), pos, rot);

// ------------------------------------------------------------------ sofa

// A low modular sofa. Local frame: the sitter faces +z; w is its length (x), d its depth (z).
const sofaCache = {};
function sofaGeometry(w, d) {
  const key = `${w}:${d}`;
  if (sofaCache[key]) return sofaCache[key];
  const n = w > 2.2 ? 3 : 2;
  const arm = 0.2;
  const inner = w - arm * 2;
  const fabric = [rbox(w, 0.22, d, 0.05, [0, 0.2, 0]), ...[-1, 1].map((s) => rbox(arm, 0.52, d, 0.07, [s * (w / 2 - arm / 2), 0.35, 0]))];
  for (let i = 0; i < n; i++) {
    const x = -inner / 2 + (inner / n) * (i + 0.5);
    fabric.push(rbox(inner / n - 0.02, 0.17, d - 0.26, 0.07, [x, 0.39, 0.1]));
    fabric.push(rbox(inner / n - 0.03, 0.46, 0.22, 0.09, [x, 0.66, -d / 2 + 0.15], [-0.12, 0, 0]));
  }
  const legs = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) legs.push(new THREE.CylinderGeometry(0.025, 0.02, 0.09, 8).translate(sx * (w / 2 - 0.12), 0.045, sz * (d / 2 - 0.12)));
  return (sofaCache[key] = { fabric: merge(fabric), legs: merge(legs) });
}

export function Sofa({ w, d, fabric = PALETTE.oat, cushions = [], ...props }) {
  const gl = useThree((s) => s.gl);
  const k = decorKit(gl);
  const g = sofaGeometry(w, d);
  const mat = useMemo(() => k.fabric(fabric), [k, fabric]);
  const pillows = useMemo(() => {
    if (!cushions.length) return null;
    return merge(
      cushions.map((c, i) => {
        const x = (i % 2 ? 1 : -1) * (w / 2 - 0.42 - Math.floor(i / 2) * 0.32);
        return paint(rbox(0.42, 0.4, 0.13, 0.06, [x, 0.66, -d / 2 + 0.35], [-0.25, (i % 2 ? -1 : 1) * 0.2, (i % 2 ? 1 : -1) * 0.1]), c);
      }),
    );
  }, [cushions, w, d]);
  return (
    <group {...props}>
      <mesh geometry={g.fabric} material={mat} castShadow receiveShadow />
      <mesh geometry={g.legs} material={k.steel} />
      {pillows && <mesh geometry={pillows} material={k.paintedSolid} castShadow />}
    </group>
  );
}

// A lounge armchair on splayed oak legs. Local frame: the sitter faces +z.
let armchairGeo = null;
function armchairGeometry() {
  if (armchairGeo) return armchairGeo;
  const leather = merge([
    rbox(0.8, 0.14, 0.72, 0.05, [0, 0.36, 0.02]),
    rbox(0.8, 0.5, 0.14, 0.06, [0, 0.66, -0.3], [-0.2, 0, 0]),
    rbox(0.1, 0.24, 0.66, 0.04, [-0.37, 0.52, 0]),
    rbox(0.1, 0.24, 0.66, 0.04, [0.37, 0.52, 0]),
  ]);
  const legs = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) legs.push(place(new THREE.CylinderGeometry(0.022, 0.016, 0.34, 8), [sx * 0.31, 0.16, sz * 0.26], [sz * 0.15, 0, -sx * 0.15]));
  return (armchairGeo = { leather, legs: merge(legs) });
}

// A Beni Ourain-style rug: cream wool with an irregular charcoal diamond lattice.
function rugTexture(w, d) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = Math.round((512 * d) / w);
  const g = c.getContext('2d');
  const r = rng(12);
  g.fillStyle = '#ece4d5';
  g.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = r() > 0.5 ? 'rgba(255,255,255,0.35)' : 'rgba(170,150,120,0.14)';
    g.fillRect(r() * c.width, r() * c.height, 2, 2);
  }
  g.strokeStyle = 'rgba(52,48,43,0.8)';
  g.lineWidth = 3;
  g.lineJoin = 'round';
  const cell = 90;
  for (let k = -8; k < 16; k++) {
    for (const dir of [1, -1]) {
      g.beginPath();
      for (let y = -10; y <= c.height + 10; y += 10) {
        const x = k * cell + dir * y * 0.9 + (r() - 0.5) * 3;
        if (y === -10) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
  }
  // fringe at the short ends
  g.fillStyle = '#e8dfcd';
  for (let x = 0; x < c.width; x += 5) {
    g.fillRect(x, 0, 2, 8);
    g.fillRect(x, c.height - 8, 2, 8);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// The arc floor lamp: a brass arc from a marble base, with a black dome over the table.
function arcLampGeometry(from, to) {
  const [x0, z0] = from;
  const [x1, z1] = to;
  const curve = new THREE.CubicBezierCurve3(new THREE.Vector3(x0, 0.05, z0), new THREE.Vector3(x0, 2.6, z0), new THREE.Vector3(x1, 2.9, z1), new THREE.Vector3(x1, 2.2, z1));
  return {
    arc: new THREE.TubeGeometry(curve, 40, 0.018, 6, false),
    base: new THREE.CylinderGeometry(0.2, 0.22, 0.06, 24).translate(x0, 0.03, z0),
    shade: new THREE.SphereGeometry(0.28, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2).translate(x1, 2.0, z1),
    bulb: new THREE.CircleGeometry(0.2, 20).rotateX(Math.PI / 2).translate(x1, 2.0, z1),
  };
}

export function LoungeNook() {
  const gl = useThree((s) => s.gl);
  const k = decorKit(gl);
  const { rug, sofa, table, chairs, lamp } = LOUNGE;
  const res = useMemo(() => {
    const lampGeo = arcLampGeometry([lamp.x, lamp.z], [table.x - 0.35, table.z - 0.25]);
    const tableGeo = merge([new THREE.CylinderGeometry(table.r, table.r, 0.07, 36).translate(0, 0.4, 0), new THREE.CylinderGeometry(0.2, 0.26, 0.37, 24).translate(0, 0.185, 0)]);
    const tableTop = merge([
      paint(box(0.26, 0.04, 0.2, [0.12, 0.455, 0.06], [0, 0.3, 0]), PALETTE.terracotta),
      paint(box(0.24, 0.03, 0.18, [0.12, 0.49, 0.06], [0, 0.1, 0]), PALETTE.oat),
      paint(new THREE.CylinderGeometry(0.07, 0.05, 0.16, 14).translate(-0.18, 0.515, -0.1), '#2f3134'),
      paint(new THREE.SphereGeometry(0.12, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI).translate(-0.05, 0.56, 0.2), '#d7cfc2'),
    ]);
    return {
      lamp: lampGeo,
      table: tableGeo,
      tableTop,
      rugMat: new THREE.MeshStandardMaterial({ map: rugTexture(rug.w, rug.d), roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
      travertine: new THREE.MeshStandardMaterial({ color: '#d8ccb6', roughness: 0.6 }),
      leather: new THREE.MeshStandardMaterial({ color: '#9a5a38', roughness: 0.48 }),
      bulb: k.glow('#ffe7c2'),
      marble: new THREE.MeshStandardMaterial({ color: '#1f2022', roughness: 0.25 }),
    };
  }, [k]);
  const arm = armchairGeometry();
  const chairItems = useMemo(() => chairs.map((c) => ({ p: [c.x, 0, c.z], r: c.ry })), [chairs]);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[rug.x, 0.012, rug.z]} material={res.rugMat} receiveShadow>
        <planeGeometry args={[rug.w, rug.d]} />
      </mesh>
      <Sofa w={sofa.w} d={sofa.d} position={[sofa.x, 0, sofa.z]} fabric="#e3dac8" cushions={[PALETTE.terracotta, PALETTE.mustard, PALETTE.sage]} />
      <Instanced geometry={arm.leather} material={res.leather} items={chairItems} castShadow receiveShadow />
      <Instanced geometry={arm.legs} material={k.oak} items={chairItems} />
      <group position={[table.x, 0, table.z]}>
        <mesh geometry={res.table} material={res.travertine} castShadow receiveShadow />
        <mesh geometry={res.tableTop} material={k.paintedSolid} castShadow />
      </group>
      <mesh geometry={res.lamp.arc} material={k.brass} castShadow />
      <mesh geometry={res.lamp.base} material={res.marble} />
      <mesh geometry={res.lamp.shade} material={k.steel} castShadow />
      <mesh geometry={res.lamp.bulb} material={res.bulb} />
    </group>
  );
}

// -------------------------------------------------------------- coffee bar

function flutedTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 8;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 64, 0);
  grad.addColorStop(0, '#9c7650');
  grad.addColorStop(0.25, '#d9b98f');
  grad.addColorStop(0.6, '#caa77b');
  grad.addColorStop(1, '#8e6a46');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 8);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

function terrazzoTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const r = rng(33);
  g.fillStyle = '#f1ede6';
  g.fillRect(0, 0, 256, 256);
  const chips = ['#c0664a', '#8f9d7c', '#2f3134', '#cf9f45', '#b9b2a6', '#e0b8a8'];
  for (let i = 0; i < 700; i++) {
    g.fillStyle = chips[Math.floor(r() * chips.length)];
    g.beginPath();
    const x = r() * 256;
    const y = r() * 256;
    const s = 1 + r() * 3.5;
    g.moveTo(x, y);
    g.lineTo(x + s, y + r() * s);
    g.lineTo(x + r() * s, y + s);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(6, 0.7);
  return t;
}

// The espresso machine, grinder, cups and bits on the counter (desk-local: along x, the back wall at -z).
function counterItems(top) {
  const steel = [];
  const dark = [];
  const painted = [];
  const m = 13.2;
  steel.push(box(0.62, 0.4, 0.46, [m, top + 0.2, BACK + 0.32]));
  dark.push(box(0.64, 0.05, 0.48, [m, top + 0.425, BACK + 0.32]), box(0.5, 0.03, 0.2, [m, top + 0.03, BACK + 0.6]));
  for (const dx of [-0.15, 0.15]) {
    steel.push(new THREE.CylinderGeometry(0.045, 0.045, 0.08, 12).translate(m + dx, top + 0.25, BACK + 0.57));
    dark.push(box(0.03, 0.03, 0.18, [m + dx, top + 0.2, BACK + 0.66]));
  }
  // grinder
  dark.push(box(0.18, 0.3, 0.22, [12.45, top + 0.15, BACK + 0.3]));
  painted.push(paint(new THREE.CylinderGeometry(0.1, 0.05, 0.16, 12).translate(12.45, top + 0.38, BACK + 0.3), '#6b4a33'));
  // cups on the machine and a stack beside it
  for (const dx of [-0.18, -0.02, 0.14]) painted.push(paint(new THREE.CylinderGeometry(0.04, 0.035, 0.06, 10).translate(m + dx, top + 0.48, BACK + 0.3), '#f4f1ec'));
  for (let i = 0; i < 4; i++) painted.push(paint(new THREE.CylinderGeometry(0.05, 0.04, 0.07, 12).translate(14.05, top + 0.035 + i * 0.055, BACK + 0.35), i % 2 ? '#2f3134' : '#f4f1ec'));
  // a bowl of lemons, a jar of beans, a board leaning on the wall
  painted.push(paint(new THREE.SphereGeometry(0.16, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).translate(14.75, top + 0.16, BACK + 0.38), '#e9e3d9'));
  for (let i = 0; i < 5; i++) painted.push(paint(new THREE.SphereGeometry(0.045, 10, 8).scale(1, 0.85, 0.85).translate(14.75 + Math.sin(i * 2.4) * 0.07, top + 0.1 + (i > 3 ? 0.05 : 0), BACK + 0.38 + Math.cos(i * 2.4) * 0.07), '#f2c94c'));
  painted.push(paint(new THREE.CylinderGeometry(0.07, 0.07, 0.22, 14).translate(15.35, top + 0.11, BACK + 0.25), '#d8c6a4'));
  painted.push(paint(new THREE.CylinderGeometry(0.072, 0.072, 0.03, 14).translate(15.35, top + 0.235, BACK + 0.25), '#2f3134'));
  painted.push(paint(box(0.4, 0.55, 0.025, [16.1, top + 0.27, BACK + 0.08], [0.15, 0, 0]), '#b48f64'));
  painted.push(paint(box(0.36, 0.02, 0.24, [15.85, top + 0.01, BACK + 0.4], [0, 0.1, 0]), '#8a6242'));
  return { steel: merge(steel), dark: merge(dark), painted: merge(painted) };
}

function stoolGeometry() {
  const legs = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    legs.push(place(new THREE.CylinderGeometry(0.014, 0.014, 0.74, 6), [Math.sin(a) * 0.15, 0.37, Math.cos(a) * 0.15], [Math.cos(a) * 0.1, 0, -Math.sin(a) * 0.1]));
  }
  legs.push(new THREE.TorusGeometry(0.17, 0.012, 5, 20).rotateX(Math.PI / 2).translate(0, 0.28, 0));
  return { legs: merge(legs), seat: new THREE.CylinderGeometry(0.19, 0.18, 0.05, 24).translate(0, 0.765, 0) };
}

const COFFEE_SIGN = { lines: [['coffee', 0.52]], font: 'italic 800 200px Nunito, system-ui, sans-serif', glow: 'rgba(255,190,110,1)', tube: '#ffd9a0' };

export function CoffeeBar() {
  const gl = useThree((s) => s.gl);
  const k = decorKit(gl);
  const bar = COFFEE_BAR;
  const len = bar.x1 - bar.x0;
  const cx = (bar.x0 + bar.x1) / 2;
  const res = useMemo(() => {
    const fluted = flutedTexture();
    fluted.repeat.set(len / 0.06, 1);
    const stool = stoolGeometry();
    return {
      fluted: new THREE.MeshStandardMaterial({ map: fluted, roughness: 0.6 }),
      terrazzo: new THREE.MeshStandardMaterial({ map: terrazzoTexture(), roughness: 0.35 }),
      fridge: new THREE.MeshStandardMaterial({ color: '#2a2c2f', roughness: 0.6, metalness: 0.2 }),
      items: counterItems(bar.h),
      stool,
      globe: k.glow('#fff0d8'),
      cord: new THREE.CylinderGeometry(0.006, 0.006, 1, 4).translate(0, 0.5, 0),
    };
  }, [k]);
  const stools = useMemo(() => bar.stools.map((x, i) => ({ p: [x, 0, bar.stoolZ], r: i * 0.7 })), []);
  const globes = useMemo(() => bar.stools.map((x) => ({ p: [x, 2.6, BACK + 0.4] })), []);
  const cords = useMemo(() => bar.stools.map((x) => ({ p: [x, 2.75, BACK + 0.4], s: [1, WALL_HEIGHT - 2.75, 1] })), []);
  const sign = useNeonTexture(COFFEE_SIGN, 768, 240);
  const f = bar.fridge;
  return (
    <group>
      {/* carcass with a fluted oak front, recessed black toe kick and a terrazzo top */}
      <mesh position={[cx, 0.52, BACK + bar.d / 2 - 0.02]} material={k.oakDark} castShadow receiveShadow>
        <boxGeometry args={[len, 0.8, bar.d - 0.04]} />
      </mesh>
      <mesh position={[cx, 0.52, BACK + bar.d - 0.039]} material={res.fluted}>
        <planeGeometry args={[len, 0.8]} />
      </mesh>
      <mesh position={[cx, 0.06, BACK + bar.d / 2 - 0.06]} material={k.steel}>
        <boxGeometry args={[len, 0.12, bar.d - 0.12]} />
      </mesh>
      <mesh position={[cx, bar.h - 0.025, BACK + bar.d / 2]} material={res.terrazzo} castShadow receiveShadow>
        <boxGeometry args={[len + 0.04, 0.05, bar.d + 0.03]} />
      </mesh>
      <mesh geometry={res.items.steel} material={k.chrome} castShadow />
      <mesh geometry={res.items.dark} material={k.steel} castShadow />
      <mesh geometry={res.items.painted} material={k.paintedSolid} castShadow />
      {/* fridge column with a brass pull */}
      <mesh position={[(f.x0 + f.x1) / 2, f.h / 2, BACK + bar.d / 2 - 0.01]} material={res.fridge} castShadow receiveShadow>
        <boxGeometry args={[f.x1 - f.x0, f.h, bar.d - 0.02]} />
      </mesh>
      <mesh position={[f.x0 + 0.12, 1.2, BACK + bar.d + 0.02]} material={k.brass}>
        <boxGeometry args={[0.025, 0.9, 0.03]} />
      </mesh>
      <Instanced geometry={res.stool.legs} material={k.steel} items={stools} castShadow />
      <Instanced geometry={res.stool.seat} material={k.oak} items={stools} castShadow />
      {/* opal globe pendants on brass caps */}
      <Instanced geometry={SPHERE} material={res.globe} items={globes} />
      <Instanced geometry={CAP} material={k.brass} items={globes} />
      <Instanced geometry={res.cord} material={k.steel} items={cords} />
      {/* a little neon hung in the window */}
      <group position={[cx + 0.2, 3.55, BACK + 0.1]}>
        <mesh>
          <planeGeometry args={[2.6, 0.81]} />
          <meshBasicMaterial map={sign} transparent depthWrite={false} toneMapped={false} />
        </mesh>
        <mesh position={[0, 0, -0.02]}>
          <planeGeometry args={[3.1, 1.3]} />
          <meshBasicMaterial map={glowTexture()} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} opacity={0.35} color="#ffb870" />
        </mesh>
      </group>
    </group>
  );
}

const SPHERE = new THREE.SphereGeometry(0.15, 20, 12);
const CAP = new THREE.CylinderGeometry(0.035, 0.06, 0.07, 14).translate(0, 0.17, 0);
