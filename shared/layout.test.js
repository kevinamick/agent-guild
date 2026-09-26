import test from 'node:test';
import assert from 'node:assert/strict';
import { step, STAIRS, MEZZ } from './layout.js';

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
  const balcony = { x: 0, z: MEZZ.z0 + 0.5, y: MEZZ.y, level: 'mezz' };
  assert.equal(step(balcony, 0, MEZZ.z0 + 0.2), null, 'railing');
  assert.equal(step(balcony, 0, MEZZ.z1), null, 'front edge');
});

test('walking under the mezzanine stays on the ground', () => {
  const p = { x: 0, z: 9, y: 0, level: 'ground' };
  const next = step(p, 0, 11);
  assert.equal(next.level, 'ground');
  assert.equal(next.y, 0);
});
