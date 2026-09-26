import test from 'node:test';
import assert from 'node:assert/strict';
import { detectProvider, adoPrToItem, adoWorkItemToItem, htmlToText, PR_COMMANDS } from './providers.js';

test('detects GitHub and every Azure DevOps remote form', () => {
  assert.deepEqual(detectProvider('git@github.com:kevinamick/explainimals.git'), { type: 'github', repo: 'kevinamick/explainimals', display: 'kevinamick/explainimals' });
  const want = { type: 'ado', org: 'contoso', project: 'Web App', repo: 'site', display: 'contoso/Web App/site' };
  for (const url of [
    'https://dev.azure.com/contoso/Web%20App/_git/site',
    'https://kevin@dev.azure.com/contoso/Web%20App/_git/site',
    'git@ssh.dev.azure.com:v3/contoso/Web%20App/site',
    'https://contoso.visualstudio.com/Web%20App/_git/site',
    'https://contoso.visualstudio.com/DefaultCollection/Web%20App/_git/site',
    'contoso@vs-ssh.visualstudio.com:v3/contoso/Web%20App/site',
  ]) assert.deepEqual(detectProvider(url), want, url);
  assert.equal(detectProvider('https://gitlab.com/a/b.git'), null);
});

test('maps ADO pull requests onto board columns', () => {
  const p = { org: 'o', project: 'p', repo: 'r' };
  const pr = (extra) => adoPrToItem({ pullRequestId: 7, title: 't', status: 'active', sourceRefName: 'refs/heads/feat', targetRefName: 'refs/heads/main', reviewers: [], ...extra }, p);
  assert.equal(pr({}).state, 'OPEN');
  assert.equal(pr({ status: 'completed' }).state, 'MERGED');
  assert.equal(pr({ status: 'abandoned' }).state, 'CLOSED');
  assert.equal(pr({ reviewers: [{ vote: 10 }] }).reviewDecision, 'APPROVED');
  assert.equal(pr({ reviewers: [{ vote: 10 }, { vote: -10 }] }).reviewDecision, 'CHANGES_REQUESTED');
  assert.equal(pr({ mergeStatus: 'conflicts' }).mergeable, 'CONFLICTING');
  assert.equal(pr({}).headRefName, 'feat');
  assert.equal(pr({}).url, 'https://dev.azure.com/o/p/_git/r/pullrequest/7');
});

test('maps ADO work items and strips HTML', () => {
  const wi = adoWorkItemToItem({ id: 42, fields: { 'System.Title': 'Fix login', 'System.State': 'Resolved', 'System.WorkItemType': 'Bug', 'System.Description': '<div>Steps:<br>1 &amp; 2</div>' } }, { org: 'o', project: 'p', repo: 'r' });
  assert.equal(wi.state, 'CLOSED');
  assert.equal(wi.type, 'Bug');
  assert.equal(wi.body, 'Steps:\n1 & 2');
  assert.equal(htmlToText('<ul><li>a</li><li>b</li></ul>'), '• a\n• b');
});

test('PR bonus commands match both hosts', () => {
  assert.ok(PR_COMMANDS.opened.test('az repos pr create --title x --work-items 42'));
  assert.ok(PR_COMMANDS.merged.test('az repos pr update --id 7 --status completed'));
  assert.ok(!PR_COMMANDS.merged.test('az repos pr update --id 7 --status abandoned'));
  assert.ok(PR_COMMANDS.reviewed.test('az repos pr set-vote --id 7 --vote approve'));
  assert.ok(PR_COMMANDS.opened.test('gh pr create --fill'));
});
