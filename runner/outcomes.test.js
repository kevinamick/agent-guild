import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  toolOutput, prFromHook, newTracked, observe, failed, unacked, pruneTracked, pollDelay, pollTimes, readTracked, writeTracked, outcomeMessage, REVERT_WINDOW_MS,
} from './outcomes.js';

const ref = { host: 'github', repo: 'o/r', number: 12, url: 'https://github.com/o/r/pull/12' };
const status = (extra = {}) => ({ state: 'OPEN', ci: 'pending', title: 'Fix login', base: 'main', mergedAt: null, mergeCommit: null, ...extra });
const MIN = 60 * 1000;

test("reads a finished tool's output from Claude and Copilot hooks", () => {
  assert.equal(toolOutput({ tool_response: { stdout: 'https://github.com/o/r/pull/3\n', stderr: '' } }).trim(), 'https://github.com/o/r/pull/3');
  assert.equal(toolOutput({ toolResult: { resultType: 'success', textResultForLlm: 'done: https://github.com/o/r/pull/4' } }), 'done: https://github.com/o/r/pull/4');
  assert.equal(toolOutput({ tool_response: 'plain' }), 'plain');
  assert.equal(toolOutput({}), '');
  assert.equal(prFromHook({ toolResult: { textResultForLlm: 'https://github.com/o/r/pull/4' } }).number, 4);
  assert.equal(prFromHook({ tool_response: { stdout: 'no pr' } }), null);
});

test('polls back off while nothing changes; the test interval is fixed', () => {
  assert.equal(pollDelay(0), 2 * MIN);
  assert.equal(pollDelay(1), 3 * MIN);
  assert.equal(pollDelay(50), 30 * MIN);
  assert.deepEqual(pollTimes('250'), { base: 250, max: 250 });
  assert.deepEqual(pollTimes(''), { base: 2 * MIN, max: 30 * MIN });
});

test('follows a PR through CI, merge and revert, reporting each once', () => {
  const rec = newTracked(ref, 'issue', 0);
  assert.equal(rec.key, 'github:o/r#12');
  assert.deepEqual(observe(rec, status(), [], 1000), []);
  assert.equal(rec.nextPollAt, 1000 + pollDelay(1));
  assert.deepEqual(observe(rec, status({ ci: 'passed' }), [], 2000), ['ci']);
  assert.equal(rec.polls, 0);
  assert.deepEqual(observe(rec, status({ ci: 'passed' }), [], 3000), []);
  // A revert before the merge is meaningless; after it, a matching commit counts.
  const revert = [{ sha: 'b', message: 'Revert "Fix login"\n\nThis reverts commit abc1234.' }];
  const merged = status({ state: 'MERGED', ci: 'passed', mergedAt: new Date(4000).toISOString(), mergeCommit: 'abc1234def' });
  assert.deepEqual(observe(rec, merged, [{ sha: 'a', message: 'unrelated' }], 4000), ['merged']);
  assert.equal(rec.done, false);
  assert.deepEqual(observe(rec, merged, revert, 5000), ['reverted']);
  assert.equal(rec.done, true);
  assert.deepEqual(unacked(rec), ['ci', 'merged', 'reverted']);
  rec.acked.ci = 1;
  assert.deepEqual(unacked(rec), ['merged', 'reverted']);
  assert.deepEqual(outcomeMessage('a1', rec, 'merged'), { t: 'outcome', agentId: 'a1', event: 'merged', pr: { key: 'github:o/r#12', number: 12, title: 'Fix login', url: ref.url, skill: 'issue' } });
});

test('seen merged and passing at once reports CI first; closed or quiet PRs stop being followed', () => {
  const rec = newTracked(ref, 'conflict', 0);
  assert.deepEqual(observe(rec, status({ state: 'MERGED', ci: 'passed', mergedAt: new Date(0).toISOString() }), [], 10), ['ci', 'merged']);
  assert.deepEqual(observe(rec, status({ state: 'MERGED', ci: 'passed', mergedAt: new Date(0).toISOString() }), [], REVERT_WINDOW_MS + 1), []);
  assert.equal(rec.done, true);
  const closed = newTracked(ref, 'issue', 0);
  assert.deepEqual(observe(closed, status({ state: 'CLOSED', ci: 'failed' }), [], 10), []);
  assert.equal(closed.done, true);
  const quiet = newTracked(ref, 'issue', 0);
  observe(quiet, status(), [], 31 * 24 * 60 * MIN);
  assert.equal(quiet.done, true);
  const flaky = newTracked(ref, 'issue', 0);
  failed(flaky, 100);
  assert.equal(flaky.nextPollAt, 100 + pollDelay(1));
});

test('finished PRs are dropped only once acknowledged and a month old', () => {
  const rec = newTracked(ref, 'issue', 0);
  observe(rec, status({ state: 'CLOSED', ci: 'passed' }), [], 10);
  const later = 40 * 24 * 60 * MIN;
  assert.equal(pruneTracked([rec], later).length, 1); // CI passed but not acknowledged yet
  rec.acked.ci = 20;
  assert.equal(pruneTracked([rec], 20).length, 1);
  assert.equal(pruneTracked([rec], later).length, 0);
});

test('tracked PRs persist next to agent.json', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guild-prs-'));
  assert.deepEqual(readTracked(dir), []);
  writeTracked(dir, [newTracked(ref, 'issue', 5)]);
  assert.equal(readTracked(dir)[0].key, 'github:o/r#12');
  writeTracked(path.join(dir, 'gone'), []); // an agent directory that's gone is left alone
  assert.ok(!fs.existsSync(path.join(dir, 'gone')));
  fs.rmSync(dir, { recursive: true, force: true });
});
