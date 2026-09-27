import test from 'node:test';
import assert from 'node:assert/strict';
import { TV, BOARDS, PODS, step } from './layout.js';
import { tvReach, fitContain, tvVolume, TV_MAX_VOLUME } from './tv.js';

test('the TV hangs on the left wall, clear of the Guild Hall board and the nearest pod', () => {
  assert.ok(TV.x < -19.5);
  const guild = BOARDS.find((b) => b.id === 'guild');
  assert.ok(Math.abs(guild.z - TV.z) - TV.w / 2 - 2.7 > 0, 'no overlap with the Guild Hall board');
  const pod = PODS.find((p) => p.x === -11 && p.z === -5);
  assert.ok(TV.couch.x + TV.couch.w / 2 < pod.x - pod.w / 2, 'the couch stays off the pod mat');
});

test('you can reach the TV in front of it and from behind the couch, but not from across the room', () => {
  assert.ok(tvReach(-18, TV.z) !== null);
  assert.ok(tvReach(-14.2, TV.z) !== null, 'behind the couch');
  assert.ok(tvReach(-18, TV.z + TV.w / 2) !== null, 'at the edge of the screen');
  assert.equal(tvReach(-10, TV.z), null);
  assert.equal(tvReach(-18, 0), null, 'at the Guild Hall board');
  assert.equal(tvReach(-18, 5), null);
});

test('the couch is solid, and you can walk between it and the TV', () => {
  const front = { x: -17.5, z: -3, y: 0, level: 'ground' };
  assert.ok(step(front, -17.5, TV.z), 'walk along the wall to the front of the TV');
  const behind = { x: -14.2, z: TV.z, y: 0, level: 'ground' };
  assert.equal(step(behind, -14.9, TV.z), null, 'couch blocks');
  assert.ok(step(behind, -14.2, TV.z - 0.2), 'walkway behind the couch');
});

test('video is letterboxed to keep its aspect ratio', () => {
  assert.deepEqual(fitContain(1920, 1080, 16, 9), { w: 16, h: 9 });
  const tall = fitContain(1000, 1000, 5, 2.8);
  assert.equal(tall.h, 2.8);
  assert.ok(Math.abs(tall.w - 2.8) < 1e-9);
  const wide = fitContain(3000, 1000, 5, 2.8);
  assert.equal(wide.w, 5);
  assert.ok(Math.abs(wide.h - 5 / 3) < 1e-9);
  assert.deepEqual(fitContain(0, 0, 5, 2.8), { w: 5, h: 2.8 });
});

test('TV audio is modest up close, fades with distance, and is silent upstairs', () => {
  assert.equal(tvVolume(-17, TV.z), TV_MAX_VOLUME);
  const mid = tvVolume(-12, TV.z);
  assert.ok(mid > 0 && mid < TV_MAX_VOLUME);
  assert.equal(tvVolume(5, TV.z), 0);
  assert.equal(tvVolume(-17, TV.z, 'mezz'), 0);
});
