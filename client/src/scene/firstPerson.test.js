import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moveVector, clampPitch, MAX_PITCH, lookDirection, viewOffset, pickTarget, wrapAngle, ease } from './firstPerson.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);
const keys = (...k) => new Set(k);

test('W walks the way you look; the default facing (ry = PI) is the back wall (-z)', () => {
  const v = moveVector(Math.PI, keys('w'));
  near(v.dx, 0);
  near(v.dz, -1);
  const up = moveVector(Math.PI, keys('arrowup'));
  near(up.dz, -1);
  const east = moveVector(Math.PI / 2, keys('w'));
  near(east.dx, 1);
  near(east.dz, 0);
});

test('S backs up, A/D strafe left/right of the look direction', () => {
  const back = moveVector(Math.PI, keys('s'));
  near(back.dz, 1);
  // Facing -z, your right hand is +x.
  const right = moveVector(Math.PI, keys('d'));
  near(right.dx, 1);
  near(right.dz, 0);
  const left = moveVector(Math.PI, keys('arrowleft'));
  near(left.dx, -1);
  // Facing +x, right is +z.
  const r2 = moveVector(Math.PI / 2, keys('d'));
  near(r2.dx, 0);
  near(r2.dz, 1);
});

test('diagonals are normalized and opposite keys cancel', () => {
  const v = moveVector(0.7, keys('w', 'd'));
  near(Math.hypot(v.dx, v.dz), 1);
  assert.equal(moveVector(1, keys('w', 's')), null);
  assert.equal(moveVector(1, keys()), null);
  const onlyStrafe = moveVector(1, keys('w', 's', 'a'));
  near(Math.hypot(onlyStrafe.dx, onlyStrafe.dz), 1);
});

test('pitch clamps to about ±80°', () => {
  near(MAX_PITCH, (80 * Math.PI) / 180);
  assert.equal(clampPitch(3), MAX_PITCH);
  assert.equal(clampPitch(-3), -MAX_PITCH);
  assert.equal(clampPitch(0.3), 0.3);
});

test('look direction matches the avatar facing and tilts with pitch', () => {
  const d = lookDirection(Math.PI, 0);
  near(d.z, -1);
  near(d.y, 0);
  const upward = lookDirection(0, Math.PI / 4);
  near(upward.y, Math.SQRT1_2);
  near(Math.hypot(upward.x, upward.y, upward.z), 1);
  near(wrapAngle(3 * Math.PI), Math.PI, 1e-9);
  near(ease(0), 0);
  near(ease(1), 1);
  near(ease(0.5), 0.5);
});

const eye = { x: 0, y: 1.6, z: 0 };
const agentA = { focus: { type: 'agent', agentId: 'a' }, d: 1.2, x: -1, y: 1.2, z: -1.5 };
const agentB = { focus: { type: 'agent', agentId: 'b' }, d: 1.5, x: 1, y: 1.2, z: -1.5 };

test('picks what is closest to the center of view, not what is nearest', () => {
  // Looking toward B (front-right, facing roughly -z): B wins although A is nearer.
  const yawB = Math.atan2(1, -1.5);
  const r = pickTarget([agentA, agentB], eye, yawB, 0);
  assert.deepEqual(r, { focus: agentB.focus, aimed: true });
  const yawA = Math.atan2(-1, -1.5);
  assert.equal(pickTarget([agentA, agentB], eye, yawA, 0).focus.agentId, 'a');
});

test('falls back to the nearest thing in reach when nothing is in view', () => {
  // Facing away (+z): neither is in the aim cone.
  const r = pickTarget([agentB, agentA], eye, 0, 0);
  assert.deepEqual(r, { focus: agentA.focus, aimed: false });
  assert.deepEqual(pickTarget([], eye, 0, 0), { focus: null, aimed: false });
});

test('wall items: anywhere on the board counts, and pitch matters', () => {
  // A wide board on the back wall (spans x, at z = -3), centered well off to the left.
  const board = { focus: { type: 'board', board: 'issues' }, d: 2, x: -2.5, y: 2.6, z: -3, wall: { axis: 'x', half: 3.2, halfH: 1.6 } };
  // Looking straight ahead hits the board's right part: dead center.
  near(viewOffset(board, eye, Math.PI, 0), 0, 1e-6);
  // Looking at the floor in front of you is not looking at the board.
  assert.ok(viewOffset(board, eye, Math.PI, -1.2) > 0.6);
  assert.equal(pickTarget([board], eye, Math.PI, -1.2).aimed, false);
  // A side-wall item (spans z at fixed x).
  const tv = { focus: { type: 'tv' }, d: 1, x: -3, y: 2.8, z: 0, wall: { axis: 'z', half: 2.5, halfH: 1.4 } };
  near(viewOffset(tv, eye, -Math.PI / 2, 0.2), 0, 1e-6);
  assert.ok(viewOffset(tv, eye, Math.PI / 2, 0) > 3); // behind you
});

test('looking along a wall is not looking at the board on it', () => {
  // Standing near the back wall, looking down the room (+x) past the board's edge.
  const board = { focus: { type: 'board', board: 'issues' }, d: 2, x: -6, y: 2.6, z: -13.7, wall: { axis: 'x', half: 3.2, halfH: 1.6 } };
  const at = { x: -6.05, y: 1.6, z: -11.8 };
  assert.equal(pickTarget([board], at, Math.PI / 2, 0).aimed, false);
  assert.equal(pickTarget([board], at, Math.PI, 0).aimed, true);
});

test('pitch counts less for things on the floor', () => {
  // Looking level at an agent sitting a step ahead still aims at them.
  const ahead = { focus: { type: 'agent', agentId: 'c' }, d: 1.3, x: 0, y: 1.2, z: -1.3 };
  assert.equal(pickTarget([ahead], eye, Math.PI, 0).aimed, true);
  assert.equal(pickTarget([ahead], eye, Math.PI, -0.5).aimed, true);
});
