import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { trimLog, awayLongEnough, summarize, digest, oneLine, HOUR, DAY } from './recap.js';
import { createActivityLog, createLastSeen } from './activity.js';

const T0 = Date.UTC(2026, 8, 1, 9);
const at = (min) => T0 + min * 60000;

test('the log is a ring buffer capped by count and by age', () => {
  const entries = Array.from({ length: 10 }, (_, i) => ({ at: at(i), type: 'xp' }));
  assert.equal(trimLog(entries, at(10), { max: 20, maxAge: DAY }), entries, 'nothing to trim, same array');
  assert.deepEqual(trimLog(entries, at(10), { max: 4, maxAge: DAY }).map((e) => e.at), [at(6), at(7), at(8), at(9)], 'newest kept by count');
  assert.deepEqual(trimLog(entries, at(10), { max: 20, maxAge: 3 * 60000 }).map((e) => e.at), [at(7), at(8), at(9)], 'older than maxAge dropped');
  assert.deepEqual(trimLog(entries, at(10), { max: 2, maxAge: 5 * 60000 }).map((e) => e.at), [at(8), at(9)], 'both limits apply');
  assert.deepEqual(trimLog(entries, at(10) + DAY, { max: 20, maxAge: DAY }), [], 'all expired');
  assert.deepEqual(trimLog([], at(0)), []);
});

test('a recap is due only after being away long enough, and never for newcomers', () => {
  assert.equal(awayLongEnough(null, at(0)), false, 'never seen: the welcome, not a recap');
  assert.equal(awayLongEnough(undefined, at(0)), false);
  assert.equal(awayLongEnough(at(0), at(59)), false, 'under an hour by default');
  assert.equal(awayLongEnough(at(0), at(60)), true, 'an hour away');
  assert.equal(awayLongEnough(at(0), at(0) + 2000, 1000), true, 'configurable threshold');
  assert.equal(awayLongEnough(at(0), at(0) + 500, 1000), false);
});

const LOG = [
  { at: at(-5), type: 'task', agentId: 'a1', agent: 'Ada', owner: 'Kevin', skill: 'issue', xp: 90, summary: 'before you left' },
  { at: at(1), type: 'hired', agentId: 'a1', agent: 'Ada', owner: 'Kevin', by: 'Kevin', borrowed: false },
  { at: at(2), type: 'task', agentId: 'a1', agent: 'Ada', owner: 'Kevin', skill: 'issue', xp: 80, summary: 'fix issue #1 and open a pr' },
  { at: at(2), type: 'pr-opened', agentId: 'a1', agent: 'Ada', owner: 'Kevin' },
  { at: at(2), type: 'xp', agentId: 'a1', agent: 'Ada', owner: 'Kevin', skill: 'issue', xp: 80 },
  { at: at(2), type: 'levelup', agentId: 'a1', agent: 'Ada', owner: 'Kevin', skill: 'issue', level: 2 },
  { at: at(3), type: 'lessons', agentId: 'a1', agent: 'Ada', owner: 'Kevin', skill: 'issue', added: 1 },
  { at: at(4), type: 'hired', agentId: 'b1', agent: 'Bolt', owner: 'Alice', by: 'Kevin', borrowed: true },
  { at: at(5), type: 'task', agentId: 'b1', agent: 'Bolt', owner: 'Alice', skill: 'review', xp: 40, summary: 'review pr 2' },
  { at: at(5), type: 'xp', agentId: 'b1', agent: 'Bolt', owner: 'Alice', skill: 'review', xp: 40, from: 'Kevin' },
  { at: at(6), type: 'xp', agentId: 'b1', agent: 'Bolt', owner: 'Alice', skill: 'review', xp: 20, reasons: ['kudos'] },
  { at: at(6), type: 'pr-merged', agentId: 'b1', agent: 'Bolt', owner: 'Alice' },
  { at: at(7), type: 'hand', agentId: 'a1', agent: 'Ada', owner: 'Kevin', activity: 'Permission needed' },
  { at: at(8), type: 'access-request', agentId: 'a1', agent: 'Ada', owner: 'Kevin', from: 'Alice' },
  { at: at(9), type: 'home', agentId: 'b1', agent: 'Bolt', owner: 'Alice', by: 'Kevin' },
  { at: at(9), type: 'bounty-claimed', agentId: 'b1', agent: 'Bolt', owner: 'Alice' },
];

test('summarising entries into a recap: per agent, totals and highlights', () => {
  const r = summarize(LOG, {
    since: at(0), until: at(10), me: 'kevin',
    agents: { a1: { name: 'Ada Lovelace', owner: 'Kevin', color: '#f00' }, b1: { name: 'Bolt', owner: 'Alice' } },
    hands: [{ agentId: 'c1', name: 'Cog', owner: 'Alice', activity: 'question' }, { agentId: 'a1', activity: 'Permission needed' }],
    requests: [{ id: 'r1', agentId: 'a1', agentName: 'Ada', from: 'Alice', at: at(8) }],
  });
  assert.equal(r.empty, false);
  assert.deepEqual(
    { ...r.totals, other: undefined },
    { tasks: 2, xp: 140, levelUps: 1, lessons: 1, prsOpened: 1, prsMerged: 1, hired: 1, borrowed: 1, sentHome: 1, accessRequests: 1, hands: 1, other: undefined },
  );
  assert.deepEqual(r.totals.other, { 'bounty-claimed': 1 }, 'unknown types are kept and counted');
  assert.deepEqual(r.agents.map((a) => a.name), ['Ada Lovelace', 'Bolt'], "my agents first, with today's names");
  const [ada, bolt] = r.agents;
  assert.equal(ada.mine, true);
  assert.equal(bolt.mine, false);
  assert.deepEqual([ada.tasks, ada.xp, ada.xpTotal, ada.prsOpened, ada.lessons, ada.lessonsTotal], [1, { issue: 80 }, 80, 1, { issue: 1 }, 1]);
  assert.deepEqual(ada.levelUps, [{ skill: 'issue', level: 2, overall: false }]);
  assert.deepEqual(ada.tasksDone.map((t) => t.summary), ['fix issue #1 and open a pr'], 'only what happened since');
  assert.deepEqual([bolt.xp, bolt.prsMerged, bolt.borrowedBy], [{ review: 60 }, 1, ['Kevin']], 'XP from every xp entry (kudos too)');
  assert.deepEqual(r.highlights.hands.map((h) => [h.name, h.mine, h.since]), [['Ada Lovelace', true, at(7)], ['Cog', false, null]], 'my raised hands first');
  assert.equal(r.highlights.requests[0].from, 'Alice');
});

test('a quiet stretch makes an empty recap; a raised hand alone does not', () => {
  assert.equal(summarize(LOG, { since: at(20), until: at(30), me: 'Kevin' }).empty, true);
  assert.equal(summarize([], { since: 0, hands: [{ agentId: 'a1', name: 'Ada', owner: 'Kevin' }], me: 'Kevin' }).empty, false);
  const onlyHired = summarize(LOG.slice(1, 2), { since: 0, me: 'Kevin' });
  assert.equal(onlyHired.empty, false);
  assert.equal(onlyHired.agents.length, 0, 'being hired alone only counts in the totals');
});

test('the board digest covers the window and ranks the top agents by XP', () => {
  const d = digest(LOG, at(10), 8 * 60000);
  assert.deepEqual([d.tasks, d.xp, d.prsOpened, d.prsMerged, d.levelUps, d.lessons], [2, 140, 1, 1, 1, 1]);
  assert.deepEqual(d.top.map((a) => [a.name, a.xp, a.tasks]), [['Ada', 80, 1], ['Bolt', 60, 1]]);
  assert.equal(digest(LOG, at(10) + DAY).tasks, 0, 'a day later the window is empty');
});

test('task summaries are one tidy line', () => {
  assert.equal(oneLine('\n  Fix the login bug\nthen more'), 'Fix the login bug');
  assert.equal(oneLine('x'.repeat(200), 10), `${'x'.repeat(9)}…`);
  assert.equal(oneLine(null), '');
});

test('the log and last-seen times are written debounced and survive a reload', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guild-activity-'));
  const file = path.join(dir, 'activity.json');
  let now = T0;
  const log = createActivityLog(file, { max: 3, maxAge: HOUR, delayMs: 30, now: () => now });
  for (let i = 0; i < 5; i++) log.add('task', { agentId: 'a1', n: i });
  assert.equal(fs.existsSync(file), false, 'not written on every event');
  assert.deepEqual(log.entries().map((e) => e.n), [2, 3, 4], 'capped by count as it grows');
  await new Promise((r) => setTimeout(r, 80));
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).map((e) => e.n), [2, 3, 4], 'written once things settle');
  now += 2 * HOUR;
  const reloaded = createActivityLog(file, { max: 3, maxAge: HOUR, now: () => now });
  assert.deepEqual(reloaded.entries(), [], 'expired entries are dropped on load');
  now = T0;
  const again = createActivityLog(file, { max: 3, maxAge: HOUR, now: () => now });
  assert.deepEqual(again.since(T0).map((e) => e.n), [2, 3, 4]);

  const seenFile = path.join(dir, 'lastseen.json');
  const seen = createLastSeen(seenFile, { delayMs: 10_000 });
  seen.touch('Kevin', at(5));
  assert.equal(seen.get('kevin'), at(5), 'names are case-insensitive');
  seen.flush();
  assert.equal(createLastSeen(seenFile).get('KEVIN'), at(5));
  assert.equal(createLastSeen(seenFile).get('Alice'), null);
  fs.rmSync(dir, { recursive: true, force: true });
});
