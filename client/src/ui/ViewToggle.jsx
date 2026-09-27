import { useGame } from '../net.js';
import { useCameraMode, toggleFirstPerson } from '../scene/cameraMode.js';

// 🎥 / 👁️ in the HUD button row: third- or first-person view (V does the same).
export function ViewToggle() {
  const fp = useCameraMode((s) => s.firstPerson);
  return (
    <button
      className="btn"
      title={fp ? 'First person (V for third person)' : 'Third person (V for first person)'}
      aria-label={fp ? 'Switch to third-person view' : 'Switch to first-person view'}
      aria-pressed={fp}
      onClick={(e) => {
        toggleFirstPerson();
        e.currentTarget.blur(); // so Space/Enter don't re-press it while you walk
      }}
    >
      {fp ? '👁️' : '🎥'}
    </button>
  );
}

const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

// The first-person crosshair (lit when it's on something you can use) and, until
// the mouse is captured, a hint on how to look around.
export function FirstPersonOverlay() {
  const fp = useCameraMode((s) => s.firstPerson);
  const locked = useCameraMode((s) => s.locked);
  const aimed = useCameraMode((s) => s.aimed);
  const focus = useGame((s) => s.focus);
  const modal = useGame((s) => s.modal);
  if (!fp || modal) return null;
  return (
    <>
      <div className={`crosshair ${aimed && focus ? 'on' : ''}`} />
      {!locked && <div className="look-hint">{coarse ? 'Drag to look around' : 'Click to look around · Esc to release'}</div>}
    </>
  );
}
