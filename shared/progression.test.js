import test from 'node:test';
import assert from 'node:assert/strict';
import { xpForLevel, levelFor, progress, turnXp, playbookCapacity, overallLevel, emptyXp, hatFor } from './progression.js';

test('level curve is monotonic and round-trips', () => {
  for (let l = 1; l < 30; l++) {
    assert.ok(xpForLevel(l + 1) > xpForLevel(l));
    assert.equal(levelFor(xpForLevel(l)), l);
    assert.equal(levelFor(xpForLevel(l + 1) - 1), l);
  }
  assert.equal(levelFor(0), 1);
  assert.equal(levelFor(60), 2);
});

test('progress reports fraction into the level', () => {
  const p = progress(xpForLevel(4) + 10);
  assert.equal(p.level, 4);
  assert.equal(p.into, 10);
  assert.ok(p.pct > 0 && p.pct < 1);
});

test('turn xp rewards real work and caps', () => {
  assert.equal(turnXp({ toolCalls: 0 }).amount, 2);
  assert.equal(turnXp({ toolCalls: 5, durationMs: 0 }).amount, 20);
  assert.equal(turnXp({ toolCalls: 5, prOpened: true }).amount, 70);
  assert.equal(turnXp({ toolCalls: 100, durationMs: 3.6e6, prOpened: true, prMerged: true, reviewed: true }).amount, 200);
});

test('higher skill level means a bigger playbook', () => {
  assert.equal(playbookCapacity(1), 5);
  assert.ok(playbookCapacity(10) > playbookCapacity(5));
  assert.equal(playbookCapacity(99), 45);
});

test('overall level and hats', () => {
  assert.equal(overallLevel(emptyXp()), 1);
  assert.equal(hatFor(1), null);
  assert.equal(hatFor(3), 'beanie');
  assert.equal(hatFor(16), 'crown');
});

import { sanitizeAvatar } from './avatar.js';

test('avatar input is clamped to known options', () => {
  const a = sanitizeAvatar({ gender: 'woman', skin: '#3b2219', hair: 'afro', hairColor: 'javascript:alert(1)', shirt: '<b>' });
  assert.equal(a.gender, undefined);
  assert.equal(a.hair, 'afro');
  assert.equal(a.hairColor, '#3b2314');
  assert.equal(a.shirt, '#3b82f6');
  assert.equal(sanitizeAvatar().hair, 'short');
});
