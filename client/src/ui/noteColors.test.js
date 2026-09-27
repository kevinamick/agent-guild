import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noteColor, POSTIT } from './noteColors.js';

test('Azure DevOps work items are coloured by type', () => {
  assert.equal(noteColor({ number: 1, type: 'Bug' }, 'issues'), POSTIT.pink);
  assert.equal(noteColor({ number: 1, type: 'User Story' }, 'issues'), POSTIT.blue);
  assert.equal(noteColor({ number: 1, type: 'Product Backlog Item' }, 'issues'), POSTIT.blue);
  assert.equal(noteColor({ number: 1, type: 'Task' }, 'issues'), POSTIT.yellow);
  assert.equal(noteColor({ number: 1, type: 'Feature' }, 'issues'), POSTIT.purple);
  assert.equal(noteColor({ number: 1, type: 'Epic' }, 'issues'), POSTIT.orange);
});

test('GitHub issues are coloured by label', () => {
  assert.equal(noteColor({ number: 2, labels: [{ name: 'bug' }] }, 'issues'), POSTIT.pink);
  assert.equal(noteColor({ number: 2, labels: [{ name: 'good first issue' }, { name: 'enhancement' }] }, 'issues'), POSTIT.blue);
  assert.equal(noteColor({ number: 2, labels: [{ name: 'documentation' }] }, 'issues'), POSTIT.green);
});

test('pull requests are coloured by state', () => {
  assert.equal(noteColor({ number: 3, isDraft: true }, 'prs'), POSTIT.purple);
  assert.equal(noteColor({ number: 3, reviewDecision: 'APPROVED' }, 'prs'), POSTIT.green);
  assert.equal(noteColor({ number: 3, reviewDecision: 'CHANGES_REQUESTED' }, 'prs'), POSTIT.orange);
});

test('anything else gets a steady mix of colours', () => {
  const colors = [1, 2, 3, 4, 5, 6].map((n) => noteColor({ number: n, labels: [] }, 'issues'));
  assert.equal(new Set(colors).size, 6, 'neighbours differ');
  assert.equal(noteColor({ number: 7 }, 'prs'), noteColor({ number: 7 }, 'prs'), 'the same item keeps its colour');
});
