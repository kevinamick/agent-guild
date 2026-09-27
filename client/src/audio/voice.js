// Proximity voice chat: a WebRTC mesh between everyone who joined voice in this
// office, over the shared signaling relay (channel 'voice'). Each remote voice
// runs through Web Audio, where its volume and stereo position follow the
// distance between you and them in the office.
//
// Signaling: joining sends { type: 'hello' } to every player; those already in
// voice answer by connecting (their negotiationneeded sends an offer). Offers and
// answers use the "perfect negotiation" pattern, so both sides may offer at once
// (two people joining together, ICE restarts) without getting stuck.
import { create } from 'zustand';
import { useGame, positions, localPlayer, onRtc, sendRtc, rtcConfig, toast } from '../net.js';
import { audioContext, unlockAudio, voiceBus } from './engine.js';
import { voiceVolume, panFor, rightVector, speakingState } from './mix.js';

export const useVoice = create(() => ({
  joined: false,
  joining: false,
  muted: false,
  peers: {}, // playerId -> { state, muted }
  speaking: {}, // playerId -> true while their level is up (including yours)
}));

const peers = new Map(); // playerId -> peer (see connect())
let local = null; // { stream, meter }
let myId = null;
let timer = null;
let cleanups = [];
const levels = new Map(); // playerId -> speakingState

const signal = (to, data) => sendRtc(to, { channel: 'voice', ...data });
const setPeer = (id, patch) =>
  useVoice.setState((s) => ({ peers: { ...s.peers, [id]: { ...s.peers[id], ...patch } } }));

export async function joinVoice() {
  const v = useVoice.getState();
  if (v.joined || v.joining) return;
  useVoice.setState({ joining: true });
  unlockAudio();
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (e) {
    useVoice.setState({ joining: false });
    toast(e?.name === 'NotAllowedError' ? 'Voice needs microphone access. Allow it in the browser and try again.' : `Couldn't open your microphone (${e?.message || e}).`, 'error');
    return;
  }
  // Left (or signed out) while the permission prompt was open.
  if (!useVoice.getState().joining) return stream.getTracks().forEach((t) => t.stop());
  local = { stream, meter: meter(stream) };
  myId = useGame.getState().me;
  cleanups = [onRtc(onSignal), useGame.subscribe(onGame)];
  timer = setInterval(tick, 100);
  useVoice.setState({ joined: true, joining: false, muted: false, peers: {}, speaking: {} });
  hello();
}

export function leaveVoice() {
  const v = useVoice.getState();
  if (!v.joined && !v.joining) return;
  for (const id of [...peers.keys()]) {
    signal(id, { type: 'bye' });
    drop(id);
  }
  cleanups.forEach((fn) => fn());
  cleanups = [];
  clearInterval(timer);
  local?.stream.getTracks().forEach((t) => t.stop());
  local?.meter?.source.disconnect();
  local = null;
  levels.clear();
  useVoice.setState({ joined: false, joining: false, muted: false, peers: {}, speaking: {} });
}

export function toggleMute() {
  if (!local) return;
  const muted = !useVoice.getState().muted;
  local.stream.getAudioTracks().forEach((t) => (t.enabled = !muted));
  useVoice.setState({ muted });
  for (const id of peers.keys()) signal(id, { type: 'mute', muted });
}

function hello() {
  const { players, me } = useGame.getState();
  for (const p of players) if (p.id !== me) signal(p.id, { type: 'hello' });
}

function onGame(s, prev) {
  if (s.status === 'closed' || s.status === 'idle') return leaveVoice();
  // A reconnect gives us a new player id; everyone dropped the old one, so start over.
  if (s.me && s.me !== myId) {
    myId = s.me;
    for (const id of [...peers.keys()]) drop(id);
    return hello();
  }
  if (s.players !== prev.players) {
    const here = new Set(s.players.map((p) => p.id));
    for (const id of [...peers.keys()]) if (!here.has(id)) drop(id);
  }
}

function onSignal(from, data) {
  if (data?.channel !== 'voice' || !local) return;
  if (!useGame.getState().players.some((p) => p.id === from)) return;
  switch (data.type) {
    case 'hello':
      // They just joined (or reconnected): replace any stale connection.
      if (peers.has(from)) drop(from);
      connect(from);
      break;
    case 'bye':
      drop(from);
      break;
    case 'mute':
      if (peers.has(from)) setPeer(from, { muted: Boolean(data.muted) });
      break;
    case 'desc':
      onDescription(from, data.description);
      // Offers and answers carry the sender's mute state, so it's known from the start.
      if (peers.has(from)) setPeer(from, { muted: Boolean(data.muted) });
      break;
    case 'ice':
      peers.get(from)?.pc.addIceCandidate(data.candidate).catch((e) => {
        if (!peers.get(from)?.ignoreOffer) console.warn('voice: ICE candidate', e);
      });
      break;
  }
}

function connect(id) {
  const pc = new RTCPeerConnection(rtcConfig());
  // Perfect negotiation roles: the polite side yields when both offer at once.
  const peer = { id, pc, polite: myId > id, makingOffer: false, ignoreOffer: false, audio: null };
  peers.set(id, peer);
  setPeer(id, { state: 'connecting', muted: false });
  for (const track of local.stream.getTracks()) pc.addTrack(track, local.stream);
  pc.onnegotiationneeded = async () => {
    try {
      peer.makingOffer = true;
      await pc.setLocalDescription();
      signal(id, { type: 'desc', description: pc.localDescription, muted: useVoice.getState().muted });
    } catch (e) {
      console.warn('voice: offer', e);
    } finally {
      peer.makingOffer = false;
    }
  };
  pc.onicecandidate = ({ candidate }) => candidate && signal(id, { type: 'ice', candidate });
  pc.ontrack = (e) => play(peer, e.streams[0] || new MediaStream([e.track]));
  pc.onconnectionstatechange = () => {
    if (peers.get(id) !== peer) return;
    const state = pc.connectionState;
    if (state === 'failed') pc.restartIce();
    if (state === 'closed') return drop(id);
    setPeer(id, { state });
  };
  return peer;
}

async function onDescription(from, description) {
  if (!description?.type) return;
  let peer = peers.get(from);
  if (!peer) {
    if (description.type !== 'offer') return;
    peer = connect(from);
  }
  const { pc } = peer;
  const collision = description.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
  peer.ignoreOffer = !peer.polite && collision;
  if (peer.ignoreOffer) return;
  try {
    // No await before this: ICE candidates that arrive meanwhile queue behind it.
    await pc.setRemoteDescription(description);
    if (description.type === 'offer') {
      await pc.setLocalDescription();
      signal(from, { type: 'desc', description: pc.localDescription, muted: useVoice.getState().muted });
    }
  } catch (e) {
    console.warn('voice: negotiation', e);
  }
}

function drop(id) {
  const peer = peers.get(id);
  if (!peer) return;
  peers.delete(id);
  levels.delete(id);
  peer.pc.onconnectionstatechange = null;
  peer.pc.close();
  stopAudio(peer);
  useVoice.setState((s) => {
    const { [id]: _, ...rest } = s.peers;
    const { [id]: __, ...speaking } = s.speaking;
    return { peers: rest, speaking };
  });
}

// An AnalyserNode for the speaking indicator.
function meter(stream) {
  const ctx = audioContext();
  if (!ctx) return null;
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  return { source, analyser, buf: new Float32Array(analyser.fftSize) };
}

function level(m) {
  if (!m) return 0;
  m.analyser.getFloatTimeDomainData(m.buf);
  let s = 0;
  for (const v of m.buf) s += v * v;
  return Math.sqrt(s / m.buf.length);
}

function play(peer, stream) {
  if (peer.audio?.stream === stream) return;
  stopAudio(peer);
  // Chrome only feeds a remote WebRTC stream into Web Audio while a media element
  // is also playing it, so keep a muted <audio> element attached.
  const el = new Audio();
  el.srcObject = stream;
  el.muted = true;
  el.play().catch(() => {});
  const ctx = audioContext();
  if (!ctx) {
    // No Web Audio: plain element playback, distance still sets its volume.
    el.muted = false;
    peer.audio = { stream, el };
    return;
  }
  const m = meter(stream);
  const gain = ctx.createGain();
  gain.gain.value = 0;
  const panner = ctx.createStereoPanner();
  m.source.connect(gain).connect(panner).connect(voiceBus());
  peer.audio = { stream, el, meter: m, gain, panner };
}

function stopAudio(peer) {
  const a = peer.audio;
  if (!a) return;
  a.el.srcObject = null;
  a.meter?.source.disconnect();
  a.gain?.disconnect();
  a.panner?.disconnect();
  peer.audio = null;
}

// Distance -> volume and pan for every voice, and the speaking indicators.
function tick() {
  const ctx = audioContext();
  const now = performance.now();
  const me = { x: localPlayer.x, y: localPlayer.y, z: localPlayer.z };
  const right = rightVector(localPlayer.level);
  const speaking = {};
  for (const peer of peers.values()) {
    const a = peer.audio;
    const p = positions.get(peer.id);
    if (!a || !p) continue;
    const vol = voiceVolume(me, p);
    if (a.gain) {
      a.gain.gain.setTargetAtTime(vol, ctx.currentTime, 0.12);
      a.panner.pan.setTargetAtTime(panFor(me, p, right), ctx.currentTime, 0.12);
    } else {
      a.el.volume = vol;
    }
    const st = speakingState(levels.get(peer.id), level(a.meter), now);
    levels.set(peer.id, st);
    if (st.speaking) speaking[peer.id] = true;
  }
  const mine = speakingState(levels.get(myId), useVoice.getState().muted ? 0 : level(local?.meter), now);
  levels.set(myId, mine);
  if (mine.speaking) speaking[myId] = true;
  const prev = useVoice.getState().speaking;
  const keys = Object.keys(speaking);
  if (keys.length !== Object.keys(prev).length || keys.some((k) => !prev[k])) useVoice.setState({ speaking });
}

// For tests and debugging: connection states of the current voice peers.
if (typeof window !== 'undefined') {
  window.__guildVoice = () => [...peers.values()].map((p) => ({ id: p.id, state: p.pc.connectionState, tracks: p.pc.getReceivers().filter((r) => r.track?.readyState === 'live').length, volume: p.audio?.gain?.gain.value }));
}
