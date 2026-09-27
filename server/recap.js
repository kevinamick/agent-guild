// "While you were away": the office's activity log, and the summaries built from
// it. Everything here is pure (no I/O, no clock) so it can be tested directly;
// server/activity.js keeps the log on disk and server/index.js feeds it.
//
// A log entry is a flat object: { at, type, ...data }. Entries about an agent
// carry `agentId`, `agent` (its name then) and `owner`. The summaries understand:
//   task          a finished turn: skill, xp (for display), summary, by, borrowed
//   xp            XP granted: skill, xp, reasons, from. The only source of XP sums,
//                 so any new way of earning XP shows up by logging an `xp` entry.
//   levelup       skill (null for the overall level), level, overall
//   lessons       skill, added: the playbook grew
//   pr-opened / pr-merged
//   hired         by, borrowed
//   home          by (null when the session ended by itself)
//   access-request from
//   hand          activity: the agent raised its hand
// Any other type is kept and counted in `totals.other[type]`, so features can log
// their own events (e.g. outcome XP, bounties) before the recap knows them.

import { SKILLS } from '../shared/progression.js';

export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;
export const LOG_MAX = 2000;
export const LOG_MAX_AGE = 14 * DAY;
export const RECAP_AFTER = HOUR;

const lower = (s) => String(s || '').toLowerCase();

// The ring buffer: newest `max` entries no older than `maxAge`, oldest first.
export function trimLog(entries, now, { max = LOG_MAX, maxAge = LOG_MAX_AGE } = {}) {
  const cutoff = now - maxAge;
  let start = Math.max(0, entries.length - max);
  while (start < entries.length && !(entries[start]?.at >= cutoff)) start++;
  return start ? entries.slice(start) : entries;
}

// Whether someone walking in has been away long enough for a recap. New people
// (never seen) get the welcome instead.
export function awayLongEnough(lastSeen, now, thresholdMs = RECAP_AFTER) {
  return Number.isFinite(lastSeen) && lastSeen > 0 && now - lastSeen >= thresholdMs;
}

const emptyTotals = () => ({
  tasks: 0, xp: 0, levelUps: 0, lessons: 0, prsOpened: 0, prsMerged: 0,
  hired: 0, borrowed: 0, sentHome: 0, accessRequests: 0, hands: 0, other: {},
});

/**
 * Summarise log entries into a recap for one person.
 * @param entries  log entries (any order); those outside [since, until] are ignored
 * @param opts.me        the person's name: their agents come first and are marked `mine`
 * @param opts.agents    current agents by id ({ name, owner, color }), for today's names
 * @param opts.hands     agents with a hand up right now: [{ agentId, activity }]
 * @param opts.requests  access requests waiting for `me`: [{ id, agentId, agentName, from, at }]
 */
export function summarize(entries, { since = 0, until = Infinity, me = '', agents = {}, hands = [], requests = [] } = {}) {
  const totals = emptyTotals();
  const byAgent = new Map();
  const lastHand = new Map();
  const agentRow = (e) => {
    let row = byAgent.get(e.agentId);
    if (!row) {
      const now = agents[e.agentId] || {};
      row = {
        id: e.agentId, name: now.name || e.agent || 'an agent', owner: now.owner || e.owner || '', color: now.color || null,
        tasks: 0, xp: {}, xpTotal: 0, levelUps: [], lessons: {}, lessonsTotal: 0, prsOpened: 0, prsMerged: 0,
        borrowedBy: [], tasksDone: [],
      };
      row.mine = Boolean(me) && lower(row.owner) === lower(me);
      byAgent.set(e.agentId, row);
    }
    return row;
  };
  for (const e of entries) {
    if (!e || !(e.at >= since && e.at <= until)) continue;
    const row = e.agentId ? agentRow(e) : null;
    switch (e.type) {
      case 'task':
        totals.tasks++;
        if (row) {
          row.tasks++;
          if (e.summary) row.tasksDone.push({ at: e.at, skill: e.skill || 'general', summary: e.summary, xp: e.xp || 0 });
        }
        break;
      case 'xp': {
        const xp = Math.max(0, +e.xp || 0);
        const skill = SKILLS.includes(e.skill) ? e.skill : 'general';
        totals.xp += xp;
        if (row) {
          row.xp[skill] = (row.xp[skill] || 0) + xp;
          row.xpTotal += xp;
        }
        break;
      }
      case 'levelup':
        totals.levelUps++;
        row?.levelUps.push({ skill: e.skill || null, level: e.level, overall: Boolean(e.overall) });
        break;
      case 'lessons': {
        const added = Math.max(0, +e.added || 0);
        totals.lessons += added;
        if (row) {
          const skill = e.skill || 'general';
          row.lessons[skill] = (row.lessons[skill] || 0) + added;
          row.lessonsTotal += added;
        }
        break;
      }
      case 'pr-opened':
        totals.prsOpened++;
        if (row) row.prsOpened++;
        break;
      case 'pr-merged':
        totals.prsMerged++;
        if (row) row.prsMerged++;
        break;
      case 'hired':
        if (e.borrowed) {
          totals.borrowed++;
          if (row && e.by && !row.borrowedBy.some((n) => lower(n) === lower(e.by))) row.borrowedBy.push(e.by);
        } else totals.hired++;
        break;
      case 'home':
        totals.sentHome++;
        break;
      case 'access-request':
        totals.accessRequests++;
        break;
      case 'hand':
        totals.hands++;
        if (e.agentId) lastHand.set(e.agentId, e.at);
        break;
      default:
        totals.other[e.type] = (totals.other[e.type] || 0) + 1;
    }
  }

  // Only agents that did something worth reading about; being hired or sent home
  // alone shows in the totals.
  const busy = (r) => r.tasks || r.xpTotal || r.levelUps.length || r.lessonsTotal || r.prsOpened || r.prsMerged;
  const list = [...byAgent.values()].filter(busy).map((r) => ({ ...r, tasksDone: r.tasksDone.slice(-3) }));
  list.sort((a, b) => b.mine - a.mine || b.xpTotal - a.xpTotal || b.tasks - a.tasks || a.name.localeCompare(b.name));

  const handList = hands
    .map((h) => {
      const a = agents[h.agentId] || {};
      return {
        agentId: h.agentId, name: a.name || h.name || 'an agent', owner: a.owner || h.owner || '', activity: h.activity || '',
        since: lastHand.get(h.agentId) ?? h.since ?? null, mine: Boolean(me) && lower(a.owner || h.owner) === lower(me),
      };
    })
    .sort((a, b) => b.mine - a.mine || (a.since ?? Infinity) - (b.since ?? Infinity));
  const requestList = [...requests].sort((a, b) => (a.at || 0) - (b.at || 0));

  const quiet = !list.length && !totals.tasks && !totals.xp && !totals.hired && !totals.borrowed && !totals.sentHome
    && !totals.accessRequests && !Object.keys(totals.other).length;
  return {
    since, until: Number.isFinite(until) ? until : null,
    totals, agents: list,
    highlights: { hands: handList, requests: requestList },
    empty: quiet && !handList.length && !requestList.length,
  };
}

// The Guild Hall board's "Last 24h" panel: office-wide numbers and the top agents.
export function digest(entries, now, windowMs = DAY) {
  const { totals, agents } = summarize(entries, { since: now - windowMs, until: now });
  const top = [...agents]
    .sort((a, b) => b.xpTotal - a.xpTotal || b.tasks - a.tasks)
    .slice(0, 3)
    .map(({ id, name, owner, color, xpTotal, tasks, levelUps, prsMerged }) => ({ id, name, owner, color, xp: xpTotal, tasks, levelUps: levelUps.length, prsMerged }));
  return {
    windowMs, at: now,
    tasks: totals.tasks, xp: totals.xp, levelUps: totals.levelUps, lessons: totals.lessons,
    prsOpened: totals.prsOpened, prsMerged: totals.prsMerged, top,
  };
}

// A one-line summary of what a task was about, from the prompt (or the activity).
export function oneLine(text, max = 120) {
  const line = String(text || '').split('\n').map((s) => s.trim()).find(Boolean) || '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
