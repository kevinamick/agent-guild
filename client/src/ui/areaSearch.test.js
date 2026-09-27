import test from 'node:test';
import assert from 'node:assert/strict';
import { searchAreas } from './areaSearch.js';

const AREAS = ['Web', 'Web\\Checkout', 'Web\\Checkout\\Payments', 'Web\\Search', 'Web\\Platform\\Payments API', 'Web\\Growth\\Checkout Experiments'];

test('an empty search lists everything', () => {
  assert.deepEqual(searchAreas(AREAS, ''), AREAS);
});

test('matches any part of any segment, best matches first', () => {
  assert.deepEqual(searchAreas(AREAS, 'pay'), ['Web\\Checkout\\Payments', 'Web\\Platform\\Payments API']);
  assert.equal(searchAreas(AREAS, 'checkout')[0], 'Web\\Checkout', 'the area itself before things under it');
  assert.deepEqual(searchAreas(AREAS, 'ments'), ['Web\\Checkout\\Payments', 'Web\\Growth\\Checkout Experiments', 'Web\\Platform\\Payments API']);
});

test('several words (or a typed path) must all match', () => {
  assert.deepEqual(searchAreas(AREAS, 'checkout pay'), ['Web\\Checkout\\Payments']);
  assert.deepEqual(searchAreas(AREAS, 'checkout\\pay'), ['Web\\Checkout\\Payments']);
  assert.deepEqual(searchAreas(AREAS, 'nope'), []);
});

test('case-insensitive and limited', () => {
  assert.deepEqual(searchAreas(AREAS, 'SEARCH'), ['Web\\Search']);
  assert.equal(searchAreas(AREAS, 'web', 2).length, 2);
});
