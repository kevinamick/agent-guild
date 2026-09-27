// Leafy plants, built from procedural leaves with per-vertex colour. Each kind is
// one merged geometry (pot, stems and leaves), drawn instanced: one draw call per
// kind however many are placed.
import { useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { decorKit, paint, merge, rng } from './decor.js';
import { Instanced } from './Instanced.jsx';

// A leaf as a small grid: base at the origin, pointing +y, upper face +z.
// hw(v) is the half-width along the leaf (v 0..1); fold cups it along the midrib,
// droop bends the tip down, and slit(u, v) cuts quads out (monstera holes, fern combs).
function leaf({ len, wid, hw, fold = 0.25, droop = 0.15, color, tint = 0, slit, nu = 6, nv = 10 }) {
  const pos = [];
  const col = [];
  const base = new THREE.Color(color);
  const c = new THREE.Color();
  for (let j = 0; j <= nv; j++) {
    const v = j / nv;
    const half = (wid / 2) * hw(v);
    for (let i = 0; i <= nu; i++) {
      const u = -1 + (2 * i) / nu;
      pos.push(u * half, v * len, fold * Math.abs(u) * half - droop * len * v * v);
      // a lighter midrib and a slightly darker edge
      c.copy(base).offsetHSL(0, 0, tint + (Math.abs(u) < 0.2 ? 0.05 : -0.02 * Math.abs(u)));
      col.push(c.r, c.g, c.b);
    }
  }
  const idx = [];
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      if (slit && slit(-1 + (2 * (i + 0.5)) / nu, (j + 0.5) / nv)) continue;
      const a = j * (nu + 1) + i;
      const b = a + 1;
      const d = a + nu + 1;
      const e = d + 1;
      idx.push(a, b, e, a, e, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((pos.length / 3) * 2).fill(0), 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
// Tilt a leaf `pitch` away from upright toward its heading `yaw`, then move it to `at`.
function aim(g, at, yaw, pitch, roll = 0, scale = 1) {
  _q.setFromEuler(_e.set(-pitch, yaw, roll));
  return g.applyMatrix4(_m.compose(_v.set(...at), _q, _s.set(scale, scale, scale)));
}
const cyl = (rt, rb, h, color, at, seg = 16) => paint(new THREE.CylinderGeometry(rt, rb, h, seg).translate(...at), color);
// A thin stem from a to b.
function stem(a, b, r, color) {
  const A = new THREE.Vector3(...a);
  const B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const g = new THREE.CylinderGeometry(r * 0.7, r, len, 5).translate(0, len / 2, 0);
  _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  g.applyMatrix4(_m.compose(A, _q, _s.set(1, 1, 1)));
  return paint(g, color);
}
// A planter: a slightly tapered cylinder with a rim and a disc of soil.
function pot(r, h, color, taper = 0.82) {
  return [
    cyl(r, r * taper, h, color, [0, h / 2, 0], 24),
    paint(new THREE.TorusGeometry(r - 0.012, 0.014, 6, 24).rotateX(Math.PI / 2).translate(0, h, 0), color),
    cyl(r - 0.02, r - 0.02, 0.02, '#3b2f25', [0, h - 0.03, 0], 16),
  ];
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

function fig() {
  const r = rng(101);
  const parts = pot(0.26, 0.52, '#ebe6dc');
  const trunk = '#6d5641';
  parts.push(stem([0, 0.5, 0], [0.04, 1.95, 0.02], 0.032, trunk), stem([0.02, 1.15, 0], [-0.22, 1.75, 0.08], 0.02, trunk));
  const greens = ['#2d5a2a', '#356532', '#3f7038', '#2a5227'];
  const n = 36;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const onBranch = i % 5 === 2;
    const y = 1.0 + t * 1.15;
    const yaw = i * GOLDEN * 2.1;
    const len = 0.36 - t * 0.1 + r() * 0.05;
    const lf = leaf({
      len,
      wid: len * 0.78,
      hw: (v) => Math.pow(Math.sin(Math.PI * Math.min(v, 0.98)), 0.6) * (0.5 + 0.65 * v),
      fold: 0.35,
      droop: 0.12 + r() * 0.1,
      color: greens[i % greens.length],
      tint: (r() - 0.5) * 0.06,
      nu: 4,
      nv: 6,
    });
    const cx = onBranch ? -0.22 * (y - 1.15) / 0.6 : 0.04 * t;
    parts.push(aim(lf, [cx + Math.sin(yaw) * 0.03, y, Math.cos(yaw) * 0.03], yaw, 0.55 + (1 - t) * 0.5 + r() * 0.2, (r() - 0.5) * 0.4));
  }
  return merge(parts);
}

function monstera() {
  const r = rng(202);
  const parts = pot(0.34, 0.42, '#b9694b', 0.8);
  const greens = ['#2f6b3a', '#377640', '#285e33', '#3c7d44'];
  const slits = [0.3, 0.44, 0.58, 0.72, 0.84];
  for (let i = 0; i < 10; i++) {
    const yaw = i * GOLDEN * 1.7;
    const out = 0.18 + r() * 0.3;
    const top = [Math.sin(yaw) * out, 0.7 + r() * 0.55, Math.cos(yaw) * out];
    parts.push(stem([Math.sin(yaw) * 0.05, 0.4, Math.cos(yaw) * 0.05], top, 0.014, '#4d7a3c'));
    const len = 0.5 + r() * 0.18;
    const lf = leaf({
      len,
      wid: len * 1.05,
      hw: (v) => Math.pow(Math.sin(Math.PI * Math.min(Math.max(v, 0.04), 0.98)), 0.55) * (1 - 0.25 * v),
      fold: 0.18,
      droop: 0.3,
      color: greens[i % greens.length],
      tint: (r() - 0.5) * 0.05,
      nu: 8,
      nv: 22,
      slit: (u, v) => Math.abs(u) > 0.4 && slits.some((s) => Math.abs(v - s) < 0.025),
    });
    parts.push(aim(lf, top, yaw, 0.9 + r() * 0.45, (r() - 0.5) * 0.3));
  }
  return merge(parts);
}

function snake() {
  const r = rng(303);
  const parts = pot(0.2, 0.36, '#2f3134', 0.9);
  for (let i = 0; i < 13; i++) {
    const yaw = i * GOLDEN * 1.3;
    const len = 0.65 + r() * 0.45;
    const lf = leaf({
      len,
      wid: 0.11,
      hw: (v) => Math.pow(1 - v, 0.6) * (0.6 + 0.4 * Math.sin(Math.PI * v)),
      fold: 0.25,
      droop: 0.02,
      color: i % 3 ? '#2f5236' : '#3d6340',
      tint: (r() - 0.5) * 0.05,
      nu: 4,
      nv: 6,
    });
    // the pale yellow edge of the leaves
    const colAttr = lf.attributes.color;
    for (let k = 0; k < colAttr.count; k++) if (k % 5 === 0 || k % 5 === 4) colAttr.setXYZ(k, 0.72, 0.7, 0.36);
    const out = 0.03 + r() * 0.08;
    parts.push(aim(lf, [Math.sin(yaw) * out, 0.33, Math.cos(yaw) * out], yaw, 0.05 + r() * 0.25, (r() - 0.5) * 0.6));
  }
  return merge(parts);
}

// A pothos in a hanging bowl, trailing vines. Its origin is the bowl's rim; the
// cord up to the ceiling is drawn separately (see Room.jsx).
function pothos() {
  const r = rng(404);
  const parts = [paint(new THREE.SphereGeometry(0.22, 18, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), '#efe9df')];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    parts.push(stem([Math.sin(a) * 0.21, 0, Math.cos(a) * 0.21], [0, 0.75, 0], 0.006, '#d8cbb3'));
  }
  const greens = ['#4f8a3c', '#62a04a', '#3f7533', '#8fb65a'];
  const heart = (v) => Math.pow(Math.sin(Math.PI * Math.min(Math.max(v, 0.06), 0.97)), 0.7) * (1.1 - 0.6 * v);
  for (let i = 0; i < 10; i++) {
    const yaw = i * GOLDEN * 3;
    parts.push(aim(leaf({ len: 0.12, wid: 0.11, hw: heart, fold: 0.2, droop: 0.05, color: greens[i % 4], nu: 4, nv: 5 }), [Math.sin(yaw) * 0.12, 0.0, Math.cos(yaw) * 0.12], yaw, 0.7 + r() * 0.5));
  }
  for (let vIdx = 0; vIdx < 8; vIdx++) {
    const a = vIdx * GOLDEN * 2.3;
    const length = 0.6 + r() * 1.1;
    const out = [Math.sin(a), Math.cos(a)];
    for (let s = 0; s < length / 0.09; s++) {
      const t = (s * 0.09) / length;
      const x = out[0] * (0.2 + 0.12 * Math.sin(t * 2)) + Math.sin(s * 1.7) * 0.03;
      const z = out[1] * (0.2 + 0.12 * Math.sin(t * 2)) + Math.cos(s * 1.3) * 0.03;
      const y = -s * 0.09;
      const side = s % 2 ? 1 : -1;
      parts.push(aim(leaf({ len: 0.1, wid: 0.09, hw: heart, fold: 0.2, droop: 0.04, color: greens[(s + vIdx) % 4], nu: 2, nv: 3 }), [x, y, z], a + side * 1.1, 1.9 + r() * 0.5, side * 0.4));
    }
  }
  return merge(parts);
}

// Arching fern fronds (for the planter under the moss wall); no pot.
function fern() {
  const r = rng(505);
  const parts = [];
  for (let i = 0; i < 16; i++) {
    const yaw = i * GOLDEN * 2;
    parts.push(
      aim(
        leaf({
          len: 0.45 + r() * 0.2,
          wid: 0.2,
          hw: (v) => Math.sin(Math.PI * Math.min(v * 0.9 + 0.08, 1)),
          fold: 0.1,
          droop: 0.45,
          color: i % 2 ? '#4f7d35' : '#5d8c3d',
          nu: 4,
          nv: 14,
          slit: (u, v) => Math.abs(u) > 0.3 && Math.floor(v * 14) % 2 === 1,
        }),
        [0, 0, 0],
        yaw,
        0.45 + r() * 0.5,
      ),
    );
  }
  return merge(parts);
}

// A little succulent in a concrete pot, for desks and shelves.
function succulent() {
  const parts = [cyl(0.055, 0.048, 0.08, '#b7b2aa', [0, 0.04, 0], 12)];
  for (let i = 0; i < 9; i++) {
    const yaw = i * GOLDEN * 2;
    parts.push(aim(leaf({ len: 0.06, wid: 0.035, hw: (v) => Math.sin(Math.PI * Math.min(v * 0.9 + 0.1, 1)), fold: 0.5, droop: 0.02, color: i % 2 ? '#7fa37a' : '#91b489', nu: 2, nv: 3 }), [0, 0.075, 0], yaw, 0.6 + (i % 3) * 0.3));
  }
  return merge(parts);
}

const BUILDERS = { fig, monstera, snake, pothos, fern, succulent };
const cache = {};
export const plantGeometry = (kind) => (cache[kind] ??= BUILDERS[kind]());

// items: [{ kind, x, y?, z, s?, r? }]; one instanced mesh per kind.
export function Plants({ items, castShadow = true }) {
  const gl = useThree((s) => s.gl);
  const k = decorKit(gl);
  const byKind = useMemo(() => {
    const out = {};
    for (const it of items) (out[it.kind] ??= []).push({ p: [it.x, it.y || 0, it.z], r: it.r ?? (it.x * 1.7 + it.z) % 6.28, s: it.s ?? 1 });
    return out;
  }, [items]);
  return Object.entries(byKind).map(([kind, list]) => (
    <Instanced key={kind} geometry={plantGeometry(kind)} material={k.painted} items={list} castShadow={castShadow} />
  ));
}
