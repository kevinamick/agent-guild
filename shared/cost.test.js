import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addTurnCost, cleanCost, cleanTurnCost, costPerTask, formatCost, formatPerTask, formatTotals } from './cost.js';

test('turns add up per unit and per skill', () => {
  let c = addTurnCost(undefined, 'review', { amount: 0.3, unit: 'usd' });
  c = addTurnCost(c, 'review', { amount: 0.5, unit: 'usd' });
  c = addTurnCost(c, 'review', { amount: 0.1, unit: 'usd' }, false); // a chat turn: spend, not a task
  c = addTurnCost(c, 'review', { amount: 2, unit: 'credits' });
  c = addTurnCost(c, 'issue', { amount: 1.25, unit: 'usd' });
  assert.equal(c.total.usd.toFixed(2), '2.15');
  assert.equal(c.total.credits, 2);
  assert.deepEqual(c.skills.review.credits, { tasks: 1, amount: 2 });
  assert.equal(c.skills.review.usd.tasks, 2);
  const per = costPerTask(c, 'review');
  assert.deepEqual(per.map((p) => [p.unit, p.amount.toFixed(2), p.tasks]), [['usd', '0.45', 2], ['credits', '2.00', 1]]);
  assert.deepEqual(costPerTask(c, 'conflict'), []);
});

test("old runners' turns and bad values leave the totals alone", () => {
  const c = addTurnCost(undefined, 'general', { amount: 1, unit: 'usd' });
  for (const bad of [undefined, null, {}, { amount: 'x', unit: 'usd' }, { amount: -1, unit: 'usd' }, { amount: 1, unit: 'eur' }, { amount: 1e9, unit: 'usd' }]) {
    assert.deepEqual(addTurnCost(c, 'general', bad), c);
    assert.equal(cleanTurnCost(bad), null);
  }
  assert.deepEqual(addTurnCost(c, 'nonsense', { amount: 1, unit: 'usd' }), c);
  assert.deepEqual(cleanCost(undefined), { total: {}, skills: {} });
  assert.deepEqual(cleanCost({ total: { usd: 'NaN', credits: 3 }, skills: { review: { usd: { tasks: 2.7, amount: -4 } }, hacking: {} } }), {
    total: { credits: 3 },
    skills: { review: { usd: { tasks: 2, amount: 0 } } },
  });
});

test('costs read as estimates in dollars, or credits', () => {
  assert.equal(formatCost(0.4, 'usd'), '≈$0.40');
  assert.equal(formatCost(0.004, 'usd'), '≈<$0.01');
  assert.equal(formatCost(0, 'usd'), '≈$0.00');
  assert.equal(formatCost(123.4, 'usd'), '≈$123');
  assert.equal(formatCost(3.32849, 'credits'), '3.3 credits');
  assert.equal(formatCost(0.456, 'credits'), '0.46 credits');
  assert.equal(formatCost(42.4, 'credits'), '42 credits');
  assert.equal(formatPerTask({ amount: 0.4, unit: 'usd' }, 'review'), '≈$0.40 per review');
  assert.equal(formatPerTask({ amount: 1.3, unit: 'credits' }, 'issue', true), '1.3 credits/fix');
});

test('totals list each unit that has spend', () => {
  assert.equal(formatTotals({ total: { usd: 1.234, credits: 4.5 } }), '≈$1.23 · 4.5 credits');
  assert.equal(formatTotals({ total: {} }), '');
  assert.equal(formatTotals(null), '');
});
