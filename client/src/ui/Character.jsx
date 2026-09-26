import { useEffect, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useGame, send, closeModal } from '../net.js';
import { Person } from '../scene/Characters.jsx';
import {
  SKIN_TONES, HAIR_STYLES, HAIR_COLORS, FACIAL_HAIR, BOTTOMS, SHIRT_COLORS, sanitizeAvatar, randomAvatar,
} from '../../../shared/avatar.js';

function Turntable({ avatar }) {
  const group = useRef();
  // Sway around a front view so the face stays visible.
  useFrame(({ clock }) => {
    if (group.current) group.current.rotation.y = Math.sin(clock.elapsedTime * 0.8) * 0.7;
  });
  return (
    <group ref={group} position={[0, -1.15, 0]}>
      <Person avatar={avatar} />
    </group>
  );
}

function Swatches({ colors, value, onPick, label }) {
  return (
    <div className="swatches" role="radiogroup" aria-label={label}>
      {colors.map((c) => (
        <button
          type="button"
          key={c}
          role="radio"
          aria-checked={c === value}
          aria-label={c}
          className={`swatch ${c === value ? 'on' : ''}`}
          style={{ background: c }}
          onClick={() => onPick(c)}
        />
      ))}
    </div>
  );
}

function Choices({ options, value, onPick }) {
  return (
    <div className="kind-row">
      {options.map((o) => (
        <button type="button" key={o.id} className={`kind-btn ${value === o.id ? 'on' : ''}`} style={{ '--c': '#fde68a' }} onClick={() => onPick(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function CharacterModal({ first }) {
  const me = useGame((s) => s.players.find((p) => p.id === s.me));
  const [draft, setDraft] = useState(() => sanitizeAvatar(me?.avatar));
  const set = (k) => (v) => setDraft((d) => ({ ...d, [k]: v }));
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && closeModal();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const save = () => {
    send({ t: 'avatar', avatar: draft });
    closeModal();
  };

  return (
    <div className="modal-backdrop">
      <div className="modal wide character-modal">
        <div className="modal-head">
          <b className="modal-title">{first ? '🧍 Create your character' : '🧍 Your character'}</b>
          <span className="grow" />
          <button className="icon-btn" onClick={closeModal} aria-label="Close">×</button>
        </div>
        <div className="character-body">
          <div className="character-preview">
            <Canvas camera={{ position: [0, 0.35, 4.6], fov: 38 }} dpr={[1, 2]}>
              <color attach="background" args={['#f6ecd9']} />
              <hemisphereLight args={['#fffaf0', '#d9c7a8', 1.1]} />
              <directionalLight position={[3, 5, 4]} intensity={1.4} />
              <Turntable avatar={draft} />
            </Canvas>
            <button className="btn" onClick={() => setDraft(randomAvatar())}>🎲 Surprise me</button>
          </div>
          <div className="character-options">
            <label className="field-label">Skin tone</label>
            <Swatches label="Skin tone" colors={SKIN_TONES} value={draft.skin} onPick={set('skin')} />
            <label className="field-label">Hair</label>
            <Choices options={HAIR_STYLES} value={draft.hair} onPick={set('hair')} />
            <label className="field-label">{draft.hair === 'headscarf' ? 'Headscarf color' : 'Hair color'}</label>
            <Swatches label="Hair color" colors={HAIR_COLORS} value={draft.hairColor} onPick={set('hairColor')} />
            <label className="field-label">Facial hair</label>
            <Choices options={FACIAL_HAIR} value={draft.facialHair} onPick={set('facialHair')} />
            <label className="field-label">Bottoms</label>
            <Choices options={BOTTOMS} value={draft.bottoms} onPick={set('bottoms')} />
            <label className="field-label">Shirt</label>
            <Swatches label="Shirt color" colors={SHIRT_COLORS} value={draft.shirt} onPick={set('shirt')} />
          </div>
        </div>
        <div className="modal-foot">
          <span className="muted small">Coworkers see your character in the office.</span>
          <span className="grow" />
          <button className="btn" onClick={closeModal}>{first ? 'Later' : 'Cancel'}</button>
          <button className="btn primary" onClick={save}>{first ? 'Walk in as this' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
