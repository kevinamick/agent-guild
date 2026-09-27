import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  isoWeekId, addWeekly, weeklyOf, pickMvp, bountyProblem, recordWork, resolveClaim, createBountyStore, BOUNTY_DAILY_LIMIT,
} from './bounties.js';

test('ISO week ids start on Monday and follow the Thursday rule at year ends', () => {
  assert.equal(isoWeekId(new Date(2026, 8, 26)), '2026-W39'); // Saturday
  assert.equal(isoWeekId(new Date(2026, 8, 27, 23, 59)), '2026-W39'); // Sunday night: same week
  assert.equal(isoWeekId(new Date(2026, 8, 28, 0, 1)), '2026-W40'); // Monday: a new week
  assert.equal(isoWeekId(new Date(2021, 0, 3)), '2020-W53'); // early January can be last year's week
  assert.equal(isoWeekId(new Date(2024, 11, 30)), '2025-W01'); // late December can be next year's
  assert.equal(isoWeekId(new Date(2026, 0, 1)), '2026-W01');
  assert.equal(isoWeekId(new Date(2027, 0, 1)), '2026-W53');
});

test('the weekly tally resets when the week rolls over', () => {
  const p = { id: 'a', name: 'Ada' };
  addWeekly(p, '2026-W39', 40);
  addWeekly(p, '2026-W39', 50, 1);
  assert.deepEqual(weeklyOf(p, '2026-W39'), { xp: 90, bounties: 1 });
  assert.deepEqual(weeklyOf(p, '2026-W40'), { xp: 0, bounties: 0 }, 'an old tally reads as zero');
  addWeekly(p, '2026-W40', 10);
  assert.deepEqual(p.week, { id: '2026-W40', xp: 10, bounties: 0 });
});

test("last week's MVP is the agent with the most XP that week", () => {
  const profiles = [
    { id: 'a', name: 'Ada', owner: 'Kevin', week: { id: 'W1', xp: 100, bounties: 0 } },
    { id: 'b', name: 'Bob', owner: 'Alice', week: { id: 'W1', xp: 100, bounties: 1 } },
    { id: 'c', name: 'Cy', owner: 'Kevin', week: { id: 'W0', xp: 999, bounties: 3 } },
    { id: 'd', name: 'Dee', owner: 'Kevin' },
  ];
  const mvp = pickMvp(profiles, 'W1');
  assert.equal(mvp.agentId, 'b', 'bounties break an XP tie');
  assert.equal(mvp.xp, 100);
  assert.equal(mvp.week, 'W1');
  assert.equal(pickMvp(profiles, 'W2'), null, 'a quiet week has no MVP');
});

test('posting a bounty: preset amounts, open items only, one per item, a daily limit', () => {
  const item = { number: 12, state: 'OPEN' };
  const ok = { item, amount: 50, name: 'Kevin', open: {}, posts: [] };
  assert.equal(bountyProblem(ok), null);
  assert.match(bountyProblem({ ...ok, amount: 30 }), /25, 50, 100/);
  assert.match(bountyProblem({ ...ok, amount: '50' }), /25, 50, 100/);
  assert.match(bountyProblem({ ...ok, item: null }), /isn't on the board/);
  assert.match(bountyProblem({ ...ok, item: { number: 12, state: 'CLOSED' } }), /already closed/);
  assert.match(bountyProblem({ ...ok, open: { 12: { amount: 25 } } }), /already has a 25 XP bounty/);
  const now = new Date(2026, 8, 26, 15).getTime();
  const posts = Array.from({ length: BOUNTY_DAILY_LIMIT }, (_, i) => ({ by: 'kevin', at: now - i * 1000 }));
  assert.match(bountyProblem({ ...ok, posts, now }), /a day/);
  assert.equal(bountyProblem({ ...ok, posts, now, name: 'Alice' }), null, "the limit is per person");
  assert.equal(bountyProblem({ ...ok, posts, now: now + 86400000 }), null, 'and per day');
});

test('claims: the first PR wins, then the latest finished turn, then the latest hire', () => {
  const b = { workers: {} };
  assert.equal(resolveClaim(b), null, 'nobody worked on it: it expires');
  recordWork(b, 'a', { now: 1 });
  recordWork(b, 'b', { now: 2 });
  assert.equal(resolveClaim(b).agentId, 'b', 'only hires: the most recent one');
  recordWork(b, 'a', { turnEnded: true, now: 5, skill: 'general' });
  assert.deepEqual(resolveClaim(b), { agentId: 'a', skill: 'general' }, 'a finished turn beats a mere hire');
  recordWork(b, 'b', { turnEnded: true, now: 6 });
  assert.equal(resolveClaim(b).agentId, 'b', 'the latest finished turn');
  recordWork(b, 'a', { turnEnded: true, prOpened: true, now: 7 });
  recordWork(b, 'c', { turnEnded: true, prOpened: true, now: 8, skill: 'issue' });
  recordWork(b, 'a', { turnEnded: true, prOpened: true, now: 9 });
  assert.equal(b.workers.a.prOpenedAt, 7, 'the first PR time sticks');
  assert.deepEqual(resolveClaim(b), { agentId: 'a', skill: 'general' }, 'the first to open a PR wins, with the skill of its work');
});

test('the store persists open bounties and closes each one only once', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bounties-'));
  const file = path.join(dir, 'bounties.json');
  const store = createBountyStore(file);
  store.post({ number: 12, amount: 50, by: 'Kevin', at: Date.now(), workers: {} });
  const again = createBountyStore(file);
  assert.equal(again.data.open[12].amount, 50, 'survives a restart');
  assert.equal(again.close(12, { outcome: 'claimed', agentId: 'a' }).amount, 50);
  assert.equal(again.close(12, { outcome: 'claimed' }), null, 'a second close does nothing');
  const third = createBountyStore(file);
  assert.deepEqual(third.data.open, {});
  assert.equal(third.data.history[0].outcome, 'claimed');
  assert.equal(third.data.posts.length, 1, 'posts are kept for the daily limit');
  fs.rmSync(dir, { recursive: true, force: true });
});
