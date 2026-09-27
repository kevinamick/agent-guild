import { useEffect, useRef, useState } from 'react';
import { useSound, setSound } from '../audio/engine.js';
import { startSoundscape } from '../audio/ambience.js';
import { leaveVoice } from '../audio/voice.js';

// Runs the office soundscape while you're in the office (renders nothing).
export function Soundscape() {
  useEffect(() => {
    const stop = startSoundscape();
    return () => {
      stop();
      leaveVoice();
    };
  }, []);
  return null;
}

// 🔊 in the HUD button row: opens a little panel with the sound toggle and volumes.
export function SoundButton() {
  const { on, volume, voiceVolume, chatter, chatterVolume } = useSound();
  const [open, setOpen] = useState(false);
  const box = useRef();
  useEffect(() => {
    if (!open) return;
    const away = (e) => !box.current?.contains(e.target) && setOpen(false);
    window.addEventListener('pointerdown', away);
    return () => window.removeEventListener('pointerdown', away);
  }, [open]);
  const icon = on && volume > 0 ? '🔊' : '🔈';
  return (
    <span className="sound-wrap" ref={box}>
      <button className="btn" title="Sound" aria-label="Sound settings" onClick={() => setOpen(!open)}>{icon}</button>
      {open && (
        <div className="sound-pop panel">
          <label className="sound-line">
            <input type="checkbox" checked={on} onChange={(e) => setSound({ on: e.target.checked })} />
            <b>Office sounds</b>
          </label>
          <label className="sound-line">
            <span className="muted small">Volume</span>
            <input type="range" min="0" max="1" step="0.05" value={volume} disabled={!on} onChange={(e) => setSound({ volume: +e.target.value })} />
          </label>
          <label className="sound-line">
            <input type="checkbox" checked={chatter} disabled={!on} onChange={(e) => setSound({ chatter: e.target.checked })} />
            <span className="small">Office chatter</span>
          </label>
          <label className="sound-line">
            <span className="muted small">Chatter</span>
            <input type="range" min="0" max="1" step="0.05" value={chatterVolume} disabled={!on || !chatter} onChange={(e) => setSound({ chatterVolume: +e.target.value })} />
          </label>
          <label className="sound-line">
            <span className="muted small">Voices</span>
            <input type="range" min="0" max="1" step="0.05" value={voiceVolume} onChange={(e) => setSound({ voiceVolume: +e.target.value })} />
          </label>
        </div>
      )}
    </span>
  );
}
