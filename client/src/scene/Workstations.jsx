// The pods' furniture, all instanced: oak herringbone zones, white desks on black
// steel sled legs with cable trays, felt dividers, ergonomic mesh chairs, a few
// mugs and succulents, and a linear LED pendant over each pod. The laptops and
// the "free desk" markers stay per desk (see Office.jsx).
import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { PODS, DESKS, WALL_HEIGHT } from '../../../shared/layout.js';
import { decorKit, box, merge, paint, place, setInstances, POD_ACCENTS, PALETTE } from './decor.js';
import { localPlayer } from '../net.js';
import { Instanced } from './Instanced.jsx';
import { plantGeometry } from './Plants.jsx';

export const DESK_TOP_Y = 0.815; // the laptops sit on this (see Office.jsx)
export const PENDANT_Y = 3.3;

// Desk-local frame: origin on the floor under the desk's centre, +z toward the seat.
const deskGeometry = {
  top: () => new THREE.BoxGeometry(1.85, 0.05, 1.05).translate(0, DESK_TOP_Y - 0.025, 0),
  frame: () => {
    const parts = [];
    for (const sx of [-0.84, 0.84]) {
      for (const sz of [-0.44, 0.44]) parts.push(box(0.045, 0.75, 0.045, [sx, 0.39, sz]));
      parts.push(box(0.05, 0.04, 0.93, [sx, DESK_TOP_Y - 0.07, 0]), box(0.055, 0.03, 1.0, [sx, 0.015, 0]));
    }
    parts.push(box(1.64, 0.05, 0.035, [0, DESK_TOP_Y - 0.08, -0.42]));
    // a cable tray under the back edge
    parts.push(box(1.3, 0.012, 0.16, [0, 0.6, -0.32]), box(1.3, 0.08, 0.012, [0, 0.64, -0.24]), box(1.3, 0.08, 0.012, [0, 0.64, -0.4]));
    return merge(parts);
  },
};

// An ergonomic mesh chair. Local frame: the sitter faces -z, the backrest is at +z.
const chairGeometry = {
  frame: () => {
    const parts = [];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      parts.push(place(new THREE.BoxGeometry(0.05, 0.035, 0.3).translate(0, 0, 0.15), [0, 0.08, 0], [0.12, a, 0]));
      parts.push(place(new THREE.CylinderGeometry(0.028, 0.028, 0.035, 8).rotateZ(Math.PI / 2), [Math.sin(a) * 0.29, 0.03, Math.cos(a) * 0.29], [0, a, 0]));
    }
    parts.push(new THREE.CylinderGeometry(0.028, 0.034, 0.36, 10).translate(0, 0.28, 0));
    parts.push(box(0.26, 0.05, 0.26, [0, 0.46, 0]));
    // armrests
    for (const sx of [-0.28, 0.28]) parts.push(box(0.035, 0.22, 0.035, [sx, 0.6, 0.05]), box(0.07, 0.03, 0.26, [sx, 0.72, 0.02]));
    // spine and back frame (tilted a little)
    parts.push(box(0.06, 0.34, 0.03, [0, 0.62, 0.3], [-0.12, 0, 0]));
    const back = [box(0.5, 0.035, 0.035, [0, 0.72, 0]), box(0.5, 0.035, 0.035, [0, 1.3, 0]), box(0.035, 0.6, 0.035, [-0.24, 1.01, 0]), box(0.035, 0.6, 0.035, [0.24, 1.01, 0])];
    for (const g of back) parts.push(place(g, [0, 0, 0.3], [-0.12, 0, 0]).translate(0, 0.02, 0));
    return merge(parts);
  },
  seat: () => new THREE.BoxGeometry(0.5, 0.075, 0.48).translate(0, 0.52, -0.01),
  back: () => {
    const g = new THREE.BoxGeometry(0.46, 0.56, 0.015).translate(0, 1.01, 0);
    return place(g, [0, 0.02, 0.3], [-0.12, 0, 0]);
  },
};

// A linear pendant: a slim black bar (glowing underneath) on two cables.
const pendantGeometry = {
  bar: () => new THREE.BoxGeometry(3.4, 0.04, 0.09),
  glow: () => new THREE.PlaneGeometry(3.3, 0.06).rotateX(Math.PI / 2).translate(0, -0.026, 0),
  cable: () => new THREE.CylinderGeometry(0.006, 0.006, WALL_HEIGHT - PENDANT_Y, 4).translate(0, (WALL_HEIGHT - PENDANT_Y) / 2, 0),
};

const mugGeometry = () =>
  merge([
    paint(new THREE.CylinderGeometry(0.05, 0.045, 0.11, 14, 1, true).translate(0, 0.055, 0), '#ffffff'),
    paint(new THREE.CylinderGeometry(0.045, 0.045, 0.005, 14).translate(0, 0.004, 0), '#ffffff'),
    paint(new THREE.CylinderGeometry(0.043, 0.043, 0.005, 14).translate(0, 0.085, 0), '#5a3a26'),
    paint(new THREE.TorusGeometry(0.028, 0.008, 5, 10, Math.PI).rotateZ(-Math.PI / 2).translate(0.05, 0.055, 0), '#ffffff'),
  ]);

let geo = null;
export const workstationGeometry = () =>
  (geo ??= {
    top: deskGeometry.top(),
    frame: deskGeometry.frame(),
    chairFrame: chairGeometry.frame(),
    chairSeat: chairGeometry.seat(),
    chairBack: chairGeometry.back(),
    zone: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    divider: new THREE.BoxGeometry(3.7, 0.3, 0.03),
    pendantBar: pendantGeometry.bar(),
    pendantGlow: pendantGeometry.glow(),
    cable: pendantGeometry.cable(),
    mug: mugGeometry(),
  });

// A pendant over each pod. From the follow camera, which looks down from above
// and behind you, the pendants between it and you would hang right across the
// view, so those are taken out (like the mezzanine's cutaway); from eye level
// in first person, and from upstairs, they're all there.
function Pendants({ g, k, glow }) {
  const bars = useRef();
  const glows = useRef();
  const cables = useRef();
  const shown = useRef('');
  useFrame(({ camera }) => {
    const hidden = PODS.map((p) => camera.position.y > PENDANT_Y + 0.3 && localPlayer.level === 'ground' && p.z > localPlayer.z - 2.5);
    const key = hidden.join();
    if (key === shown.current) return;
    shown.current = key;
    const s = (i) => (hidden[i] ? 0 : 1);
    const bar = PODS.map((p, i) => ({ p: [p.x, PENDANT_Y, p.z], s: s(i) }));
    setInstances(bars.current, bar);
    setInstances(glows.current, bar);
    setInstances(cables.current, PODS.flatMap((p, i) => [-1.45, 1.45].map((dx) => ({ p: [p.x + dx, PENDANT_Y, p.z], s: s(i) }))));
  });
  return (
    <>
      <instancedMesh ref={bars} args={[g.pendantBar, k.steel, PODS.length]} />
      <instancedMesh ref={glows} args={[g.pendantGlow, glow, PODS.length]} />
      <instancedMesh ref={cables} args={[g.cable, k.steel, PODS.length * 2]} />
    </>
  );
}

// The pod zone is a little smaller than the pod, so the agents' floor lanes run just outside it.
export const ZONE = { w: 5.4, d: 4.5 };

export function Workstations() {
  const gl = useThree((s) => s.gl);
  const k = decorKit(gl);
  const g = workstationGeometry();
  const mats = useMemo(() => {
    const zone = new THREE.MeshStandardMaterial({ map: k.tex.herringbone, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    const zoneEdge = new THREE.MeshStandardMaterial({ color: PALETTE.steel, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -0.5, polygonOffsetUnits: -0.5 });
    const seat = new THREE.MeshStandardMaterial({ color: '#fff', map: k.tex.weave, roughness: 0.9 });
    const back = new THREE.MeshStandardMaterial({ color: '#2b2e33', roughness: 0.85, transparent: true, opacity: 0.88 });
    const felt = new THREE.MeshStandardMaterial({ color: '#fff', map: k.tex.weave, roughness: 1 });
    const mug = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4 });
    return { zone, zoneEdge, seat, back, felt, mug, glow: k.glow(PALETTE.warmLight) };
  }, [k]);

  const items = useMemo(() => {
    const deskRot = (d) => (d.ry === 0 ? Math.PI : 0); // desk-local +z toward the seat
    const accent = (d) => POD_ACCENTS[d.pod % POD_ACCENTS.length];
    const mugColors = ['#f1ece4', '#c0664a', '#2f3134', '#8f9d7c'];
    // A few things on the desks: mugs on some, a succulent on others (clear of the laptop).
    const mugs = DESKS.filter((d, i) => i % 3 === 0).map((d, i) => {
      const side = d.ry === 0 ? -1 : 1;
      return { p: [d.x + 0.65, DESK_TOP_Y, d.z + side * 0.15], r: i, color: mugColors[i % mugColors.length] };
    });
    const succulents = DESKS.filter((d, i) => i % 4 === 2).map((d) => ({ kind: 'succulent', p: [d.x - 0.68, DESK_TOP_Y, d.z + (d.ry === 0 ? 0.3 : -0.3)], r: d.id }));
    return {
      desks: DESKS.map((d) => ({ p: [d.x, 0, d.z], r: deskRot(d) })),
      chairs: DESKS.map((d) => ({ p: [d.seatX, 0, d.seatZ], r: deskRot(d) + (((d.id * 37) % 9) - 4) * 0.03, color: accent(d) })),
      zones: PODS.map((p) => ({ p: [p.x, 0.006, p.z], s: [ZONE.w, 1, ZONE.d] })),
      zoneEdges: PODS.map((p) => ({ p: [p.x, 0.004, p.z], s: [ZONE.w + 0.1, 1, ZONE.d + 0.1] })),
      dividers: PODS.map((p) => ({ p: [p.x, DESK_TOP_Y + 0.15, p.z], color: POD_ACCENTS[p.id % POD_ACCENTS.length] })),
      mugs,
      succulents,
    };
  }, []);

  return (
    <group>
      <Instanced geometry={g.zone} material={mats.zoneEdge} items={items.zoneEdges} receiveShadow />
      <Instanced geometry={g.zone} material={mats.zone} items={items.zones} receiveShadow />
      <Instanced geometry={g.top} material={k.deskTop} items={items.desks} castShadow receiveShadow />
      <Instanced geometry={g.frame} material={k.steel} items={items.desks} castShadow />
      <Instanced geometry={g.divider} material={mats.felt} items={items.dividers} castShadow />
      <Instanced geometry={g.chairFrame} material={k.graphite} items={items.chairs} castShadow />
      <Instanced geometry={g.chairSeat} material={mats.seat} items={items.chairs} castShadow />
      <Instanced geometry={g.chairBack} material={mats.back} items={items.chairs} />
      <Instanced geometry={g.mug} material={mats.mug} items={items.mugs} />
      <Instanced geometry={plantGeometry('succulent')} material={k.painted} items={items.succulents} />
      <Pendants g={g} k={k} glow={mats.glow} />
    </group>
  );
}
