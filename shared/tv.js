// Pure helpers for the screen-sharing TV (shared so they can be unit tested).
import { TV } from './layout.js';

// How close a ground-floor walker at (x, z) is to the TV, or null when out of
// reach. Anywhere along the screen's width counts; distance from the wall is
// weighted down so you can stand back (even behind the couch) and still use it.
export function tvReach(x, z) {
  const dx = x - TV.x;
  if (dx < 0) return null;
  const dz = Math.max(0, Math.abs(z - TV.z) - TV.w / 2 + 0.6);
  const d = Math.hypot(dx * 0.4, dz);
  return d < 2.4 ? d : null;
}

// Largest w x h with the source's aspect ratio that fits the box (letterbox / pillarbox).
export function fitContain(srcW, srcH, boxW, boxH) {
  if (!(srcW > 0 && srcH > 0)) return { w: boxW, h: boxH };
  const scale = Math.min(boxW / srcW, boxH / srcH);
  return { w: srcW * scale, h: srcH * scale };
}

// Shared audio is only heard near the TV: full (but modest) volume within a few
// steps, fading out across the room, silent upstairs.
export const TV_MAX_VOLUME = 0.5;
export function tvVolume(x, z, level = 'ground') {
  if (level !== 'ground') return 0;
  const dist = Math.hypot(x - TV.x, Math.max(0, Math.abs(z - TV.z) - TV.w / 2));
  const t = Math.min(1, Math.max(0, (dist - 3.5) / 8));
  return +(TV_MAX_VOLUME * (1 - t)).toFixed(3);
}
