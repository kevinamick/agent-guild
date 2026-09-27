#!/usr/bin/env node
// Self-contained end-to-end test: starts a server and two runners (Kevin, Alice)
// using scripts/fake-agent.js, drives them over the real protocol, restarts the
// server mid-session, and checks that agents survive. The "while you were away"
// threshold is 2 seconds here so a recap can be tested without waiting an hour.
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
  start(['server/index.js', '--port', String(PORT), '--data', path.join(TMP, 'data'), '--admin', 'Kevin', '--admin-key', KEYS.Kevin, '--seed', `Alice=${KEYS.Alice}`, '--recap-after', '2'], 'server');
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

  // --- laptop screens: the office gets each seated agent's live terminal (changed rows only)
  const screenText = (msgs) => msgs.filter((m) => m.t === 'screen' && m.agentId === agentId && m.rows).flatMap((m) => Object.values(m.rows)).flat().map((r) => r[0]).join('');
  await kevin.wait((m) => m.t === 'screen' && m.agentId === agentId && m.rows && screenText([m]).includes('fake agent'), 'laptop screen');
  check(/fake agent/.test(screenText(kevin.events)), "players see the agent's live terminal on its laptop");
  const late = player(KEYS.Alice);
  await late.ready;
  const lateFull = await late.wait((m) => m.t === 'screen' && m.agentId === agentId && m.full, 'full screen for a late joiner');
  check(lateFull.n > 0 && /fake agent/.test(screenText([lateFull])), 'someone walking in later gets the whole screen at once');
  late.ws.close();
  // A viewer resizes the shared terminal; the runner confirms the real size, viewers
  // follow it, and the laptop copy re-lays itself out at that width.
  kevin.send({ t: 'sub', agentId });
  kevin.send({ t: 'resize', agentId, cols: 100, rows: 30 });
  const size = await kevin.wait((m) => m.t === 'pty-size' && m.agentId === agentId && m.cols === 100, 'pty size from the runner');
  const relaid = await kevin.wait((m) => m.t === 'screen' && m.agentId === agentId && m.cols === 100 && m.n === 30, 'screen at the new size');
  check(size.rows === 30 && relaid, "the terminal's real size reaches every viewer and the laptop copy");
  kevin.send({ t: 'unsub', agentId });

  const alice = player(KEYS.Alice);
  await alice.ready;
  await alice.wait((m) => m.t === 'welcome', 'alice welcome');

  // --- someone else's agent: watching is free, using it takes the owner's permission
  alice.send({ t: 'sub', agentId });
  const watched = await alice.wait((m) => m.t === 'scrollback' && m.agentId === agentId, 'watch');
  check(watched.data.length > 0, "Alice can watch Kevin's agent without permission");
  alice.send({ t: 'prompt', agentId, text: 'do something' });
  await alice.wait((m) => m.t === 'error' && m.needAccess?.agentId === agentId && /prompt/.test(m.text), 'prompt needs access');
  alice.send({ t: 'dismiss', agentId });
  await alice.wait((m) => m.t === 'error' && m.needAccess && /send home/.test(m.text), 'dismiss needs access');
  check(true, "without permission Alice can't prompt it or send it home");
  alice.send({ t: 'unsub', agentId });
  kevin.send({ t: 'dismiss', agentId });
  await kevin.wait((m) => m.t === 'state' && agentIn(m, agentId) && !agentIn(m, agentId).deskId, 'agent went home');
  await kevin.wait((m) => m.t === 'screen' && m.agentId === agentId && m.clear, 'screen cleared');
  check(true, "sending the agent home clears its laptop screen");
  alice.send({ t: 'hire', deskId: 7, agentId, task: { text: 'review pr 2', kind: 'review' }, worktree: false });
  await alice.wait((m) => m.t === 'error' && m.needAccess && /borrow/.test(m.text), 'borrow needs access');
  check(true, "Alice can't borrow Kevin's agent without asking");
  alice.send({ t: 'access-request', agentId });
  const asked = await kevin.wait((m) => m.t === 'access-requests' && m.requests.some((r) => r.from === 'Alice'), 'Kevin sees the request');
  alice.send({ t: 'access-decide', id: asked.requests[0].id, decision: 'always' });
  await alice.wait((m) => m.t === 'error' && /Only Kevin can answer/.test(m.text), 'only the owner answers');
  kevin.send({ t: 'access-decide', id: asked.requests[0].id, decision: 'once' });
  await alice.wait((m) => m.t === 'event' && m.kind === 'toast' && /let you use .* until it next goes home/.test(m.text), 'granted once');
  check(true, "Alice asks, Kevin allows once (only the owner can answer)");
  alice.send({ t: 'hire', deskId: 7, agentId, task: { text: 'review pr 2', kind: 'review' }, worktree: false });
  const xp2 = await alice.wait((m) => m.t === 'event' && m.kind === 'xp' && m.skill === 'review', 'review xp', 20000);
  check(xp2.from === 'Alice', `Alice borrowed Kevin's agent; it earned ${xp2.amount} review XP`);

  // --- naming agents: owner (or admin) only, tidied, unique per office, synced to the runner
  alice.send({ t: 'rename', agentId, name: 'Hacked' });
  await alice.wait((m) => m.t === 'error' && /Only Kevin or an admin/.test(m.text), 'non-owner rename refused');
  check(true, "someone else can't rename Kevin's agent");
  kevin.send({ t: 'rename', agentId, name: '  Ada   Lovelace ' });
  await kevin.wait((m) => m.t === 'state' && agentIn(m, agentId)?.name === 'Ada Lovelace', 'renamed');
  await sleep(400);
  const localAgent = JSON.parse(fs.readFileSync(path.join(TMP, 'Kevin', 'offices', 'main', 'agents', agentId, 'agent.json'), 'utf8'));
  check(localAgent.name === 'Ada Lovelace', "the owner renames their agent (tidied to 'Ada Lovelace') and the owner's runner saves it");
  kevin.send({ t: 'rename', agentId, name: '<b>x</b>' });
  await kevin.wait((m) => m.t === 'error' && /letters, numbers/.test(m.text), 'bad name refused');
  kevin.send({ t: 'hire', deskId: 9, agentId: null, name: 'ada lovelace', task: { kind: 'general' } });
  await kevin.wait((m) => m.t === 'error' && /already an agent called/.test(m.text), 'duplicate refused');
  check(true, 'names with markup, and names already used in the office, are refused');
  kevin.send({ t: 'hire', deskId: 9, agentId: null, name: 'Grace', task: { kind: 'general' } });
  const grace = await kevin.wait((m) => m.t === 'state' && m.state.agents.some((a) => a.name === 'Grace' && a.deskId === 9), 'named recruit');
  check(grace.state.agents.find((a) => a.name === 'Grace').owner === 'Kevin', 'a new recruit can be named when hired');
  kevin.send({ t: 'dismiss', agentId: grace.state.agents.find((a) => a.name === 'Grace').id });

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
  check(!lee.events.some((m) => m.t === 'screen' && m.agentId === agentId), "Lab never receives the main office's laptop screens");
  KEYS.Lee = lab.key;
  let leeRunner = startRunner('Lee');
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
  // The runner restarts (e.g. to update): its terminals are gone, so the desk frees up at once.
  leeRunner.kill('SIGKILL');
  await lee.wait((m) => m.t === 'state' && agentIn(m, labXp.agentId)?.status === 'offline', 'lab agent offline');
  leeRunner = startRunner('Lee');
  await lee.wait((m) => m.t === 'state' && agentIn(m, labXp.agentId) && !agentIn(m, labXp.agentId).deskId, 'desk freed', 20000);
  check(agentIn(lee, labXp.agentId).online, "after a runner restart, an agent whose session died is back home and hireable, not stuck offline");
  // WebRTC signaling relays to a player in the same office only.
  lee.send({ t: 'rtc', to: kevin.state.players.find((p) => p.name === 'Kevin').id, data: { channel: 'test' } });
  alice.send({ t: 'rtc', to: kevin.state.players.find((p) => p.name === 'Kevin').id, data: { channel: 'voice', sdp: 'x' } });
  const rtc = await kevin.wait((m) => m.t === 'rtc', 'rtc relay');
  await sleep(300);
  check(rtc.data.channel === 'voice' && rtc.from === alice.state.players.find((p) => p.name === 'Alice').id && !kevin.events.some((m) => m.t === 'rtc' && m.data?.channel === 'test'),
    'WebRTC signaling reaches players in the same office and never crosses offices');

  // --- the TV: one screen sharer per office, tracked by the server
  const idOf = (p, name) => p.state.players.find((x) => x.name === name)?.id;
  // Waits until this player's latest office state shows `id` holding the TV.
  const sharerSeen = async (p, id) => {
    for (let i = 0; i < 100; i++, await sleep(50)) if ((p.state?.tv?.sharer ?? null) === id) return;
    throw new Error(`timeout: TV sharer should be ${id}, is ${p.state?.tv?.sharer}`);
  };
  const kevinId = idOf(kevin, 'Kevin');
  check(kevin.state.tv?.sharer === null, 'nobody is sharing on the TV at first');
  kevin.send({ t: 'tv', share: true });
  await sharerSeen(alice, kevinId);
  await alice.wait((m) => m.t === 'event' && m.kind === 'toast' && /Kevin is sharing their screen/.test(m.text), 'share toast');
  check(true, "Kevin starts sharing and everyone in the office sees him on the TV (with a toast)");
  alice.send({ t: 'tv', share: true });
  await alice.wait((m) => m.t === 'error' && /Kevin is already sharing/.test(m.text), 'second sharer refused');
  alice.send({ t: 'tv', share: false });
  await sleep(300);
  check(alice.state.tv.sharer === kevinId && kevin.state.tv.sharer === kevinId, "a second person can't take the TV, and only the sharer can stop it");
  lee.send({ t: 'tv', share: true });
  await sharerSeen(lee, idOf(lee, 'Lee'));
  await sleep(300);
  check(kevin.state.tv.sharer === kevinId && !lee.events.some((m) => m.state?.tv?.sharer === kevinId) && !kevin.events.some((m) => m.t === 'event' && /Lee is sharing/.test(m.text || '')),
    "Lab's TV is its own: Lee shares there while Kevin shares here, and neither sees the other");
  lee.send({ t: 'tv', share: false });
  await sharerSeen(lee, null);
  kevin.send({ t: 'tv', share: false });
  await sharerSeen(alice, null);
  check(true, 'the sharer stops and the TV is free again');
  kevin.send({ t: 'invite', name: 'Dana' });
  const danaKey = (await kevin.wait((m) => m.t === 'invited' && m.name === 'Dana', 'invite dana')).key;
  const dana = player(danaKey);
  await dana.ready;
  const danaId = (await dana.wait((m) => m.t === 'welcome', 'dana welcome')).you;
  dana.send({ t: 'tv', share: true });
  await sharerSeen(alice, danaId);
  const dana2 = player(danaKey); // Dana opens the office in another tab: the old tab's share ends
  await dana2.ready;
  const d2w = await dana2.wait((m) => m.t === 'welcome', 'dana second tab');
  check(d2w.state.tv.sharer === null, "opening a new tab ends the old tab's screen share");
  dana2.send({ t: 'tv', share: true });
  await sharerSeen(alice, d2w.you);
  dana2.ws.close();
  await sharerSeen(alice, null);
  check(true, "the sharer disconnecting frees the TV for everyone");
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
  // Work typed straight into the terminal: nobody says what kind it is, the runner works it out.
  kevin2.send({ t: 'input', agentId, data: 'merge main into my branch\r' });
  const xp4 = await kevin2.wait((m) => m.t === 'event' && m.kind === 'xp' && m.skill === 'conflict', 'conflict xp', 20000);
  check(xp4.amount > 0, 'a merge typed into the terminal earns Conflict Resolver XP, detected from the work');
  check(agentIn(kevin2, agentId).task?.kind === 'conflict', 'the desk now shows it as conflict work');
  kevin2.send({ t: 'input', agentId, data: 'this needs permission\r' });
  await kevin2.wait((m) => m.t === 'state' && agentIn(m, agentId)?.status === 'waiting', 'hand raised');
  await sleep(1200);
  check(agentIn(kevin2, agentId).status === 'waiting' && /Permission needed/.test(agentIn(kevin2, agentId).activity), 'a permission prompt raises the hand, and a late tool hook doesn\'t lower it');
  await kevin2.wait((m) => m.t === 'state' && agentIn(m, agentId)?.status === 'working', 'hand lowered', 5000);
  check(true, 'once the tool has run (the prompt was answered) the hand goes down');
  await kevin2.wait((m) => m.t === 'state' && agentIn(m, agentId)?.status === 'done', 'done after permission', 20000);
  const lessons4 = await kevin2.wait((m) => m.t === 'state' && agentIn(m, agentId)?.lessons?.conflict > 0, 'conflict lesson', 10000);
  check(Boolean(lessons4), 'the agent wrote its lesson to the playbook file the task note named (conflict.md)');
  const lee2 = player(KEYS.Lee);
  await lee2.ready;
  const lw = await lee2.wait((m) => m.t === 'welcome', 'lab after restart');
  check(lw.state.office.name === 'Lab', 'Lab and its key survive the restart');
  check(pictureAt(kevin2, 'l1')?.url === pic.url && !pictureAt(kevin2, 'r2') && lw.state.pictures.length === 1, 'wall pictures survive the restart, each in its own office');
  kevin2.send({ t: 'dismiss', agentId });
  await kevin2.wait((m) => m.t === 'state' && agentIn(m, agentId) && !agentIn(m, agentId).deskId && !agentIn(m, agentId).access?.alice, 'once-grant ends');
  check(true, "an 'allow once' grant ends when the agent goes home");
  const alice3 = player(KEYS.Alice);
  await alice3.ready;
  await alice3.wait((m) => m.t === 'welcome', 'alice back');
  alice3.send({ t: 'access-request', agentId });
  const again = await kevin2.wait((m) => m.t === 'access-requests' && m.requests.length, 'second request');
  kevin2.send({ t: 'access-decide', id: again.requests[0].id, decision: 'always' });
  await kevin2.wait((m) => m.t === 'state' && agentIn(m, agentId)?.access?.alice === 'always', 'always grant');
  kevin2.send({ t: 'access-revoke', agentId, name: 'alice' });
  await alice3.wait((m) => m.t === 'event' && m.kind === 'toast' && /took back your access/.test(m.text), 'revoked');
  check(true, "an 'always' grant sticks until the owner takes it back");

  // --- while you were away: Kevin leaves, his agent works, Alice asks for it, Kevin comes back
  const lessonsBefore = agentIn(kevin2, agentId).lessons?.issue || 0;
  kevin2.send({ t: 'hire', deskId: 7, agentId, task: { text: 'fix issue #5 and open a pr', kind: 'issue' }, worktree: false });
  await kevin2.wait((m) => m.t === 'state' && agentIn(m, agentId)?.status === 'working', 'working on #5');
  kevin2.ws.close();
  const leftAt = Date.now();
  await alice3.wait((m) => m.t === 'state' && !m.state.players.some((p) => p.name === 'Kevin'), 'Kevin left');
  alice3.send({ t: 'access-request', agentId });
  const awayXp = await alice3.wait((m) => m.t === 'event' && m.kind === 'xp' && m.agentId === agentId && m.skill === 'issue', 'work while Kevin is away', 20000);
  await alice3.wait((m) => m.t === 'state' && (agentIn(m, agentId)?.lessons?.issue || 0) > lessonsBefore, 'lesson while away');
  await sleep(Math.max(0, 2300 - (Date.now() - leftAt)));
  const kevin3 = player(KEYS.Kevin);
  await kevin3.ready;
  const { recap } = await kevin3.wait((m) => m.t === 'recap' && m.arrival, 'recap on arrival');
  const row = recap.agents[0];
  check(recap.totals.tasks === 1 && recap.totals.prsOpened === 1 && recap.totals.xp === awayXp.amount && recap.totals.accessRequests === 1,
    `Kevin walks back in to a recap: 1 task, 1 PR opened, ${awayXp.amount} XP, 1 access request`);
  check(row?.id === agentId && row.mine && row.xp.issue === awayXp.amount && row.lessonsTotal >= 1 && row.tasksDone[0]?.summary === 'fix issue #5 and open a pr',
    'the recap lists his agent first, with its XP per skill, lessons learned and what the task was');
  check(recap.highlights.requests.length === 1 && recap.highlights.requests[0].from === 'Alice', "Alice's request is waiting for him in the recap");
  const board = kevin3.events.find((m) => m.t === 'digest');
  check(board?.digest.tasks >= 2 && board.digest.prsOpened >= 2 && board.digest.top[0]?.xp > 0, "the Guild Hall board's Last 24h panel gets the office-wide numbers");
  alice3.send({ t: 'recap', hours: 1 });
  const aliceRecap = await alice3.wait((m) => m.t === 'recap' && !m.arrival, 'recap on request');
  check(!aliceRecap.arrival && aliceRecap.recap.totals.tasks >= 1 && !aliceRecap.recap.agents[0]?.mine, 'anyone can reopen a recap for the last hours; Alice sees it is not her agent');
  const noRecapYet = player(KEYS.Alice); // a new tab: she never left, so no recap
  await noRecapYet.ready;
  await noRecapYet.wait((m) => m.t === 'welcome', 'alice new tab');
  await sleep(300);
  check(!noRecapYet.events.some((m) => m.t === 'recap') && !dana.events.some((m) => m.t === 'recap'), 'no recap in a new tab (she never left), nor for a newcomer (Dana)');
  kevin3.send({ t: 'access-decide', id: recap.highlights.requests[0].id, decision: 'deny' });

  // The log and last-seen times survive a restart (SIGTERM writes what's pending).
  server.kill('SIGTERM');
  await new Promise((r) => server.once('exit', r));
  const saved = JSON.parse(fs.readFileSync(path.join(TMP, 'data', 'activity.json'), 'utf8'));
  check(saved.some((e) => e.type === 'task' && e.summary === 'fix issue #5 and open a pr'), 'the activity log is on disk after shutdown');
  server = startServer();
  await serverUp();
  const downAt = Date.now();
  const kevin4 = player(KEYS.Kevin);
  await kevin4.ready;
  await kevin4.wait((m) => m.t === 'state' && agentIn(m, agentId)?.deskId, 'agent back after the second restart', 25000);
  kevin4.send({ t: 'recap', hours: 2 });
  const afterRestart = (await kevin4.wait((m) => m.t === 'recap' && !m.arrival, 'recap after restart')).recap;
  check(afterRestart.agents.find((a) => a.id === agentId)?.prsOpened >= 2, 'after a restart the recap still has the work from before it');
  kevin4.send({ t: 'prompt', agentId, text: 'tidy up the readme', kind: 'general' });
  await kevin4.wait((m) => m.t === 'event' && m.kind === 'xp' && m.agentId === agentId && m.skill === 'general', 'work after restart', 20000);
  await sleep(Math.max(0, 2300 - (Date.now() - downAt)));
  const alice4 = player(KEYS.Alice);
  await alice4.ready;
  const back = (await alice4.wait((m) => m.t === 'recap' && m.arrival, 'alice recap after restart')).recap;
  check(back.totals.tasks === 1 && back.agents[0]?.tasksDone[0]?.summary === 'tidy up the readme',
    "Alice's last-seen time survived the restart: her recap starts when she left, not at the beginning");
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
