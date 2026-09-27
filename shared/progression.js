// XP, levels, titles and cosmetics. Shared by the server (authoritative ledger),
// the runner (playbook capacity) and the client (display).

export const SKILLS = ['issue', 'review', 'conflict', 'general'];

export const SKILL_INFO = {
  issue: { label: 'Issue Fixer', short: 'Fix', color: '#f472b6', icon: '📌' },
  review: { label: 'Reviewer', short: 'Rev', color: '#60a5fa', icon: '🔍' },
  conflict: { label: 'Conflict Resolver', short: 'Merge', color: '#f59e0b', icon: '🔀' },
  general: { label: 'Generalist', short: 'Gen', color: '#34d399', icon: '🧰' },
};

export const MAX_LEVEL = 30;
export const KUDOS_XP = 20;

// Total XP needed to *reach* `level`. Lv2 = 60, Lv5 ≈ 550, Lv10 ≈ 2000.
export function xpForLevel(level) {
  return Math.round(60 * Math.pow(Math.max(0, level - 1), 1.6));
}

export function levelFor(xp) {
  let level = 1;
  while (level < MAX_LEVEL && xp >= xpForLevel(level + 1)) level++;
  return level;
}

export function progress(xp) {
  const level = levelFor(xp);
  const floor = xpForLevel(level);
  const next = level >= MAX_LEVEL ? floor : xpForLevel(level + 1);
  const need = Math.max(1, next - floor);
  return { level, into: xp - floor, need, pct: level >= MAX_LEVEL ? 1 : (xp - floor) / need };
}

export function emptyXp() {
  return Object.fromEntries(SKILLS.map((s) => [s, 0]));
}

export function totalXp(xp = {}) {
  return SKILLS.reduce((sum, s) => sum + (xp[s] || 0), 0);
}

// Overall level uses total XP on a stretched curve so it moves slower than skills.
export function overallLevel(xp) {
  return levelFor(Math.round(totalXp(xp) / 1.5));
}

export function bestSkill(xp = {}) {
  return SKILLS.reduce((best, s) => ((xp[s] || 0) > (xp[best] || 0) ? s : best), 'general');
}

// The concrete power of a level: how many lessons an agent may keep in its
// playbook for that skill. Lessons are injected into every session it starts.
export function playbookCapacity(skillLevel) {
  return Math.min(45, 3 + 2 * skillLevel);
}

const TITLES = [
  [20, 'Legend'],
  [15, 'Principal'],
  [11, 'Staff'],
  [8, 'Senior'],
  [5, 'Engineer'],
  [3, 'Junior'],
  [1, 'Intern'],
];

export function titleFor(level, skill) {
  const rank = TITLES.find(([min]) => level >= min)[1];
  return skill ? `${rank} ${SKILL_INFO[skill].label}` : rank;
}

export const COSMETICS = [
  { level: 3, id: 'beanie', label: 'Beanie' },
  { level: 5, id: 'party', label: 'Party hat' },
  { level: 8, id: 'tophat', label: 'Top hat' },
  { level: 11, id: 'aura', label: 'Mastery aura' },
  { level: 15, id: 'crown', label: 'Crown' },
  { level: 20, id: 'halo', label: 'Halo' },
];

export function hatFor(level) {
  if (level >= 15) return 'crown';
  if (level >= 8) return 'tophat';
  if (level >= 5) return 'party';
  if (level >= 3) return 'beanie';
  return null;
}

export function badgeTier(level) {
  if (level >= 15) return 'diamond';
  if (level >= 10) return 'gold';
  if (level >= 5) return 'silver';
  return 'bronze';
}

// XP for one finished turn (prompt → Stop). Chats with no tool use earn a trickle
// so the ledger rewards real work rather than message spam.
export function turnXp({ toolCalls = 0, durationMs = 0, prOpened = false, prMerged = false, reviewed = false } = {}) {
  const reasons = [];
  if (toolCalls === 0) return { amount: 2, reasons: ['chat'] };
  let amount = 10;
  reasons.push('task +10');
  const work = Math.min(40, toolCalls * 2);
  amount += work;
  reasons.push(`${toolCalls} tool calls +${work}`);
  const minutes = durationMs / 60000;
  const focus = Math.min(30, Math.round(minutes * 3));
  if (focus > 0) {
    amount += focus;
    reasons.push(`focus +${focus}`);
  }
  if (prOpened) {
    amount += 50;
    reasons.push('opened PR +50');
  }
  if (reviewed) {
    amount += 30;
    reasons.push('posted review +30');
  }
  if (prMerged) {
    amount += 80;
    reasons.push('merged PR +80');
  }
  return { amount: Math.min(200, amount), reasons };
}

// XP for what became of a PR the agent opened, paid once each to the skill of the
// work that opened it. Opening a PR already earns +50 in its turn; these reward it
// landing. A revert takes the merge bonus back (never below zero for the skill).
export const OUTCOME_XP = { ci: 20, merged: 60, reverted: -60 };
export const OUTCOMES = Object.keys(OUTCOME_XP);

// `have` is the skill's current XP, so a deduction says what it really takes.
export function outcomeXp(event, number, have = Infinity) {
  const nominal = OUTCOME_XP[event];
  if (!nominal) return null;
  const amount = nominal > 0 ? nominal : 0 - Math.min(-nominal, Math.max(0, have));
  const pr = number ? `PR #${number}` : 'PR';
  const what = { ci: `${pr} CI passed`, merged: `${pr} merged`, reverted: `${pr} reverted` }[event];
  return { amount, reasons: [`${what} ${nominal < 0 ? '−' : '+'}${Math.abs(amount)}`] };
}
