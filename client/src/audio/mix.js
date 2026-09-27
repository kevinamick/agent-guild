// Pure mixing math for spatial sound and proximity voice: how loud and how far
// left/right something at `source` sounds to a listener. No browser APIs here.
import { levelForY } from '../../../shared/layout.js';

// Proximity voice: full volume within VOICE_NEAR world units, silent past VOICE_FAR.
export const VOICE_NEAR = 4;
export const VOICE_FAR = 14;
// The corner office floor sits between it and the ground floor, so sound between
// them carries this many times less far (only someone right below is faintly heard).
export const FLOOR_DAMPING = 2.5;

// 1 inside `near`, 0 beyond `far`, and an ease-out curve in between (drops quickly
// at first, like loudness does with distance, then fades out softly).
export function falloff(d, near, far) {
  if (d <= near) return 1;
  if (d >= far) return 0;
  const t = (d - near) / (far - near);
  return (1 - t) * (1 - t);
}

const floorApart = (a, b) => {
  const fa = levelForY(a.y || 0);
  const fb = levelForY(b.y || 0);
  return (fa === 'mezz' && fb === 'ground') || (fa === 'ground' && fb === 'mezz');
};

// Distance as the ear hears it: straight-line, stretched when a floor is in the way.
// The stairs count as both floors, so people on them hear either side normally.
export function hearingDistance(a, b) {
  const d = Math.hypot(a.x - b.x, (a.y || 0) - (b.y || 0), a.z - b.z);
  return floorApart(a, b) ? d * FLOOR_DAMPING : d;
}

export function voiceVolume(listener, source) {
  return falloff(hearingDistance(listener, source), VOICE_NEAR, VOICE_FAR);
}

// Footsteps, typing, chimes: same shape, tighter range by default.
export function sfxVolume(listener, source, near = 1.5, far = 12) {
  return falloff(hearingDistance(listener, source), near, far);
}

// The camera never turns with the player: on the ground floor screen-right is +x;
// upstairs it looks diagonally across the room (World.jsx LOOK_UP = dx -10, dz -13),
// so screen-right is that look direction turned 90 degrees.
const UP_RIGHT = [13 / Math.hypot(13, 10), -10 / Math.hypot(13, 10)];
export function rightVector(level) {
  return level === 'mezz' ? UP_RIGHT : [1, 0];
}

// Stereo position in [-0.8, 0.8]: how far the source is to the listener's screen
// left/right. Never fully one-sided, which sounds odd on headphones.
export function panFor(listener, source, right = [1, 0], width = 6) {
  const side = ((source.x - listener.x) * right[0] + (source.z - listener.z) * right[1]) / width;
  return Math.max(-0.8, Math.min(0.8, side));
}

// What a footstep sounds like on the floor at height y.
export function surfaceAt(y) {
  const level = levelForY(y || 0);
  return level === 'stairs' ? 'stairs' : level === 'mezz' ? 'carpet' : 'floor';
}

// Speaking detection with a short hold, so the indicator doesn't flicker between
// words. Returns the new { speaking, until } for one level sample at time `now` (ms).
export const SPEAK_THRESHOLD = 0.012;
export function speakingState(prev, rms, now, hold = 350) {
  if (rms >= SPEAK_THRESHOLD) return { speaking: true, until: now + hold };
  return { speaking: now < (prev?.until || 0), until: prev?.until || 0 };
}
