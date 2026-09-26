#!/usr/bin/env node
// Self-contained end-to-end test: starts a server and two runners (Kevin, Alice)
// using scripts/fake-agent.js, drives them over the real protocol, restarts the
// server mid-session, and checks that agents survive.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'guild-smoke-'));
const PORT = 4700 + Math.floor(Math.random() * 200);
const SERVER = `ws://localhost:${PORT}`;
const KEYS = { Kevin: 'ag_kevin_test_key', Alice: 'ag_alice_test_key' };
const procs = [];

const repo = path.join(TMP, 'repo');
fs.mkdirSync(repo);
execFileSync('git', ['init', '-q'], { cwd: repo });
execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: repo });

function start(args, name) {
  const p = spawn('node', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  p.logs = '';
  p.stdout.on('data', (d) => (p.logs += d));
  p.stderr.on('data', (d) => (p.logs += d));
  p.label = name;
  procs.push(p);
  return p;
}
const startServer = () =>
  start(['server/index.js', '--port', String(PORT), '--data', path.join(TMP, 'data'), '--admin', 'Kevin', '--admin-key', KEYS.Kevin, '--seed', `Alice=${KEYS.Alice}`], 'server');
const startRunner = (who) =>
  start(['runner/index.js', '--server', SERVER, '--key', KEYS[who], '--repo-dir', repo, '--home', path.join(TMP, who), '--agent-cmd', path.join(ROOT, 'scripts/fake-agent.js')], who);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function serverUp() {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`http://localhost:${PORT}/api/health`)).ok) return;
    } catch {}
    await sleep(100);
  }
  throw new Error('server did not start');
}

function player(key) {
  const ws = new WebSocket(`${SERVER}/ws?key=${key}&color=%23ef4444`);
  const p = { ws, state: null, events: [], waiters: [], closed: null };
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    if (msg.t === 'welcome' || msg.t === 'state') p.state = msg.state;
    p.events.push(msg);
    p.waiters = p.waiters.filter((w) => !w(msg));
  });
  ws.on('close', (code) => (p.closed = code));
  ws.on('error', () => {});
  p.send = (m) => ws.send(JSON.stringify(m));
  p.wait = (pred, label, ms = 15000) =>
    new Promise((resolve, reject) => {
      const found = p.events.find(pred);
      if (found) return resolve(found);
      const timer = setTimeout(() => reject(new Error(`timeout: ${label}`)), ms);
      p.waiters.push((m) => pred(m) && (clearTimeout(timer), resolve(m), true));
    });
  p.ready = new Promise((r, j) => (ws.on('open', r), ws.on('error', j)));
  return p;
}

const check = (cond, label) => {
  if (!cond) throw new Error(`FAILED: ${label}`);
  console.log(`  ✓ ${label}`);
};
const agentIn = (p, id) => p.state.agents.find((a) => a.id === id);

async function main() {
  let server = startServer();
  await serverUp();
  startRunner('Kevin');
  startRunner('Alice');

  const bad = player('ag_nope');
  await bad.ready;
  await bad.wait((m) => m.t === 'error' && m.fatal, 'bad key rejected');
  check(true, 'an invalid key is rejected');

  const kevin = player(KEYS.Kevin);
  await kevin.ready;
  const welcome = await kevin.wait((m) => m.t === 'welcome', 'welcome');
  check(welcome.me.name === 'Kevin' && welcome.me.admin, 'Kevin signs in by key and is admin');
  await kevin.wait((m) => (m.t === 'state' || m.t === 'welcome') && m.state.runners.length >= 2, 'two runners online');
  check(true, 'both runners are online (identity from their keys)');

  kevin.send({ t: 'invite', name: 'Bob' });
  const inv = await kevin.wait((m) => m.t === 'invited', 'invite');
  const bob = player(inv.key);
  await bob.ready;
  const bw = await bob.wait((m) => m.t === 'welcome', 'bob welcome');
  check(bw.me.name === 'Bob' && !bw.me.admin && inv.joinUrl.includes('#key='), 'admin invite creates a working key for Bob');
  bob.send({ t: 'invite', name: 'Eve' });
  await bob.wait((m) => m.t === 'error' && /admins/.test(m.text), 'non-admin invite refused');
  check(true, 'non-admins cannot invite');
  kevin.send({ t: 'revoke', name: 'Bob' });
  await sleep(300);
  check(bob.closed === 4001, 'revoking Bob disconnects him');

  kevin.send({ t: 'hire', deskId: 3, agentId: null, task: { text: 'fix issue #1 and open a pr', kind: 'issue', ref: { type: 'issue', number: 1 } }, worktree: false });
  const xp1 = await kevin.wait((m) => m.t === 'event' && m.kind === 'xp', 'xp after first task', 20000);
  const agentId = xp1.agentId;
  check(xp1.skill === 'issue' && xp1.amount >= 60, `new recruit earned ${xp1.amount} issue XP`);
  await kevin.wait((m) => m.t === 'state' && agentIn(m, agentId)?.lessons?.issue >= 1, 'lesson recorded');
  check(true, 'playbook lesson counted');

  const alice = player(KEYS.Alice);
  await alice.ready;
  await alice.wait((m) => m.t === 'welcome', 'alice welcome');
  kevin.send({ t: 'dismiss', agentId });
  await kevin.wait((m) => m.t === 'state' && agentIn(m, agentId) && !agentIn(m, agentId).deskId, 'agent went home');
  alice.send({ t: 'hire', deskId: 7, agentId, task: { text: 'review pr 2', kind: 'review' }, worktree: false });
  const xp2 = await alice.wait((m) => m.t === 'event' && m.kind === 'xp' && m.skill === 'review', 'review xp', 20000);
  check(xp2.from === 'Alice', `Alice borrowed Kevin's agent; it earned ${xp2.amount} review XP`);

  // --- server restart with the agent still at its desk
  alice.send({ t: 'sub', agentId });
  server.kill('SIGKILL');
  await sleep(700);
  server = startServer();
  await serverUp();
  const kevin2 = player(KEYS.Kevin);
  await kevin2.ready;
  await kevin2.wait((m) => m.t === 'state' && agentIn(m, agentId)?.deskId === 7, 'agent restored at desk 7', 25000);
  check(true, 'after a server restart the runner reconnects and the agent is back at desk 7');
  const restored = agentIn(kevin2, agentId);
  check(restored.task?.requestedBy === 'Alice' && restored.task?.kind === 'review', 'its task (borrowed by Alice, review) was restored');
  check(restored.total >= xp1.amount + xp2.amount, `XP survived the restart (${restored.total})`);
  kevin2.send({ t: 'sub', agentId });
  const sb = await kevin2.wait((m) => m.t === 'scrollback' && m.agentId === agentId, 'scrollback after restart');
  check(sb.data.includes('review pr 2'), 'terminal history was restored from the runner');
  kevin2.send({ t: 'prompt', agentId, text: 'one more task', kind: 'general' });
  const xp3 = await kevin2.wait((m) => m.t === 'event' && m.kind === 'xp' && m.skill === 'general', 'xp after restart', 20000);
  check(xp3.amount > 0, 'the restored session still takes prompts and earns XP');
  kevin2.send({ t: 'dismiss', agentId });
  await sleep(300);
}

main()
  .then(() => {
    console.log('\nall good');
    cleanup(0);
  })
  .catch((e) => {
    console.error(e.message);
    for (const p of procs) console.error(`--- ${p.label}\n${p.logs.slice(-1500)}`);
    cleanup(1);
  });

function cleanup(code) {
  for (const p of procs) p.kill();
  setTimeout(() => {
    fs.rmSync(TMP, { recursive: true, force: true });
    process.exit(code);
  }, 500);
}
