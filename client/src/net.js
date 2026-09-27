import { create } from 'zustand';

// Positions change every frame, so they live outside React state.
export const positions = new Map(); // playerId -> { x, y, z, ry }
// Each seated agent's terminal as the server sees it: { rows, n, cols, version }.
// Read by the laptops every frame, so kept outside React state like positions.
export const screens = new Map();
export const localPlayer = { x: 0, y: 0, z: 11, ry: Math.PI, level: 'ground' };
// Read-only position for automated UI tests (e.g. walking a scripted route).
if (typeof window !== 'undefined') Object.defineProperty(window, '__guildPosition', { get: () => ({ ...localPlayer }) });
const ptyListeners = new Map(); // agentId -> Set<fn>

export const useGame = create(() => ({
  status: 'idle', // idle | connecting | online | reconnecting | closed
  error: null,
  me: null,
  myName: '',
  admin: false,
  owner: false,
  officeList: null,
  accessRequests: [], // for owners: requests to use their agents
  newOffice: null,
  members: null,
  invite: null,
  myLinks: null,
  office: { name: 'Agent Guild', repo: null },
  players: [],
  runners: [],
  agents: {},
  desks: {},
  pictures: [], // wall pictures: { spot, url, by, caption, at }
  chat: [],
  toasts: [],
  fx: [], // floating XP / level-up effects
  focus: null, // what the player is standing next to
  modal: null, // { type, ...props }
  boards: {},
  playbooks: {},
  bubbles: {}, // playerId -> { text, at }
  tv: { sharer: null }, // who is screen sharing on the TV (player id)
}));

let socket = null;
let lastSent = 0;
let creds = null;
let retry = 0;

// The office server can live on another host (e.g. Fly) than the page (e.g. Vercel).
const SERVER = (import.meta.env.VITE_GUILD_SERVER || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`).replace(/\/$/, '');
// The same server over HTTP(S), for files it serves (e.g. wall pictures).
export const SERVER_HTTP = SERVER.replace(/^ws/, 'http');

export function connect({ key }) {
  creds = { key };
  useGame.setState({ status: 'connecting', error: null });
  open();
}

function open() {
  const params = new URLSearchParams({ key: creds.key, x: localPlayer.x, z: localPlayer.z });
  const sock = new WebSocket(`${SERVER}/ws?${params}`);
  socket = sock;
  sock.onmessage = (e) => handle(JSON.parse(e.data));
  sock.onclose = (e) => {
    if (socket !== sock) return;
    const { status, error } = useGame.getState();
    // Bad or revoked key, or never got in: back to the sign-in screen.
    if (e.code === 4001 || error || status === 'connecting') {
      return useGame.setState({ status: 'closed', error: error || 'Could not reach the office.' });
    }
    if (e.code === 4002) return useGame.setState({ status: 'closed', error: 'You opened the office in another tab.' });
    useGame.setState({ status: 'reconnecting' });
    const wait = Math.min(10000, 500 * 2 ** retry++);
    setTimeout(open, wait);
  };
}

export function send(msg) {
  if (socket?.readyState === 1) socket.send(JSON.stringify(msg));
}

export function sendMove(x, y, z, ry) {
  const now = performance.now();
  if (now - lastSent < 70) return;
  lastSent = now;
  send({ t: 'move', x, y, z, ry });
}

// WebRTC signaling relay. Features share it by tagging messages with a channel
// (e.g. { channel: 'voice', ... } or { channel: 'tv', ... }); only players in
// the same office can reach each other.
const rtcListeners = new Set();
export function onRtc(fn) {
  rtcListeners.add(fn);
  return () => rtcListeners.delete(fn);
}
export function sendRtc(to, data) {
  send({ t: 'rtc', to, data });
}
// RTCPeerConnection config from the server (STUN/TURN), for every WebRTC feature.
export function rtcConfig() {
  return { iceServers: useGame.getState().rtc?.iceServers || [{ urls: 'stun:stun.l.google.com:19302' }] };
}

// The real terminal's size, which every viewer adopts so lines wrap identically.
const sizeListeners = new Map(); // agentId -> Set<fn(cols, rows)>
export function onPtySize(agentId, fn) {
  if (!sizeListeners.has(agentId)) sizeListeners.set(agentId, new Set());
  sizeListeners.get(agentId).add(fn);
  return () => sizeListeners.get(agentId)?.delete(fn);
}

export function onPty(agentId, fn) {
  if (!ptyListeners.has(agentId)) ptyListeners.set(agentId, new Set());
  ptyListeners.get(agentId).add(fn);
  return () => ptyListeners.get(agentId)?.delete(fn);
}

export function toast(text, tone = 'info') {
  const id = Math.random().toString(36).slice(2);
  useGame.setState((s) => ({ toasts: [...s.toasts.slice(-4), { id, text, tone }] }));
  setTimeout(() => useGame.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 5000);
}

function addFx(fx) {
  const id = Math.random().toString(36).slice(2);
  useGame.setState((s) => ({ fx: [...s.fx, { ...fx, id, at: performance.now() }] }));
  setTimeout(() => useGame.setState((s) => ({ fx: s.fx.filter((f) => f.id !== id) })), fx.kind === 'levelup' ? 3200 : 2400);
}

function applyState(state) {
  const agents = Object.fromEntries(state.agents.map((a) => [a.id, a]));
  for (const p of state.players) {
    if (!positions.has(p.id)) positions.set(p.id, { x: p.x, y: p.y || 0, z: p.z, ry: p.ry });
  }
  const ids = new Set(state.players.map((p) => p.id));
  for (const id of positions.keys()) if (!ids.has(id)) positions.delete(id);
  useGame.setState({ office: state.office, players: state.players, runners: state.runners, agents, desks: state.desks, pictures: state.pictures || [], tv: state.tv || { sharer: null } });
}

function handle(msg) {
  switch (msg.t) {
    case 'welcome': {
      retry = 0;
      applyState(msg.state);
      const first = useGame.getState().status !== 'reconnecting';
      let boardArea = '';
      try {
        boardArea = localStorage.getItem(`guild-area:${msg.state.office?.id || 'main'}`) || '';
      } catch {}
      useGame.setState({ boardArea, status: 'online', me: msg.you, myName: msg.me.name, admin: msg.me.admin, owner: Boolean(msg.me.owner), chat: msg.chat, rtc: msg.rtc });
      // First visit: open the character creator.
      if (first && !msg.me.avatarChosen) useGame.setState({ modal: { type: 'character', first: true } });
      // After a reconnect, pick the open terminal's stream back up.
      const modal = useGame.getState().modal;
      if (modal?.type === 'terminal') send({ t: 'sub', agentId: modal.agentId });
      break;
    }
    case 'members':
      useGame.setState({ members: msg.members });
      break;
    case 'invited':
      useGame.setState({ invite: msg });
      break;
    case 'my-links':
      useGame.setState({ myLinks: msg });
      break;
    case 'access-requests':
      useGame.setState({ accessRequests: msg.requests || [] });
      break;
    case 'offices':
      useGame.setState({ officeList: msg.offices });
      break;
    case 'office-created':
      useGame.setState({ newOffice: msg });
      break;
    case 'state':
      applyState(msg.state);
      break;
    case 'pos':
      for (const [id, x, z, ry, y = 0] of msg.list) {
        if (id === useGame.getState().me) continue;
        positions.set(id, { x, y, z, ry });
      }
      break;
    case 'chat':
      useGame.setState((s) => ({
        chat: [...s.chat.slice(-99), msg.entry],
        bubbles: { ...s.bubbles, [msg.entry.playerId]: { text: msg.entry.text, at: Date.now() } },
      }));
      break;
    case 'screen': {
      if (msg.clear) {
        screens.delete(msg.agentId);
        break;
      }
      const sc = (!msg.full && screens.get(msg.agentId)) || { rows: [], version: 0 };
      for (const [i, row] of Object.entries(msg.rows)) sc.rows[+i] = row;
      sc.rows.length = msg.n;
      sc.n = msg.n;
      sc.cols = msg.cols;
      sc.version++;
      screens.set(msg.agentId, sc);
      break;
    }
    case 'rtc':
      rtcListeners.forEach((fn) => fn(msg.from, msg.data));
      break;
    case 'pty':
      ptyListeners.get(msg.agentId)?.forEach((fn) => fn(msg.data));
      break;
    case 'pty-size':
      sizeListeners.get(msg.agentId)?.forEach((fn) => fn(msg.cols, msg.rows));
      break;
    case 'scrollback':
      ptyListeners.get(msg.agentId)?.forEach((fn) => fn(msg.data, true));
      break;
    case 'board':
      // Ignore a work-items answer for an area filter that's no longer selected.
      if (msg.kind === 'issues' && (msg.area || '') !== (useGame.getState().boardArea || '')) break;
      useGame.setState((s) => ({ boards: { ...s.boards, [msg.kind]: msg } }));
      break;
    case 'playbook':
      useGame.setState((s) => ({ playbooks: { ...s.playbooks, [msg.agentId]: msg } }));
      break;
    case 'error':
      if (msg.fatal) useGame.setState({ error: msg.text });
      toast(msg.text, 'error');
      break;
    case 'event':
      if (msg.kind === 'toast') toast(msg.text, msg.tone);
      if (msg.kind === 'xp') addFx({ kind: 'xp', agentId: msg.agentId, amount: msg.amount, skill: msg.skill, reasons: msg.reasons });
      if (msg.kind === 'levelup') addFx({ kind: 'levelup', agentId: msg.agentId, level: msg.level, skill: msg.skill, overall: msg.overall });
      if (msg.kind === 'done') {
        const a = useGame.getState().agents[msg.agentId];
        if (a) toast(`✅ ${a.name} finished your task`, 'success');
      }
      break;
  }
}

// Boards. The work-items board can be narrowed to an Azure DevOps area path; the
// choice is remembered per office and used for every refresh.
const areaKey = () => `guild-area:${useGame.getState().office?.id || 'main'}`;
export function requestBoard(kind, { force = false } = {}) {
  send({ t: 'board', kind, force, ...(kind === 'issues' ? { area: useGame.getState().boardArea || '' } : {}) });
}
export function setBoardArea(area) {
  useGame.setState({ boardArea: area });
  try {
    localStorage.setItem(areaKey(), area);
  } catch {}
  requestBoard('issues', { force: true });
}

export const openModal = (modal) => useGame.setState({ modal });

// Forget this browser's key and return to the sign-in screen (to switch offices).
export function signOut() {
  try {
    localStorage.removeItem('guild-login');
  } catch {}
  creds = null;
  const sock = socket;
  socket = null;
  sock?.close();
  useGame.setState({ status: 'idle', error: null, modal: null, me: null, agents: {}, players: [], desks: {}, boards: {} });
}
export const closeModal = () => useGame.setState({ modal: null });
