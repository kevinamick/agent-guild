// Where the team's code lives. The runner reads the boards from the repo's host
// and hands the office one normalized shape (GitHub's field names), so the UI
// doesn't care whether items came from GitHub or Azure DevOps.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveBin, spawnSpec } from './adapters.js';

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
// Ask the Azure CLI for an Azure DevOps token. On Windows `az` is `az.cmd`, which
// can't be started directly, so resolve it like the agent CLIs (spawnSpec runs
// batch files through cmd.exe). Returns { token } or { problem } saying why not.
export async function azAccessToken({ exec = run, resolve = resolveBin } = {}) {
  const az = resolve('az');
  if (!az) return { problem: "the Azure CLI (`az`) isn't on the runner's PATH" };
  const spec = spawnSpec(az, ['account', 'get-access-token', '--resource', ADO_RESOURCE, '--query', 'accessToken', '-o', 'tsv']);
  try {
    const { stdout } = await exec(spec.file, spec.args, { timeout: 30000, windowsHide: true, windowsVerbatimArguments: Boolean(spec.windowsVerbatimArguments) });
    const token = String(stdout).trim();
    return token ? { token } : { problem: '`az account get-access-token` returned no token' };
  } catch (e) {
    const out = String(e.stderr || e.message || '');
    // az often ends with the exact fix, e.g. "Please run: az login --scope <resource>/.default".
    const fix = out.match(/^\s*(az login[^\r\n]*)/m)?.[1];
    if (fix) return { problem: `\`az\` needs you to sign in again for Azure DevOps. Run: ${fix.trim()}` };
    const detail = out.split('\n').map((l) => l.trim()).find(Boolean) || 'it failed';
    return { problem: `\`az account get-access-token\` failed: ${detail.slice(0, 220)}` };
  }
}

// `az` is slow to start, so a token is reused for 30 minutes; a failure is only
// remembered for 30 seconds so signing in with `az login` takes effect quickly.
let azToken = { value: null, until: 0, problem: null };

async function adoAuth() {
  const pat = process.env.AZURE_DEVOPS_EXT_PAT || process.env.GUILD_ADO_PAT;
  if (pat) return { headers: { authorization: `Basic ${Buffer.from(`:${pat}`).toString('base64')}` }, via: 'pat' };
  if (Date.now() > azToken.until) {
    const r = await azAccessToken();
    azToken = r.token
      ? { value: r.token, until: Date.now() + 30 * 60 * 1000, problem: null }
      : { value: null, until: Date.now() + 30 * 1000, problem: r.problem };
  }
  return azToken.value ? { headers: { authorization: `Bearer ${azToken.value}` }, via: 'az' } : { headers: {}, via: null };
}

export function signInMessage(via, org, azProblem) {
  if (via === 'pat') return `Azure DevOps rejected AZURE_DEVOPS_EXT_PAT for "${org}": check it hasn't expired and has Code (Read) and Work Items (Read) scopes for that organization.`;
  if (via === 'az')
    return `Azure DevOps rejected the token from your \`az login\` for "${org}": the signed-in account may not be a member of that organization, or it's in a different directory. Try \`az login --tenant <your org's tenant>\`, or set AZURE_DEVOPS_EXT_PAT instead.`;
  return `Azure DevOps needs sign-in for "${org}": run \`az login\` on the runner's machine, or set AZURE_DEVOPS_EXT_PAT (a PAT with Code and Work Items read) and restart the runner.${azProblem ? ` (${azProblem})` : ''}`;
}

async function adoFetch(url, p, init = {}) {
  const auth = await adoAuth();
  const res = await fetch(url, { ...init, headers: { accept: 'application/json', ...(init.headers || {}), ...auth.headers }, redirect: 'manual' });
  const type = res.headers.get('content-type') || '';
  // Unauthenticated requests get a redirect or a 203 sign-in page instead of JSON.
  if (res.status === 401 || res.status === 403 || res.status === 203 || (res.status >= 300 && res.status < 400) || !type.includes('json')) {
    if (auth.via === 'az') azToken.until = 0; // ask az again next time
    throw new Error(signInMessage(auth.via, p.org, azToken.problem));
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
    areaPath: f['System.AreaPath'] || null,
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

// Area paths as work items store them ("Project\\Team\\Sub"). The API's own
// `path` field has a leading backslash and an extra "\\Area\\" segment, so the
// paths are rebuilt from node names instead.
export function flattenAreas(node, prefix = '') {
  if (!node?.name) return [];
  const path = prefix ? `${prefix}\\${node.name}` : node.name;
  return [path, ...(node.children || []).flatMap((c) => flattenAreas(c, path))];
}

// WIQL for "under this area". Only paths from the project's own area tree are
// accepted, and quotes are doubled, so a filter can never change the query.
export function areaClause(area, areas) {
  if (!area) return '';
  if (!areas.includes(area)) throw new Error(`"${area}" isn't an area path in this project.`);
  return ` AND [System.AreaPath] UNDER '${area.replace(/'/g, "''")}'`;
}

const areaCache = new Map(); // project url -> { list, until }
async function adoAreas(p) {
  const key = base(p);
  const hit = areaCache.get(key);
  if (hit && hit.until > Date.now()) return hit.list;
  const root = await adoFetch(`${key}/_apis/wit/classificationnodes/Areas?$depth=10&api-version=7.1`, p);
  const list = flattenAreas(root);
  areaCache.set(key, { list, until: Date.now() + 5 * 60 * 1000 });
  return list;
}

async function adoBoard(kind, p, { area } = {}) {
  if (kind === 'prs') {
    const data = await adoFetch(`${base(p)}/_apis/git/repositories/${encodeURIComponent(p.repo)}/pullrequests?searchCriteria.status=all&$top=60&api-version=7.1`, p);
    return (data.value || []).map((pr) => adoPrToItem(pr, p));
  }
  const areas = await adoAreas(p);
  const wiql = await adoFetch(`${base(p)}/_apis/wit/wiql?$top=60&api-version=7.1`, p, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.WorkItemType] NOT IN ('Test Case', 'Test Plan', 'Test Suite', 'Shared Steps')${areaClause(area, areas)} ORDER BY [System.ChangedDate] DESC`,
    }),
  });
  const ids = (wiql.workItems || []).map((w) => w.id).slice(0, 60);
  if (!ids.length) return { items: [], areas };
  const fields = ['System.Id', 'System.Title', 'System.State', 'System.WorkItemType', 'System.AreaPath', 'System.CreatedBy', 'System.CreatedDate', 'System.Description', 'System.Tags', 'Microsoft.VSTS.TCM.ReproSteps'];
  const items = await adoFetch(`${base(p)}/_apis/wit/workitems?ids=${ids.join(',')}&fields=${fields.join(',')}&errorPolicy=omit&api-version=7.1`, p);
  return { items: (items.value || []).filter(Boolean).map((wi) => adoWorkItemToItem(wi, p)), areas };
}

// Returns an array of items, or { items, areas } for Azure DevOps work items.
export async function loadBoard(provider, kind, cwd, { area } = {}) {
  if (!provider) throw new Error('This repo has no GitHub or Azure DevOps remote, so there are no boards to show.');
  return provider.type === 'ado' ? adoBoard(kind, provider, { area }) : githubBoard(kind, cwd);
}

// Commands that earn PR bonuses, for either host.
export const PR_COMMANDS = {
  opened: /\b(gh pr create|az repos pr create)\b/,
  merged: /\bgh pr merge\b|\baz repos pr update\b[^\n]*--status\s+completed\b/,
  reviewed: /\bgh pr (review|comment)\b|\baz repos pr set-vote\b/,
};
