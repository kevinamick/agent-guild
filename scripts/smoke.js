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
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

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

  // --- a second office: owner-only creation, and nothing crosses between offices
  alice.send({ t: 'create-office', name: 'Sneaky', adminName: 'Alice' });
  await alice.wait((m) => m.t === 'error' && /owner/.test(m.text), 'non-owner cannot create offices');
  check(true, 'a non-owner cannot create an office');
  kevin.send({ t: 'create-office', name: 'Lab', adminName: 'Lee' });
  const lab = await kevin.wait((m) => m.t === 'office-created', 'office created');
  check(lab.office.id === 'lab' && lab.runnerCmd.includes(lab.key), 'the owner created office "Lab" with an admin key for Lee');
  const lee = player(lab.key);
  await lee.ready;
  const leeWelcome = await lee.wait((m) => m.t === 'welcome', 'lee welcome');
  check(leeWelcome.state.office.name === 'Lab' && leeWelcome.me.admin && !leeWelcome.me.owner, 'Lee walks into Lab as its admin (not owner)');
  check(leeWelcome.state.players.length === 1 && leeWelcome.state.agents.length === 0 && leeWelcome.state.runners.length === 0, "Lab sees none of the main office's people, agents or runners");
  lee.send({ t: 'create-office', name: 'Another', adminName: 'Lee' });
  await lee.wait((m) => m.t === 'error' && /owner/.test(m.text), 'office admin cannot create offices');
  check(true, "an office's own admin cannot create offices either");
  KEYS.Lee = lab.key;
  startRunner('Lee');
  await lee.wait((m) => m.t === 'state' && m.state.runners.some((r) => r.owner === 'Lee'), 'lab runner online');
  await sleep(300);
  check(!kevin.state.runners.some((r) => r.owner === 'Lee'), "Lee's runner shows up only in Lab");
  lee.send({ t: 'chat', text: 'lab-only secret' });
  await lee.wait((m) => m.t === 'chat' && m.entry.text === 'lab-only secret', 'lab chat');
  await sleep(300);
  check(!kevin.events.some((m) => m.t === 'chat' && m.entry.text === 'lab-only secret'), 'chat in Lab never reaches the main office');
  lee.send({ t: 'hire', deskId: 1, task: { text: 'fix issue #9 and open a pr', kind: 'issue' } });
  const labXp = await lee.wait((m) => m.t === 'event' && m.kind === 'xp', 'lab agent xp', 20000);
  check(labXp.amount > 0 && !kevin.events.some((m) => m.t === 'event' && m.kind === 'xp' && m.agentId === labXp.agentId), "Lab's agent earns XP in Lab only");
  // WebRTC signaling relays to a player in the same office only.
  lee.send({ t: 'rtc', to: kevin.state.players.find((p) => p.name === 'Kevin').id, data: { channel: 'test' } });
  alice.send({ t: 'rtc', to: kevin.state.players.find((p) => p.name === 'Kevin').id, data: { channel: 'voice', sdp: 'x' } });
  const rtc = await kevin.wait((m) => m.t === 'rtc', 'rtc relay');
  await sleep(300);
  check(rtc.data.channel === 'voice' && rtc.from === alice.state.players.find((p) => p.name === 'Alice').id && !kevin.events.some((m) => m.t === 'rtc' && m.data?.channel === 'test'),
    'WebRTC signaling reaches players in the same office and never crosses offices');
  kevin.send({ t: 'revoke', name: 'Lee' });
  await sleep(300);
  check(lee.closed === null, "revoking 'Lee' from the main office doesn't touch Lab's Lee");

  // --- wall pictures: per office, only the uploader or an admin can take one down
  const pictureAt = (p, spot) => p.state.pictures?.find((x) => x.spot === spot);
  kevin.send({ t: 'picture', spot: 'l1', data: PNG_1PX, caption: 'Offsite' });
  await alice.wait((m) => m.t === 'state' && m.state.pictures.some((x) => x.spot === 'l1'), 'picture reaches Alice');
  const pic = pictureAt(alice, 'l1');
  check(pic.by === 'Kevin' && pic.caption === 'Offsite' && /^\/pictures\/main\/[a-f0-9]{32}\.png$/.test(pic.url), 'a picture Kevin hangs shows up for Alice, credited to Kevin');
  await sleep(300);
  check(!lee.state.pictures.length && !lee.events.some((m) => m.t === 'state' && m.state.pictures.length), "the picture never appears in Lab");
  const img = await fetch(`http://localhost:${PORT}${pic.url}`);
  const body = Buffer.from(await img.arrayBuffer());
  check(img.status === 200 && img.headers.get('content-type') === 'image/png' && img.headers.get('access-control-allow-origin') === '*'
    && img.headers.get('x-content-type-options') === 'nosniff' && body.equals(Buffer.from(PNG_1PX, 'base64')), 'the picture is served over HTTP as image/png with CORS');
  const [, , , , file] = pic.url.split('/');
  const misses = await Promise.all([`/pictures/lab/${file}`, `/pictures/main/${'0'.repeat(32)}.png`, '/pictures/main/..%2Fkeys.json', '/pictures/main/pictures.json']
    .map((u) => fetch(`http://localhost:${PORT}${u}`).then((r) => r.status)));
  check(misses.every((s) => s === 404), "another office's path, unknown ids and other files are 404");
  alice.send({ t: 'picture-remove', spot: 'l1' });
  await alice.wait((m) => m.t === 'error' && /Kevin or an admin can take/.test(m.text), 'alice cannot remove');
  alice.send({ t: 'picture', spot: 'l1', data: PNG_1PX });
  await alice.wait((m) => m.t === 'error' && /Kevin/.test(m.text) && /replace/.test(m.text), 'alice cannot replace');
  check(pictureAt(kevin, 'l1')?.url === pic.url, "someone else can't take down or replace Kevin's picture");
  await sleep(3100); // one upload every few seconds per person
  alice.send({ t: 'picture', spot: 'r1', data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>').toString('base64') });
  await alice.wait((m) => m.t === 'error' && /PNG, JPEG/.test(m.text), 'svg refused');
  check(!pictureAt(kevin, 'r1'), 'an SVG upload is refused');
  lee.send({ t: 'picture', spot: 'r1', data: PNG_1PX, caption: 'lab only' });
  await lee.wait((m) => m.t === 'state' && m.state.pictures.some((x) => x.spot === 'r1'), 'lab picture');
  await sleep(300);
  check(!pictureAt(kevin, 'r1') && pictureAt(lee, 'r1').url.startsWith('/pictures/lab/'), "Lab's own picture stays in Lab");
  await sleep(2800);
  alice.send({ t: 'picture', spot: 'r2', data: PNG_1PX });
  await kevin.wait((m) => m.t === 'state' && m.state.pictures.some((x) => x.spot === 'r2'), 'alice picture');
  const alicePic = pictureAt(kevin, 'r2');
  kevin.send({ t: 'picture-remove', spot: 'r2' });
  await alice.wait((m) => m.t === 'event' && m.text === "🖼️ Kevin took down Alice's picture", 'admin removes');
  check((await fetch(`http://localhost:${PORT}${alicePic.url}`)).status === 404, "the office admin took down Alice's picture and its file is gone");

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
  const lee2 = player(KEYS.Lee);
  await lee2.ready;
  const lw = await lee2.wait((m) => m.t === 'welcome', 'lab after restart');
  check(lw.state.office.name === 'Lab', 'Lab and its key survive the restart');
  check(pictureAt(kevin2, 'l1')?.url === pic.url && !pictureAt(kevin2, 'r2') && lw.state.pictures.length === 1, 'wall pictures survive the restart, each in its own office');
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
