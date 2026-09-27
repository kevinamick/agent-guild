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

// Empty spots on the ground-floor side walls where people can hang pictures.
// `nx` is the wall's inward normal (+1 on the left wall, -1 on the right).
// The rest of the wall space is spoken for (boards, the TV, the stairs).
export const PICTURE_SPOTS = [
  { id: 'l1', x: -19.85, y: 2.5, z: 5, nx: 1 },
  { id: 'l2', x: -19.85, y: 2.5, z: 8.5, nx: 1 },
  { id: 'l3', x: -19.85, y: 2.5, z: 12, nx: 1 },
  { id: 'r1', x: 19.85, y: 2.5, z: -11.5, nx: -1 },
  { id: 'r2', x: 19.85, y: 2.5, z: -8, nx: -1 },
  { id: 'r3', x: 19.85, y: 2.5, z: -4.5, nx: -1 },
];
// The largest a picture gets; it keeps its aspect ratio inside this box.
export const PICTURE_MAX = { w: 2.2, h: 1.6 };

export function deskById(id) {
  return DESKS.find((d) => d.id === id);
}

export function nearestFreeDesk(occupied, from = DOOR) {
  return DESKS.filter((d) => !occupied.has(d.id))
    .sort((a, b) => Math.hypot(a.x - from.x, a.z - from.z) - Math.hypot(b.x - from.x, b.z - from.z))[0];
}

// The screen-sharing TV on the left wall (facing +x), with a lounge in front:
// a rug and a couch facing the screen. The couch leaves a walkway to the pod
// behind it and room to stand right in front of the TV.
export const TV = {
  x: -19.85, z: -8, y: 2.8, w: 5, h: 2.8,
  couch: { x: -15.2, z: -8, w: 0.9, d: 2.6 }, // w along x, d along z
};

// ---------------------------------------------------------------- furniture
// Everything here sits off the agents' walking routes (see agentPath), clear of
// the boards, the TV, the picture spots and the foot of the stairs.

// The lounge nook in the back-left corner: a sofa under the window, two armchairs
// and a coffee table on a rug. Sizes: w along x, d along z.
export const LOUNGE = {
  rug: { x: -12.4, z: -11.75, w: 5.2, d: 3.5 },
  sofa: { x: -12.4, z: -13.47, w: 3, d: 0.95 },
  table: { x: -12.4, z: -11.75, r: 0.5 },
  chairs: [
    { x: -14.55, z: -11.55, ry: Math.PI / 2 }, // facing +x, toward the table
    { x: -10.25, z: -11.55, ry: -Math.PI / 2 },
  ],
  lamp: { x: -14.75, z: -13.35 },
};

// The coffee bar along the back wall under the right-hand window, a tall fridge
// beside it and three stools in front.
export const COFFEE_BAR = { x0: 11, x1: 17.2, d: 0.7, h: 0.95, stools: [12.2, 13.8, 15.4], stoolZ: -12.8, fridge: { x0: 17.35, x1: 18.45, h: 2.15 } };

// Open shelving on the right wall between the last picture spot and the stairs.
export const SHELF = { x: ROOM.maxX, z0: -2.9, z1: 0.4, d: 0.42, h: 2.6 };

// Potted plants on the ground floor (kind: fig, monstera or snake; s = scale).
// The ones under the stairs sit where nobody can walk anyway.
export const PLANTERS = [
  { kind: 'fig', x: -19.1, z: -13.25, s: 1.25 },
  { kind: 'monstera', x: -15.75, z: -13.2, s: 1 },
  { kind: 'fig', x: 19.15, z: -13.25, s: 1.2 },
  { kind: 'monstera', x: 10.2, z: -13.25, s: 0.85 },
  { kind: 'fig', x: -19.1, z: 13.3, s: 1.15 },
  { kind: 'fig', x: 19.1, z: 13.3, s: 1.05 },
  { kind: 'monstera', x: 18.5, z: 7.9, s: 0.8 },
  { kind: 'snake', x: 18.6, z: 5.9, s: 1 },
];
const PLANTER_R = { fig: 0.34, monstera: 0.42, snake: 0.24 };

const rect = (x, z, w, d) => ({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
export const FURNITURE = [
  rect(LOUNGE.sofa.x, LOUNGE.sofa.z, LOUNGE.sofa.w, LOUNGE.sofa.d),
  rect(LOUNGE.table.x, LOUNGE.table.z, LOUNGE.table.r * 2, LOUNGE.table.r * 2),
  ...LOUNGE.chairs.map((c) => rect(c.x, c.z, 0.85, 0.85)),
  rect(LOUNGE.lamp.x, LOUNGE.lamp.z, 0.4, 0.4),
  { minX: COFFEE_BAR.x0, maxX: COFFEE_BAR.fridge.x1, minZ: ROOM.minZ, maxZ: ROOM.minZ + COFFEE_BAR.d },
  { minX: COFFEE_BAR.stools[0] - 0.3, maxX: COFFEE_BAR.stools[COFFEE_BAR.stools.length - 1] + 0.3, minZ: COFFEE_BAR.stoolZ - 0.3, maxZ: COFFEE_BAR.stoolZ + 0.3 },
  { minX: SHELF.x - SHELF.d, maxX: SHELF.x, minZ: SHELF.z0, maxZ: SHELF.z1 },
  ...PLANTERS.map((p) => rect(p.x, p.z, PLANTER_R[p.kind] * 2 * p.s, PLANTER_R[p.kind] * 2 * p.s)),
];

// Pods, the TV couch and the furniture are solid for the walking player; these are the blocking rectangles.
export const OBSTACLES = [
  ...PODS.map((p) => ({ minX: p.x - 2.1, maxX: p.x + 2.1, minZ: p.z - 1.25, maxZ: p.z + 1.25 })),
  { minX: TV.couch.x - TV.couch.w / 2, maxX: TV.couch.x + TV.couch.w / 2, minZ: TV.couch.z - TV.couch.d / 2, maxZ: TV.couch.z + TV.couch.d / 2 },
  ...FURNITURE,
];

// The route a newly hired agent walks from the door to its seat: across the
// front of the room, down an aisle, along the pod and in. It takes the nearest
// aisle whose route doesn't run through furniture. Returns [x, z] points.
const AISLES = [-16.5, -5.5, 5.5, 16.5];
const onRoute = (pts) => {
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.1);
    for (let k = 0; k <= n; k++) {
      const x = ax + ((bx - ax) * k) / n;
      const z = az + ((bz - az) * k) / n;
      if (OBSTACLES.some((o) => x > o.minX && x < o.maxX && z > o.minZ && z < o.maxZ)) return false;
    }
  }
  return true;
};
export function agentPath(desk) {
  const outward = desk.ry === 0 ? -1 : 1;
  const wz = desk.seatZ + outward * 0.9;
  const route = (cx) => [[DOOR.x, DOOR.z], [cx, 12], [cx, wz], [desk.seatX, wz], [desk.seatX, desk.seatZ]];
  const byDistance = [...AISLES].sort((a, b) => Math.abs(a - desk.seatX) - Math.abs(b - desk.seatX));
  return route(byDistance.find((cx) => onRoute(route(cx).slice(0, 4))) ?? byDistance[0]);
}

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
