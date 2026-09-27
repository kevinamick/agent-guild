import test from 'node:test';
import assert from 'node:assert/strict';
import { createScreen, paletteColor } from './screens.js';

const settle = () => new Promise((r) => setTimeout(r, 20));

test('snapshots keep text and colours as runs', async () => {
  const s = createScreen(30, 4);
  s.write('\x1b[31mred\x1b[0m plain \x1b[38;2;10;200;30mrgb\x1b[0m\r\n\x1b[7minv\x1b[0m');
  await settle();
  const rows = s.snapshot();
  assert.deepEqual(rows[0], [['red', '#ef4444', null], [' plain ', null, null], ['rgb', '#0ac81e', null]]);
  assert.deepEqual(rows[1][0], ['inv', '#1b1d2e', '#d6deeb'], 'inverse video swaps colours');
  assert.deepEqual(rows[3], [], 'blank rows are empty');
});

test('only changed rows are sent after the first snapshot', async () => {
  const s = createScreen(20, 3);
  s.write('one\r\ntwo');
  await settle();
  const first = s.changes();
  assert.deepEqual(Object.keys(first.rows).sort(), ['0', '1', '2']);
  assert.equal(s.changes(), null, 'nothing new, nothing sent');
  s.write('\r\x1b[Ktwo!');
  await settle();
  assert.deepEqual(Object.keys(s.changes().rows), ['1']);
  const full = s.full();
  assert.equal(full.full, true);
  assert.equal(full.n, 3);
});

test('resize and reset force a fresh full picture', async () => {
  const s = createScreen(20, 3);
  s.write('hello');
  await settle();
  s.changes();
  s.resize(40, 5);
  await settle();
  assert.equal(Object.keys(s.changes().rows).length, 5);
  s.reset('again');
  await settle();
  assert.deepEqual(s.snapshot()[0], [['again', null, null]]);
});

test('the 256-colour palette', () => {
  assert.equal(paletteColor(1), '#ef4444');
  assert.equal(paletteColor(16), '#000000');
  assert.equal(paletteColor(231), '#ffffff');
  assert.equal(paletteColor(232), '#080808');
});

test('a Windows (ConPTY) screen takes the compatibility option and still resizes', async () => {
  const s = createScreen(40, 5, { backend: 'conpty', buildNumber: 22631 });
  s.write('C:\\> copilot');
  await settle();
  s.resize(100, 30);
  await settle();
  const c = s.changes();
  assert.equal(c.cols, 100);
  assert.equal(c.n, 30);
  assert.deepEqual(s.snapshot()[0], [['C:\\> copilot', null, null]]);
});
