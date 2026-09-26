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

// ---------------------------------------------------------------- upper floor
// The boss's office is a raised corner office over the front-right corner,
// cantilevered (no posts), with glass on its two open sides so the whole lower
// level is in view. Stairs run up the right-hand wall into it.
export const MEZZ = { y: 4, z0: 9.5, z1: 14, minX: 10.5, maxX: ROOM.maxX };
export const STAIRS = { x0: 17.4, x1: 19.6, z0: 1, z1: MEZZ.z0 };
export const WALL_HEIGHT = 9;
export const BOSS_DESK = { x: 14.2, z: 11.3, w: 3.2, d: 1.3 };

const MEZZ_OBSTACLES = [
  { minX: BOSS_DESK.x - BOSS_DESK.w / 2, maxX: BOSS_DESK.x + BOSS_DESK.w / 2, minZ: BOSS_DESK.z - BOSS_DESK.d / 2, maxZ: BOSS_DESK.z + BOSS_DESK.d / 2 },
  { minX: 19.0, maxX: 19.9, minZ: 11.2, maxZ: 13.4 }, // bookshelf, right wall
];

const R = 0.35;
const hits = (x, z, o) => x > o.minX - R && x < o.maxX + R && z > o.minZ - R && z < o.maxZ + R;
const inStairs = (x, z) => x > STAIRS.x0 && x < STAIRS.x1 && z > STAIRS.z0 && z < STAIRS.z1;
export const stairHeight = (z) => MEZZ.y * Math.min(1, Math.max(0, (z - STAIRS.z0) / (STAIRS.z1 - STAIRS.z0)));
export const levelForY = (y) => (y >= MEZZ.y - 0.05 ? 'mezz' : y > 0.05 ? 'stairs' : 'ground');

// One movement step for a walker { x, z, y, level }. Returns the new position, or
// null when blocked. Callers try x and z separately so walkers slide along walls.
export function step(p, nx, nz) {
  if (p.level === 'stairs') {
    if (nx < STAIRS.x0 + R || nx > STAIRS.x1 - R) return null; // side rails
    if (nz <= STAIRS.z0) return { x: nx, z: nz, y: 0, level: 'ground' };
    if (nz >= STAIRS.z1) return { x: nx, z: nz, y: MEZZ.y, level: 'mezz' };
    return { x: nx, z: nz, y: stairHeight(nz), level: 'stairs' };
  }
  if (p.level === 'mezz') {
    // The only way down is the stair opening in the railing.
    if (nz < MEZZ.z0 + R) {
      if (nx > STAIRS.x0 + R && nx < STAIRS.x1 - R) return { x: nx, z: nz, y: stairHeight(nz), level: 'stairs' };
      return null;
    }
    if (nx < MEZZ.minX + R || nx > MEZZ.maxX - R || nz > MEZZ.z1 - R) return null;
    if (MEZZ_OBSTACLES.some((o) => hits(nx, nz, o))) return null;
    return { x: nx, z: nz, y: MEZZ.y, level: 'mezz' };
  }
  // Ground: stairs are only entered from their bottom end.
  if (inStairs(nx, nz) || (nx > STAIRS.x0 - R && nx < STAIRS.x1 + R && nz > STAIRS.z0 && nz < STAIRS.z1)) {
    const fromBottom = p.z <= STAIRS.z0 + 0.01 && nx > STAIRS.x0 + R && nx < STAIRS.x1 - R;
    return fromBottom ? { x: nx, z: nz, y: stairHeight(nz), level: 'stairs' } : null;
  }
  if (nx < ROOM.minX + R || nx > ROOM.maxX - R || nz < ROOM.minZ + 0.6 || nz > ROOM.maxZ - R) return null;
  if (OBSTACLES.some((o) => hits(nx, nz, o))) return null;
  return { x: nx, z: nz, y: 0, level: 'ground' };
}
