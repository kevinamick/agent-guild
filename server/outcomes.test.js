import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanOutcome, recordOutcome, pruneLedger } from './outcomes.js';

const report = (event, extra = {}) => ({ t: 'outcome', agentId: 'a1', event, pr: { key: 'github:Guild/Smoke#12', number: 12, title: 'Fix login', skill: 'issue', ...extra } });

test('outcome reports are checked and tidied', () => {
  assert.deepEqual(cleanOutcome(report('merged')), { event: 'merged', key: 'github:guild/smoke#12', number: 12, title: 'Fix login', skill: 'issue' });
  assert.equal(cleanOutcome(report('merged', { skill: 'hacking' })).skill, 'issue');
  assert.equal(cleanOutcome(report('merged', { skill: 'conflict' })).skill, 'conflict');
  assert.equal(cleanOutcome(report('merged', { key: 'ado:contoso/web%20app/site#7' })).number, 7);
  assert.equal(cleanOutcome(report('bonus')), null);
  assert.equal(cleanOutcome(report('ci', { key: 'github:o/r' })), null);
  assert.equal(cleanOutcome(report('ci', { key: 'gitlab:o/r#1' })), null);
  assert.equal(cleanOutcome(report('ci', { key: 'github:o r#1' })), null);
  assert.equal(cleanOutcome({ t: 'outcome', event: 'ci' }), null);
  assert.equal(cleanOutcome(null), null);
});

test('each outcome pays once per PR, in the skill that opened it', () => {
  const profile = {};
  const ci = cleanOutcome(report('ci'));
  assert.deepEqual(recordOutcome(profile, ci, 1), { award: true, skill: 'issue' });
  assert.deepEqual(recordOutcome(profile, ci, 2), { award: false, skill: 'issue' });
  // A later report naming another skill doesn't move the PR's skill.
  assert.deepEqual(recordOutcome(profile, cleanOutcome(report('merged', { skill: 'general' })), 3), { award: true, skill: 'issue' });
  assert.deepEqual(recordOutcome(profile, cleanOutcome(report('merged')), 4), { award: false, skill: 'issue' });
  assert.deepEqual(recordOutcome(profile, cleanOutcome(report('reverted')), 5), { award: true, skill: 'issue' });
  assert.deepEqual(recordOutcome(profile, cleanOutcome(report('reverted')), 6), { award: false, skill: 'issue' });
  assert.deepEqual(profile.outcomes['github:guild/smoke#12'], { skill: 'issue', number: 12, title: 'Fix login', ci: 1, merged: 3, reverted: 5, at: 5 });
  // Survives a restart: the ledger is plain JSON on the profile.
  const reloaded = JSON.parse(JSON.stringify(profile));
  assert.equal(recordOutcome(reloaded, ci, 7).award, false);
});

test('a revert only costs a merge that was paid, and a merge after its revert pays nothing', () => {
  const profile = {};
  assert.equal(recordOutcome(profile, cleanOutcome(report('reverted')), 1).award, false);
  assert.equal(recordOutcome(profile, cleanOutcome(report('merged')), 2).award, false);
  assert.equal(recordOutcome(profile, cleanOutcome(report('ci', { key: 'github:o/r#1' })), 3).award, true);
});

test('the ledger keeps the newest entries', () => {
  const ledger = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`github:o/r#${i}`, { at: i }]));
  pruneLedger(ledger, 3);
  assert.deepEqual(Object.keys(ledger).sort(), ['github:o/r#2', 'github:o/r#3', 'github:o/r#4']);
});
