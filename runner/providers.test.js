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

import { azAccessToken, signInMessage } from './providers.js';

test('az token: missing az, Windows az.cmd, failures and success', async () => {
  assert.match((await azAccessToken({ resolve: () => null })).problem, /isn't on the runner's PATH/);

  let called;
  const ok = await azAccessToken({
    resolve: () => 'C:\\Program Files\\Azure CLI\\wbin\\az.cmd',
    exec: async (file, args, options) => ((called = { file, args, options }), { stdout: 'tok123\n' }),
  });
  assert.equal(ok.token, 'tok123');
  assert.match(called.file, /cmd(\.exe)?$/i, 'az.cmd must go through cmd.exe on Windows');
  assert.ok(called.options.windowsVerbatimArguments, 'the escaped command line is passed as-is');
  assert.ok(called.args[3].includes('C:\\Program^ Files\\Azure^ CLI\\wbin\\az.cmd') && called.args[3].includes('get-access-token'));

  const failed = await azAccessToken({
    resolve: () => '/usr/bin/az',
    exec: async () => {
      throw Object.assign(new Error('exit 1'), { stderr: "\nERROR: Please run 'az login' to setup account.\n" });
    },
  });
  assert.match(failed.problem, /Please run 'az login'/);

  // Signed in, but Azure DevOps needs its own consent: surface az's exact command.
  const consent = await azAccessToken({
    resolve: () => '/usr/bin/az',
    exec: async () => {
      throw Object.assign(new Error('exit 1'), {
        stderr: 'ERROR: AADSTS9002313: Invalid request.\nInteractive authentication is needed. Please run:\naz login --scope 499b84ac-1321-427f-aa17-267ca6975798/.default\n',
      });
    },
  });
  assert.match(consent.problem, /Run: az login --scope 499b84ac-1321-427f-aa17-267ca6975798\/\.default$/);
});

test('sign-in messages say which credential was rejected', () => {
  assert.match(signInMessage('pat', 'contoso'), /rejected AZURE_DEVOPS_EXT_PAT/);
  assert.match(signInMessage('az', 'contoso'), /rejected the token from your `az login`.*--tenant/);
  assert.match(signInMessage(null, 'contoso', "`az` isn't on PATH"), /needs sign-in.*az login.*isn't on PATH/);
});

import { flattenAreas, areaClause, workItemQueries, chunk } from './providers.js';

test('area paths come out as work items store them', () => {
  const tree = { name: 'Web', path: '\\Web\\Area', children: [{ name: 'Checkout', children: [{ name: 'Payments' }] }, { name: "O'Hare Team" }] };
  assert.deepEqual(flattenAreas(tree), ['Web', 'Web\\Checkout', 'Web\\Checkout\\Payments', "Web\\O'Hare Team"]);
  assert.deepEqual(flattenAreas(null), []);
});

test('area filters only accept known paths and can never break the query', () => {
  const areas = ['Web', 'Web\\Checkout', "Web\\O'Hare Team"];
  assert.equal(areaClause('', areas), '');
  assert.equal(areaClause('Web\\Checkout', areas), " AND [System.AreaPath] UNDER 'Web\\Checkout'");
  assert.equal(areaClause("Web\\O'Hare Team", areas), " AND [System.AreaPath] UNDER 'Web\\O''Hare Team'");
  assert.throws(() => areaClause("Web' OR 1=1 --", areas), /isn't an area path/);
});

test('work items carry their area path', () => {
  const wi = adoWorkItemToItem({ id: 1, fields: { 'System.Title': 't', 'System.State': 'Active', 'System.AreaPath': 'Web\\Checkout' } }, { org: 'o', project: 'p', repo: 'r' });
  assert.equal(wi.areaPath, 'Web\\Checkout');
});

import { curlConfig, httpRequest, netReason } from './providers.js';

test('curl config quotes everything and keeps secrets off the command line', () => {
  const cfg = curlConfig('https://dev.azure.com/o/p/_apis/wit/wiql', {
    method: 'POST',
    headers: { authorization: 'Bearer abc"def', 'content-type': 'application/json' },
    body: JSON.stringify({ query: "x UNDER 'A\\B'" }),
  });
  assert.match(cfg, /^url = "https:\/\/dev\.azure\.com\/o\/p\/_apis\/wit\/wiql"$/m);
  assert.match(cfg, /^request = "POST"$/m);
  assert.match(cfg, /^header = "authorization: Bearer abc\\"def"$/m);
  assert.match(cfg, /^data-binary = "\{\\"query\\":\\"x UNDER 'A\\\\\\\\B'\\"\}"$/m);
  assert.ok(!cfg.includes('\r'));
});

test('a fetch that cannot connect falls back to curl, and explains when both fail', async () => {
  const broken = async () => {
    throw new TypeError('fetch failed', { cause: { code: 'SELF_SIGNED_CERT_IN_CHAIN' } });
  };
  const ok = await httpRequest('https://dev.azure.com/x', {}, { fetchImpl: broken, curl: async () => ({ status: 200, type: 'application/json', text: '{"a":1}' }) });
  assert.deepEqual(ok, { status: 200, type: 'application/json', text: '{"a":1}' });
  await assert.rejects(
    httpRequest('https://dev.azure.com/x', {}, { fetchImpl: broken, curl: async () => { throw new Error('curl: (60) SSL certificate problem'); } }),
    /Couldn't reach dev\.azure\.com \(SELF_SIGNED_CERT_IN_CHAIN\); curl couldn't either \(curl: \(60\) SSL certificate problem\)\. Behind a proxy\?/,
  );
  assert.equal(netReason(new TypeError('fetch failed')), 'fetch failed');
});

test('work item queries take everything open under the area, and only a few closed', () => {
  const areas = ['Web', 'Web\\Checkout', 'Web\\Checkout\\Payments'];
  const q = workItemQueries('Web\\Checkout', areas);
  for (const query of [q.open, q.closed]) assert.match(query, /\[System\.AreaPath\] UNDER 'Web\\Checkout'/);
  assert.match(q.open, /\[System\.State\] NOT IN \('Closed', 'Done', 'Removed'/);
  assert.match(q.closed, /\[System\.State\] IN \('Closed'/);
  assert.doesNotMatch(workItemQueries('', areas).open, /AreaPath/);
});

test('ids are fetched 200 at a time', () => {
  const ids = Array.from({ length: 450 }, (_, i) => i);
  assert.deepEqual(chunk(ids, 200).map((c) => c.length), [200, 200, 50]);
  assert.deepEqual(chunk([], 200), []);
});
