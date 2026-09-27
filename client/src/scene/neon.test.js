import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signLines } from './neon.js';

const text = (name) => signLines(name).lines.map(([t]) => t);

test('short names stay on one line, longer ones split evenly', () => {
  assert.deepEqual(text('DFM'), ['DFM']);
  assert.deepEqual(text('Agent Guild'), ['Agent', 'Guild']);
  assert.deepEqual(text('Data Foundations Machine Learning'), ['Data Foundations', 'Machine Learning']);
  assert.deepEqual(text('The Very Long Office Name For Testing Things'), ['The Very Long', 'Office Name For', 'Testing Things']);
});

test('the line count sets the font size and line heights', () => {
  assert.deepEqual(signLines('Agent Guild'), { lines: [['Agent', 0.3], ['Guild', 0.72]], px: 230 });
  assert.equal(signLines('DFM').px, 260);
  assert.equal(signLines('The Very Long Office Name For Testing Things').lines.length, 3);
});

test('an empty name falls back to Agent Guild', () => {
  assert.deepEqual(text(''), ['Agent', 'Guild']);
  assert.deepEqual(text('   '), ['Agent', 'Guild']);
});
