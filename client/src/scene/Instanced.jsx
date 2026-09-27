import { useLayoutEffect, useRef } from 'react';
import { setInstances } from './decor.js';

// One draw call for many copies of a mesh: items are { p: [x, y, z], r, s, color } (see setInstances).
export function Instanced({ geometry, material, items, castShadow = false, receiveShadow = false, ...props }) {
  const ref = useRef();
  useLayoutEffect(() => setInstances(ref.current, items), [items]);
  if (!items.length) return null;
  return <instancedMesh ref={ref} args={[geometry, material, items.length]} castShadow={castShadow} receiveShadow={receiveShadow} {...props} />;
}
