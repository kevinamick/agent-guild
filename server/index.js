#!/usr/bin/env node
// Agent Guild office server: world state, presence, chat, the XP ledger, and a
// relay between browsers and the runners that host agents on their owners' machines.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { DESKS, deskById, nearestFreeDesk, MEZZ, PICTURE_SPOTS } from '../shared/layout.js';
import { createKeyStore } from './keys.js';
import { createPictureStore } from './pictures.js';
import { sanitizeAvatar, randomAvatar } from '../shared/avatar.js';
import { cleanAgentName, sameName } from '../shared/names.js';
import { createScreen } from './screens.js';
import {
  SKILLS, SKILL_INFO, KUDOS_XP, emptyXp, levelFor, overallLevel, titleFor, bestSkill, turnXp, totalXp,
} from '../shared/progression.js';

const { values: opts } = parseArgs({
  options: {
    port: { type: 'string', default: process.env.PORT || '4600' },
    host: { type: 'string', default: '0.0.0.0' },
    name: { type: 'string', default: process.env.GUILD_OFFICE_NAME || 'Agent Guild' },
    data: { type: 'string', default: process.env.GUILD_DATA || path.resolve('data') },
    // The first admin. With --admin-key the key is fixed (e.g. a Fly secret);
    // otherwise one is generated on first start and printed once.
    admin: { type: 'string', default: process.env.GUILD_ADMIN_NAME || 'admin' },
    'admin-key': { type: 'string', default: process.env.GUILD_ADMIN_KEY || '' },
    // Extra "Name=key" pairs, comma separated. Handy for local testing.
    seed: { type: 'string', default: process.env.GUILD_SEED_KEYS || '' },
    // Where people open the office (for invite links) and where runners connect.
    'client-url': { type: 'string', default: process.env.GUILD_CLIENT_URL || '' },
    'public-url': { type: 'string', default: process.env.GUILD_PUBLIC_URL || '' },
    // WebRTC ICE servers (JSON) for voice and screen sharing. STUN alone works on
    // most networks; add a TURN server for people behind strict firewalls.
    'ice-servers': { type: 'string', default: process.env.GUILD_ICE_SERVERS || '[{"urls":"stun:stun.l.google.com:19302"}]' },
    // What coworkers run to host agents: a package npx can fetch (the repo's latest tarball).
    'runner-package': { type: 'string', default: process.env.GUILD_RUNNER_PACKAGE || 'https://github.com/kevinamick/agent-guild/archive/HEAD.tar.gz' },
  },
});

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../client/dist');
const SCROLLBACK_LIMIT = 256 * 1024;
const NAMES = ['Pixel', 'Byte', 'Nibble', 'Sprocket', 'Widget', 'Gizmo', 'Cog', 'Bolt', 'Sparky', 'Noodle', 'Pebble', 'Mochi',
  'Ziggy', 'Tofu', 'Biscuit', 'Waffle', 'Quark', 'Rivet', 'Dot', 'Blip', 'Jinx', 'Fizz', 'Echo', 'Nova', 'Juno', 'Pip'];
const COLORS = ['#22c55e', '#f97316', '#3b82f6', '#ef4444', '#a855f7', '#eab308', '#14b8a6', '#ec4899', '#64748b', '#84cc16'];

fs.mkdirSync(opts.data, { recursive: true });

const keys = createKeyStore(path.join(opts.data, 'keys.json'));
let bootstrapKey = null;
// The deployment owner's key is the only one that can create offices.
if (opts['admin-key']) keys.ensure(opts['admin-key'], opts.admin, true, { owner: true, office: 'main' });
for (const pair of opts.seed.split(',').filter(Boolean)) {
  const [name, key] = pair.split('=');
  keys.ensure(key, name, false);
}
if (keys.isEmpty()) bootstrapKey = keys.issue(opts.admin, true, 'main', { owner: true });

const RUNNER_GRACE_MS = 10 * 60 * 1000;
let ICE_SERVERS;
try {
  ICE_SERVERS = JSON.parse(opts['ice-servers']);
} catch {
  console.error('GUILD_ICE_SERVERS / --ice-servers is not valid JSON');
  process.exit(1);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 2));
  fs.renameSync(file + '.tmp', file);
}

// Each person's character, remembered across devices (names are per office).
const AVATARS_FILE = path.join(opts.data, 'avatars.json');
const avatars = readJson(AVATARS_FILE, {});
const avatarKey = (office, name) => (office === 'main' ? name.toLowerCase() : `${office}:${name.toLowerCase()}`);
function saveAvatar(office, name, avatar) {
  avatars[avatarKey(office, name)] = avatar;
  writeJson(AVATARS_FILE, avatars);
}

// ---------------------------------------------------------------- offices
// Everything below lives per office: nothing is shared between two offices
// except the key store (which maps each key to exactly one office).

function createOffice(officeId, officeName, dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const PROFILES_FILE = path.join(dataDir, 'agents.json');

  /** Persistent agent profiles: the shared XP ledger. */
  const profiles = new Map(Object.entries(readJson(PROFILES_FILE, {})));
  /** Live per-agent state while its runner is connected. */
  const live = new Map();
  const players = new Map();
  const runners = new Map();
  const desks = new Map(); // deskId -> agentId
  const chat = [];
  const boardCache = new Map();
  const pendingRunnerReplies = new Map();
  const killOnReconnect = new Set(); // sent home while their runner was away
  const pictures = createPictureStore(path.join(dataDir, 'pictures'), PICTURE_SPOTS);
  let tvSharer = null; // player id sharing their screen on this office's TV (one at a time)

  // ---------------------------------------------------------------- persistence

  let saveTimer = null;
  function saveProfiles() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      fs.writeFileSync(PROFILES_FILE + '.tmp', JSON.stringify(Object.fromEntries(profiles), null, 2));
      fs.renameSync(PROFILES_FILE + '.tmp', PROFILES_FILE);
    }, 250);
  }

  // ---------------------------------------------------------------- views

  function agentView(id) {
    const p = profiles.get(id);
    const l = live.get(id);
    const runner = l?.runnerId ? runners.get(l.runnerId) : runnerFor(p.owner);
    const level = overallLevel(p.xp);
    const best = bestSkill(p.xp);
    return {
      id,
      name: p.name,
      owner: p.owner,
      color: p.color,
      xp: p.xp,
      total: totalXp(p.xp),
      level,
      skillLevels: Object.fromEntries(SKILLS.map((s) => [s, levelFor(p.xp[s] || 0)])),
      title: titleFor(level, totalXp(p.xp) > 0 ? best : null),
      stats: p.stats,
      online: Boolean(runner),
      lendable: runner ? runner.lend : false,
      // Who else may use this agent ({ name: 'session' | 'always' }); the owner always can.
      access: Object.fromEntries(Object.entries(p.grants || {}).map(([n, g]) => [n, g.type])),
      deskId: l?.deskId ?? null,
      status: l ? (l.runnerId ? l.status : 'offline') : 'home',
      activity: l?.activity ?? '',
      task: l?.task ?? null,
      lessons: l?.lessons ?? p.lessons ?? {},
      spawnedAt: l?.spawnedAt ?? null,
      engine: l?.engine ?? p.lastEngine ?? null,
    pty: runner?.pty || null,
    };
  }

  function snapshot() {
    return {
      office: { id: officeId, name: officeName, repo: firstRunner()?.repo || null, provider: firstRunner()?.provider || null },
      players: [...players.values()].map(({ id, name, color, avatar, x, y, z, ry }) => ({ id, name, color, avatar, x, y, z, ry })),
      runners: [...runners.values()].filter((r) => r.ready).map(({ id, owner, repo, lend, engines }) => ({ id, owner, repo, lend, engines })),
      agents: [...profiles.keys()].map(agentView),
      desks: Object.fromEntries(desks),
      pictures: pictures.list().map(({ spot, file, by, caption, at }) => ({ spot, url: `/pictures/${officeId}/${file}`, by, caption, at })),
      tv: { sharer: tvSharer },
    };
  }

  // ---------------------------------------------------------------- messaging

  function send(ws, msg) {
    if (ws?.readyState === 1) ws.send(JSON.stringify(msg));
  }

  function broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const p of players.values()) if (p.ws.readyState === 1) p.ws.send(data);
  }

  let stateTimer = null;
  function pushState() {
    if (stateTimer) return;
    stateTimer = setTimeout(() => {
      stateTimer = null;
      broadcast({ t: 'state', state: snapshot() });
    }, 60);
  }

  function toast(text, extra = {}) {
    broadcast({ t: 'event', kind: 'toast', text, ...extra });
  }

  function playerByName(name) {
    return [...players.values()].find((p) => p.name.toLowerCase() === name.toLowerCase());
  }

  function windowsPtyOf(runner) {
    return runner?.pty?.platform === 'win32' ? { backend: 'conpty', buildNumber: runner.pty.buildNumber } : undefined;
  }

  function firstRunner() {
    return [...runners.values()].find((r) => r.ready);
  }

  function runnerFor(owner) {
    return [...runners.values()].find((r) => r.ready && r.owner.toLowerCase() === owner.toLowerCase());
  }

  function askRunner(runner, msg, timeoutMs = 20000) {
    const reqId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingRunnerReplies.delete(reqId);
        reject(new Error('runner did not answer'));
      }, timeoutMs);
      pendingRunnerReplies.set(reqId, { resolve, reject, timer });
      send(runner.ws, { ...msg, reqId });
    });
  }

  // ---------------------------------------------------------------- XP ledger

  function grantXp(agentId, skill, amount, reasons, from) {
    const p = profiles.get(agentId);
    if (!p || amount <= 0) return;
    const beforeSkill = levelFor(p.xp[skill] || 0);
    const beforeOverall = overallLevel(p.xp);
    p.xp[skill] = (p.xp[skill] || 0) + amount;
    const afterSkill = levelFor(p.xp[skill]);
    const afterOverall = overallLevel(p.xp);
    saveProfiles();
    broadcast({ t: 'event', kind: 'xp', agentId, skill, amount, reasons, from });
    if (afterSkill > beforeSkill) {
      broadcast({ t: 'event', kind: 'levelup', agentId, skill, level: afterSkill });
      toast(`⭐ ${p.name} is now ${SKILL_INFO[skill].label} Lv ${afterSkill}: playbook holds more lessons`);
    }
    if (afterOverall > beforeOverall) {
      broadcast({ t: 'event', kind: 'levelup', agentId, level: afterOverall, overall: true });
      toast(`🎉 ${p.name} reached Lv ${afterOverall}: ${titleFor(afterOverall, bestSkill(p.xp))}`);
    }
    const runner = runnerFor(p.owner);
    if (runner) send(runner.ws, { t: 'profile', agent: runnerAgent(agentId) });
    pushState();
  }

  function runnerAgent(id) {
    const p = profiles.get(id);
    return { id, name: p.name, color: p.color, owner: p.owner, xp: p.xp, stats: p.stats };
  }

  // ---------------------------------------------------------------- agents

  // Names are unique within an office so "Ada" always means one agent.
  const nameTaken = (name, exceptId) => [...profiles.values()].some((p) => p.id !== exceptId && sameName(p.name, name));

  function newProfile(owner, wanted) {
    const pool = NAMES.filter((n) => !nameTaken(n));
    const name = wanted || (pool.length ? pool[Math.floor(Math.random() * pool.length)] : `Bot-${profiles.size + 1}`);
    const id = crypto.randomBytes(5).toString('hex');
    const profile = {
      id,
      name,
      owner,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      xp: emptyXp(),
      stats: { tasks: 0, borrowed: 0, kudos: 0, prsOpened: 0, prsMerged: 0, reviews: 0 },
      createdAt: Date.now(),
    };
    profiles.set(id, profile);
    saveProfiles();
    return profile;
  }

  function hire(player, { deskId, agentId, task, worktree, engine: wanted, name: wantedName }) {
    const occupied = new Set(desks.keys());
    const desk = deskId && !occupied.has(deskId) ? deskById(deskId) : nearestFreeDesk(occupied, player);
    if (!desk) return send(player.ws, { t: 'error', text: 'Every desk is taken. Send someone home first.' });

    let profile;
    if (agentId) {
      profile = profiles.get(agentId);
      if (!profile) return send(player.ws, { t: 'error', text: 'Unknown agent.' });
      if (live.get(agentId)?.deskId) return send(player.ws, { t: 'error', text: `${profile.name} is already at a desk.` });
    } else {
      if (!runnerFor(player.name)) {
        return send(player.ws, { t: 'error', text: 'Start your runner to recruit your own agents, or borrow a coworker\'s.' });
      }
      let name = null;
      if (wantedName && String(wantedName).trim()) {
        const checked = cleanAgentName(wantedName);
        if (checked.error) return send(player.ws, { t: 'error', text: checked.error });
        if (nameTaken(checked.name)) return send(player.ws, { t: 'error', text: `There's already an agent called ${checked.name} in this office.` });
        name = checked.name;
      }
      profile = newProfile(player.name, name);
    }

    const runner = runnerFor(profile.owner);
    if (!runner) return send(player.ws, { t: 'error', text: `${profile.owner}'s runner is offline.` });
    const borrowed = profile.owner.toLowerCase() !== player.name.toLowerCase();
    if (borrowed && !runner.lend) return send(player.ws, { t: 'error', text: `${profile.owner} isn't lending agents right now.` });
    if (borrowed && !canUse(player, profile.id)) return needAccess(player, profile.id, 'borrow');

    const kind = SKILLS.includes(task?.kind) ? task.kind : 'general';
    const offered = (runner.engines || []).map((e) => e.id);
    const engine = [wanted, profile.lastEngine].find((e) => e && offered.includes(e)) || offered[0] || null;
    profile.lastEngine = engine;
    const l = {
      engine,
      runnerId: runner.id,
      deskId: desk.id,
      status: 'starting',
      activity: task?.text ? 'reading the brief' : 'booting up',
      task: { kind, title: task?.title || null, text: task?.text || '', requestedBy: player.name, borrowed, ref: task?.ref || null },
      scrollback: '',
      screen: (live.get(profile.id)?.screen?.dispose(), createScreen(120, 34, windowsPtyOf(runner))),
      cols: 120,
      rows: 34,
      viewers: new Set(),
      kudosBy: new Set(),
      turnId: 0,
      spawnedAt: Date.now(),
      lessons: profile.lessons || {},
    };
    live.set(profile.id, l);
    desks.set(desk.id, profile.id);
    if (borrowed) profile.stats.borrowed++;
    saveProfiles();

    send(runner.ws, {
      t: 'spawn',
      agent: runnerAgent(profile.id),
      task: task?.text ? { text: task.text, kind, requestedBy: player.name } : null,
      deskId: desk.id,
      meta: l.task,
      cli: engine,
      worktree: Boolean(worktree),
      cols: 120,
      rows: 34,
    });
    const verb = borrowed ? `borrowed ${profile.owner}'s ${profile.name}` : `hired ${profile.name}`;
    toast(`${player.name} ${verb}${task?.text ? ' with a task' : ''}`);
    pushState();
  }

  // ---------------------------------------------------------------- access
  // Using someone else's agent (borrowing it, prompting it, typing into its terminal,
  // sending it home) takes its owner's permission. Watching doesn't.
  const requests = new Map(); // id -> { id, agentId, agentName, from, at }

  function canUse(player, agentId) {
    const p = profiles.get(agentId);
    return Boolean(p && (sameName(p.owner, player.name) || p.grants?.[player.name.toLowerCase()]));
  }

  function needAccess(player, agentId, what) {
    const p = profiles.get(agentId);
    send(player.ws, { t: 'error', text: `${p.name} is ${p.owner}'s agent: ask ${p.owner} for access to ${what} it.`, needAccess: { agentId } });
  }

  const socketsOf = (name) => [...players.values()].filter((pl) => sameName(pl.name, name));
  const requestsFor = (owner) => [...requests.values()].filter((r) => sameName(profiles.get(r.agentId)?.owner || '', owner));
  function sendRequests(owner) {
    for (const pl of socketsOf(owner)) send(pl.ws, { t: 'access-requests', requests: requestsFor(owner) });
  }

  // "Allow once" lasts until the agent next goes home.
  function endSessionGrants(p) {
    for (const [name, g] of Object.entries(p.grants || {})) if (g.type === 'session') delete p.grants[name];
  }

  // Each agent at a desk has a virtual screen mirroring its terminal, drawn on its laptop.
  function dropScreen(agentId, l) {
    l.screen?.dispose();
    l.screen = null;
    broadcast({ t: 'screen', agentId, clear: true });
  }

  function dismiss(agentId, by) {
    const l = live.get(agentId);
    if (!l?.deskId) return;
    const runner = runners.get(l.runnerId);
    if (runner) send(runner.ws, { t: 'kill', agentId });
    else killOnReconnect.add(agentId);
    desks.delete(l.deskId);
    l.deskId = null;
    l.status = 'home';
    l.activity = '';
    l.task = null;
    l.scrollback = '';
    dropScreen(agentId, l);
    endSessionGrants(profiles.get(agentId));
    saveProfiles();
    if (by) toast(`${by} sent ${profiles.get(agentId).name} home`);
    pushState();
  }

  // ---------------------------------------------------------------- player socket

  function onPlayerMessage(player, msg) {
    switch (msg.t) {
      case 'move':
        player.x = +msg.x || 0;
        player.y = Math.min(MEZZ.y, Math.max(0, +msg.y || 0));
        player.z = +msg.z || 0;
        player.ry = +msg.ry || 0;
        player.moved = true;
        break;
      case 'rtc': {
        // WebRTC signaling (offers, answers, ICE candidates) between two players.
        // Only to someone in this same office; the payload is opaque to the server.
        const target = players.get(msg.to);
        if (!target || target === player) return;
        const data = JSON.stringify(msg.data ?? null);
        if (data.length > 64 * 1024) return;
        target.ws.send(JSON.stringify({ t: 'rtc', from: player.id, data: JSON.parse(data) }));
        break;
      }
      case 'tv': {
        // Screen sharing on the TV. The stream itself goes peer to peer (over the
        // 'rtc' relay); the server only tracks who holds the TV.
        if (players.get(player.id) !== player) return; // a replaced tab
        if (msg.share) {
          if (tvSharer === player.id) return;
          if (tvSharer) return send(player.ws, { t: 'error', text: `${players.get(tvSharer)?.name || 'Someone'} is already sharing on the TV.` });
          tvSharer = player.id;
          toast(`📺 ${player.name} is sharing their screen on the TV`);
        } else {
          if (tvSharer !== player.id) return;
          tvSharer = null;
        }
        pushState();
        break;
      }
      case 'chat': {
        const text = String(msg.text || '').slice(0, 280).trim();
        if (!text) return;
        const entry = { id: crypto.randomUUID(), from: player.name, color: player.color, playerId: player.id, text, at: Date.now() };
        chat.push(entry);
        if (chat.length > 100) chat.shift();
        broadcast({ t: 'chat', entry });
        break;
      }
      case 'hire':
        hire(player, msg);
        break;
      case 'avatar':
        player.avatar = { ...sanitizeAvatar(msg.avatar), chosen: true };
        player.color = player.avatar.shirt;
        saveAvatar(officeId, player.name, player.avatar);
        pushState();
        break;
      case 'picture': {
        // Uploads are up to 1.5 MB each, so one every few seconds per person is plenty.
        if (Date.now() - (player.pictureAt || 0) < 3000) return send(player.ws, { t: 'error', text: 'One picture at a time, please.' });
        player.pictureAt = Date.now();
        const result = pictures.hang(String(msg.spot), msg.data, msg.caption, player);
        if (result.error) return send(player.ws, { t: 'error', text: result.error });
        toast(`🖼️ ${player.name} ${result.replaced ? 'replaced' : 'hung'} a picture`);
        pushState();
        break;
      }
      case 'picture-remove': {
        const result = pictures.remove(String(msg.spot), player);
        if (result.error) return send(player.ws, { t: 'error', text: result.error });
        toast(`🖼️ ${player.name} took down ${result.by === player.name ? 'their' : `${result.by}'s`} picture`);
        pushState();
        break;
      }
      case 'prompt': {
        const l = live.get(msg.agentId);
        const text = String(msg.text || '').trim();
        if (!l?.deskId || !text) return;
        if (!canUse(player, msg.agentId)) return needAccess(player, msg.agentId, 'prompt');
        const kind = SKILLS.includes(msg.kind) ? msg.kind : l.task?.kind || 'general';
        const owner = profiles.get(msg.agentId).owner;
        const borrowed = owner.toLowerCase() !== player.name.toLowerCase();
        l.task = { ...(l.task || {}), kind, text, requestedBy: player.name, borrowed };
        send(runners.get(l.runnerId)?.ws, { t: 'prompt', agentId: msg.agentId, text, kind, meta: l.task });
        pushState();
        break;
      }
      case 'input': {
        const l = live.get(msg.agentId);
        if (!l?.deskId || !canUse(player, msg.agentId)) return; // watching is read-only
        send(runners.get(l.runnerId)?.ws, { t: 'input', agentId: msg.agentId, data: String(msg.data) });
        break;
      }
      case 'resize': {
        const l = live.get(msg.agentId);
        if (!l?.deskId || !canUse(player, msg.agentId)) return; // watchers follow the size, they don't set it
        send(runners.get(l.runnerId)?.ws, { t: 'resize', agentId: msg.agentId, cols: msg.cols | 0, rows: msg.rows | 0 });
        l.screen?.resize(msg.cols | 0, msg.rows | 0);
        break;
      }
      case 'sub': {
        const l = live.get(msg.agentId);
        if (!l) return;
        l.viewers.add(player.id);
        if (l.cols) send(player.ws, { t: 'pty-size', agentId: msg.agentId, cols: l.cols, rows: l.rows });
        send(player.ws, { t: 'scrollback', agentId: msg.agentId, data: l.scrollback });
        break;
      }
      case 'unsub':
        live.get(msg.agentId)?.viewers.delete(player.id);
        break;
      case 'dismiss':
        if (!profiles.has(msg.agentId)) return;
        if (!canUse(player, msg.agentId) && !player.admin) return needAccess(player, msg.agentId, 'send home');
        dismiss(msg.agentId, player.name);
        break;
      case 'access-request': {
        const p = profiles.get(msg.agentId);
        if (!p || canUse(player, p.id)) return;
        const mine = [...requests.values()].filter((r) => sameName(r.from, player.name));
        if (mine.some((r) => r.agentId === p.id)) return send(player.ws, { t: 'event', kind: 'toast', text: `You've already asked ${p.owner} about ${p.name}.` });
        if (mine.length >= 10) return send(player.ws, { t: 'error', text: 'You have too many requests waiting. Wait for answers first.' });
        const req = { id: crypto.randomUUID(), agentId: p.id, agentName: p.name, from: player.name, at: Date.now() };
        requests.set(req.id, req);
        sendRequests(p.owner);
        const here = socketsOf(p.owner).length > 0;
        send(player.ws, { t: 'event', kind: 'toast', text: `🔑 Asked ${p.owner} to use ${p.name}.${here ? '' : ` ${p.owner} isn't in the office; they'll see it when they're back.`}` });
        break;
      }
      case 'access-decide': {
        const req = requests.get(msg.id);
        const p = req && profiles.get(req.agentId);
        if (!p) return;
        if (!sameName(p.owner, player.name)) return send(player.ws, { t: 'error', text: `Only ${p.owner} can answer that.` });
        requests.delete(req.id);
        const decision = ['once', 'always', 'deny'].includes(msg.decision) ? msg.decision : 'deny';
        if (decision !== 'deny') {
          p.grants = { ...(p.grants || {}), [req.from.toLowerCase()]: { type: decision === 'always' ? 'always' : 'session', by: player.name, at: Date.now() } };
          saveProfiles();
        }
        const text =
          decision === 'deny'
            ? `🚫 ${p.owner} said no to using ${p.name}.`
            : `✅ ${p.owner} let you use ${p.name}${decision === 'always' ? '' : ' until it next goes home'}.`;
        for (const pl of socketsOf(req.from)) send(pl.ws, { t: 'event', kind: 'toast', text, tone: decision === 'deny' ? 'error' : 'success' });
        sendRequests(p.owner);
        pushState();
        break;
      }
      case 'access-revoke': {
        const p = profiles.get(msg.agentId);
        const who = String(msg.name || '').toLowerCase();
        if (!p || !sameName(p.owner, player.name) || !p.grants?.[who]) return;
        delete p.grants[who];
        saveProfiles();
        for (const pl of socketsOf(who)) send(pl.ws, { t: 'event', kind: 'toast', text: `${p.owner} took back your access to ${p.name}.` });
        pushState();
        break;
      }
      case 'rename': {
        const p = profiles.get(msg.agentId);
        if (!p) return;
        // The owner names their agents; an office admin can fix a name too.
        if (!sameName(p.owner, player.name) && !player.admin) return send(player.ws, { t: 'error', text: `Only ${p.owner} or an admin can rename ${p.name}.` });
        const checked = cleanAgentName(msg.name);
        if (checked.error) return send(player.ws, { t: 'error', text: checked.error });
        if (checked.name === p.name) return;
        if (nameTaken(checked.name, p.id)) return send(player.ws, { t: 'error', text: `There's already an agent called ${checked.name} in this office.` });
        const old = p.name;
        p.name = checked.name;
        saveProfiles();
        // The owner's runner keeps its own copy; the agent uses the new name from its next session.
        const runner = runnerFor(p.owner);
        if (runner) send(runner.ws, { t: 'profile', agent: runnerAgent(p.id) });
        toast(`✏️ ${player.name} renamed ${old} to ${p.name}${live.get(p.id)?.deskId ? ' (from its next session)' : ''}`);
        pushState();
        break;
      }
      case 'kudos': {
        const l = live.get(msg.agentId);
        const p = profiles.get(msg.agentId);
        if (!l || !p) return;
        const key = `${player.id}:${l.turnId}`;
        if (l.kudosBy.has(key)) return send(player.ws, { t: 'error', text: 'You already gave kudos for this task.' });
        l.kudosBy.add(key);
        p.stats.kudos++;
        grantXp(msg.agentId, l.task?.kind || 'general', KUDOS_XP, ['kudos'], player.name);
        toast(`👏 ${player.name} gave ${p.name} kudos`);
        break;
      }
      case 'board':
        loadBoard(player, msg.kind, msg.force, msg.area);
        break;
      case 'members':
        if (player.admin) send(player.ws, { t: 'members', members: keys.members(officeId) });
        break;
      case 'invite': {
        if (!player.admin) return send(player.ws, { t: 'error', text: 'Only admins can invite people.' });
        const name = String(msg.name || '').trim().slice(0, 24);
        if (!/^[\w .-]{2,24}$/.test(name)) return send(player.ws, { t: 'error', text: 'Names are 2 to 24 letters, digits, spaces, dots or dashes.' });
        const key = keys.issue(name, false, officeId);
        send(player.ws, { t: 'invited', name, key, ...inviteLinks(key) });
        send(player.ws, { t: 'members', members: keys.members(officeId) });
        break;
      }
      case 'revoke': {
        if (!player.admin) return;
        const removed = keys.revoke(String(msg.name || ''), officeId);
        for (const p of players.values()) if (p.name.toLowerCase() === String(msg.name).toLowerCase() && !p.admin) p.ws.close(4001, 'revoked');
        for (const r of runners.values()) if (r.owner.toLowerCase() === String(msg.name).toLowerCase()) r.ws.close(4001, 'revoked');
        send(player.ws, { t: 'members', members: keys.members(officeId) });
        toast(`${player.name} revoked ${removed} key${removed === 1 ? '' : 's'} for ${msg.name}`);
        break;
      }
      case 'offices':
        if (player.owner) send(player.ws, { t: 'offices', offices: listOffices() });
        break;
      case 'create-office': {
        if (!player.owner) return send(player.ws, { t: 'error', text: 'Only the owner of this deployment can create offices.' });
        const result = createNewOffice(msg.name, msg.adminName);
        if (result.error) return send(player.ws, { t: 'error', text: result.error });
        send(player.ws, { t: 'office-created', ...result });
        send(player.ws, { t: 'offices', offices: listOffices() });
        break;
      }
      case 'my-links':
        send(player.ws, { t: 'my-links', ...inviteLinks(null) });
        break;
      case 'playbook': {
        const p = profiles.get(msg.agentId);
        const runner = p && runnerFor(p.owner);
        if (!runner) return send(player.ws, { t: 'playbook', agentId: msg.agentId, error: `${p?.owner || 'Owner'}'s runner is offline` });
        askRunner(runner, { t: 'playbook', agentId: msg.agentId })
          .then((data) => send(player.ws, { t: 'playbook', agentId: msg.agentId, playbooks: data }))
          .catch((e) => send(player.ws, { t: 'playbook', agentId: msg.agentId, error: e.message }));
        break;
      }
    }
  }

  // Boards are read through a runner. Azure DevOps work items can be narrowed to an
  // area path (the runner checks it against the project's area tree).
  async function loadBoard(player, kind, force, rawArea) {
    if (kind !== 'issues' && kind !== 'prs') return;
    const area = kind === 'issues' ? String(rawArea || '').slice(0, 256) : '';
    const key = `${kind}:${area}`;
    const cached = boardCache.get(key);
    if (cached && !force && Date.now() - cached.at < 15000) return send(player.ws, { t: 'board', kind, area, ...cached });
    const runner = firstRunner();
    if (!runner) return send(player.ws, { t: 'board', kind, area, error: 'No runner connected. Boards are read through a runner (gh for GitHub, the REST API for Azure DevOps).' });
    try {
      const data = await askRunner(runner, { t: 'board', kind, area });
      // Older runners answer with a plain list; newer ones add the area paths for ADO.
      const entry = Array.isArray(data) ? { items: data, at: Date.now() } : { items: data.items || [], areas: data.areas || null, at: Date.now() };
      boardCache.set(key, entry);
      send(player.ws, { t: 'board', kind, area, ...entry });
    } catch (e) {
      send(player.ws, { t: 'board', kind, area, error: e.message });
    }
  }

  // ---------------------------------------------------------------- runner socket

  function onRunnerHello(runner, msg) {
    for (const other of runners.values()) {
      if (other !== runner && other.owner.toLowerCase() === runner.owner.toLowerCase()) other.ws.close(4003, 'replaced');
    }
    runner.ready = true;
    runner.repo = msg.repo || null;
    runner.provider = msg.provider === 'ado' || msg.provider === 'github' ? msg.provider : null;
    runner.engines = Array.isArray(msg.engines) ? msg.engines.slice(0, 8) : [];
    runner.pty = cleanPtyInfo(msg.pty);
    runner.lend = msg.lend !== false;
    // A runner remembers its agents locally; merge so XP survives either side restarting.
    for (const a of msg.agents || []) {
      const existing = profiles.get(a.id);
      if (!existing) {
        profiles.set(a.id, {
          id: a.id, name: a.name, owner: runner.owner, color: a.color, xp: { ...emptyXp(), ...a.xp },
          stats: { tasks: 0, borrowed: 0, kudos: 0, prsOpened: 0, prsMerged: 0, reviews: 0, ...a.stats }, createdAt: Date.now(),
        });
      } else {
        for (const s of SKILLS) existing.xp[s] = Math.max(existing.xp[s] || 0, a.xp?.[s] || 0);
        existing.owner = runner.owner;
      }
      if (a.lessons) profiles.get(a.id).lessons = a.lessons;
    }
    let restored = 0;
    for (const sess of msg.sessions || []) {
      if (!profiles.has(sess.agentId) || killOnReconnect.delete(sess.agentId)) {
        send(runner.ws, { t: 'kill', agentId: sess.agentId });
        continue;
      }
      let l = live.get(sess.agentId);
      if (!l) {
        const occupied = new Set(desks.keys());
        const desk = sess.deskId && !occupied.has(sess.deskId) ? deskById(sess.deskId) : nearestFreeDesk(occupied);
        if (!desk) {
          send(runner.ws, { t: 'kill', agentId: sess.agentId });
          continue;
        }
        l = {
          deskId: desk.id, task: sess.meta || { kind: 'general' }, scrollback: '', screen: createScreen(sess.cols || 120, sess.rows || 34, windowsPtyOf(runner)), cols: sess.cols || 120, rows: sess.rows || 34, viewers: new Set(), kudosBy: new Set(),
          turnId: 0, spawnedAt: 0, lessons: profiles.get(sess.agentId).lessons || {},
        };
        live.set(sess.agentId, l);
        desks.set(desk.id, sess.agentId);
      }
      l.runnerId = runner.id;
      l.offlineSince = null;
      if (sess.cols && sess.rows) {
        l.cols = sess.cols;
        l.rows = sess.rows;
        l.screen?.resize(sess.cols, sess.rows);
      }
      l.engine = sess.engine || l.engine || null;
      l.status = sess.status || 'ready';
      l.activity = sess.activity || '';
      if (sess.scrollback && sess.scrollback.length > l.scrollback.length) {
        l.scrollback = sess.scrollback.slice(-SCROLLBACK_LIMIT);
        l.screen?.reset(l.scrollback);
        const data = JSON.stringify({ t: 'scrollback', agentId: sess.agentId, data: l.scrollback });
        for (const pid of l.viewers) players.get(pid)?.ws.send(data);
      }
      restored++;
    }
    saveProfiles();
    send(runner.ws, { t: 'welcome', owner: runner.owner });
    toast(`🔌 ${runner.owner}'s runner joined${restored ? `, ${restored} agent${restored > 1 ? 's' : ''} back at their desks` : ''}`);
    pushState();
  }

  // Agents of a disconnected runner keep their desks for a while so a network blip
  // or a server deploy doesn't send everyone home.
  setInterval(() => {
    let changed = false;
    for (const [agentId, l] of live) {
      if (l.runnerId || !l.offlineSince || Date.now() - l.offlineSince < RUNNER_GRACE_MS) continue;
      if (l.deskId) desks.delete(l.deskId);
      dropScreen(agentId, l);
      live.delete(agentId);
      changed = true;
    }
    if (changed) pushState();
  }, 30000);

  function onRunnerMessage(runner, msg) {
    if (msg.t === 'hello') return onRunnerHello(runner, msg);
    if (msg.t === 'reply') {
      const pending = pendingRunnerReplies.get(msg.reqId);
      if (!pending) return;
      pendingRunnerReplies.delete(msg.reqId);
      clearTimeout(pending.timer);
      return msg.error ? pending.reject(new Error(msg.error)) : pending.resolve(msg.data);
    }
    const l = live.get(msg.agentId);
    if (!l || l.runnerId !== runner.id) return;
    switch (msg.t) {
      case 'pty': {
        l.scrollback = (l.scrollback + msg.data).slice(-SCROLLBACK_LIMIT);
        l.screen?.write(msg.data);
        const data = JSON.stringify({ t: 'pty', agentId: msg.agentId, data: msg.data });
        for (const pid of l.viewers) {
          const p = players.get(pid);
          if (p?.ws.readyState === 1) p.ws.send(data);
        }
        break;
      }
      case 'status':
        if (!l.deskId) return;
        l.status = msg.status;
        if (msg.activity !== undefined) l.activity = String(msg.activity).slice(0, 160);
        if (msg.status === 'working' && msg.newTurn) {
          l.turnId++;
          l.kudosBy.clear();
        }
        if (msg.status === 'done' && l.task?.requestedBy) {
          const requester = playerByName(l.task.requestedBy);
          if (requester) send(requester.ws, { t: 'event', kind: 'done', agentId: msg.agentId });
        }
        pushState();
        break;
      case 'size': {
        // The PTY's real size: the laptop copy and every viewer follow it so lines wrap the same.
        l.cols = msg.cols | 0;
        l.rows = msg.rows | 0;
        l.screen?.resize(l.cols, l.rows);
        const data = JSON.stringify({ t: 'pty-size', agentId: msg.agentId, cols: l.cols, rows: l.rows });
        for (const pid of l.viewers) players.get(pid)?.ws.send(data);
        break;
      }
            case 'turn': {
        const p = profiles.get(msg.agentId);
        const stats = msg.stats || {};
        const { amount, reasons } = turnXp(stats);
        if ((stats.toolCalls || 0) > 0) p.stats.tasks++;
        if (stats.prOpened) p.stats.prsOpened++;
        if (stats.prMerged) p.stats.prsMerged++;
        if (stats.reviewed) p.stats.reviews++;
        const kind = l.task?.kind || 'general';
        const from = l.task?.borrowed ? l.task.requestedBy : null;
        grantXp(msg.agentId, kind, amount, reasons, from);
        break;
      }
      case 'lessons':
        l.lessons = msg.lessons || {};
        profiles.get(msg.agentId).lessons = l.lessons;
        saveProfiles();
        pushState();
        break;
      case 'exit':
        if (l.deskId) {
          toast(`${profiles.get(msg.agentId).name}'s session ended`);
          dismiss(msg.agentId);
        }
        break;
    }
  }

  // ---------------------------------------------------------------- connections

  function connectRunner(ws, ident, id) {
    const runner = { id, ws, owner: ident.name, repo: null, lend: true, ready: false };
    runners.set(id, runner);
    // Runners keep agents per office on disk, so tell them which office this is first.
    send(ws, { t: 'office', id: officeId, name: officeName, owner: ident.name });
    ws.on('message', (raw) => {
      try {
        onRunnerMessage(runner, JSON.parse(raw));
      } catch (e) {
        console.error('runner message', e);
      }
    });
    ws.on('close', () => {
      runners.delete(id);
      let waiting = 0;
      for (const l of live.values()) {
        if (l.runnerId !== id) continue;
        l.runnerId = null;
        l.offlineSince = Date.now();
        waiting++;
      }
      if (runner.ready) toast(`🔌 ${runner.owner}'s runner disconnected${waiting ? `; ${waiting} agent${waiting > 1 ? 's' : ''} will wait at their desks` : ''}`);
      pushState();
    });
  }

  function connectPlayer(ws, ident, id, url) {
    const name = ident.name;
    // A new tab (or a reconnect racing the old socket's timeout) replaces the old one.
    const previous = playerByName(name);
    if (previous) {
      players.delete(previous.id);
      if (tvSharer === previous.id) tvSharer = null; // that tab's screen share ends with it
      previous.ws.close(4002, 'replaced');
    }
    const stored = avatars[avatarKey(officeId, name)];
    let avatar = stored && { ...sanitizeAvatar(stored), chosen: Boolean(stored.chosen) };
    if (!avatar) {
      avatar = randomAvatar();
      saveAvatar(officeId, name, avatar);
    }
    const player = {
      id, ws, name, admin: ident.admin, owner: Boolean(ident.owner), avatar, color: avatar.shirt,
      x: +url.searchParams.get('x') || 0, z: +url.searchParams.get('z') || 11, ry: Math.PI, moved: true,
    };
    players.set(id, player);
    send(ws, {
      t: 'welcome', you: id,
      me: { name, admin: ident.admin, owner: player.owner, avatar, avatarChosen: Boolean(avatar.chosen) },
      state: snapshot(), chat, rtc: { iceServers: ICE_SERVERS },
    });
    for (const [agentId, l] of live) if (l.deskId && l.screen) send(ws, { t: 'screen', agentId, ...l.screen.full() });
    if (requestsFor(name).length) send(ws, { t: 'access-requests', requests: requestsFor(name) });
    if (!previous) toast(`👋 ${name} walked into the office`);
    pushState();

    ws.on('message', (raw) => {
      try {
        onPlayerMessage(player, JSON.parse(raw));
      } catch (e) {
        console.error('player message', e);
      }
    });
    ws.on('close', () => {
      if (tvSharer === id) {
        tvSharer = null;
        pushState();
      }
      if (players.get(id) !== player) return;
      players.delete(id);
      for (const l of live.values()) l.viewers.delete(id);
      pushState();
    });
  }

  // Laptop screens: twice a second, send each office the rows that changed.
  setInterval(() => {
    if (!players.size) return;
    for (const [agentId, l] of live) {
      const changes = l.deskId && l.screen?.changes();
      if (changes) broadcast({ t: 'screen', agentId, ...changes });
    }
  }, 500);

  // Movement fan-out at 12 Hz.
  setInterval(() => {
    const moved = [...players.values()].filter((p) => p.moved);
    if (!moved.length) return;
    for (const p of moved) p.moved = false;
    broadcast({ t: 'pos', list: moved.map(({ id, x, y, z, ry }) => [id, +x.toFixed(2), +z.toFixed(2), +ry.toFixed(2), +(y || 0).toFixed(2)]) });
  }, 80);

  return {
    connectRunner,
    connectPlayer,
    pictureFile: pictures.file,
    stats: () => ({ players: players.size, runners: runners.size, agents: profiles.size }),
  };
}

function inviteLinks(key) {
  const client = (opts['client-url'] || `http://localhost:${opts.port}`).replace(/\/$/, '');
  const pub = (opts['public-url'] || `http://localhost:${opts.port}`).replace(/\/$/, '').replace(/^http/, 'ws');
  const k = key || '<your key>';
  return {
    joinUrl: key ? `${client}/#key=${key}` : client,
    runnerCmd: `npx -y --package ${opts['runner-package']} agent-guild --server ${pub} --key ${k}`,
  };
}

// ---------------------------------------------------------------- http + ws

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    const totals = [...offices.values()].map((o) => o.stats());
    const sum = (k) => totals.reduce((n, t) => n + t[k], 0);
    return res.end(JSON.stringify({ ok: true, offices: offices.size, players: sum('players'), runners: sum('runners'), agents: sum('agents') }));
  }
  if (url.pathname.startsWith('/pictures/')) return servePicture(url.pathname, req, res);
  let file = path.join(DIST, path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  if (!fs.existsSync(file)) {
    res.writeHead(404);
    return res.end('Client not built. Run `npm run build`, or use `npm run dev` for development.');
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

// Wall pictures: /pictures/<officeId>/<random id>.<ext>. The random id is the
// capability (only that office's players are told it), and the page loads it
// cross-origin as a WebGL texture, hence CORS.
function servePicture(pathname, req, res) {
  const m = /^\/pictures\/([a-z0-9-]{1,64})\/([^/]+)$/.exec(pathname);
  const pic = m && (req.method === 'GET' || req.method === 'HEAD') && offices.get(m[1])?.pictureFile(m[2]);
  if (!pic) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('Not found');
  }
  res.writeHead(200, {
    'content-type': pic.type,
    'access-control-allow-origin': '*',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; sandbox",
    // Ids are never reused: a replaced picture gets a new URL.
    'cache-control': 'public, max-age=31536000, immutable',
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(pic.path).on('error', () => res.destroy()).pipe(res);
}

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4 * 1024 * 1024 });

function send(ws, msg) {
  if (ws?.readyState === 1) ws.send(JSON.stringify(msg));
}

// What a runner says about its terminals (platform, Windows ConPTY build), kept to known shapes.
function cleanPtyInfo(p) {
  if (!p || typeof p !== 'object') return null;
  const platform = String(p.platform || '').slice(0, 16);
  const buildNumber = Number.isInteger(p.buildNumber) && p.buildNumber > 0 && p.buildNumber < 1e6 ? p.buildNumber : undefined;
  return platform === 'win32' ? { platform, backend: 'conpty', buildNumber } : { platform };
}

// The first office keeps the original data layout; others live under data/offices/<id>.
const OFFICES_FILE = path.join(opts.data, 'offices.json');
const officeMeta = readJson(OFFICES_FILE, {});
officeMeta.main ||= { id: 'main', name: opts.name, createdAt: Date.now() };
officeMeta.main.name = opts.name;
writeJson(OFFICES_FILE, officeMeta);
const offices = new Map(
  Object.values(officeMeta).map((o) => [o.id, createOffice(o.id, o.name, o.id === 'main' ? opts.data : path.join(opts.data, 'offices', o.id))]),
);

function listOffices() {
  return Object.values(officeMeta)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((o) => ({ ...o, members: keys.members(o.id).length, ...offices.get(o.id).stats() }));
}

// Only reachable from the deployment owner's key (checked by the caller).
function createNewOffice(rawName, rawAdmin) {
  const name = String(rawName || '').trim().slice(0, 40);
  const adminName = String(rawAdmin || '').trim().slice(0, 24);
  if (name.length < 2) return { error: 'Give the office a name.' };
  if (!/^[\w .-]{2,24}$/.test(adminName)) return { error: 'Admin names are 2 to 24 letters, digits, spaces, dots or dashes.' };
  let id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'office';
  if (id === 'main' || officeMeta[id]) id = `${id}-${crypto.randomBytes(2).toString('hex')}`;
  officeMeta[id] = { id, name, createdAt: Date.now() };
  writeJson(OFFICES_FILE, officeMeta);
  offices.set(id, createOffice(id, name, path.join(opts.data, 'offices', id)));
  const key = keys.issue(adminName, true, id);
  console.log(`created office "${name}" (${id}) with admin ${adminName}`);
  return { office: officeMeta[id], adminName, key, ...inviteLinks(key) };
}

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://x');
  const ident = keys.lookup(url.searchParams.get('key'));
  const office = ident && offices.get(ident.office);
  if (!office) {
    send(ws, { t: 'error', fatal: true, text: 'That key isn\'t valid. Ask the office admin for an invite.' });
    return ws.close(4001, 'bad key');
  }
  const id = crypto.randomUUID();
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));
  if (url.searchParams.get('role') === 'runner') office.connectRunner(ws, ident, id);
  else office.connectPlayer(ws, ident, id, url);
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) ws.terminate();
    ws.isAlive = false;
    ws.ping();
  }
}, 20000);

server.listen(+opts.port, opts.host, () => {
  const { joinUrl, runnerCmd } = inviteLinks(bootstrapKey);
  console.log(`\n  🏢 Agent Guild is listening on :${opts.port} with ${offices.size} office${offices.size > 1 ? 's' : ''}`);
  if (bootstrapKey) {
    console.log(`  First start: created an admin key for ${opts.admin}. It is shown only once:\n`);
    console.log(`    ${bootstrapKey}\n`);
    console.log(`  Open ${joinUrl}`);
    console.log(`  Runner: ${runnerCmd}\n`);
  }
});
