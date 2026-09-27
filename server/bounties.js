// Bounties and the weekly leaderboard: the pure rules plus a tiny per-office store.
//
// A bounty is bonus XP pinned on an open issue / work item. It's won by the agent
// that lands it: when a board refresh shows the item closed, the bounty goes to one
// of the agents that were hired (or prompted) with `task.ref` pointing at the item:
//   1. an agent that opened a PR while on it wins (the earliest PR if several did);
//   2. otherwise the agent whose last finished turn is the most recent;
//   3. otherwise (nobody finished a turn yet) the most recently hired one.
// Nobody worked on it through the office: the bounty expires. The XP goes to the
// skill of the winner's work on it (usually Issue Fixer).
import fs from 'node:fs';
import { BOUNTY_AMOUNTS, BOUNTY_DAILY_LIMIT } from '../shared/bounties.js';

export { BOUNTY_AMOUNTS, BOUNTY_DAILY_LIMIT };
const HISTORY_LIMIT = 50;

// ---------------------------------------------------------------- weeks

// ISO 8601 week of a date in server-local time: weeks start on Monday and belong
// to the year their Thursday falls in, e.g. '2026-W39'.
export function isoWeekId(date = new Date()) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7)); // this week's Thursday
  const dayOfYear = Math.round((d - new Date(d.getFullYear(), 0, 1, 12)) / 86400000); // 0-based
  const week = 1 + Math.floor(dayOfYear / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

// Add to an agent profile's weekly tally, starting a fresh one when the week changed.
export function addWeekly(profile, weekId, xp = 0, bounties = 0) {
  if (profile.week?.id !== weekId) profile.week = { id: weekId, xp: 0, bounties: 0 };
  profile.week.xp += xp;
  profile.week.bounties += bounties;
  return profile.week;
}

// What an agent has earned in `weekId` (zero if its tally is from an older week).
export const weeklyOf = (profile, weekId) =>
  profile.week?.id === weekId ? { xp: profile.week.xp, bounties: profile.week.bounties } : { xp: 0, bounties: 0 };

// The agent that earned the most XP in `weekId` (bounties break ties), or null.
export function pickMvp(profiles, weekId) {
  let best = null;
  for (const p of profiles) {
    const w = weeklyOf(p, weekId);
    if (!w.xp && !w.bounties) continue;
    if (!best || w.xp > best.xp || (w.xp === best.xp && w.bounties > best.bounties)) {
      best = { week: weekId, agentId: p.id, name: p.name, owner: p.owner, color: p.color, ...w };
    }
  }
  return best;
}

// ---------------------------------------------------------------- posting

const dayOf = (t) => new Date(t).toDateString();

// Why `name` can't pin `amount` XP on board item `item` right now, or null.
export function bountyProblem({ item, amount, name, open, posts, now = Date.now() }) {
  if (!BOUNTY_AMOUNTS.includes(amount)) return `Bounties are ${BOUNTY_AMOUNTS.join(', ')} XP.`;
  if (!item) return 'That item isn\'t on the board. Refresh the board and try again.';
  if (item.state !== 'OPEN') return `#${item.number} is already closed.`;
  if (open[item.number]) return `#${item.number} already has a ${open[item.number].amount} XP bounty.`;
  const today = posts.filter((p) => p.by.toLowerCase() === name.toLowerCase() && dayOf(p.at) === dayOf(now)).length;
  if (today >= BOUNTY_DAILY_LIMIT) return `You can post ${BOUNTY_DAILY_LIMIT} bounties a day. Try again tomorrow.`;
  return null;
}

// ---------------------------------------------------------------- claiming

// Note that `agentId` is working on a bountied item (hired, prompted, or finished a turn).
export function recordWork(bounty, agentId, { skill, turnEnded = false, prOpened = false, now = Date.now() } = {}) {
  const w = (bounty.workers[agentId] ||= { hiredAt: now, lastTurnAt: null, prOpenedAt: null, skill: skill || 'issue' });
  if (skill) w.skill = skill;
  if (turnEnded) w.lastTurnAt = now;
  if (prOpened && !w.prOpenedAt) w.prOpenedAt = now;
  return w;
}

// Who lands a closed bounty (see the rules at the top), as { agentId, skill }, or null.
export function resolveClaim(bounty) {
  const workers = Object.entries(bounty.workers || {}).map(([agentId, w]) => ({ agentId, ...w }));
  if (!workers.length) return null;
  const pick = (list, score, better) => list.reduce((a, b) => (better(score(b), score(a)) ? b : a));
  const withPr = workers.filter((w) => w.prOpenedAt);
  const withTurn = workers.filter((w) => w.lastTurnAt);
  const winner = withPr.length
    ? pick(withPr, (w) => w.prOpenedAt, (x, y) => x < y)
    : withTurn.length
      ? pick(withTurn, (w) => w.lastTurnAt, (x, y) => x > y)
      : pick(workers, (w) => w.hiredAt, (x, y) => x > y);
  return { agentId: winner.agentId, skill: winner.skill || 'issue' };
}

// ---------------------------------------------------------------- store

// One file per office: open bounties by item number, recent outcomes, today's posts
// (for the daily limit) and the weekly leaderboard's state.
export function createBountyStore(file) {
  let data = { open: {}, history: [], posts: [], week: { id: null, mvp: null } };
  try {
    data = { ...data, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {}
  const save = () => {
    fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 2));
    fs.renameSync(file + '.tmp', file);
  };
  return {
    data,
    save,
    post(bounty) {
      data.open[bounty.number] = bounty;
      data.posts = [...data.posts.filter((p) => Date.now() - p.at < 2 * 86400000), { by: bounty.by, at: bounty.at }];
      save();
    },
    // Takes a bounty off the board for good (claimed, expired or removed); saved at
    // once so it can't be awarded twice, even across a restart.
    close(number, outcome) {
      const bounty = data.open[number];
      if (!bounty) return null;
      delete data.open[number];
      data.history = [{ ...bounty, ...outcome, closedAt: Date.now() }, ...data.history].slice(0, HISTORY_LIMIT);
      save();
      return bounty;
    },
  };
}
