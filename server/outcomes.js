// The outcome ledger: which PR outcomes (CI passed, merged, reverted) each agent has
// already been paid for. Runners report what they see and re-send until the office
// acknowledges; the ledger on the agent's profile makes each outcome count once.
import { SKILLS, OUTCOMES } from '../shared/progression.js';

// github:owner/repo#12 or ado:org/project/repo#12 (parts URI-encoded, lower case).
const KEY = /^(github|ado):[^\s#]{1,200}#\d{1,9}$/;
const LEDGER_LIMIT = 300;

// A runner's report, checked and tidied. Null if it isn't one.
export function cleanOutcome(msg) {
  const pr = msg?.pr && typeof msg.pr === 'object' ? msg.pr : {};
  const key = String(pr.key || '').toLowerCase();
  if (!OUTCOMES.includes(msg?.event) || !KEY.test(key)) return null;
  return {
    event: msg.event,
    key,
    number: Number(key.split('#').pop()),
    title: String(pr.title || '').slice(0, 200),
    skill: SKILLS.includes(pr.skill) ? pr.skill : 'issue',
  };
}

// Writes the outcome into the profile's ledger and says whether it pays (or costs)
// XP now. The skill is the one the PR's first report named, so a revert takes back
// from the same skill the merge paid into.
export function recordOutcome(profile, { key, event, skill, number, title }, now = Date.now()) {
  profile.outcomes ||= {};
  const entry = (profile.outcomes[key] ||= { skill, number, title });
  if (title) entry.title = title;
  if (entry[event]) return { award: false, skill: entry.skill };
  entry[event] = now;
  entry.at = now;
  // A revert only takes back a merge that was paid; a merge reported after its revert pays nothing.
  const award = event === 'reverted' ? Boolean(entry.merged) : event === 'merged' ? !entry.reverted : true;
  pruneLedger(profile.outcomes);
  return { award, skill: entry.skill };
}

// Keeps the newest entries. Runners stop following a PR within weeks, so an entry
// old enough to be dropped is never reported again.
export function pruneLedger(ledger, limit = LEDGER_LIMIT) {
  const keys = Object.keys(ledger);
  if (keys.length <= limit) return;
  keys.sort((a, b) => (ledger[a].at || 0) - (ledger[b].at || 0));
  for (const k of keys.slice(0, keys.length - limit)) delete ledger[k];
}
