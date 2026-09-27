import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { PICTURE_SPOTS, PICTURE_MAX } from '../../../shared/layout.js';
import { useGame, SERVER_HTTP } from '../net.js';

const BORDER = 0.09;
const WOOD = '#5b4636';
const loader = new THREE.TextureLoader(); // crossOrigin 'anonymous': images come from the office server

// The picture's size on the wall: as large as fits inside the frame, same aspect ratio.
function fit(aspect) {
  const maxW = PICTURE_MAX.w - BORDER * 2;
  const maxH = PICTURE_MAX.h - BORDER * 2;
  return aspect > maxW / maxH ? [maxW, maxW / aspect] : [maxH * aspect, maxH];
}

function usePictureTexture(url) {
  const [tex, setTex] = useState(null);
  useEffect(() => {
    let alive = true;
    let loaded = null;
    loader.load(
      SERVER_HTTP + url,
      (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 4;
        loaded = t;
        if (alive) setTex(t);
        else t.dispose();
      },
      undefined,
      () => alive && setTex(null),
    );
    return () => {
      alive = false;
      loaded?.dispose();
    };
  }, [url]);
  return tex;
}

function Framed({ picture }) {
  const tex = usePictureTexture(picture.url);
  const [w, h] = fit(tex ? tex.image.width / tex.image.height : 4 / 3);
  return (
    <group>
      <mesh position={[0, 0, -0.09]} castShadow>
        <boxGeometry args={[w + BORDER * 2, h + BORDER * 2, 0.1]} />
        <meshStandardMaterial color={WOOD} roughness={0.7} />
      </mesh>
      <mesh position={[0, 0, -0.035]}>
        <planeGeometry args={[w, h]} />
        {tex ? <meshBasicMaterial map={tex} toneMapped={false} /> : <meshStandardMaterial color="#fffaf0" />}
      </mesh>
    </group>
  );
}

// An empty spot: a faint outline and a nail, so people notice they can hang something.
function EmptySpot({ focused }) {
  const color = focused ? '#f97352' : '#d8c6a6';
  const w = 1.5;
  const h = 1.1;
  const t = 0.035;
  return (
    <group position={[0, 0, -0.13]}>
      {[[0, h / 2, w, t], [0, -h / 2, w, t], [-w / 2, 0, t, h], [w / 2, 0, t, h]].map(([x, y, sw, sh], i) => (
        <mesh key={i} position={[x, y, 0]}>
          <boxGeometry args={[sw, sh, 0.01]} />
          <meshStandardMaterial color={color} />
        </mesh>
      ))}
      <mesh position={[0, h / 2 + 0.25, 0.03]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.035, 0.035, 0.07, 10]} />
        <meshStandardMaterial color="#9ca3af" metalness={0.6} roughness={0.3} />
      </mesh>
    </group>
  );
}

export function Pictures() {
  const pictures = useGame((s) => s.pictures);
  const focusSpot = useGame((s) => (s.focus?.type === 'picture' ? s.focus.spot : null));
  return PICTURE_SPOTS.map((spot) => {
    const picture = pictures.find((p) => p.spot === spot.id);
    return (
      <group key={spot.id} position={[spot.x, spot.y, spot.z]} rotation={[0, spot.nx > 0 ? Math.PI / 2 : -Math.PI / 2, 0]}>
        {picture ? <Framed key={picture.url} picture={picture} /> : <EmptySpot focused={focusSpot === spot.id} />}
      </group>
    );
  });
}
