// A 13.8" Microsoft Surface Laptop, built from primitives: a thin aluminium
// wedge with a recessed backlit keyboard and a big precision touchpad, and a 3:2
// touchscreen under edge-to-edge glass that shows the seated agent's terminal.
// Every laptop shares one set of geometry and materials (built once, see kit()),
// so each costs five draw calls (body, keyboard, glass, logo and display) and
// only the body casts a shadow.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { screens } from '../net.js';
import { screenTexture, drawTerminal, SCREEN_ASPECT } from './terminalTexture.js';

// The real 308 × 223 mm chassis at ~2.27×, to fit the desks. Local frame: the
// origin is under the middle of the base, +z runs toward the seat.
const W = 0.7;
const D = 0.5;
const H_FRONT = 0.021; // the base tapers a little toward the front edge
const H_BACK = 0.027;
const RADIUS = 0.024;
const BEVEL = 0.004;
const LID_H = 0.49;
const LID_T = 0.009;
const LID_BEVEL = 0.0025;
// The lid hinges at the back edge, opened a little past upright.
const LID = new THREE.Matrix4().makeRotationX(-0.28).setPosition(0, H_BACK + 0.004, -D / 2 + 0.012);
// 3:2 display with thin bezels (a little deeper at the chin), webcam centred on top.
const SCREEN_W = 0.656;
const SCREEN_H = SCREEN_W / SCREEN_ASPECT;
const SCREEN_Y = LID_H - 0.022 - SCREEN_H / 2;
const CAM_Y = LID_H - 0.012;
// Keyboard: 15 key widths across; a short function row over five full rows.
const PITCH = 0.0412;
const ROW = 0.0425;
const KEY_GAP = 0.0065;
const KB_W = 15 * PITCH;
const KB_D = 5.6 * ROW;
const WELL = { x0: -KB_W / 2 - 0.006, z0: -D / 2 + 0.03, w: KB_W + 0.012, d: KB_D + 0.012 };
const PAD = { w: 0.26, d: 0.165, z: WELL.z0 + WELL.d + 0.018 + 0.165 / 2 };

// Real Surface colours; an agent's laptop is one of them, empty desks get Platinum.
const FINISHES = [
  { name: 'Platinum', color: '#babcc0', metalness: 0.8, roughness: 0.36 },
  { name: 'Black', color: '#2a2b2f', metalness: 0.55, roughness: 0.42 },
  { name: 'Sage', color: '#aab5a4', metalness: 0.7, roughness: 0.4 },
  { name: 'Sapphire', color: '#3f5f8f', metalness: 0.7, roughness: 0.38 },
  { name: 'Dune', color: '#c6b49a', metalness: 0.7, roughness: 0.4 },
];

function finishIndex(agentId) {
  if (!agentId) return 0;
  let h = 0;
  for (const ch of agentId) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h) % FINISHES.length;
}

// Height of the top deck at depth z (the wedge).
const deckY = (z) => H_BACK + ((H_FRONT - H_BACK) * (z + D / 2)) / D;

// Rounded rectangle centred on (cx, cy), drawn into a Shape or a Path (for holes).
function roundedRect(p, cx, cy, w, h, r) {
  const x = cx - w / 2;
  const y = cy - h / 2;
  p.moveTo(x + r, y);
  p.lineTo(x + w - r, y);
  p.absarc(x + w - r, y + r, r, -Math.PI / 2, 0);
  p.lineTo(x + w, y + h - r);
  p.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2);
  p.lineTo(x + r, y + h);
  p.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
  p.lineTo(x, y + r);
  p.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5);
  return p;
}

// Smooth shading round an extrusion's rounded edges, but flat faces: creased
// normals alone would bend the face edges toward the bevel and shade them unevenly.
function smoothEdges(geo) {
  const faces = geo.groups[0].count;
  // toCreasedNormals matches corners to 0.01 units, too coarse for a laptop: work at 1000×.
  toCreasedNormals(geo.scale(1000, 1000, 1000), Math.PI / 3).scale(0.001, 0.001, 0.001);
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < faces; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    c.sub(b).cross(a.sub(b)).normalize();
    for (let k = 0; k < 3; k++) nor.setXYZ(i + k, c.x, c.y, c.z);
  }
  return geo;
}

// Every key as { x, z, w, d, label } (left/back corner), in the laptop's frame.
function keyLayout() {
  const letters = (s) => [...s];
  const rows = [
    [0.6, ['Esc', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12', 'PrtSc', 'Del']],
    [1, [...letters('`1234567890-='), ['Backspace', 2]]],
    [1, [['Tab', 1.5], ...letters('QWERTYUIOP[]'), ['\\', 1.5]]],
    [1, [['Caps', 1.75], ...letters("ASDFGHJKL;'"), ['Enter', 2.25]]],
    [1, [['Shift', 2.25], ...letters('ZXCVBNM,./'), ['Shift', 2.75]]],
    [1, ['Ctrl', 'Fn', 'Win', 'Alt', ['', 5], 'Alt', 'Copilot', 'Ctrl']],
  ];
  const keys = [];
  let z = WELL.z0 + 0.006;
  for (const [height, row] of rows) {
    let u = 0;
    for (const key of row) {
      const [label, width] = Array.isArray(key) ? key : [key, 1];
      keys.push({ x: -KB_W / 2 + u * PITCH, z, w: width * PITCH, d: height * ROW, label });
      u += width;
    }
    z += height * ROW;
  }
  // Half-height arrows in the bottom-right corner, up stacked over down.
  const x = -KB_W / 2 + 12 * PITCH;
  const top = z - ROW;
  const half = ROW / 2;
  keys.push({ x, z: top + half, w: PITCH, d: half, label: '←' });
  keys.push({ x: x + PITCH, z: top, w: PITCH, d: half, label: '↑' });
  keys.push({ x: x + PITCH, z: top + half, w: PITCH, d: half, label: '↓' });
  keys.push({ x: x + 2 * PITCH, z: top + half, w: PITCH, d: half, label: '→' });
  return keys;
}

// The keyboard well, painted once: dark keys with light legends (map), and the
// legends plus a faint bleed round each key for the backlight (emissive map).
function keyboardTextures(keys) {
  const PX = 2400; // canvas pixels per world unit
  const make = () => {
    const c = document.createElement('canvas');
    c.width = Math.round(WELL.w * PX);
    c.height = Math.round(WELL.d * PX);
    return c;
  };
  const map = make();
  const glow = make();
  const g = map.getContext('2d');
  const e = glow.getContext('2d');
  g.fillStyle = '#0e0f11';
  g.fillRect(0, 0, map.width, map.height);
  e.fillStyle = '#000';
  e.fillRect(0, 0, glow.width, glow.height);
  const rect = (k) => [(k.x - WELL.x0 + KEY_GAP / 2) * PX, (k.z - WELL.z0 + KEY_GAP / 2) * PX, (k.w - KEY_GAP) * PX, (k.d - KEY_GAP) * PX];
  for (const k of keys) {
    const [x, y, w, h] = rect(k);
    g.fillStyle = '#1d1e22';
    g.beginPath();
    g.roundRect(x, y, w, h, 7);
    g.fill();
    g.strokeStyle = '#2b2d33';
    g.lineWidth = 2;
    g.stroke();
    e.save();
    e.shadowColor = 'rgba(150, 180, 255, 0.55)';
    e.shadowBlur = 10;
    e.fillStyle = '#000';
    e.fillRect(x, y, w, h);
    e.restore();
  }
  for (const [ctx, color] of [[g, '#aeb4bf'], [e, '#b8c6e8']]) {
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const k of keys) {
      const [x, y, w, h] = rect(k);
      if (k.label === 'Win') {
        for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) ctx.fillRect(x + w / 2 + (dx < 0 ? -11 : 1), y + h / 2 + (dy < 0 ? -11 : 1), 10, 10);
        continue;
      }
      const long = k.label.length > 1 && k.label.length < 10 && !'←↑↓→'.includes(k.label);
      ctx.font = `500 ${k.d < ROW ? 17 : long ? 19 : 27}px "Segoe UI", system-ui, sans-serif`;
      ctx.fillText(k.label, x + w / 2, y + h / 2 + 1, w - 10);
    }
  }
  return [map, glow].map((c) => {
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  });
}

// Keys and well floor as one mesh, UV-mapped from above onto the painted layout.
// The hinge rides along, mapped onto a plain corner of the well.
function keyboardGeometry(keys) {
  const floor = new THREE.PlaneGeometry(WELL.w, WELL.d).rotateX(-Math.PI / 2).translate(WELL.x0 + WELL.w / 2, -0.0025, WELL.z0 + WELL.d / 2);
  const caps = keys.map((k) => new THREE.BoxGeometry(k.w - KEY_GAP, 0.0029, k.d - KEY_GAP).translate(k.x + k.w / 2, -0.00105, k.z + k.d / 2).toNonIndexed());
  const deck = mergeGeometries([floor.toNonIndexed(), ...caps]);
  const pos = deck.attributes.position;
  const uv = deck.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    uv.setXY(i, (pos.getX(i) - WELL.x0) / WELL.w, 1 - (z - WELL.z0) / WELL.d);
    pos.setY(i, pos.getY(i) + deckY(z));
  }
  deck.computeVertexNormals();
  const hinge = new THREE.CylinderGeometry(0.0075, 0.0075, W - 0.09, 20).rotateZ(Math.PI / 2).translate(0, H_BACK + 0.001, -D / 2 + 0.012).toNonIndexed();
  const huv = hinge.attributes.uv;
  for (let i = 0; i < huv.count; i++) huv.setXY(i, 0.001, 0.999);
  return mergeGeometries([deck, hinge]);
}

// Base (with the keyboard well and touchpad cut in), touchpad and lid: all one
// aluminium finish, so one mesh.
function bodyGeometry() {
  const shape = roundedRect(new THREE.Shape(), 0, 0, W - 2 * BEVEL, D - 2 * BEVEL, RADIUS - BEVEL);
  // Shape y runs toward the back (-z) once the extrusion is laid flat.
  shape.holes.push(roundedRect(new THREE.Path(), WELL.x0 + WELL.w / 2, -(WELL.z0 + WELL.d / 2), WELL.w, WELL.d, 0.008));
  shape.holes.push(roundedRect(new THREE.Path(), 0, -PAD.z, PAD.w, PAD.d, 0.012));
  const base = new THREE.ExtrudeGeometry(shape, { depth: H_BACK - 2 * BEVEL, bevelThickness: BEVEL, bevelSize: BEVEL, bevelSegments: 4, curveSegments: 10 });
  base.translate(0, 0, BEVEL).rotateX(-Math.PI / 2);
  const pos = base.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, (pos.getY(i) * deckY(pos.getZ(i))) / H_BACK);
  smoothEdges(base);

  // The touchpad sits a hair below the deck, so the cut's rounded lip reads as its seam.
  const pad = new THREE.ShapeGeometry(roundedRect(new THREE.Shape(), 0, -PAD.z, PAD.w, PAD.d, 0.012), 8).rotateX(-Math.PI / 2).toNonIndexed();
  const pp = pad.attributes.position;
  for (let i = 0; i < pp.count; i++) pp.setY(i, deckY(pp.getZ(i)) - 0.0009);
  pad.computeVertexNormals();

  const lidShape = roundedRect(new THREE.Shape(), 0, LID_H / 2, W - 2 * LID_BEVEL, LID_H - 2 * LID_BEVEL, RADIUS - LID_BEVEL);
  const lid = new THREE.ExtrudeGeometry(lidShape, { depth: LID_T - 2 * LID_BEVEL, bevelThickness: LID_BEVEL, bevelSize: LID_BEVEL, bevelSegments: 3, curveSegments: 10 });
  lid.translate(0, 0, LID_BEVEL - LID_T); // screen side at z = 0
  smoothEdges(lid).applyMatrix4(LID);

  return mergeGeometries([base, pad, lid]);
}

// Edge-to-edge glass over the lid (black bezel), with the webcam in vertex colours.
function glassGeometry() {
  const inset = 0.004;
  const tint = (geo, hex) => {
    const g = geo.toNonIndexed();
    const c = new THREE.Color(hex);
    g.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: g.attributes.position.count }, () => [c.r, c.g, c.b]).flat(), 3));
    return g;
  };
  const glass = new THREE.ShapeGeometry(roundedRect(new THREE.Shape(), 0, LID_H / 2, W - 2 * inset, LID_H - 2 * inset, RADIUS - inset), 10).translate(0, 0, 0.0003);
  const ring = new THREE.CircleGeometry(0.0042, 20).translate(0, CAM_Y, 0.0005);
  const lens = new THREE.CircleGeometry(0.0021, 16).translate(0, CAM_Y, 0.0007);
  return mergeGeometries([tint(glass, '#07080a'), tint(ring, '#1f2228'), tint(lens, '#020308')]).applyMatrix4(LID);
}

// The four-pane logo, centred on the back of the lid.
function logoGeometry() {
  const s = 0.0105;
  const panes = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, y]) =>
    new THREE.PlaneGeometry(s * 2 - 0.0028, s * 2 - 0.0028).rotateY(Math.PI).translate(x * s, LID_H / 2 + y * s, -LID_T - 0.0004),
  );
  return mergeGeometries(panes).applyMatrix4(LID);
}

// A dim lock-screen glow for laptops at empty desks.
function idleTexture() {
  const c = document.createElement('canvas');
  c.width = 384;
  c.height = Math.round(384 / SCREEN_ASPECT);
  const g = c.getContext('2d');
  const bloom = g.createRadialGradient(c.width * 0.62, c.height * 0.7, 10, c.width * 0.55, c.height * 0.6, c.width * 0.7);
  bloom.addColorStop(0, '#1d3a6b');
  bloom.addColorStop(0.45, '#0f1b36');
  bloom.addColorStop(1, '#05070d');
  g.fillStyle = bloom;
  g.fillRect(0, 0, c.width, c.height);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let shared = null;

// Everything the laptops share, built on first use (it needs the renderer to
// prefilter a small studio environment, which gives the metal and glass their sheen).
function kit(gl) {
  if (shared) return shared;
  const pmrem = new THREE.PMREMGenerator(gl);
  const room = new RoomEnvironment();
  const env = pmrem.fromScene(room, 0.04).texture;
  room.dispose();
  pmrem.dispose();
  const keys = keyLayout();
  const [keyMap, keyGlow] = keyboardTextures(keys);
  const screen = (emissiveMap, envMapIntensity) =>
    new THREE.MeshStandardMaterial({ color: '#000', emissive: '#fff', emissiveMap, roughness: 0.08, metalness: 0, envMap: env, envMapIntensity, toneMapped: false });
  shared = {
    geometry: {
      body: bodyGeometry(),
      keyboard: keyboardGeometry(keys),
      glass: glassGeometry(),
      logo: logoGeometry(),
      display: new THREE.PlaneGeometry(SCREEN_W, SCREEN_H).translate(0, SCREEN_Y, 0.0009).applyMatrix4(LID),
    },
    finishes: FINISHES.map((f) => new THREE.MeshStandardMaterial({ color: f.color, metalness: f.metalness, roughness: f.roughness, envMap: env, envMapIntensity: 0.6 })),
    keys: new THREE.MeshStandardMaterial({ map: keyMap, emissive: '#fff', emissiveMap: keyGlow, emissiveIntensity: 0.55, roughness: 0.6 }),
    glass: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.06, metalness: 0, envMap: env, envMapIntensity: 0.3 }),
    logo: new THREE.MeshStandardMaterial({ color: '#e4e6ea', metalness: 1, roughness: 0.12, envMap: env, envMapIntensity: 1.3 }),
    idle: screen(idleTexture(), 0.1),
    // The live terminal behind the glass: the text as-is (like the canvas), plus a soft reflection.
    screen: (tex) => screen(tex, 0.06),
  };
  return shared;
}

// An empty desk's laptop shows a dim lock screen; a seated agent's shows its live terminal.
export function Laptop({ agentId }) {
  const gl = useThree((s) => s.gl);
  const k = kit(gl);
  const tex = useMemo(() => (agentId ? screenTexture() : null), [agentId]);
  const display = useMemo(() => (tex ? k.screen(tex) : k.idle), [tex, k]);
  useEffect(
    () => () => {
      tex?.dispose();
      if (display !== k.idle) display.dispose();
    },
    [tex, display, k],
  );
  const drawn = useRef({ tex: null, version: -1 });
  useFrame(() => {
    if (!tex) return;
    const sc = screens.get(agentId);
    if (sc && (sc.version !== drawn.current.version || tex !== drawn.current.tex)) {
      drawTerminal(tex, sc);
      drawn.current.tex = tex;
      drawn.current.version = sc.version;
    }
  });
  const g = k.geometry;
  return (
    <group>
      <mesh geometry={g.body} material={k.finishes[finishIndex(agentId)]} castShadow />
      <mesh geometry={g.keyboard} material={k.keys} />
      <mesh geometry={g.glass} material={k.glass} />
      <mesh geometry={g.logo} material={k.logo} />
      <mesh geometry={g.display} material={display} />
    </group>
  );
}
