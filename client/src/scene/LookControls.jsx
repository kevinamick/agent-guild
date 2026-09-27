import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { ROOM, DOOR, WALL_HEIGHT } from '../../../shared/layout.js';
import { useCameraMode, turn, look } from './cameraMode.js';

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
  return <FrontWall />;
}

// The room has no front wall so the third-person camera can look in from
// outside. From inside, in first person, you'd see the void, so put one up
// (with the entrance door) whenever the camera is actually inside.
const W = ROOM.maxX - ROOM.minX;
const DOOR_W = 3;
const DOOR_H = 2.7;
const Z = ROOM.maxZ + 0.15;
// Its inside faces away from the sun, so a little glow keeps it from looking dingier than the other walls.
const WALL = { color: '#f5ead7', emissive: '#f5ead7', emissiveIntensity: 0.22 };

function FrontWall() {
  const group = useRef();
  useFrame(({ camera }) => {
    if (group.current) group.current.visible = look.blend > 0.5 && camera.position.z < ROOM.maxZ;
  });
  const sideW = (W + 0.6 - DOOR_W) / 2;
  return (
    <group ref={group} visible={false}>
      {[-1, 1].map((sd) => (
        <mesh key={sd} position={[DOOR.x + sd * (DOOR_W / 2 + sideW / 2), WALL_HEIGHT / 2, Z]} receiveShadow>
          <boxGeometry args={[sideW, WALL_HEIGHT, 0.3]} />
          <meshStandardMaterial {...WALL} />
        </mesh>
      ))}
      <mesh position={[DOOR.x, (WALL_HEIGHT + DOOR_H) / 2, Z]}>
        <boxGeometry args={[DOOR_W, WALL_HEIGHT - DOOR_H, 0.3]} />
        <meshStandardMaterial {...WALL} />
      </mesh>
      {/* the door itself, a little inset, and the skirting line the other walls have */}
      <mesh position={[DOOR.x, DOOR_H / 2, Z + 0.05]}>
        <boxGeometry args={[DOOR_W, DOOR_H, 0.2]} />
        <meshStandardMaterial color="#c2681c" emissive="#c2681c" emissiveIntensity={0.15} roughness={0.7} />
      </mesh>
      <mesh position={[DOOR.x + 1, 1.2, Z - 0.08]}>
        <sphereGeometry args={[0.08, 10, 8]} />
        <meshStandardMaterial color="#fde68a" metalness={0.6} roughness={0.3} />
      </mesh>
      {[-1, 1].map((sd) => (
        <mesh key={sd} position={[DOOR.x + sd * (DOOR_W / 2 + sideW / 2), 0.2, ROOM.maxZ - 0.02]}>
          <boxGeometry args={[sideW, 0.4, 0.06]} />
          <meshStandardMaterial color="#e8834a" />
        </mesh>
      ))}
    </group>
  );
}
