// Office floor plan in world units (x right, z toward the camera).
export const ROOM = { minX: -20, maxX: 20, minZ: -14, maxZ: 14 };
export const DOOR = { x: 0, z: 13.5 };

const POD_COLORS = ['#f9c5e8', '#c8f0c0', '#bfe0fb', '#fde2b8', '#dccbfb', '#c5f1ec'];
const POD_CENTERS = [
  [-11, -5], [0, -5], [11, -5],
  [-11, 5.5], [0, 5.5], [11, 5.5],
];

// Each pod is two desks facing two desks. A desk's seat sits on the outer side
// and `ry` turns a seated agent to face the pod's center.
export const PODS = POD_CENTERS.map(([x, z], i) => ({ id: i, x, z, color: POD_COLORS[i], w: 5.6, d: 4.8 }));

export const DESKS = PODS.flatMap((pod) =>
  [
    [-0.95, -1], [0.95, -1],
    [-0.95, 1], [0.95, 1],
  ].map(([dx, side], j) => ({
    id: pod.id * 4 + j + 1,
    pod: pod.id,
    x: pod.x + dx,
    z: pod.z + side * 0.55,
    seatX: pod.x + dx,
    seatZ: pod.z + side * 1.55,
    ry: side < 0 ? 0 : Math.PI,
  })),
);

export const BOARDS = [
  { id: 'issues', label: 'Issues', x: -6, z: -13.7, color: '#f9c5e8' },
  { id: 'prs', label: 'Pull Requests', x: 6, z: -13.7, color: '#c8f0c0' },
  { id: 'guild', label: 'Guild Hall', x: -19.7, z: 0, color: '#fde68a', side: true },
];

export function deskById(id) {
  return DESKS.find((d) => d.id === id);
}

export function nearestFreeDesk(occupied, from = DOOR) {
  return DESKS.filter((d) => !occupied.has(d.id))
    .sort((a, b) => Math.hypot(a.x - from.x, a.z - from.z) - Math.hypot(b.x - from.x, b.z - from.z))[0];
}

// Pods are solid for the walking player; this returns the blocking rectangles.
export const OBSTACLES = PODS.map((p) => ({ minX: p.x - 2.1, maxX: p.x + 2.1, minZ: p.z - 1.25, maxZ: p.z + 1.25 }));
