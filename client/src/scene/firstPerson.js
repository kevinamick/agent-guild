// Pure math for the first-person camera (no three.js, no DOM), so it can be unit tested.
//
// Angles follow the avatar's convention: yaw is `localPlayer.ry`, and a player
// with yaw `ry` faces (sin ry, cos ry) in (x, z). ry = PI faces the back wall (-z).
// Pitch is up-positive and only moves the camera.

export const EYE_HEIGHT = 1.6;
export const MAX_PITCH = (80 * Math.PI) / 180;
// How far off the center of view (radians, see viewOffset) something may be and
// still count as "looked at". Wall items are measured to their nearest edge, so
// they get a tighter cone than desks and agents (measured to a single point).
export const AIM_CONE = 0.5;
export const AIM_CONE_WALL = 0.3;

export const clampPitch = (p) => Math.max(-MAX_PITCH, Math.min(MAX_PITCH, p));
export const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// Unit direction the camera looks along.
export function lookDirection(yaw, pitch) {
  const c = Math.cos(pitch);
  return { x: Math.sin(yaw) * c, y: Math.sin(pitch), z: Math.cos(yaw) * c };
}

// World-space walking direction for the held keys: W/S along the look yaw, A/D
// strafe. Returns a unit vector, or null when the keys cancel out / none are held.
export function moveVector(yaw, keys) {
  let fwd = 0;
  let side = 0;
  if (keys.has('w') || keys.has('arrowup')) fwd += 1;
  if (keys.has('s') || keys.has('arrowdown')) fwd -= 1;
  if (keys.has('d') || keys.has('arrowright')) side += 1;
  if (keys.has('a') || keys.has('arrowleft')) side -= 1;
  if (!fwd && !side) return null;
  // forward = (sin, cos); right = forward turned a quarter to the right.
  const dx = fwd * Math.sin(yaw) - side * Math.cos(yaw);
  const dz = fwd * Math.cos(yaw) + side * Math.sin(yaw);
  const len = Math.hypot(dx, dz);
  return { dx: dx / len, dz: dz / len };
}

// The point on a target to aim at. Wall items (boards, pictures, the TV) are
// big flat rectangles: aim at where the view ray meets their wall, clamped to
// their edges, so looking anywhere on a wide board counts as dead center.
function aimPoint(t, eye, dir) {
  if (!t.wall) return t;
  const { axis, half, halfH = 0.8 } = t.wall;
  // axis 'z': the item spans z on a wall at fixed x (side walls); 'x': spans x at fixed z.
  const n = axis === 'z' ? dir.x : dir.z;
  const dist = axis === 'z' ? t.x - eye.x : t.z - eye.z;
  let along = axis === 'z' ? t.z : t.x;
  let y = t.y;
  if (Math.abs(n) > 1e-6 && dist / n > 0) {
    const k = dist / n;
    const hit = axis === 'z' ? eye.z + dir.z * k : eye.x + dir.x * k;
    along += Math.max(-half, Math.min(half, hit - along));
    y += Math.max(-halfH, Math.min(halfH, eye.y + dir.y * k - y));
  }
  return axis === 'z' ? { x: t.x, y, z: along } : { x: along, y, z: t.z };
}

// Angular distance from the center of view to a target. Pitch counts fully for
// wall items; for things on the floor (desks, agents) it's weighted down, since
// you naturally look straight ahead at someone sitting a step away.
export function viewOffset(t, eye, yaw, pitch) {
  const dir = lookDirection(yaw, pitch);
  const p = aimPoint(t, eye, dir);
  const dx = p.x - eye.x;
  const dz = p.z - eye.z;
  const yawTo = Math.atan2(dx, dz);
  const pitchTo = Math.atan2(p.y - eye.y, Math.hypot(dx, dz));
  const w = t.wall ? 1 : 0.35;
  return Math.hypot(wrapAngle(yawTo - yaw), (pitchTo - pitch) * w);
}

// Choose among in-reach targets ({ focus, d, x, y, z, wall? }, d = reach distance):
// the one nearest the center of view inside the aim cone, else the nearest one.
export function pickTarget(targets, eye, yaw, pitch) {
  let aimed = null;
  let aimedOff = Infinity;
  let near = null;
  for (const t of targets) {
    if (!near || t.d < near.d) near = t;
    const off = viewOffset(t, eye, yaw, pitch);
    if (off < (t.wall ? AIM_CONE_WALL : AIM_CONE) && off < aimedOff) {
      aimedOff = off;
      aimed = t;
    }
  }
  if (aimed) return { focus: aimed.focus, aimed: true };
  return { focus: near ? near.focus : null, aimed: false };
}

// Smoothstep for the camera's third <-> first person blend.
export const ease = (t) => t * t * (3 - 2 * t);
