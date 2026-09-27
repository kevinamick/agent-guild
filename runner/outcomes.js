// Following the PRs an agent opened until they have an outcome: CI passing, a merge,
// and (for two weeks after the merge) a revert. Each agent's tracked PRs live in
// prs.json next to its agent.json, so a restarted runner picks up where it left off.
// The runner only reports what it saw; the office decides what that pays.
import fs from 'node:fs';
import path from 'node:path';
import { OUTCOMES } from '../shared/progression.js';
import { isRevertOf, parsePrRef, prKey } from './providers.js';

const DAY = 24 * 60 * 60 * 1000;
export const REVERT_WINDOW_MS = 14 * DAY;
const GIVE_UP_MS = 30 * DAY; // an open PR nobody merges
const KEEP_DONE_MS = 30 * DAY;

// Polls start every 2 minutes and back off to every 30 while nothing changes.
// GUILD_PR_POLL_MS fixes the interval (the end-to-end test uses a fraction of a second).
export function pollTimes(fixed = process.env.GUILD_PR_POLL_MS) {
  const ms = Number(fixed);
  return ms > 0 ? { base: ms, max: ms } : { base: 2 * 60 * 1000, max: 30 * 60 * 1000 };
}
export const POLL = pollTimes();
export const pollDelay = (polls, times = POLL) => Math.min(times.max, Math.round(times.base * 1.5 ** polls));

// What a finished tool printed: Claude sends tool_response ({ stdout, stderr } for
// Bash), Copilot sends toolResult ({ textResultForLlm }).
export function toolOutput(body = {}) {
  const r = body.tool_response ?? body.toolResult ?? body.tool_result ?? body.result;
  if (r == null) return '';
  if (typeof r === 'string') return r;
  const text = [r.stdout, r.stderr, r.textResultForLlm, r.output, r.content].filter((x) => typeof x === 'string').join('\n');
  return text || JSON.stringify(r);
}

// The PR a create command's finished hook reports, if it names one.
export function prFromHook(body, provider) {
  return parsePrRef(toolOutput(body), provider);
}

const file = (dir) => path.join(dir, 'prs.json');

export function readTracked(dir) {
  try {
    const list = JSON.parse(fs.readFileSync(file(dir), 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function writeTracked(dir, list) {
  if (!fs.existsSync(dir)) return;
  fs.writeFileSync(file(dir) + '.tmp', JSON.stringify(list, null, 2));
  fs.renameSync(file(dir) + '.tmp', file(dir));
}

export function newTracked(ref, skill, now = Date.now()) {
  return {
    key: prKey(ref), ref, number: ref.number, skill, openedAt: now,
    title: '', state: 'OPEN', ci: 'none', base: null, mergedAt: null, mergeCommit: null,
    seen: {}, acked: {}, polls: 0, nextPollAt: now, done: false,
  };
}

// Takes a fresh look at the PR (and, once merged, the base branch's commits since).
// Returns the outcomes seen for the first time, in the order they happen, and
// schedules the next look: sooner after a change, backing off while nothing moves.
export function observe(rec, status, commits = [], now = Date.now()) {
  Object.assign(rec, {
    title: status.title || rec.title,
    state: status.state,
    ci: status.ci,
    base: status.base || rec.base,
    mergedAt: status.mergedAt || rec.mergedAt,
    mergeCommit: status.mergeCommit || rec.mergeCommit,
  });
  const fresh = [];
  const see = (event) => {
    if (rec.seen[event]) return;
    rec.seen[event] = now;
    fresh.push(event);
  };
  if (status.ci === 'passed') see('ci');
  if (status.state === 'MERGED') see('merged');
  if (rec.seen.merged && commits.some((c) => isRevertOf(c.message, { ...rec, repo: rec.ref.repo }))) see('reverted');
  const mergedAt = rec.mergedAt && !Number.isNaN(Date.parse(rec.mergedAt)) ? Date.parse(rec.mergedAt) : rec.seen.merged;
  rec.done = Boolean(rec.seen.reverted) || status.state === 'CLOSED' || (rec.seen.merged ? now - mergedAt > REVERT_WINDOW_MS : now - rec.openedAt > GIVE_UP_MS);
  rec.polls = fresh.length ? 0 : rec.polls + 1;
  rec.nextPollAt = now + pollDelay(rec.polls);
  return fresh;
}

// A look that failed (offline, signed out): try again later, backing off the same way.
export function failed(rec, now = Date.now()) {
  rec.polls++;
  rec.nextPollAt = now + pollDelay(rec.polls);
}

// Outcomes seen but not yet acknowledged by the office, in order.
export const unacked = (rec) => OUTCOMES.filter((e) => rec.seen[e] && !rec.acked[e]);

// Finished PRs are kept a while (their acks may still be due), then dropped.
export function pruneTracked(list, now = Date.now()) {
  return list.filter((r) => !r.done || unacked(r).length || now - Math.max(...Object.values(r.seen), r.openedAt) < KEEP_DONE_MS);
}

// The office's message for an outcome.
export function outcomeMessage(agentId, rec, event) {
  return { t: 'outcome', agentId, event, pr: { key: rec.key, number: rec.number, title: rec.title, url: rec.ref.url, skill: rec.skill } };
}
