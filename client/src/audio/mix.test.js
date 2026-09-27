import test from 'node:test';
import assert from 'node:assert/strict';
import { falloff, voiceVolume, sfxVolume, hearingDistance, panFor, rightVector, surfaceAt, speakingState, VOICE_NEAR, VOICE_FAR, FLOOR_DAMPING } from './mix.js';

test('falloff is full inside near, silent past far, and decreasing in between', () => {
  assert.equal(falloff(0, 4, 14), 1);
  assert.equal(falloff(4, 4, 14), 1);
  assert.equal(falloff(14, 4, 14), 0);
  assert.equal(falloff(40, 4, 14), 0);
  let last = 1;
  for (let d = 4.5; d < 14; d += 0.5) {
    const v = falloff(d, 4, 14);
    assert.ok(v > 0 && v < last, `falloff(${d}) = ${v}`);
    last = v;
  }
});

test('voice is full volume nearby and silent across the room', () => {
  const me = { x: 0, y: 0, z: 0 };
  assert.equal(VOICE_NEAR, 4);
  assert.equal(VOICE_FAR, 14);
  assert.equal(voiceVolume(me, { x: 3, y: 0, z: 2 }), 1);
  assert.equal(voiceVolume(me, { x: 14, y: 0, z: 1 }), 0);
  const mid = voiceVolume(me, { x: 9, y: 0, z: 0 });
  assert.ok(mid > 0.1 && mid < 0.5, `mid-range ${mid}`);
});

test('the corner office and the ground floor barely hear each other', () => {
  const boss = { x: 14, y: 4, z: 11 };
  // Standing right below the corner office: faint.
  const below = voiceVolume(boss, { x: 14, y: 0, z: 11 });
  assert.ok(below > 0 && below < 0.25, `below ${below}`);
  // The same distance on one floor would be full volume.
  assert.equal(voiceVolume({ x: 14, y: 0, z: 7 }, { x: 14, y: 0, z: 11 }), 1);
  // A few steps away on the ground floor: silent.
  assert.equal(voiceVolume(boss, { x: 10, y: 0, z: 6 }), 0);
  assert.equal(hearingDistance(boss, { x: 14, y: 0, z: 11 }), 4 * FLOOR_DAMPING);
  // Someone on the stairs is heard normally from either floor.
  const stairs = { x: 18.5, y: 2, z: 5 };
  assert.equal(hearingDistance(stairs, { x: 18.5, y: 0, z: 3 }), Math.hypot(2, 2));
  assert.ok(voiceVolume(stairs, { x: 17, y: 4, z: 10 }) > 0);
});

test('sfx volume uses its own range', () => {
  const me = { x: 0, z: 0 };
  assert.equal(sfxVolume(me, { x: 1, z: 0 }), 1);
  assert.equal(sfxVolume(me, { x: 12, z: 0 }), 0);
  assert.equal(sfxVolume(me, { x: 5, z: 0 }, 6, 10), 1);
});

test('pan follows screen left/right and is clamped', () => {
  const me = { x: 0, z: 0 };
  assert.equal(panFor(me, { x: 0, z: -5 }), 0);
  assert.ok(panFor(me, { x: 3, z: 0 }) > 0);
  assert.ok(panFor(me, { x: -3, z: 0 }) < 0);
  assert.equal(panFor(me, { x: 50, z: 0 }), 0.8);
  assert.equal(panFor(me, { x: -50, z: 0 }), -0.8);
  // Upstairs the camera looks diagonally, so something straight ahead of the view is centered.
  const up = rightVector('mezz');
  assert.ok(Math.abs(panFor(me, { x: -10, z: -13 }, up)) < 1e-9);
  assert.ok(Math.abs(Math.hypot(...up) - 1) < 1e-9);
  assert.deepEqual(rightVector('ground'), [1, 0]);
});

test('footstep surface follows the floor', () => {
  assert.equal(surfaceAt(0), 'floor');
  assert.equal(surfaceAt(undefined), 'floor');
  assert.equal(surfaceAt(2), 'stairs');
  assert.equal(surfaceAt(4), 'carpet');
});

test('speaking indicator holds briefly after the voice drops', () => {
  let s = speakingState(null, 0, 0);
  assert.equal(s.speaking, false);
  s = speakingState(s, 0.1, 1000);
  assert.equal(s.speaking, true);
  s = speakingState(s, 0, 1200);
  assert.equal(s.speaking, true);
  s = speakingState(s, 0, 1400);
  assert.equal(s.speaking, false);
});
