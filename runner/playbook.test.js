import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { lessonNote, systemPrompt } from './playbook.js';
import { emptyXp } from '../shared/progression.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guild-playbook-'));

test('the task note names the playbook file for that kind of work', () => {
  const note = lessonNote('review', dir);
  assert.match(note, /a Reviewer task/);
  assert.doesNotMatch(note, /\n/, 'one line of context');
  assert.ok(note.includes(path.join(dir, 'playbook', 'review.md')));
  assert.match(lessonNote('issue', dir), /an Issue Fixer task.*issue\.md/s);
  assert.match(lessonNote('nonsense', dir), /general\.md/);
});

test("an agent with no XP isn't told it is a Generalist", () => {
  const agent = { name: 'Pixel', xp: emptyXp() };
  assert.match(systemPrompt(agent, dir, 'Kevin'), /Overall level 1 \(Intern\)/);
  const reviewer = { name: 'Rivet', xp: { ...emptyXp(), review: 300 } };
  assert.match(systemPrompt(reviewer, dir, 'Kevin'), /Reviewer\)/);
});
