import { useEffect, useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { TV } from '../../../shared/layout.js';
import { fitContain, tvVolume } from '../../../shared/tv.js';
import { useGame, localPlayer } from '../net.js';
import { useTv } from '../rtc/screenShare.js';

// A text card drawn on a canvas, for the TV's idle/connecting screen and its LIVE tag.
function useCardTexture(draw, deps) {
  const tex = useMemo(() => {
    const c = document.createElement('canvas');
    draw(c);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }, deps);
  useEffect(() => () => tex.dispose(), [tex]);
  return tex;
}

function drawScreen(c, title, subtitle) {
  c.width = 1024;
  c.height = Math.round((1024 * TV.h) / TV.w);
  const g = c.getContext('2d');
  const bg = g.createLinearGradient(0, 0, 0, c.height);
  bg.addColorStop(0, '#1e1b4b');
  bg.addColorStop(1, '#0f172a');
  g.fillStyle = bg;
  g.fillRect(0, 0, c.width, c.height);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#a5b4fc';
  g.font = '900 88px Nunito, system-ui, sans-serif';
  g.fillText('📺', c.width / 2, c.height * 0.3);
  g.fillStyle = '#f8fafc';
  g.font = '900 56px Nunito, system-ui, sans-serif';
  g.fillText(title, c.width / 2, c.height * 0.55);
  g.fillStyle = '#cbd5e1';
  g.font = '700 36px Nunito, system-ui, sans-serif';
  g.fillText(subtitle, c.width / 2, c.height * 0.7);
}

function drawTag(c, text) {
  c.width = 512;
  c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(15, 23, 42, 0.8)';
  g.beginPath();
  g.roundRect(0, 0, c.width, c.height, 24);
  g.fill();
  g.fillStyle = '#ef4444';
  g.beginPath();
  g.arc(48, 48, 16, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#fff';
  g.font = '900 44px Nunito, system-ui, sans-serif';
  g.textBaseline = 'middle';
  g.fillText(text, 80, 50, 410);
}

// A <video> the TV samples every frame, plus proximity audio for someone else's stream.
function useStreamVideo(stream, withAudio) {
  const video = useMemo(() => {
    const v = document.createElement('video');
    v.muted = true; // sound goes through the proximity audio element instead
    v.playsInline = true;
    v.autoplay = true;
    return v;
  }, []);
  const audio = useMemo(() => new Audio(), []);
  const [size, setSize] = useState(null);
  useEffect(() => {
    video.srcObject = stream || null;
    setSize(null);
    if (!stream) return;
    const onSize = () => video.videoWidth && setSize({ w: video.videoWidth, h: video.videoHeight });
    video.addEventListener('loadedmetadata', onSize);
    video.addEventListener('resize', onSize);
    video.play().catch(() => {});
    return () => {
      video.removeEventListener('loadedmetadata', onSize);
      video.removeEventListener('resize', onSize);
    };
  }, [stream]);
  useEffect(() => {
    audio.srcObject = withAudio ? stream : null;
    if (!withAudio || !stream) return;
    audio.volume = 0;
    // Autoplay with sound needs a user gesture; retry on the next one if the browser said no.
    const retry = () => audio.play().then(() => window.removeEventListener('keydown', retry)).catch(() => {});
    audio.play().catch(() => window.addEventListener('keydown', retry));
    return () => {
      window.removeEventListener('keydown', retry);
      audio.pause();
    };
  }, [stream, withAudio]);
  useEffect(() => () => {
    video.srcObject = null;
    audio.srcObject = null;
  }, []);
  return { video, audio, size };
}

function Screen() {
  const stream = useTv((s) => s.stream);
  const sharing = useTv((s) => s.sharing);
  const sharerName = useGame((s) => s.players.find((p) => p.id === s.tv?.sharer)?.name);
  const mine = useGame((s) => s.tv?.sharer && s.tv.sharer === s.me) || sharing;
  const { video, audio, size } = useStreamVideo(stream, !mine);
  const texture = useMemo(() => {
    const t = new THREE.VideoTexture(video);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [video]);
  useEffect(() => () => texture.dispose(), [texture]);

  const live = Boolean(stream && size);
  const who = mine ? 'You' : sharerName || 'Someone';
  const [title, subtitle] = live
    ? ['', '']
    : mine
      ? ['Starting your screen share…', 'Pick a screen, window or tab to share']
      : sharerName
        ? [`Connecting to ${sharerName}'s screen…`, 'Hang tight, the picture is on its way']
        : ['Nobody is sharing', 'Walk up and press E to share your screen'];
  const card = useCardTexture((c) => drawScreen(c, title, subtitle), [title, subtitle]);
  const tag = useCardTexture((c) => drawTag(c, `LIVE · ${who}`), [who]);
  const fit = fitContain(size?.w, size?.h, TV.w, TV.h);

  useFrame(() => {
    if (!mine && stream) audio.volume = tvVolume(localPlayer.x, localPlayer.z, localPlayer.level);
  });

  return (
    <group position={[0, 0, 0.07]}>
      {live ? (
        <>
          <mesh>
            <planeGeometry args={[fit.w, fit.h]} />
            <meshBasicMaterial map={texture} toneMapped={false} />
          </mesh>
          <mesh position={[-TV.w / 2 + 0.55, TV.h / 2 - 0.16, 0.01]}>
            <planeGeometry args={[0.9, 0.17]} />
            <meshBasicMaterial map={tag} transparent toneMapped={false} />
          </mesh>
        </>
      ) : (
        <mesh>
          <planeGeometry args={[TV.w, TV.h]} />
          <meshBasicMaterial map={card} toneMapped={false} />
        </mesh>
      )}
    </group>
  );
}

function Couch() {
  const { x, z, w, d } = TV.couch;
  const fabric = '#7c9cc9';
  return (
    // Built facing -x (toward the TV): the backrest is on the +x side.
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.25, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, 0.3, d]} />
        <meshStandardMaterial color={fabric} roughness={0.9} />
      </mesh>
      {[-d / 4, d / 4].map((cz) => (
        <mesh key={cz} position={[-0.08, 0.46, cz]} castShadow>
          <boxGeometry args={[w - 0.2, 0.14, d / 2 - 0.3]} />
          <meshStandardMaterial color="#93b4e0" roughness={0.95} />
        </mesh>
      ))}
      <mesh position={[w / 2 - 0.12, 0.62, 0]} castShadow>
        <boxGeometry args={[0.24, 0.85, d]} />
        <meshStandardMaterial color={fabric} roughness={0.9} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[0, 0.5, s * (d / 2 - 0.1)]} castShadow>
          <boxGeometry args={[w, 0.5, 0.2]} />
          <meshStandardMaterial color="#6b89b5" roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

function FloorLamp({ position }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.03, 0]}>
        <cylinderGeometry args={[0.22, 0.22, 0.06, 16]} />
        <meshStandardMaterial color="#334155" />
      </mesh>
      <mesh position={[0, 0.8, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 1.6, 8]} />
        <meshStandardMaterial color="#334155" />
      </mesh>
      <mesh position={[0, 1.7, 0]} castShadow>
        <cylinderGeometry args={[0.2, 0.32, 0.36, 18, 1, true]} />
        <meshStandardMaterial color="#fde68a" emissive="#fde68a" emissiveIntensity={0.35} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

// The screen-sharing TV on the left wall, with a soundbar shelf and a small lounge.
export function Tv() {
  const rugX = (TV.x + 0.25 + TV.couch.x + TV.couch.w / 2 + 0.6) / 2;
  const rugW = TV.couch.x + TV.couch.w / 2 + 0.6 - (TV.x + 0.25);
  return (
    <group>
      <group position={[TV.x, TV.y, TV.z]} rotation={[0, Math.PI / 2, 0]}>
        <mesh castShadow>
          <boxGeometry args={[TV.w + 0.24, TV.h + 0.24, 0.12]} />
          <meshStandardMaterial color="#111827" metalness={0.3} roughness={0.4} />
        </mesh>
        <mesh position={[0, 0, 0.065]}>
          <planeGeometry args={[TV.w, TV.h]} />
          <meshBasicMaterial color="#000" />
        </mesh>
        <Screen />
        {/* floating shelf with a soundbar */}
        <mesh position={[0, -TV.h / 2 - 0.55, 0.2]} castShadow>
          <boxGeometry args={[3.4, 0.07, 0.4]} />
          <meshStandardMaterial color="#8a5a2b" roughness={0.7} />
        </mesh>
        <mesh position={[0, -TV.h / 2 - 0.43, 0.2]} castShadow>
          <boxGeometry args={[2.2, 0.16, 0.2]} />
          <meshStandardMaterial color="#1f2937" roughness={0.6} />
        </mesh>
        <mesh position={[0, -TV.h / 2 - 0.43, 0.301]}>
          <planeGeometry args={[2.1, 0.11]} />
          <meshStandardMaterial color="#374151" roughness={1} />
        </mesh>
      </group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[rugX, 0.014, TV.z]} receiveShadow>
        <planeGeometry args={[rugW, TV.w - 0.4]} />
        <meshStandardMaterial color="#c7b8f5" roughness={1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[rugX, 0.016, TV.z]}>
        <ringGeometry args={[1.2, 1.32, 40]} />
        <meshStandardMaterial color="#fde68a" />
      </mesh>
      <Couch />
      <FloorLamp position={[TV.couch.x + 0.1, 0, TV.z - TV.couch.d / 2 - 0.45]} />
    </group>
  );
}
