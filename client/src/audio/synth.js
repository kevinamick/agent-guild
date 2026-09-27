// Procedural sound effects: every sound is built from noise, filters, oscillators
// and envelopes, so there are no audio files to ship or license. Each function
// plays one sound into `out` at time `at` with a `gain` and stereo `pan`.

let noise = null;
// One second of white noise, shared by every noisy sound (started at random offsets).
function noiseBuffer(ctx) {
  if (noise?.sampleRate === ctx.sampleRate) return noise;
  noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return noise;
}

const jitter = (v, amount) => v * (1 + (Math.random() * 2 - 1) * amount);

// gain -> pan -> out. Returns the node sounds connect into.
function route(ctx, out, gain, pan = 0) {
  const g = ctx.createGain();
  g.gain.value = gain;
  if (!pan) {
    g.connect(out);
    return g;
  }
  const p = ctx.createStereoPanner();
  p.pan.value = pan;
  g.connect(p).connect(out);
  return g;
}

// A filtered noise burst with a fast attack and exponential decay.
function noiseHit(ctx, dest, at, { dur, type = 'lowpass', freq, q = 0.7, gain = 1, attack = 0.002, sweepTo }) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, at);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, at + dur);
  f.Q.value = q;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, at);
  env.gain.linearRampToValueAtTime(gain, at + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(f).connect(env).connect(dest);
  src.start(at, Math.random() * 0.9, dur + 0.02);
}

// A pitched tone with an optional glide and a percussive envelope.
function tone(ctx, dest, at, { freq, dur, type = 'sine', gain = 1, attack = 0.004, glideTo }) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, at);
  if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, at + dur);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, at);
  env.gain.linearRampToValueAtTime(gain, at + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(env).connect(dest);
  o.start(at);
  o.stop(at + dur + 0.02);
}

// Soft shoe on the office floor, a hollow wooden knock on the stairs, a muffled
// pad on the corner office carpet.
export function footstep(ctx, out, { at = ctx.currentTime, gain = 1, pan = 0, surface = 'floor' } = {}) {
  const d = route(ctx, out, jitter(gain, 0.15), pan);
  if (surface === 'stairs') {
    noiseHit(ctx, d, at, { dur: 0.13, type: 'bandpass', freq: jitter(750, 0.1), q: 2.2, gain: 0.9 });
    tone(ctx, d, at, { freq: jitter(140, 0.08), glideTo: 85, dur: 0.12, gain: 0.7 });
    noiseHit(ctx, d, at, { dur: 0.03, type: 'bandpass', freq: 1900, q: 1.5, gain: 0.25 });
  } else if (surface === 'carpet') {
    noiseHit(ctx, d, at, { dur: 0.14, freq: jitter(420, 0.1), gain: 0.8, attack: 0.012 });
    tone(ctx, d, at, { freq: jitter(70, 0.08), glideTo: 45, dur: 0.1, gain: 0.35, attack: 0.01 });
  } else {
    noiseHit(ctx, d, at, { dur: 0.09, freq: jitter(950, 0.12), gain: 0.85, attack: 0.004 });
    tone(ctx, d, at, { freq: jitter(95, 0.08), glideTo: 55, dur: 0.08, gain: 0.5 });
    noiseHit(ctx, d, at + 0.004, { dur: 0.022, type: 'bandpass', freq: jitter(2600, 0.15), q: 1.2, gain: 0.12 });
  }
}

// One key press: a plastic click and a small bottom-out thock; spacebars are deeper.
export function keystroke(ctx, out, { at = ctx.currentTime, gain = 1, pan = 0, space = false } = {}) {
  const d = route(ctx, out, jitter(gain, 0.25), pan);
  if (space) {
    noiseHit(ctx, d, at, { dur: 0.05, type: 'bandpass', freq: jitter(1300, 0.1), q: 1.4, gain: 0.7 });
    noiseHit(ctx, d, at + 0.004, { dur: 0.05, type: 'bandpass', freq: 260, q: 1.5, gain: 0.6 });
    return;
  }
  noiseHit(ctx, d, at, { dur: 0.024, type: 'bandpass', freq: jitter(3200, 0.25), q: 1.6, gain: 0.8, attack: 0.001 });
  noiseHit(ctx, d, at + 0.003, { dur: 0.035, type: 'bandpass', freq: jitter(420, 0.2), q: 1.8, gain: 0.45 });
}

// New chat message: a quick two-step "blip".
export function chatBlip(ctx, out, { at = ctx.currentTime, gain = 1 } = {}) {
  const d = route(ctx, out, gain);
  tone(ctx, d, at, { freq: 880, dur: 0.09, gain: 0.35 });
  tone(ctx, d, at + 0.07, { freq: 1320, dur: 0.14, gain: 0.3 });
}

// Two soft bell notes (inharmonic partials, long decay): an agent finished.
export function doneChime(ctx, out, { at = ctx.currentTime, gain = 1, pan = 0 } = {}) {
  const d = route(ctx, out, gain, pan);
  [659.25, 987.77].forEach((f, i) => {
    const t = at + i * 0.14;
    tone(ctx, d, t, { freq: f, dur: 1.4, gain: 0.32 });
    tone(ctx, d, t, { freq: f * 2.76, dur: 0.5, gain: 0.07 });
    tone(ctx, d, t, { freq: f * 5.4, dur: 0.2, gain: 0.03 });
  });
}

// A bright rising arpeggio with a little sparkle on top.
export function levelUpJingle(ctx, out, { at = ctx.currentTime, gain = 1, pan = 0 } = {}) {
  const d = route(ctx, out, gain, pan);
  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((f, i) => {
    const last = i === notes.length - 1;
    tone(ctx, d, at + i * 0.09, { type: 'triangle', freq: f, dur: last ? 0.9 : 0.22, gain: 0.3 });
    if (last) tone(ctx, d, at + i * 0.09, { freq: f * 2, dur: 0.7, gain: 0.08 });
  });
  [2093, 2637, 3136].forEach((f, i) => tone(ctx, d, at + 0.36 + i * 0.06, { freq: f, dur: 0.25, gain: 0.05 }));
}

// Air moving past: a band of noise sweeping up and back down.
export function whoosh(ctx, out, { at = ctx.currentTime, gain = 1 } = {}) {
  const d = route(ctx, out, gain);
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = 0.9;
  f.frequency.setValueAtTime(300, at);
  f.frequency.exponentialRampToValueAtTime(1800, at + 0.16);
  f.frequency.exponentialRampToValueAtTime(500, at + 0.38);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(0.5, at + 0.12);
  env.gain.exponentialRampToValueAtTime(0.0001, at + 0.4);
  src.connect(f).connect(env).connect(d);
  src.start(at, Math.random() * 0.5, 0.42);
}
