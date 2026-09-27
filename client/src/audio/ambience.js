// The office soundscape: recorded office chatter, footsteps (yours and everyone else's),
// keyboards at desks where agents are working, and little cues for chat, finished
// tasks, level-ups and opening a terminal. It reads positions and game state on a
// timer, so the 3D scene doesn't need to know about sound at all.
import { useGame, positions, localPlayer } from '../net.js';
import { audioContext, sfxBus, sfxAudible, useSound } from './engine.js';
import { footstep, keystroke, chatBlip, doneChime, levelUpJingle, whoosh } from './synth.js';
import { sfxVolume, panFor, rightVector, surfaceAt } from './mix.js';
import { deskById } from '../../../shared/layout.js';

const TICK_MS = 40;
const STRIDE = 1.45; // world units per footstep, matching the walk animation
const MAX_TYPISTS = 4; // only the nearest working agents get keyboards

export function startSoundscape() {
  const walkers = new Map(); // id -> { x, z, travelled }
  const typists = new Map(); // agentId -> { next, left }
  const recent = new Map(); // de-dupes cues: key -> last played (ms)
  let bed = null;

  const listener = () => ({ x: localPlayer.x, y: localPlayer.y, z: localPlayer.z });
  const place = (src) => {
    const me = listener();
    return { gain: sfxVolume(me, src), pan: panFor(me, src, rightVector(localPlayer.level)) };
  };

  // A real office: people chatting, keyboards and mice (a CC0 field recording, see
  // client/public/sounds/CREDITS.md), cut into a seamless loop of over three
  // minutes, long enough that the repeat isn't noticeable.
  function startBed(ctx) {
    bed = { loading: true };
    fetch(`${import.meta.env.BASE_URL}sounds/office-chatter.mp3`)
      .then((res) => res.arrayBuffer())
      .then((data) => ctx.decodeAudioData(data))
      .then((buffer) => {
        if (!bed?.loading) return; // left the office while it loaded
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 3200;
        const gain = ctx.createGain();
        gain.gain.value = 0;
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.loop = true;
        src.connect(filter).connect(gain).connect(sfxBus());
        // Start somewhere random so everyone in the office isn't hearing the same moment.
        src.start(ctx.currentTime, Math.random() * buffer.duration);
        bed = { layers: [src], filter, gain };
      })
      .catch(() => (bed = { failed: true })); // no chatter is better than an error
  }

  function updateBed(ctx) {
    if (!bed.gain) return;
    const { players, agents } = useGame.getState();
    const { chatter, chatterVolume } = useSound.getState();
    // A fuller office sounds a little busier; the glass corner office muffles it.
    const busy = players.length + Object.values(agents).filter((a) => a.status === 'working').length;
    const level = 0.55 + 0.45 * Math.min(1, busy / 8);
    const up = localPlayer.level === 'mezz';
    const target = chatter ? chatterVolume * level * (up ? 0.6 : 1) : 0;
    bed.gain.gain.setTargetAtTime(target, ctx.currentTime, chatter ? 0.8 : 0.15);
    bed.filter.frequency.setTargetAtTime(up ? 900 : 3200, ctx.currentTime, 0.5);
  }

  // Count distance walked and play a step every STRIDE. Big jumps (spawning,
  // reconnecting) aren't walking. Positions update less often than we tick (remote
  // ones at ~12 Hz, ours once per rendered frame), so only a real pause resets the stride.
  function walk(ctx, id, p, isMe, now) {
    const w = walkers.get(id);
    if (!w) return walkers.set(id, { x: p.x, z: p.z, travelled: STRIDE * 0.6, movedAt: 0 });
    const moved = Math.hypot(p.x - w.x, p.z - w.z);
    w.x = p.x;
    w.z = p.z;
    if (moved > 3) return;
    if (moved < 0.001) {
      if (now - w.movedAt > 300) w.travelled = STRIDE * 0.6; // the first step comes soon after starting again
      return;
    }
    w.movedAt = now;
    w.travelled += moved;
    if (w.travelled < STRIDE) return;
    w.travelled -= STRIDE;
    const surface = surfaceAt(p.y);
    if (isMe) return footstep(ctx, sfxBus(), { gain: 0.5, surface });
    const { gain, pan } = place(p);
    if (gain > 0.02) footstep(ctx, sfxBus(), { gain: 0.4 * gain, pan, surface });
  }

  function type(ctx, now) {
    const { agents, desks } = useGame.getState();
    const me = listener();
    const near = Object.entries(desks)
      .filter(([, agentId]) => agents[agentId]?.status === 'working')
      .map(([deskId, agentId]) => {
        const d = deskById(+deskId);
        return d && { agentId, at: { x: d.seatX, y: 0, z: d.seatZ } };
      })
      .filter(Boolean)
      .sort((a, b) => Math.hypot(a.at.x - me.x, a.at.z - me.z) - Math.hypot(b.at.x - me.x, b.at.z - me.z))
      .slice(0, MAX_TYPISTS);
    const active = new Set(near.map((n) => n.agentId));
    for (const id of typists.keys()) if (!active.has(id)) typists.delete(id);
    for (const { agentId, at } of near) {
      let s = typists.get(agentId);
      if (!s) typists.set(agentId, (s = { next: now + Math.random() * 600, left: 0 }));
      if (now < s.next) continue;
      // Bursts of keys with thinking pauses between them.
      if (s.left > 0) {
        s.left--;
        s.next = now + 70 + Math.random() * 120;
      } else {
        s.left = 4 + Math.floor(Math.random() * 16);
        s.next = now + 400 + Math.random() * 2200;
      }
      const { gain, pan } = place(at);
      if (gain > 0.02) keystroke(ctx, sfxBus(), { gain: 0.35 * gain, pan, space: Math.random() < 0.15 });
    }
  }

  function tick() {
    const ctx = audioContext();
    if (!sfxAudible()) return;
    if (!bed) startBed(ctx);
    updateBed(ctx);
    const now = performance.now();
    const me = useGame.getState().me;
    walk(ctx, 'me', localPlayer, true, now);
    for (const [id, p] of positions) if (id !== me) walk(ctx, id, p, false, now);
    for (const id of walkers.keys()) if (id !== 'me' && !positions.has(id)) walkers.delete(id);
    type(ctx, now);
  }

  // Once per `key` within `ms`, e.g. a skill and an overall level-up arriving together.
  const once = (key, ms) => {
    const now = performance.now();
    if (now - (recent.get(key) || -Infinity) < ms) return false;
    recent.set(key, now);
    return true;
  };

  function react(s, prev) {
    if (!sfxAudible()) return;
    const ctx = audioContext();
    const out = sfxBus();
    if (s.chat !== prev.chat) {
      const last = s.chat[s.chat.length - 1];
      // Only live messages: the history that arrives on (re)connect is silent.
      if (last && last.id !== prev.chat[prev.chat.length - 1]?.id && Date.now() - last.at < 5000) {
        chatBlip(ctx, out, { gain: last.playerId === s.me ? 0.35 : 0.6 });
      }
    }
    if (s.fx !== prev.fx) {
      const old = new Set(prev.fx.map((f) => f.id));
      for (const f of s.fx) {
        if (f.kind !== 'levelup' || old.has(f.id) || !once(`lv:${f.agentId}`, 1500)) continue;
        const desk = deskOf(s, f.agentId);
        const { pan } = desk ? place(desk) : { pan: 0 };
        levelUpJingle(ctx, out, { gain: 0.7, pan });
      }
    }
    if (s.agents !== prev.agents) {
      for (const a of Object.values(s.agents)) {
        // Only a live finish (working, or waiting on a permission prompt, then done),
        // not agents that were already done when we walked in.
        const was = prev.agents[a.id]?.status;
        if (a.status !== 'done' || (was !== 'working' && was !== 'waiting') || !once(`done:${a.id}`, 3000)) continue;
        // Heard office-wide, louder when you're near the desk.
        const desk = deskOf(s, a.id);
        const { gain, pan } = desk ? place(desk) : { gain: 0, pan: 0 };
        doneChime(ctx, out, { gain: 0.35 + 0.45 * gain, pan });
      }
    }
    if (s.modal && s.modal.type !== prev.modal?.type) whoosh(ctx, out, { gain: 0.25 });
  }

  const timer = setInterval(tick, TICK_MS);
  const unsub = useGame.subscribe(react);
  return () => {
    clearInterval(timer);
    unsub();
    for (const src of bed?.layers || []) {
      try {
        src.stop();
      } catch {}
    }
    bed?.gain?.disconnect();
    bed = null;
  };
}

function deskOf(state, agentId) {
  const deskId = Object.keys(state.desks).find((d) => state.desks[d] === agentId);
  const d = deskId && deskById(+deskId);
  return d && { x: d.seatX, y: 0, z: d.seatZ };
}
