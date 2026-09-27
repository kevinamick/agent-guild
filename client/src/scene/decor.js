// The office's art direction in one place: an "oak and evergreen" loft. Polished
// warm concrete with light-oak herringbone under the pods, warm plaster walls and
// a deep evergreen accent wall, blackened steel, brass details and terracotta,
// sage and oat textiles. Everything here is built once and shared: materials,
// procedural canvas textures (no image assets) and small geometry helpers.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export const PALETTE = {
  evergreen: '#20392f',
  plaster: '#f0eadf',
  concrete: '#bfb8ad',
  oak: '#d3b28a',
  oakDark: '#a9845a',
  walnut: '#6b4a33',
  steel: '#1d1e20',
  graphite: '#34373b',
  brass: '#c4a062',
  terracotta: '#c0664a',
  sage: '#8f9d7c',
  oat: '#e5dccb',
  navy: '#2c3a52',
  mustard: '#cf9f45',
  ceiling: '#6b6d70',
  deskTop: '#f2efe9',
  warmLight: '#ffe3b8',
};

// Each pod gets a muted accent (its chairs' seats and the felt divider).
export const POD_ACCENTS = [PALETTE.terracotta, PALETTE.sage, PALETTE.navy, PALETTE.mustard, '#3f6b5c', '#b98378'];

// A tiny deterministic random, so textures and plant shapes look the same for everyone.
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(w, h, draw, { repeat, srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(...repeat);
  }
  tex.anisotropy = 8;
  return tex;
}

// ------------------------------------------------------------------ textures

// Polished concrete: soft mottling and saw-cut joints at the tile edges (one tile = 4 m).
function concreteTexture(repeat) {
  return canvasTexture(512, 512, (g, w, h) => {
    const r = rng(7);
    g.fillStyle = '#cbc3b6';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 220; i++) {
      const x = r() * w;
      const y = r() * h;
      const rad = 40 + r() * 110;
      const light = r() > 0.5;
      const grad = g.createRadialGradient(x, y, 0, x, y, rad);
      grad.addColorStop(0, light ? 'rgba(236,230,220,0.06)' : 'rgba(120,110,98,0.045)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      // draw wrapped so the tile repeats seamlessly
      for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) g.fillRect(x - rad + ox, y - rad + oy, rad * 2, rad * 2);
    }
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = r() > 0.5 ? 'rgba(90,82,72,0.16)' : 'rgba(250,246,240,0.18)';
      g.fillRect(r() * w, r() * h, 1 + r() * 1.5, 1 + r() * 1.5);
    }
    g.fillStyle = 'rgba(70,64,56,0.35)';
    g.fillRect(0, 0, w, 2);
    g.fillRect(0, 0, 2, h);
    g.fillStyle = 'rgba(255,255,255,0.18)';
    g.fillRect(0, 2, w, 1);
    g.fillRect(2, 0, 1, h);
  }, { repeat });
}

// Light-oak herringbone. The pattern is periodic in a 512 px square, so it tiles.
function herringboneTexture(repeat) {
  return canvasTexture(512, 512, (g, W, H) => {
    const w = 512 / 16 / Math.SQRT2; // plank width, so the stair-step period is 32 px across
    const L = 4 * w; // plank length
    const tones = ['#d8b88f', '#cfae83', '#dcc099', '#c9a578', '#d4b287', '#e0c6a0'];
    g.fillStyle = '#b8966c';
    g.fillRect(0, 0, W, H);
    g.save();
    g.rotate(-Math.PI / 4);
    const plank = (x, y, pw, ph, s, k, horizontal) => {
      const r = rng(((((s % 16) + 16) % 16) * 7 + (((k % 4) + 4) % 4)) * 2 + (horizontal ? 1 : 0) + 11);
      g.fillStyle = tones[Math.floor(r() * tones.length)];
      g.fillRect(x + 0.6, y + 0.6, pw - 1.2, ph - 1.2);
      // grain along the plank
      g.strokeStyle = 'rgba(120,86,50,0.16)';
      g.lineWidth = 0.8;
      for (let i = 0; i < 4; i++) {
        const t = 0.15 + r() * 0.7;
        g.beginPath();
        if (horizontal) {
          g.moveTo(x + 2, y + ph * t);
          g.bezierCurveTo(x + pw * 0.3, y + ph * (t + (r() - 0.5) * 0.2), x + pw * 0.7, y + ph * (t + (r() - 0.5) * 0.2), x + pw - 2, y + ph * t);
        } else {
          g.moveTo(x + pw * t, y + 2);
          g.bezierCurveTo(x + pw * (t + (r() - 0.5) * 0.2), y + ph * 0.3, x + pw * (t + (r() - 0.5) * 0.2), y + ph * 0.7, x + pw * t, y + ph - 2);
        }
        g.stroke();
      }
    };
    for (let k = -8; k <= 8; k++) {
      for (let s = -40; s <= 40; s++) {
        const ox = s * w + k * L;
        const oy = s * w - k * L;
        plank(ox, oy, L, w, s, k, true);
        plank(ox + L, oy + w - L, w, L, s, k, false);
      }
    }
    g.restore();
  }, { repeat });
}

// Cork for the pinboards.
function corkTexture() {
  return canvasTexture(256, 256, (g, w, h) => {
    const r = rng(3);
    g.fillStyle = '#c29a6b';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 5000; i++) {
      const c = r();
      g.fillStyle = c < 0.4 ? 'rgba(120,80,45,0.45)' : c < 0.75 ? 'rgba(214,176,128,0.5)' : 'rgba(90,58,30,0.35)';
      const s = 1 + r() * 2.5;
      g.fillRect(r() * w, r() * h, s, s);
    }
  }, { repeat: [3, 1.5] });
}

// A preserved-moss wall: thousands of little clumps in several greens.
function mossTexture() {
  return canvasTexture(256, 432, (g, w, h) => {
    const r = rng(21);
    g.fillStyle = '#243b22';
    g.fillRect(0, 0, w, h);
    const greens = ['#3d5f2c', '#4f7432', '#5f8a38', '#2f4d27', '#7a9a45', '#6e8f3d', '#9bb35a', '#445f30'];
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = greens[Math.floor(r() * greens.length)];
      g.globalAlpha = 0.55 + r() * 0.45;
      g.beginPath();
      g.arc(r() * w, r() * h, 1 + r() * 3.2, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  });
}

// Daytime city through the factory windows: sky, haze and three layers of buildings.
function skylineTexture() {
  return canvasTexture(2048, 600, (g, w, h) => {
    const r = rng(42);
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#7fa9c9');
    sky.addColorStop(0.35, '#b4cfe0');
    sky.addColorStop(0.62, '#e9e4d6');
    sky.addColorStop(1, '#f0dfc6');
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);
    // soft clouds
    for (let i = 0; i < 26; i++) {
      const x = r() * w;
      const y = 40 + r() * 170;
      const cw = 80 + r() * 220;
      const grad = g.createRadialGradient(x, y, 0, x, y, cw);
      grad.addColorStop(0, 'rgba(255,255,255,0.55)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.save();
      g.translate(x, y);
      g.scale(1, 0.28);
      g.translate(-x, -y);
      g.fillRect(x - cw, y - cw, cw * 2, cw * 2);
      g.restore();
    }
    const layer = (base, minH, maxH, color, windows, seed) => {
      const q = rng(seed);
      let x = -20;
      while (x < w) {
        const bw = 40 + q() * 110;
        const bh = minH + q() * (maxH - minH);
        g.fillStyle = color;
        g.fillRect(x, base - bh, bw, h);
        if (q() < 0.25) g.fillRect(x + bw * 0.4, base - bh - 26, 3, 26); // antenna
        if (windows) {
          g.fillStyle = windows;
          for (let wy = base - bh + 10; wy < h; wy += 14) for (let wx = x + 6; wx < x + bw - 8; wx += 11) if (q() < 0.7) g.fillRect(wx, wy, 6, 8);
        }
        x += bw + q() * 14;
      }
    };
    layer(h * 0.62, 20, 150, 'rgba(160,180,196,0.85)', null, 5);
    layer(h * 0.78, 60, 230, '#8d9fb0', 'rgba(220,232,240,0.35)', 9);
    // a few near warehouses in brick, with a rooftop water tower
    layer(h * 0.95, 70, 180, '#6f7d8b', 'rgba(230,238,244,0.28)', 13);
    for (const x of [300, 1350]) {
      const tower = x === 300;
      g.fillStyle = '#9a5b44';
      g.fillRect(x, h * 0.55, 260, h);
      g.fillStyle = 'rgba(40,30,26,0.55)';
      for (let wy = h * 0.58; wy < h; wy += 34) for (let wx = x + 14; wx < x + 250; wx += 40) g.fillRect(wx, wy, 24, 20);
      if (!tower) continue;
      g.fillStyle = '#4b3a30';
      g.fillRect(x + 170, h * 0.55 - 60, 8, 60);
      g.fillRect(x + 222, h * 0.55 - 60, 8, 60);
      g.fillRect(x + 160, h * 0.55 - 110, 80, 56);
      g.beginPath();
      g.moveTo(x + 154, h * 0.55 - 110);
      g.lineTo(x + 200, h * 0.55 - 146);
      g.lineTo(x + 246, h * 0.55 - 110);
      g.fill();
    }
    const haze = g.createLinearGradient(0, h * 0.4, 0, h);
    haze.addColorStop(0, 'rgba(240,228,210,0)');
    haze.addColorStop(1, 'rgba(240,228,210,0.35)');
    g.fillStyle = haze;
    g.fillRect(0, 0, w, h);
  });
}

// A soft round shadow for baked contact shadows under furniture (an alpha map:
// white is opaque, black clear).
function blobTexture() {
  return canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
    const grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grad.addColorStop(0, 'rgb(150,150,150)');
    grad.addColorStop(0.5, 'rgb(80,80,80)');
    grad.addColorStop(1, 'rgb(0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  }, { srgb: false });
}

// Light falling from a ceiling cove down a wall: bright at the top, fading out.
function washTexture() {
  return canvasTexture(8, 256, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(255,214,160,0.55)');
    grad.addColorStop(0.25, 'rgba(255,200,140,0.22)');
    grad.addColorStop(1, 'rgba(255,190,130,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  });
}

// Fine weave for felt and upholstery, as a bump-free colour texture (white, tinted by the material).
function weaveTexture() {
  return canvasTexture(128, 128, (g, w, h) => {
    const r = rng(17);
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = r() > 0.5 ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.5)';
      g.fillRect(r() * w, r() * h, 1 + r() * 2, 1);
    }
  }, { repeat: [2, 2] });
}

// ----------------------------------------------------------------- the kit

let kit = null;

// The shared materials and textures. Metals and glass get a small prefiltered
// studio environment for their sheen (on the material only, so characters and
// everything else keep the scene's plain lighting).
export function decorKit(gl) {
  if (kit) return kit;
  const pmrem = new THREE.PMREMGenerator(gl);
  const room = new RoomEnvironment();
  const env = pmrem.fromScene(room, 0.04).texture;
  room.dispose();
  pmrem.dispose();
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const weave = weaveTexture();
  kit = {
    env,
    tex: {
      concrete: concreteTexture([10, 7]),
      herringbone: herringboneTexture([2, 1.6]),
      cork: corkTexture(),
      moss: mossTexture(),
      skyline: skylineTexture(),
      blob: blobTexture(),
      wash: washTexture(),
      weave,
    },
    steel: std({ color: PALETTE.steel, roughness: 0.42, metalness: 0.7, envMap: env, envMapIntensity: 0.5 }),
    graphite: std({ color: PALETTE.graphite, roughness: 0.55, metalness: 0.3, envMap: env, envMapIntensity: 0.3 }),
    brass: std({ color: PALETTE.brass, roughness: 0.3, metalness: 0.9, envMap: env, envMapIntensity: 1 }),
    chrome: std({ color: '#d9dcdf', roughness: 0.18, metalness: 1, envMap: env, envMapIntensity: 1.1 }),
    glass: std({ color: '#dfeef2', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.16, envMap: env, envMapIntensity: 1, depthWrite: false }),
    oak: std({ color: PALETTE.oak, roughness: 0.6 }),
    oakDark: std({ color: PALETTE.oakDark, roughness: 0.6 }),
    walnut: std({ color: PALETTE.walnut, roughness: 0.5 }),
    deskTop: std({ color: PALETTE.deskTop, roughness: 0.5 }),
    plaster: std({ color: PALETTE.plaster, roughness: 0.95 }),
    evergreen: std({ color: PALETTE.evergreen, roughness: 0.92 }),
    ceiling: std({ color: PALETTE.ceiling, emissive: '#27282b', roughness: 1 }),
    fabric: (color) => std({ color, map: weave, roughness: 0.95 }),
    // Plants, the moss bumps and anything else built with per-vertex colours.
    painted: std({ vertexColors: true, roughness: 0.78, side: THREE.DoubleSide }),
    paintedSolid: std({ vertexColors: true, roughness: 0.7 }),
    blob: new THREE.MeshBasicMaterial({ color: '#1a140e', transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    glow: (color) => new THREE.MeshBasicMaterial({ color, toneMapped: false }),
  };
  kit.blob.alphaMap = kit.tex.blob;
  return kit;
}

// ---------------------------------------------------------- geometry helpers

// Give a geometry one flat colour per vertex (to merge differently coloured parts into one mesh).
export function paint(geo, color) {
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
// Move a geometry into place: position [x, y, z], rotation [rx, ry, rz], scale (number or [x, y, z]).
export function place(geo, pos = [0, 0, 0], rot = [0, 0, 0], scale = 1) {
  _q.setFromEuler(_e.set(rot[0], rot[1], rot[2]));
  _s.set(...(Array.isArray(scale) ? scale : [scale, scale, scale]));
  geo.applyMatrix4(_m.compose(_p.set(...pos), _q, _s));
  return geo;
}

export const box = (w, h, d, pos, rot) => place(new THREE.BoxGeometry(w, h, d), pos, rot);

// Merge parts (all indexed or all not; they're converted to match). Colours are kept if every part has them.
export function merge(parts) {
  const indexed = parts.every((p) => p.index);
  const ready = parts.map((p) => {
    let g = indexed ? p : p.index ? p.toNonIndexed() : p;
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(name)) g.deleteAttribute(name);
    return g;
  });
  const hasColor = ready.every((g) => g.attributes.color);
  if (!hasColor) for (const g of ready) if (g.attributes.color) g.deleteAttribute('color');
  const hasUv = ready.every((g) => g.attributes.uv);
  if (!hasUv) for (const g of ready) if (g.attributes.uv) g.deleteAttribute('uv');
  const out = mergeGeometries(ready, false);
  for (const p of parts) p.dispose();
  return out;
}

// Fill an InstancedMesh from a list of { p: [x, y, z], r: ry | [rx, ry, rz], s, color }.
export function setInstances(mesh, items) {
  if (!mesh) return;
  items.forEach((it, i) => {
    const r = Array.isArray(it.r) ? it.r : [0, it.r || 0, 0];
    _q.setFromEuler(_e.set(r[0], r[1], r[2]));
    const s = it.s ?? 1;
    _s.set(...(Array.isArray(s) ? s : [s, s, s]));
    mesh.setMatrixAt(i, _m.compose(_p.set(...it.p), _q, _s));
    if (it.color) mesh.setColorAt(i, new THREE.Color(it.color));
  });
  mesh.count = items.length;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
}
