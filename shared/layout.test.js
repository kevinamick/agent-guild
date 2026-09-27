import test from 'node:test';
import assert from 'node:assert/strict';
import { step, STAIRS, MEZZ, DESKS, BOARDS, PICTURE_SPOTS, BOSS_DESK, OBSTACLES, FURNITURE, agentPath } from './layout.js';
import { tvReach } from './tv.js';

// Walk in small steps along z, trying the move like the client does.
function walk(p, dz, steps) {
  for (let i = 0; i < steps; i++) {
    const next = step(p, p.x, p.z + dz);
    if (next) p = next;
  }
  return p;
}

const midStairX = (STAIRS.x0 + STAIRS.x1) / 2;

test('climb the stairs from the bottom onto the mezzanine, and back down', () => {
  let p = { x: midStairX, z: 0, y: 0, level: 'ground' };
  p = walk(p, 0.1, 120);
  assert.equal(p.level, 'mezz');
  assert.equal(p.y, MEZZ.y);
  p = walk(p, -0.1, 140);
  assert.equal(p.level, 'ground');
  assert.equal(p.y, 0);
});

test('halfway up the stairs you are halfway up', () => {
  let p = { x: midStairX, z: 0, y: 0, level: 'ground' };
  p = walk(p, 0.1, 10 + Math.round((STAIRS.z1 - STAIRS.z0) / 2 / 0.1));
  assert.equal(p.level, 'stairs');
  assert.ok(Math.abs(p.y - MEZZ.y / 2) < 0.3, `y=${p.y}`);
});

test('no stepping onto the stairs from the side, and no walking off the balcony', () => {
  const side = { x: STAIRS.x0 - 0.6, z: 5, y: 0, level: 'ground' };
  assert.equal(step(side, STAIRS.x0 + 0.5, 5), null);
  const office = { x: 12, z: MEZZ.z0 + 0.5, y: MEZZ.y, level: 'mezz' };
  assert.equal(step(office, 12, MEZZ.z0 + 0.2), null, 'front railing');
  assert.equal(step(office, 12, MEZZ.z1), null, 'front edge');
  assert.equal(step(office, MEZZ.minX + 0.2, office.z), null, 'side railing');
});

test('walking under the mezzanine stays on the ground', () => {
  const p = { x: 0, z: 9, y: 0, level: 'ground' };
  const next = step(p, 0, 11);
  assert.equal(next.level, 'ground');
  assert.equal(next.y, 0);
});

// Everywhere a walker can get to from the spawn point, stepping 0.25 at a time like the client.
function reachable() {
  const G = 0.25;
  const start = { x: 0, z: 11, y: 0, level: 'ground' };
  const key = (p) => `${p.level}:${Math.round(p.x / G)}:${Math.round(p.z / G)}`;
  const seen = new Map([[key(start), start]]);
  const queue = [start];
  while (queue.length) {
    const p = queue.shift();
    for (const [dx, dz] of [[G, 0], [-G, 0], [0, G], [0, -G]]) {
      const next = step(p, +(p.x + dx).toFixed(3), +(p.z + dz).toFixed(3));
      if (next && !seen.has(key(next))) {
        seen.set(key(next), next);
        queue.push(next);
      }
    }
  }
  return [...seen.values()];
}

test('the furniture leaves every desk, board, picture spot, the TV and the boss reachable', () => {
  const all = reachable();
  const ground = all.filter((p) => p.level === 'ground');
  for (const d of DESKS) assert.ok(ground.some((p) => Math.hypot(d.seatX - p.x, d.seatZ - p.z) < 1.4), `desk ${d.id}`);
  for (const b of BOARDS) {
    const reach = (p) => (b.side ? Math.hypot(b.x - p.x, (b.z - p.z) * 0.45) : Math.hypot((b.x - p.x) * 0.45, b.z - p.z));
    assert.ok(ground.some((p) => reach(p) < 2.2), `board ${b.id}`);
  }
  for (const s of PICTURE_SPOTS) assert.ok(ground.some((p) => Math.abs(s.x - p.x) < 2.2 && Math.abs(s.z - p.z) < 1), `picture ${s.id}`);
  assert.ok(ground.some((p) => tvReach(p.x, p.z) !== null && tvReach(p.x, p.z) < 1), 'the TV');
  assert.ok(all.some((p) => p.level === 'mezz' && Math.hypot(BOSS_DESK.x - p.x, (BOSS_DESK.z - p.z) * 0.8) < 2), "the boss's desk");
});

test("agents walk to their desks without going through furniture", () => {
  for (const d of DESKS) {
    const pts = agentPath(d);
    assert.deepEqual(pts.at(-1), [d.seatX, d.seatZ]);
    for (let i = 0; i < pts.length - 2; i++) {
      const [ax, az] = pts[i];
      const [bx, bz] = pts[i + 1];
      for (let t = 0; t <= 1; t += 0.01) {
        const x = ax + (bx - ax) * t;
        const z = az + (bz - az) * t;
        const o = OBSTACLES.find((o) => x > o.minX && x < o.maxX && z > o.minZ && z < o.maxZ);
        assert.ok(!o, `desk ${d.id} walks through ${JSON.stringify(o)} at ${x.toFixed(2)},${z.toFixed(2)}`);
      }
    }
  }
});

test('furniture is solid', () => {
  for (const o of FURNITURE) {
    const x = (o.minX + o.maxX) / 2;
    const z = Math.min((o.minZ + o.maxZ) / 2, 13);
    assert.equal(step({ x, z: z + 3, y: 0, level: 'ground' }, x, z), null, JSON.stringify(o));
  }
});
