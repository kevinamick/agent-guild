#!/usr/bin/env node
// Agent Guild runner: hosts your agents on your machine, with your Claude login
// and your repo checkout, and connects them to the shared office.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { parseArgs } from 'node:util';
import { createRequire } from 'node:module';
import WebSocket from 'ws';
import { emptyXp } from '../shared/progression.js';
import { lessonCounts, readPlaybooks, systemPrompt, trimPlaybooks, playbookDir } from './playbook.js';
import { ADAPTERS, customAdapter, explainMissing, parseCliList, resolveBin, spawnSpec, normalizeHook } from './adapters.js';
import { latestVersion, newer, npxCacheDir, npxCommand, retireDir, sweepRetired } from './update.js';
import { detectProvider, loadBoard, PR_COMMANDS } from './providers.js';

const run = promisify(execFile);
const VERSION = createRequire(import.meta.url)('../package.json').version;

const HELP = `Agent Guild runner ${VERSION}: host your coding agents in a shared Agent Guild office.

Run it inside your checkout of the team repo:

  npx -y --package https://github.com/kevinamick/agent-guild/archive/HEAD.tar.gz agent-guild --server wss://<office> --key <your key>

The server and key are remembered after the first sign-in, so next time just run:

  npx -y --package https://github.com/kevinamick/agent-guild/archive/HEAD.tar.gz agent-guild

Options:
  --server <url>          office server (ws:// or wss://)
  --key <key>             your personal key from the invite
  --repo-dir <dir>        repo your agents work in (default: current directory)
  --cli <list>            engines to offer: claude, copilot (default: whichever are installed);
                          name=path uses that file, e.g. copilot=C:\\tools\\copilot.exe
  --private               don't lend your agents to coworkers
  --permission-mode <m>   Claude Code permission mode (default: auto)
  --copilot-args "<...>"  extra flags for Copilot agents, e.g. "--allow-all-tools"
  --home <dir>            where agents, playbooks and worktrees live (default: ~/.agent-guild)
  --forget                delete the saved server and key, then exit
  -v, --version / -h, --help

Needs Node 20+, git, curl, and Claude Code (claude) or GitHub Copilot CLI (copilot).`;

const { values: opts } = parseArgs({
  options: {
    server: { type: 'string', default: process.env.GUILD_SERVER || '' },
    key: { type: 'string', default: process.env.GUILD_KEY || '' },
    'repo-dir': { type: 'string', default: process.cwd() },
    home: { type: 'string', default: path.join(os.homedir(), '.agent-guild') },
    private: { type: 'boolean', default: false },
    'permission-mode': { type: 'string', default: 'auto' },
    // Engines to offer, comma separated (claude, copilot). Default: whichever are installed.
    cli: { type: 'string', default: process.env.GUILD_CLI || '' },
    // Extra flags for Copilot agents, e.g. "--allow-all-tools" for full autonomy.
    'copilot-args': { type: 'string', default: process.env.GUILD_COPILOT_ARGS || '' },
    // Run a custom command instead (testing, or another CLI wired to the hook URL).
    'agent-cmd': { type: 'string', default: '' },
    forget: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
    version: { type: 'boolean', short: 'v', default: false },
  },
});

if (opts.help) {
  console.log(HELP);
  process.exit(0);
}
if (opts.version) {
  console.log(VERSION);
  process.exit(0);
}

// npx never re-downloads a URL it has already installed, so a runner started from
// the GitHub tarball checks for a newer release itself. If there is one, it clears
// its own npx cache entry and starts the same command again, which fetches it.
const RUNNER_PACKAGE = process.env.GUILD_RUNNER_PACKAGE || 'https://github.com/kevinamick/agent-guild/archive/HEAD.tar.gz';

async function selfUpdate() {
  const cacheDir = npxCacheDir(fileURLToPath(import.meta.url));
  const gh = RUNNER_PACKAGE.match(/github\.com\/([^/]+)\/([^/]+)\/archive\/(.+)\.tar\.gz$/);
  if (!cacheDir || !gh || process.env.GUILD_NO_UPDATE) return false;
  sweepRetired(cacheDir);
  let latest;
  try {
    latest = await latestVersion(`https://raw.githubusercontent.com/${gh[1]}/${gh[2]}/${gh[3]}/package.json`);
  } catch (e) {
    // Offline or GitHub unreachable: run what we have, but say so, since a copy
    // that never updates is otherwise invisible.
    console.log(`Couldn't check for a newer Agent Guild runner (${e.message}); running ${VERSION} from ${cacheDir}.`);
    return false;
  }
  if (!latest || !newer(latest, VERSION)) return false;
  console.log(`Updating the Agent Guild runner ${VERSION} → ${latest}…`);
  try {
    retireDir(cacheDir);
  } catch (e) {
    console.log(`Couldn't clear the old copy (${e.message}); continuing with ${VERSION}. Delete ${cacheDir} to update.`);
    return false;
  }
  // GUILD_NO_UPDATE stops a loop if GitHub's tarball lags behind its raw file for a minute.
  const { file, args, shell } = npxCommand(['-y', '--package', RUNNER_PACKAGE, 'agent-guild', ...process.argv.slice(2)]);
  const child = spawn(file, args, { stdio: 'inherit', env: { ...process.env, GUILD_NO_UPDATE: '1' }, shell });
  child.on('error', (e) => {
    console.error(`Couldn't restart the runner (${e.message}). Run the same command again.`);
    process.exit(1);
  });
  // Windows already sends Ctrl+C to every process in the console, and kill() there
  // is TerminateProcess, which would skip the new runner's clean shutdown.
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.platform !== 'win32' && child.kill(sig));
  child.on('exit', (code) => process.exit(code ?? 0));
  return true;
}

if (await selfUpdate()) await new Promise(() => {}); // the updated runner has taken over

const REPO_DIR = path.resolve(opts['repo-dir']);
const HOME = opts.home;
// Agents are kept per office (set once the server says which office this key is for).
let AGENTS_DIR = null;
let officeId = null;
const CONFIG_FILE = path.join(HOME, 'config.json');
fs.mkdirSync(HOME, { recursive: true });

// Remember where and as whom to connect, so the second run needs no flags.
function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return {};
  }
}
function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  fs.chmodSync(CONFIG_FILE, 0o600);
}
if (opts.forget) {
  fs.rmSync(CONFIG_FILE, { force: true });
  console.log('Forgot the saved server and key.');
  process.exit(0);
}
const saved = readConfig();
opts.server ||= saved.server || '';
opts.key ||= saved.key || '';
if (!opts.server || !opts.key) {
  console.error('Missing --server and --key. Your invite (or 👥 Team in the office) has the exact command.\n');
  console.error(HELP);
  process.exit(1);
}

// Prebuilt PTY binaries (no compiler needed); fall back to node-pty if that's what's installed.
let pty;
try {
  pty = (await import('@lydell/node-pty')).default;
} catch {
  try {
    pty = (await import('node-pty')).default;
  } catch {
    console.error('Could not load a terminal driver (@lydell/node-pty). Run it again with \`npx -y --package https://github.com/kevinamick/agent-guild/archive/HEAD.tar.gz agent-guild\` on Node 20+.');
    process.exit(1);
  }
}

try {
  await run('git', ['-C', REPO_DIR, 'rev-parse', '--show-toplevel']);
} catch {
  console.error(`${REPO_DIR} isn't a git repository. Run this inside your checkout of the team repo, or pass --repo-dir.`);
  process.exit(1);
}

// --cli picks engines and can say where each lives (copilot=C:\tools\copilot.exe).
const wanted = opts.cli ? parseCliList(opts.cli) : Object.keys(ADAPTERS).map((id) => ({ id }));
for (const w of wanted) if (!ADAPTERS[w.id]) console.error(`Unknown engine "${w.id}" in --cli; use ${Object.keys(ADAPTERS).join(', ')}.`);
const ENGINES = opts['agent-cmd']
  ? { custom: customAdapter(path.resolve(opts['agent-cmd'])) }
  : Object.fromEntries(
      wanted
        .filter((w) => ADAPTERS[w.id])
        .map((w) => [w.id, { ...ADAPTERS[w.id], path: resolveBin(w.path || ADAPTERS[w.id].bin) }])
        .filter(([, a]) => a.path),
    );
if (!Object.keys(ENGINES).length) {
  const tried = wanted.filter((w) => ADAPTERS[w.id]);
  const given = tried.filter((w) => w.path);
  console.error(`No agent CLI found. Install Claude Code (\`claude\`) or GitHub Copilot CLI (\`npm i -g @github/copilot\`), or pass --cli.`);
  if (given.length) console.error(given.map((w) => `  ${w.path}: not found${process.platform === 'win32' ? ', or not a file Windows can start (.exe/.cmd)' : ' or not executable'}`).join('\n'));
  console.error(`\nAgent Guild runner ${VERSION}, Node ${process.version}, ${process.platform} ${process.arch}, started from ${fileURLToPath(import.meta.url)}`);
  console.error(explainMissing(tried.filter((w) => !w.path).map((w) => ADAPTERS[w.id].bin)));
  console.error(
    '\nIf `copilot` or `claude` works in this terminal, pass its full path, e.g. --cli copilot="C:\\path\\to\\copilot.exe"' +
      ' (in PowerShell, `(Get-Command copilot).Source` prints it). If you just installed it, open a new terminal first.',
  );
  process.exit(1);
}
const HOOK_SECRET = crypto.randomBytes(12).toString('hex');
const SCROLLBACK_LIMIT = 128 * 1024;
let ownerName = '?';
// Messages that must not be lost while the office link is down (XP, lessons, exits).
const outbox = [];

/** agentId -> { term, cwd, worktree, turn, flushBuf, flushTimer } */
const sessions = new Map();
let ws = null;
let hookPort = 0;

const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a);

// ---------------------------------------------------------------- local agent store

const agentDir = (id) => path.join(AGENTS_DIR, id);

function loadLocalAgents() {
  if (!AGENTS_DIR) return [];
  return fs.readdirSync(AGENTS_DIR).flatMap((id) => {
    try {
      const a = JSON.parse(fs.readFileSync(path.join(agentDir(id), 'agent.json'), 'utf8'));
      return [{ ...a, lessons: lessonCounts(agentDir(id)) }];
    } catch {
      return [];
    }
  });
}

function saveLocalAgent(agent) {
  fs.mkdirSync(playbookDir(agentDir(agent.id)), { recursive: true });
  const file = path.join(agentDir(agent.id), 'agent.json');
  const prev = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  fs.writeFileSync(file, JSON.stringify({ ...prev, ...agent, xp: { ...emptyXp(), ...agent.xp } }, null, 2));
}

function localAgent(id) {
  return JSON.parse(fs.readFileSync(path.join(agentDir(id), 'agent.json'), 'utf8'));
}

// ---------------------------------------------------------------- repo helpers

let provider = null; // GitHub or Azure DevOps, from the origin remote

async function detectRepo() {
  try {
    const { stdout } = await run('git', ['-C', REPO_DIR, 'remote', 'get-url', 'origin']);
    provider = detectProvider(stdout);
  } catch {
    provider = null;
  }
  return provider?.display || null;
}

async function createWorktree(agent) {
  const slug = `${agent.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${crypto.randomBytes(2).toString('hex')}`;
  const branch = `guild/${slug}`;
  const dir = path.join(HOME, 'worktrees', path.basename(REPO_DIR), slug);
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  await run('git', ['-C', REPO_DIR, 'worktree', 'add', '-b', branch, dir]);
  return { dir, branch };
}

async function removeWorktree(dir) {
  // Without --force git refuses when there is uncommitted work, which is what we want.
  try {
    await run('git', ['-C', REPO_DIR, 'worktree', 'remove', dir]);
    log(`removed clean worktree ${dir}`);
  } catch {
    log(`kept worktree with uncommitted work: ${dir}`);
  }
}

// ---------------------------------------------------------------- hooks → status

function describeTool(name, input = {}) {
  if (input.command) return `${name}: ${String(input.command).split('\n')[0]}`;
  if (input.file_path) return `${name}: ${path.basename(input.file_path)}`;
  if (input.pattern) return `${name}: ${input.pattern}`;
  if (input.description) return `${name}: ${input.description}`;
  return name;
}

function onHook(agentId, event, body) {
  const s = sessions.get(agentId);
  if (!s) return;
  const status = (status, activity, extra = {}) => {
    if (status !== 'done') s.lastActivity = activity;
    s.status = status;
    s.activity = activity;
    send({ t: 'status', agentId, status, activity, ...extra });
  };
  switch (event) {
    case 'SessionStart':
      if (!s.turn) status('ready', 'waiting for a prompt');
      break;
    case 'UserPromptSubmit':
      s.turn = { start: Date.now(), toolCalls: 0, prOpened: false, prMerged: false, reviewed: false };
      status('working', String(body.prompt || '').split('\n')[0], { newTurn: true });
      break;
    case 'PreToolUse': {
      if (!s.turn) s.turn = { start: Date.now(), toolCalls: 0 };
      s.turn.toolCalls++;
      const cmd = String(body.tool_input?.command || '');
      if (PR_COMMANDS.opened.test(cmd)) s.turn.prOpened = true;
      if (PR_COMMANDS.merged.test(cmd)) s.turn.prMerged = true;
      if (PR_COMMANDS.reviewed.test(cmd)) s.turn.reviewed = true;
      status('working', describeTool(body.tool_name, body.tool_input));
      break;
    }
    case 'Notification':
      status('waiting', body.message || 'needs your input');
      break;
    case 'Stop': {
      const turn = s.turn;
      s.turn = null;
      status('done', s.lastActivity || 'done');
      if (turn) send({ t: 'turn', agentId, stats: { ...turn, durationMs: Date.now() - turn.start, start: undefined } });
      try {
        trimPlaybooks(agentDir(agentId), localAgent(agentId).xp);
        send({ t: 'lessons', agentId, lessons: lessonCounts(agentDir(agentId)) });
      } catch {}
      break;
    }
  }
}

const hookServer = http.createServer((req, res) => {
  const [, kind, secret, agentId, event] = req.url.split('/');
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    res.end('ok');
    if (kind !== 'hook' || secret !== HOOK_SECRET) return;
    try {
      onHook(agentId, event, normalizeHook(body ? JSON.parse(body) : {}));
    } catch (e) {
      log('hook error', e.message);
    }
  });
});

// ---------------------------------------------------------------- sessions

// If the runner itself was started from inside a Claude Code session, don't let
// agents inherit that session's identity (it disables their transcripts).
const SESSION_VARS = /^(CLAUDECODE|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_CODE_(CHILD_SESSION|SESSION_ID|SESSION_ATTENDED|ENTRYPOINT|EXECPATH|MESSAGING_\w+|BRIDGE_SESSION_ID))$/;
function parentEnv() {
  return Object.fromEntries(Object.entries(process.env).filter(([k]) => !SESSION_VARS.test(k)));
}

async function spawnAgent({ agent, task, worktree, cols, rows, deskId, meta, cli }) {
  const engine = ENGINES[cli] ? cli : Object.keys(ENGINES)[0];
  const adapter = ENGINES[engine];
  saveLocalAgent(agent);
  const dir = agentDir(agent.id);
  let cwd = REPO_DIR;
  let wt = null;
  if (worktree) {
    try {
      wt = await createWorktree(agent);
      cwd = wt.dir;
    } catch (e) {
      log(`worktree failed, using the main checkout: ${e.message}`);
    }
  }

  const hookUrl = `http://127.0.0.1:${hookPort}/hook/${HOOK_SECRET}/${agent.id}`;
  const baseEnv = {
    ...parentEnv(),
    AGENT_GUILD_AGENT: agent.name,
    AGENT_GUILD_PLAYBOOK_DIR: playbookDir(dir),
    AGENT_GUILD_HOOK_URL: hookUrl,
  };
  const launch = adapter.build({
    agent, dir, task, opts, hookUrl, env: baseEnv,
    playbook: playbookDir(dir),
    instructions: systemPrompt(agent, dir, agent.owner),
  });
  const env = { ...baseEnv, ...launch.env };

  // Start the file we actually found (e.g. copilot.exe), not just the bare name.
  const spec = spawnSpec(adapter.path || launch.cmd, launch.args);
  const term = pty.spawn(spec.file, spec.commandLine ?? spec.args, { name: 'xterm-256color', cols: cols || 120, rows: rows || 34, cwd, env });
  const s = {
    term, cwd, worktree: wt, turn: null, buf: '', timer: null, screen: '', trustAsked: false,
    scrollback: '', deskId, meta, engine, status: task ? 'starting' : 'ready', activity: '',
  };
  sessions.set(agent.id, s);
  log(`▶ ${agent.name} (${adapter.label}) started in ${cwd}${task ? ` for ${task.requestedBy}: ${task.text.split('\n')[0].slice(0, 80)}` : ''}`);

  term.onData((data) => {
    watchForPrompts(agent.id, s, data);
    s.scrollback = (s.scrollback + data).slice(-SCROLLBACK_LIMIT);
    s.buf += data;
    s.timer ??= setTimeout(() => {
      send({ t: 'pty', agentId: agent.id, data: s.buf });
      s.buf = '';
      s.timer = null;
    }, 16);
  });
  term.onExit(({ exitCode }) => {
    if (sessions.get(agent.id) !== s) return;
    sessions.delete(agent.id);
    send({ t: 'exit', agentId: agent.id, code: exitCode });
    if (wt) removeWorktree(wt.dir);
    log(`■ ${agent.name} exited (${exitCode})`);
  });
  if (adapter.custom) send({ t: 'status', agentId: agent.id, status: 'ready', activity: 'waiting for a prompt' });
}

// Claude Code asks before working in a folder it hasn't seen (every new worktree).
// That is the owner's call, so flag it for a human instead of answering it.
const ANSI = /\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b[\]P][^\x07]*\x07/g;
function watchForPrompts(agentId, s, data) {
  s.screen = (s.screen + data.replace(ANSI, '').replace(/\s+/g, '')).slice(-4000);
  // Claude: "trust this folder"; Copilot: "Do you trust the files in this folder?"
  if (!s.trustAsked && /trust(thefilesin)?thisfolder/i.test(s.screen)) {
    s.trustAsked = true;
    s.status = 'waiting';
    s.activity = 'Asks whether to trust this folder. Open the terminal to answer.';
    send({ t: 'status', agentId, status: s.status, activity: s.activity });
  }
}

function killAgent(agentId) {
  const s = sessions.get(agentId);
  if (!s) return;
  sessions.delete(agentId);
  try {
    s.term.kill();
  } catch {}
  if (s.worktree) setTimeout(() => removeWorktree(s.worktree.dir), 500);
}

// Bracketed paste keeps multi-line prompts in one message; the Enter submits it.
function promptAgent(agentId, text) {
  const s = sessions.get(agentId);
  if (!s) return;
  s.term.write(`\x1b[200~${text}\x1b[201~`);
  setTimeout(() => s.term.write('\r'), 120);
}

// ---------------------------------------------------------------- office link

function send(msg) {
  if (ws?.readyState === WebSocket.OPEN && ws.ready) ws.send(JSON.stringify(msg));
  else if (['turn', 'lessons', 'exit'].includes(msg.t)) outbox.push(msg);
}

async function onMessage(msg) {
  switch (msg.t) {
    case 'spawn':
      return spawnAgent(msg).catch((e) => {
        log('spawn failed', e);
        send({ t: 'exit', agentId: msg.agent.id, code: -1 });
      });
    case 'kill':
      return killAgent(msg.agentId);
    case 'input':
      return sessions.get(msg.agentId)?.term.write(msg.data);
    case 'resize':
      if (msg.cols > 10 && msg.rows > 4) sessions.get(msg.agentId)?.term.resize(msg.cols, msg.rows);
      return;
    case 'prompt':
      if (sessions.get(msg.agentId) && msg.meta) sessions.get(msg.agentId).meta = msg.meta;
      return promptAgent(msg.agentId, msg.text);
    case 'office':
      useOffice(msg.id, msg.name);
      return sendHello(ws.repo);
    case 'welcome':
      ownerName = msg.owner;
      log(`signed in as ${ownerName}${opts.private ? ' (private)' : ' (lending agents to coworkers)'}. Keep this window open while you're hosting agents.`);
      if (saved.server !== opts.server || saved.key !== opts.key) {
        saveConfig({ server: opts.server, key: opts.key });
        log(`saved your server and key to ${CONFIG_FILE}; next time just run the command without flags`);
      }
      ws.ready = true;
      while (outbox.length) send(outbox.shift());
      return;
    case 'profile':
      return saveLocalAgent(msg.agent);
    case 'playbook':
      return send({ t: 'reply', reqId: msg.reqId, data: fs.existsSync(agentDir(msg.agentId)) ? readPlaybooks(agentDir(msg.agentId)) : {} });
    case 'board':
      try {
        send({ t: 'reply', reqId: msg.reqId, data: await loadBoard(provider, msg.kind, REPO_DIR) });
      } catch (e) {
        send({ t: 'reply', reqId: msg.reqId, error: (e.stderr || e.message || 'could not load the board').toString().trim().split('\n')[0] });
      }
  }
}

function useOffice(id, name) {
  if (officeId === id) return;
  if (officeId && sessions.size) {
    // The same runner can't serve two offices at once; stop the old office's agents.
    for (const agentId of [...sessions.keys()]) killAgent(agentId);
  }
  officeId = id;
  AGENTS_DIR = path.join(HOME, 'offices', id, 'agents');
  // Before offices existed, agents lived in ~/.agent-guild/agents. They belonged to
  // the only office there was, so the first office this runner joins adopts them.
  const legacy = path.join(HOME, 'agents');
  if (fs.existsSync(legacy) && !fs.existsSync(path.join(HOME, 'offices'))) {
    fs.mkdirSync(path.dirname(AGENTS_DIR), { recursive: true });
    fs.renameSync(legacy, AGENTS_DIR);
    log(`moved your existing agents into office "${name}"`);
  }
  fs.mkdirSync(AGENTS_DIR, { recursive: true });
  log(`office: ${name}; agents live in ${AGENTS_DIR}`);
}

// Sessions survive a dropped link; hand them back so their desks are kept.
function sendHello(repo) {
  const live = [...sessions.entries()].map(([agentId, s]) => ({
    agentId, deskId: s.deskId, meta: s.meta, engine: s.engine, status: s.status, activity: s.activity, scrollback: s.scrollback,
  }));
  const engines = Object.entries(ENGINES).map(([id, a]) => ({ id, label: a.label }));
  ws.send(JSON.stringify({ t: 'hello', repo, provider: provider?.type || null, lend: !opts.private, engines, agents: loadLocalAgents(), sessions: live }));
}

async function connect(repo, attempt = 0) {
  const url = `${opts.server.replace(/\/$/, '')}/ws?role=runner&key=${encodeURIComponent(opts.key)}`;
  const sock = new WebSocket(url);
  ws = sock;
  sock.on('open', () => {
    attempt = 0;
    log(`connected to ${opts.server}`);
  });
  sock.repo = repo;
  sock.on('message', (raw) => onMessage(JSON.parse(raw)).catch((e) => log('error', e.message)));
  sock.on('close', (code) => {
    if (code === 4001) {
      console.error('The office rejected this key (invalid or revoked).');
      shutdown();
    }
    if (code === 4003) {
      console.error('Another runner signed in with your key, so this one is stepping aside.');
      shutdown();
    }
    const wait = Math.min(15000, 1000 * 2 ** attempt);
    log(`disconnected; your ${sessions.size} agent(s) keep running. Retrying in ${wait / 1000}s`);
    setTimeout(() => connect(repo, attempt + 1), wait);
  });
  sock.on('error', () => {});
}

function shutdown() {
  for (const id of [...sessions.keys()]) killAgent(id);
  setTimeout(() => process.exit(0), 600);
}

hookServer.listen(0, '127.0.0.1', async () => {
  hookPort = hookServer.address().port;
  const repo = await detectRepo();
  log(`runner in ${REPO_DIR}${repo ? ` (${provider.type === 'ado' ? 'Azure DevOps' : 'GitHub'}: ${repo})` : ''}; engines: ${Object.values(ENGINES).map((a) => `${a.label}${a.path ? ` (${a.path})` : ''}`).join(', ')}`);
  connect(repo);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, shutdown);
}
