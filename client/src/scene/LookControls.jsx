import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { useCameraMode, turn } from './cameraMode.js';

const LOCK_SENS = 0.0022; // radians per pixel of mouse movement (pointer lock)
const DRAG_SENS = 0.005; // drag-to-look moves fewer pixels, so turn more per pixel

// First-person mouse look: click the 3D view to capture the pointer (Esc gives
// it back); where pointer lock isn't available (touch, some trackpads, headless
// browsers) dragging on the view turns instead.
export function LookControls() {
  const gl = useThree((s) => s.gl);
  const fp = useCameraMode((s) => s.firstPerson);
  useEffect(() => {
    document.body.dataset.fp = fp ? '1' : '';
    if (!fp) return;
    const el = gl.domElement;
    let drag = null;
    const down = (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      if (e.pointerType === 'mouse' && el.requestPointerLock && document.pointerLockElement !== el) {
        try {
          el.requestPointerLock()?.catch?.(() => {}); // refused (e.g. right after Esc): dragging still works
        } catch {}
      }
    };
    const move = (e) => {
      if (document.pointerLockElement === el) return turn(-e.movementX * LOCK_SENS, -e.movementY * LOCK_SENS);
      if (!drag || e.pointerId !== drag.id) return;
      turn(-(e.clientX - drag.x) * DRAG_SENS, -(e.clientY - drag.y) * DRAG_SENS);
      drag.x = e.clientX;
      drag.y = e.clientY;
    };
    const up = (e) => {
      if (drag?.id === e.pointerId) drag = null;
    };
    el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (document.pointerLockElement === el) document.exitPointerLock();
    };
  }, [fp, gl]);
  return null;
}
