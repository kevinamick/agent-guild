// What agents spend, kept per unit because the engines count differently:
// Claude Code turns carry an estimated USD figure (tokens × list prices), Copilot
// turns the AI credits it reports itself. They are never converted into each other.
//
// profile.cost = {
//   total:  { usd: 1.23, credits: 4.5 },
//   skills: { review: { usd: { tasks: 3, amount: 1.2 }, credits: { tasks: 1, amount: 2.1 } }, ... },
// }
import { SKILLS } from './progression.js';

export const COST_UNITS = ['usd', 'credits'];

// A turn's cost as a runner reports it, or null if it isn't one we'll count.
export function cleanTurnCost(cost) {
  if (!cost || typeof cost !== 'object' || !COST_UNITS.includes(cost.unit)) return null;
  const amount = Number(cost.amount);
  // One turn costing more than this is a bug or a bad actor, not a task.
  if (!Number.isFinite(amount) || amount < 0 || amount > 1000) return null;
  return { amount, unit: cost.unit };
}

// Adds one turn to the running totals (returns the new object; old profiles have none).
// Every turn's spend counts; `task` says whether it was a task (it used tools),
// so "per review" means all the review spend over the reviews done.
export function addTurnCost(prev, kind, cost, task = true) {
  const c = cleanTurnCost(cost);
  const out = cleanCost(prev);
  if (!c || !SKILLS.includes(kind)) return out;
  out.total[c.unit] = (out.total[c.unit] || 0) + c.amount;
  const skill = (out.skills[kind] ??= {});
  const u = (skill[c.unit] ??= { tasks: 0, amount: 0 });
  u.amount += c.amount;
  if (task) u.tasks++;
  return out;
}

// A stored or runner-supplied cost record, with anything odd dropped.
export function cleanCost(cost) {
  const num = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : 0);
  const out = { total: {}, skills: {} };
  for (const unit of COST_UNITS) if (num(cost?.total?.[unit]) > 0) out.total[unit] = num(cost.total[unit]);
  for (const s of SKILLS) {
    for (const unit of COST_UNITS) {
      const u = cost?.skills?.[s]?.[unit];
      if (!u) continue;
      (out.skills[s] ??= {})[unit] = { tasks: Math.floor(num(u.tasks)), amount: num(u.amount) };
    }
  }
  return out;
}

// Average spend per task for a skill: [{ unit, amount, tasks }] for each unit it has tasks in.
export function costPerTask(cost, skill) {
  const s = cost?.skills?.[skill] || {};
  return COST_UNITS.filter((u) => s[u]?.tasks > 0).map((u) => ({ unit: u, amount: s[u].amount / s[u].tasks, tasks: s[u].tasks }));
}

// "≈$0.40" or "1.3 credits". USD is always an estimate, so it gets the ≈.
export function formatCost(amount, unit) {
  if (unit === 'credits') return `${amount >= 10 ? Math.round(amount) : Number(amount.toFixed(amount < 1 ? 2 : 1))} credits`;
  if (amount > 0 && amount < 0.01) return '≈<$0.01';
  return `≈$${amount >= 100 ? Math.round(amount) : amount.toFixed(2)}`;
}

const SKILL_NOUN = { issue: 'fix', review: 'review', conflict: 'merge', research: 'research task', general: 'task' };

// "≈$0.40/review" (compact) or "≈$0.40 per review".
export function formatPerTask({ amount, unit }, skill, compact = false) {
  const noun = SKILL_NOUN[skill] || 'task';
  return compact ? `${formatCost(amount, unit)}/${noun}` : `${formatCost(amount, unit)} per ${noun}`;
}

export const COST_NOTE =
  'Estimates. Claude Code: tokens from its transcripts × Anthropic API list prices (a subscription bills differently). ' +
  'Copilot: the AI credits it reports. Old turns and other CLIs have no cost.';

// "≈$1.23 · 4.5 credits", or '' before any costed turn.
export function formatTotals(cost) {
  return COST_UNITS.filter((u) => cost?.total?.[u] > 0).map((u) => formatCost(cost.total[u], u)).join(' · ');
}
