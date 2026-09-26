// Where the team's code lives. The runner reads the boards from the repo's host
// and hands the office one normalized shape (GitHub's field names), so the UI
// doesn't care whether items came from GitHub or Azure DevOps.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ADO_RESOURCE = '499b84ac-1321-427f-aa17-267ca6975798'; // Azure DevOps, for `az account get-access-token`
const CLOSED_STATES = new Set(['closed', 'done', 'removed', 'resolved', 'completed', 'cut', 'inactive']);

export function detectProvider(remoteUrl) {
  const url = String(remoteUrl || '').trim();
  let m = url.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  if (m) return { type: 'github', repo: `${m[1]}/${m[2]}`, display: `${m[1]}/${m[2]}` };
  // https://[user@]dev.azure.com/{org}/{project}/_git/{repo}
  m = url.match(/dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/?#]+)/i);
  // git@ssh.dev.azure.com:v3/{org}/{project}/{repo}
  m ||= url.match(/ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/([^/?#]+)/i);
  if (m) return ado(m[1], m[2], m[3]);
  // https://{org}.visualstudio.com/[DefaultCollection/]{project}/_git/{repo}
  m = url.match(/\/\/(?:[^@/]+@)?([^./]+)\.visualstudio\.com\/(?:DefaultCollection\/)?([^/]+)\/_git\/([^/?#]+)/i);
  // {org}@vs-ssh.visualstudio.com:v3/{org}/{project}/{repo}
  m ||= url.match(/vs-ssh\.visualstudio\.com:v3\/([^/]+)\/([^/]+)\/([^/?#]+)/i);
  if (m) return ado(m[1], m[2], m[3]);
  return null;
}

function ado(org, project, repo) {
  const [o, p, r] = [org, project, repo.replace(/\.git$/, '')].map(decodeURIComponent);
  return { type: 'ado', org: o, project: p, repo: r, display: `${o}/${p}/${r}` };
}

// ---------------------------------------------------------------- GitHub (gh)

const GH_QUERIES = {
  issues: ['issue', 'list', '--state', 'all', '--limit', '60', '--json', 'number,title,state,author,createdAt,body,url,labels,comments'],
  prs: ['pr', 'list', '--state', 'all', '--limit', '60', '--json',
    'number,title,state,isDraft,reviewDecision,author,additions,deletions,headRefName,baseRefName,body,url,mergeable,createdAt,updatedAt'],
};

async function githubBoard(kind, cwd) {
  const { stdout } = await run('gh', GH_QUERIES[kind], { cwd, maxBuffer: 16 * 1024 * 1024 });
  return JSON.parse(stdout || '[]');
}

// ---------------------------------------------------------------- Azure DevOps (REST)

// A PAT (the same variable the az devops extension reads) beats an Entra token
// from `az login`; with neither, public projects still work anonymously.
let azToken = { value: null, until: 0 };

async function adoAuth() {
  const pat = process.env.AZURE_DEVOPS_EXT_PAT || process.env.GUILD_ADO_PAT;
  if (pat) return { authorization: `Basic ${Buffer.from(`:${pat}`).toString('base64')}` };
  // `az` is slow to start, so remember the token (or its absence) for a while.
  if (Date.now() > azToken.until) {
    azToken = { value: null, until: Date.now() + 5 * 60 * 1000 };
    try {
      const { stdout } = await run('az', ['account', 'get-access-token', '--resource', ADO_RESOURCE, '--query', 'accessToken', '-o', 'tsv'], { timeout: 20000 });
      if (stdout.trim()) azToken = { value: stdout.trim(), until: Date.now() + 30 * 60 * 1000 };
    } catch {}
  }
  return azToken.value ? { authorization: `Bearer ${azToken.value}` } : {};
}

async function adoFetch(url, init = {}) {
  const res = await fetch(url, { ...init, headers: { accept: 'application/json', ...(init.headers || {}), ...(await adoAuth()) }, redirect: 'manual' });
  const type = res.headers.get('content-type') || '';
  // Unauthenticated requests get a redirect or a 203 sign-in page instead of JSON.
  if (res.status === 401 || res.status === 403 || res.status === 203 || (res.status >= 300 && res.status < 400) || !type.includes('json')) {
    throw new Error('Azure DevOps needs sign-in: set AZURE_DEVOPS_EXT_PAT (a PAT with Code and Work Items read) or run `az login`, then restart the runner.');
  }
  if (!res.ok) throw new Error(`Azure DevOps answered ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return res.json();
}

const base = (p) => `https://dev.azure.com/${encodeURIComponent(p.org)}/${encodeURIComponent(p.project)}`;

export function adoPrToItem(pr, p) {
  const votes = (pr.reviewers || []).map((r) => r.vote || 0);
  const state = { active: 'OPEN', completed: 'MERGED', abandoned: 'CLOSED' }[pr.status] || 'OPEN';
  return {
    number: pr.pullRequestId,
    title: pr.title,
    state,
    isDraft: Boolean(pr.isDraft),
    // ADO votes: 10 approved, 5 approved with suggestions, -5 waiting for author, -10 rejected.
    reviewDecision: votes.some((v) => v >= 5) && !votes.some((v) => v < 0) ? 'APPROVED' : votes.some((v) => v < 0) ? 'CHANGES_REQUESTED' : null,
    author: { login: pr.createdBy?.displayName || 'someone' },
    headRefName: String(pr.sourceRefName || '').replace(/^refs\/heads\//, ''),
    baseRefName: String(pr.targetRefName || '').replace(/^refs\/heads\//, ''),
    body: pr.description || '',
    url: `${base(p)}/_git/${encodeURIComponent(p.repo)}/pullrequest/${pr.pullRequestId}`,
    mergeable: pr.mergeStatus === 'conflicts' ? 'CONFLICTING' : 'MERGEABLE',
    createdAt: pr.creationDate,
    labels: (pr.labels || []).filter((l) => l.active !== false).map((l) => ({ name: l.name })),
  };
}

export function adoWorkItemToItem(wi, p) {
  const f = wi.fields || {};
  const stateName = String(f['System.State'] || '');
  return {
    number: wi.id,
    title: f['System.Title'] || `Work item ${wi.id}`,
    state: CLOSED_STATES.has(stateName.toLowerCase()) ? 'CLOSED' : 'OPEN',
    stateName,
    type: f['System.WorkItemType'] || 'Work item',
    author: { login: f['System.CreatedBy']?.displayName || f['System.CreatedBy'] || 'someone' },
    createdAt: f['System.CreatedDate'],
    body: htmlToText(f['System.Description'] || f['Microsoft.VSTS.TCM.ReproSteps'] || ''),
    url: `${base(p)}/_workitems/edit/${wi.id}`,
    labels: String(f['System.Tags'] || '').split(';').map((t) => t.trim()).filter(Boolean).map((name) => ({ name })),
  };
}

export function htmlToText(html) {
  return String(html)
    .replace(/<(br|\/p|\/div|\/li)[^>]*>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function adoBoard(kind, p) {
  if (kind === 'prs') {
    const data = await adoFetch(`${base(p)}/_apis/git/repositories/${encodeURIComponent(p.repo)}/pullrequests?searchCriteria.status=all&$top=60&api-version=7.1`);
    return (data.value || []).map((pr) => adoPrToItem(pr, p));
  }
  const wiql = await adoFetch(`${base(p)}/_apis/wit/wiql?$top=60&api-version=7.1`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      query: "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.WorkItemType] NOT IN ('Test Case', 'Test Plan', 'Test Suite', 'Shared Steps') ORDER BY [System.ChangedDate] DESC",
    }),
  });
  const ids = (wiql.workItems || []).map((w) => w.id).slice(0, 60);
  if (!ids.length) return [];
  const fields = ['System.Id', 'System.Title', 'System.State', 'System.WorkItemType', 'System.CreatedBy', 'System.CreatedDate', 'System.Description', 'System.Tags', 'Microsoft.VSTS.TCM.ReproSteps'];
  const items = await adoFetch(`${base(p)}/_apis/wit/workitems?ids=${ids.join(',')}&fields=${fields.join(',')}&errorPolicy=omit&api-version=7.1`);
  return (items.value || []).filter(Boolean).map((wi) => adoWorkItemToItem(wi, p));
}

export async function loadBoard(provider, kind, cwd) {
  if (!provider) throw new Error('This repo has no GitHub or Azure DevOps remote, so there are no boards to show.');
  return provider.type === 'ado' ? adoBoard(kind, provider) : githubBoard(kind, cwd);
}

// Commands that earn PR bonuses, for either host.
export const PR_COMMANDS = {
  opened: /\b(gh pr create|az repos pr create)\b/,
  merged: /\bgh pr merge\b|\baz repos pr update\b[^\n]*--status\s+completed\b/,
  reviewed: /\bgh pr (review|comment)\b|\baz repos pr set-vote\b/,
};
