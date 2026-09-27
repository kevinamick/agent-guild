import { useEffect, useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { TV } from '../../../shared/layout.js';
import { fitContain, tvVolume } from '../../../shared/tv.js';
import { useGame, localPlayer } from '../net.js';
import { useTv } from '../rtc/screenShare.js';
import { Sofa } from './Lounge.jsx';

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

// The couch facing the TV matches the lounge nook's sofa (built facing +z, so turned toward -x).
function Couch() {
  const { x, z, w, d } = TV.couch;
  return <Sofa w={d} d={w} position={[x, 0, z]} rotation={[0, -Math.PI / 2, 0]} fabric="#77876b" cushions={['#e5dccb', '#c0664a']} />;
}

// A slim tripod floor lamp with a linen drum shade.
function FloorLamp({ position }) {
  return (
    <group position={position}>
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[Math.sin((i * Math.PI * 2) / 3) * 0.13, 0.75, Math.cos((i * Math.PI * 2) / 3) * 0.13]} rotation={[Math.cos((i * Math.PI * 2) / 3) * -0.17, 0, Math.sin((i * Math.PI * 2) / 3) * 0.17]}>
          <cylinderGeometry args={[0.014, 0.014, 1.5, 6]} />
          <meshStandardMaterial color="#b48f64" roughness={0.6} />
        </mesh>
      ))}
      <mesh position={[0, 1.62, 0]} castShadow>
        <cylinderGeometry args={[0.26, 0.26, 0.34, 24, 1, true]} />
        <meshStandardMaterial color="#f3e7d0" emissive="#ffd9a0" emissiveIntensity={0.45} side={THREE.DoubleSide} />
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
          <meshStandardMaterial color="#c9a57a" roughness={0.6} />
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
      {/* a charcoal flatweave rug with an oat border */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[rugX, 0.012, TV.z]} receiveShadow>
        <planeGeometry args={[rugW, TV.w - 0.4]} />
        <meshStandardMaterial color="#d9cfbd" roughness={1} polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[rugX, 0.014, TV.z]} receiveShadow>
        <planeGeometry args={[rugW - 0.3, TV.w - 0.7]} />
        <meshStandardMaterial color="#56514b" roughness={1} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />
      </mesh>
      <Couch />
      <FloorLamp position={[TV.couch.x + 0.1, 0, TV.z - TV.couch.d / 2 - 0.45]} />
    </group>
  );
}
