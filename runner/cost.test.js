import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCostTracker, priceFor, usageCost, tallyLines, copilotTranscript } from './cost.js';

const FIX = path.join(path.dirname(new URL(import.meta.url).pathname), 'fixtures');
const read = (f) => fs.readFileSync(path.join(FIX, f), 'utf8');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'guild-cost-'));
const near = (a, b, label, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${label}: ${a} ≠ ${b}`);
const noWait = { sleep: async () => {} };

test('prices go by model family, most specific first', () => {
  assert.equal(priceFor('claude-opus-5-5').input, 4);
  assert.equal(priceFor('claude-opus-5').input, 5);
  assert.equal(priceFor('claude-opus-4-1-20250805').input, 15);
  assert.equal(priceFor('claude-haiku-4-5-20251001').output, 5);
  assert.equal(priceFor('claude-fable-5-1').read, 0.25);
  assert.equal(priceFor('<synthetic>'), null);
  assert.equal(priceFor('gpt-5'), null);
});

test("token pricing matches Claude Code's own session cost", () => {
  // A real session's usage, and the costUSD Claude Code recorded for it.
  const usage = {
    input_tokens: 10, output_tokens: 62, cache_read_input_tokens: 13689, cache_creation_input_tokens: 14463,
    cache_creation: { ephemeral_1h_input_tokens: 14463, ephemeral_5m_input_tokens: 0 },
  };
  near(usageCost(usage, 'claude-haiku-4-5-20251001'), 0.0306149, 'haiku');
  // Without the 5m/1h split, cache writes are priced at the 5-minute rate.
  near(usageCost({ cache_creation_input_tokens: 1e6 }, 'claude-opus-5'), 6.25, '5m default');
  near(usageCost({ output_tokens: 1e6, speed: 'fast' }, 'claude-opus-5-5'), 40, 'fast mode is 2×');
  assert.equal(usageCost({ output_tokens: 5 }, 'mystery-model'), null);
});

test('a Claude transcript counts each message once, and skips junk', () => {
  const st = { ids: new Set(), nanoAiu: null };
  const r = tallyLines(read('claude-transcript.jsonl'), st);
  // msg_A (written twice) + msg_B at Opus 5.5 rates; the synthetic message and the broken line don't count.
  near(r.usd, 0.219316 + 0.0262476, 'usd');
  assert.equal(r.priced, 2);
  assert.equal(r.credits, null);
});

test('the tracker reads only what each turn added, including subagents', async () => {
  const dir = tmp();
  const file = path.join(dir, 'session.jsonl');
  const [head, ...rest] = read('claude-transcript.jsonl').split(/(?<=\n)/);
  const t = createCostTracker(noWait);

  assert.equal(await t.turn(path.join(dir, 'missing.jsonl')), null, 'no file, no cost');
  fs.writeFileSync(file, head);
  t.mark(file); // a turn starts; what's already there is history
  assert.equal(await t.turn(file), null, 'nothing new yet');

  fs.appendFileSync(file, rest.join(''));
  fs.mkdirSync(path.join(dir, 'session', 'subagents'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'session', 'subagents', 'agent-a1.jsonl'), read('claude-subagent.jsonl'));
  const first = await t.turn(file);
  assert.equal(first.unit, 'usd');
  near(first.amount, 0.219316 + 0.0262476 + 0.0306149, 'turn 1 incl. subagent', 1e-6);

  // The half-written last line is finished later and counts then, once.
  fs.appendFileSync(file, ',"model":"claude-opus-5","usage":{"output_tokens":1000000}}}\n');
  assert.deepEqual(await t.turn(file), { amount: 25, unit: 'usd' });
  // The same message written again (another content block) isn't counted twice.
  fs.appendFileSync(file, '{"type":"assistant","message":{"id":"msg_broken","model":"claude-opus-5","usage":{"output_tokens":1000000}}}\n');
  assert.equal(await t.turn(file), null);

  // Rotated: a new, shorter file under the same name is read from its start.
  fs.writeFileSync(file, '{"type":"assistant","message":{"id":"msg_new","model":"claude-sonnet-5","usage":{"input_tokens":1000000}}}\n');
  assert.deepEqual(await t.turn(file), { amount: 2, unit: 'usd' });
});

test('marking a transcript that exists skips its history', async () => {
  const dir = tmp();
  const file = path.join(dir, 'resumed.jsonl');
  fs.writeFileSync(file, read('claude-transcript.jsonl').replace(/\{"type":"assistant","message":\{"id":"msg_broken"$/, ''));
  const t = createCostTracker(noWait);
  t.mark(file);
  fs.appendFileSync(file, '{"type":"assistant","message":{"id":"msg_C","model":"claude-opus-5-5","usage":{"output_tokens":1000}}}\n');
  assert.deepEqual(await t.turn(file), { amount: 0.02, unit: 'usd' });
});

test('Copilot: each turn costs the growth in AI credits, waiting for the late checkpoint', async () => {
  const lines = read('copilot-events.jsonl').split(/(?<=\n)/);
  const cps = lines.map((l, i) => (l.includes('usage_checkpoint') ? i : -1)).filter((i) => i >= 0);
  const dir = path.join(tmp(), 'sid');
  fs.mkdirSync(dir);
  const file = path.join(dir, 'events.jsonl');
  let later = null;
  // Copilot writes the checkpoint just after agentStop; the tracker polls for it.
  const t = createCostTracker({ sleep: async () => later && (fs.appendFileSync(file, later), (later = null)) });

  fs.writeFileSync(file, lines.slice(0, cps[0]).join(''));
  later = lines[cps[0]];
  const first = await t.turn(file);
  assert.deepEqual(first, { amount: 3.32849, unit: 'credits' });

  fs.appendFileSync(file, lines.slice(cps[0] + 1, cps[1]).join(''));
  later = lines[cps[1]];
  assert.deepEqual(await t.turn(file), { amount: 1.32332, unit: 'credits' });

  // No checkpoint ever comes: give up, no cost.
  fs.appendFileSync(file, lines.slice(cps[1] + 1).join(''));
  assert.equal(await t.turn(file, { waitMs: 300 }), null);
});

test('Copilot: a session picked up mid-way only counts from where it was marked', async () => {
  const dir = path.join(tmp(), 'sid');
  fs.mkdirSync(dir);
  const file = path.join(dir, 'events.jsonl');
  const lines = read('copilot-events.jsonl').split(/(?<=\n)/);
  const second = lines.findLastIndex((l) => l.includes('usage_checkpoint'));
  fs.writeFileSync(file, lines.slice(0, second).join(''));
  const t = createCostTracker(noWait);
  t.mark(file); // already holds the first turn's checkpoint
  fs.appendFileSync(file, lines[second]);
  assert.deepEqual(await t.turn(file), { amount: 1.32332, unit: 'credits' });
});

test("Copilot's session id maps to its events file", () => {
  assert.equal(copilotTranscript('0000-1111-2222', { COPILOT_HOME: '/h/.copilot' }), path.join('/h/.copilot', 'session-state', '0000-1111-2222', 'events.jsonl'));
  assert.equal(copilotTranscript('../../etc'), null);
  assert.equal(copilotTranscript(undefined), null);
});
