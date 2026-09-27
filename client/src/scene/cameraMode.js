// Third- vs first-person camera: the choice (remembered per browser) plus the
// first-person look angles, which change every frame and so live outside React.
import { create } from 'zustand';
import { localPlayer, useGame } from '../net.js';
import { clampPitch } from './firstPerson.js';

const SAVED = 'guild-first-person';

function readSaved() {
  try {
    return localStorage.getItem(SAVED) === '1';
  } catch {
    return false;
  }
}

export const useCameraMode = create(() => ({
  firstPerson: readSaved(),
  locked: false, // pointer lock is active (mouse look)
  aimed: false, // the current focus is what the crosshair is on (not just the nearest thing)
}));

// yaw/pitch are where the camera points; wantYaw/wantPitch are where the mouse
// says to point (the camera eases toward them for a little smoothing). blend runs
// 0 (third person) to 1 (first person) while the camera glides between the two.
export const look = { yaw: localPlayer.ry, pitch: 0, wantYaw: localPlayer.ry, wantPitch: 0, blend: 0 };

export function setFirstPerson(on) {
  if (on === useCameraMode.getState().firstPerson) return;
  // Start looking the way the avatar already faces, so nothing jumps.
  look.yaw = look.wantYaw = localPlayer.ry;
  look.pitch = look.wantPitch = 0;
  if (!on && typeof document !== 'undefined' && document.pointerLockElement) document.exitPointerLock();
  useCameraMode.setState({ firstPerson: on, aimed: false });
  try {
    localStorage.setItem(SAVED, on ? '1' : '0');
  } catch {}
}

export const toggleFirstPerson = () => setFirstPerson(!useCameraMode.getState().firstPerson);

export function turn(dYaw, dPitch) {
  look.wantYaw += dYaw;
  look.wantPitch = clampPitch(look.wantPitch + dPitch);
}

// A modal or a chat box needs the mouse and keys back.
if (typeof document !== 'undefined') {
  useGame.subscribe((s, prev) => s.modal && !prev.modal && document.pointerLockElement && document.exitPointerLock());
  document.addEventListener('focusin', (e) => {
    if (document.pointerLockElement && e.target.closest?.('input, textarea, .xterm')) document.exitPointerLock();
  });
  document.addEventListener('pointerlockchange', () => useCameraMode.setState({ locked: Boolean(document.pointerLockElement) }));
}
