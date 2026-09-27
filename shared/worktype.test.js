import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectKind, kindFromPrompt, isEditTool } from './worktype.js';

test('a review: asked to review, read the PR, no edits', () => {
  assert.equal(detectKind({ prompt: 'Review pull request #12', commands: ['gh pr view 12 --comments', 'gh pr diff 12'] }), 'review');
  assert.equal(detectKind({ prompt: 'can you look over the changes on this branch', commands: ['git diff main...HEAD'] }), 'review');
  assert.equal(detectKind({ prompt: 'what do you think of PR 99?', commands: ['az repos pr show --id 99'] }), 'review');
  // Typed into the terminal, no PR at all: a real Copilot turn that was scored Generalist.
  assert.equal(detectKind({ prompt: "Take a look at the latest commit (git show HEAD) and tell me if it's safe to ship", commands: ['git --no-pager show HEAD'] }), 'review');
});

test('merge conflicts and rebases', () => {
  assert.equal(detectKind({ prompt: 'merge main into my branch', commands: ['git merge origin/main', 'git checkout --theirs package-lock.json'], edits: 3 }), 'conflict');
  assert.equal(detectKind({ prompt: 'rebase onto develop', commands: ['git rebase origin/develop'] }), 'conflict');
  assert.equal(detectKind({ prompt: 'this is annoying', commands: ['git diff --name-only --diff-filter=U'], edits: 2 }), 'conflict');
});

test('fixing issues and building features', () => {
  assert.equal(detectKind({ prompt: 'Work on GitHub issue #7', commands: ['gh issue view 7'], edits: 2 }), 'issue');
  assert.equal(detectKind({ prompt: 'fix the login redirect bug', commands: ['npm test'], edits: 1 }), 'issue');
  assert.equal(detectKind({ prompt: 'Work item 4321: add CSV export', commands: ['az boards work-item show --id 4321'], edits: 4 }), 'issue');
  assert.equal(detectKind({ prompt: 'make the header blue', commands: ['gh pr create --fill'], edits: 1 }), 'issue');
});

test('a review that also fixes things counts by what dominated', () => {
  assert.equal(detectKind({ prompt: 'review PR 3', commands: ['gh pr diff 3', 'gh pr review 3 --comment'], edits: 0 }), 'review');
});

test('not enough evidence returns null (the desk keeps its kind)', () => {
  assert.equal(detectKind({ prompt: 'thanks!' }), null);
  assert.equal(detectKind({ prompt: 'what does this function do?', commands: ['cat src/app.js'] }), null);
  assert.equal(detectKind({ prompt: 'run the tests', commands: ['npm test'] }), null);
  assert.equal(detectKind({ prompt: 'git merge --abort please', commands: ['git merge --abort'] }), null);
});

test('the prompt alone, for picking the lesson file before work starts', () => {
  assert.equal(kindFromPrompt('Review pull request #12: "Add login"'), 'review');
  assert.equal(kindFromPrompt('Resolve the merge conflicts on feature/x'), 'conflict');
  assert.equal(kindFromPrompt('Fix issue #5'), 'issue');
  assert.equal(kindFromPrompt('hello'), null);
  // The briefs the boards write for each kind of card.
  assert.equal(kindFromPrompt('Review Azure DevOps pull request !42: "Add export" (feature/export → main).\n\nRead it with `az repos pr show --id 42`, then read the diff. Look for bugs, risky changes and missing tests.'), 'review');
  assert.equal(kindFromPrompt('Azure DevOps pull request !42 ("Add export") has merge conflicts with main.\n\nCheck out feature/export, merge origin/main into it, and resolve every conflict. Run the tests, then push the branch.'), 'conflict');
  assert.equal(kindFromPrompt('Work on Azure DevOps work item #4321: "CSV export".\n\nCreate a new branch, implement the change, then open a pull request with `az repos pr create --work-items 4321`.'), 'issue');
  assert.equal(kindFromPrompt('Pull request #8 ("Tidy") has merge conflicts with main.\n\nCheck out fix/tidy, merge main into it, and resolve every conflict so the intent of both sides is kept.'), 'conflict');
});

test('edit tools across Claude and Copilot', () => {
  for (const t of ['Edit', 'Write', 'MultiEdit', 'edit', 'create', 'str_replace_editor']) assert.ok(isEditTool(t), t);
  for (const t of ['Read', 'Bash', 'view', 'write_bash', 'grep']) assert.ok(!isEditTool(t), t);
});
