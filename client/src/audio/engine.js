// The one AudioContext and its two buses: effects/ambience (the 🔊 toggle and
// volume slider) and voice chat (its own slider, so muting the office noise never
// silences a coworker). Browsers only allow audio after a user gesture, so the
// context is created on the first click or keypress (the "Walk in" click counts).
import { create } from 'zustand';

const SAVED = 'guild-sound';

function readSaved() {
  try {
    return JSON.parse(localStorage.getItem(SAVED) || '{}');
  } catch {
    return {};
  }
}

const saved = readSaved();
export const useSound = create(() => ({
  on: saved.on !== false,
  volume: typeof saved.volume === 'number' ? saved.volume : 0.5,
  voiceVolume: typeof saved.voiceVolume === 'number' ? saved.voiceVolume : 1,
  // The background office chatter, separate from footsteps and cues.
  chatter: saved.chatter !== false,
  chatterVolume: typeof saved.chatterVolume === 'number' ? saved.chatterVolume : 0.6,
  running: false, // the AudioContext is unlocked and playing
}));

let ctx = null;
let sfx = null;
let voice = null;

export const audioContext = () => ctx;
export const sfxBus = () => sfx;
export const voiceBus = () => voice;
// Effects are worth scheduling only when they'd be heard.
export const sfxAudible = () => Boolean(ctx && ctx.state === 'running' && useSound.getState().on && useSound.getState().volume > 0);

function applyVolumes() {
  if (!ctx) return;
  const { on, volume, voiceVolume } = useSound.getState();
  sfx.gain.setTargetAtTime(on ? volume : 0, ctx.currentTime, 0.05);
  voice.gain.setTargetAtTime(voiceVolume, ctx.currentTime, 0.05);
}

// Create (or wake) the context. Must run inside a user gesture the first time.
export function unlockAudio() {
  const Ctx = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!Ctx) return null;
  if (!ctx) {
    ctx = new Ctx({ latencyHint: 'interactive' });
    // A gentle limiter so a chime on top of a busy office never clips.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.ratio.value = 6;
    limiter.connect(ctx.destination);
    sfx = ctx.createGain();
    sfx.gain.value = 0;
    sfx.connect(limiter);
    voice = ctx.createGain();
    voice.connect(ctx.destination);
    ctx.onstatechange = () => useSound.setState({ running: ctx.state === 'running' });
    applyVolumes();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  useSound.setState({ running: ctx.state === 'running' });
  return ctx;
}

export function setSound(patch) {
  useSound.setState(patch);
  const { on, volume, voiceVolume, chatter, chatterVolume } = useSound.getState();
  try {
    localStorage.setItem(SAVED, JSON.stringify({ on, volume, voiceVolume, chatter, chatterVolume }));
  } catch {}
  applyVolumes();
}

if (typeof window !== 'undefined') {
  // Keep listening: some browsers suspend the context again (e.g. after the tab
  // was in the background), and any later gesture should bring it back.
  const wake = () => {
    if (!ctx || ctx.state !== 'running') unlockAudio();
  };
  window.addEventListener('pointerdown', wake, true);
  window.addEventListener('click', wake, true); // keyboard-activated buttons too
  window.addEventListener('keydown', wake, true);
}
