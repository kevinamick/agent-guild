import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanAgentName, AGENT_NAME_MAX } from './names.js';

test('agent names are tidied and validated', () => {
  assert.deepEqual(cleanAgentName('  Ada   Lovelace '), { name: 'Ada Lovelace' });
  assert.deepEqual(cleanAgentName("O'Brien-2"), { name: "O'Brien-2" });
  assert.deepEqual(cleanAgentName('Zoë'), { name: 'Zoë' });
  assert.deepEqual(cleanAgentName('小助手'), { name: '小助手' });
  assert.ok(cleanAgentName('').error);
  assert.ok(cleanAgentName('   ').error);
  assert.ok(cleanAgentName('x'.repeat(AGENT_NAME_MAX + 1)).error);
  assert.ok(cleanAgentName('<b>hi</b>').error, 'no markup');
  assert.ok(cleanAgentName('-dash first').error, 'must start with a letter or number');
  assert.ok(cleanAgentName('tab\there').name === 'tab here', 'whitespace collapses to single spaces');
  assert.ok(cleanAgentName('bell\u0007').error, 'no control characters');
});
