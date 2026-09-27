import { useEffect } from 'react';
import { useGame } from '../net.js';
import { useVoice, joinVoice, leaveVoice, toggleMute } from '../audio/voice.js';

// "🎙️ Join voice" in the HUD button row; once joined it's the mute toggle (M).
export function VoiceButton() {
  const joined = useVoice((s) => s.joined);
  const joining = useVoice((s) => s.joining);
  const muted = useVoice((s) => s.muted);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key.toLowerCase() !== 'm' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (!useVoice.getState().joined || useGame.getState().modal) return;
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName) || document.activeElement?.closest?.('.xterm')) return;
      e.preventDefault();
      toggleMute();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  if (!joined)
    return (
      <button className="btn" disabled={joining} onClick={joinVoice} title="Talk with people near you in the office">
        {joining ? '🎙️ Joining…' : '🎙️ Join voice'}
      </button>
    );
  return (
    <button className={`btn ${muted ? 'warn' : ''}`} onClick={toggleMute} title={muted ? 'Unmute (M)' : 'Mute (M)'}>
      {muted ? '🔇 Muted' : '🎙️ On'}
    </button>
  );
}

// Who's in voice, who's talking, and the leave button.
export function VoicePanel() {
  const joined = useVoice((s) => s.joined);
  const peers = useVoice((s) => s.peers);
  const muted = useVoice((s) => s.muted);
  const players = useGame((s) => s.players);
  const me = useGame((s) => s.me);
  if (!joined) return null;
  const inVoice = players.filter((p) => p.id === me || peers[p.id]);
  return (
    <div className="panel side-panel voice-panel">
      <div className="panel-title">VOICE <span>{inVoice.length}</span></div>
      {inVoice.map((p) => (
        <div key={p.id} className="row">
          <span className="dot" style={{ background: p.color }} />
          <b>{p.name}</b>
          {p.id === me && <span className="muted">(you)</span>}
          <VoiceBadge id={p.id} />
        </div>
      ))}
      {inVoice.length === 1 && <div className="muted small">Nobody else is in voice yet. Walk up to people who join to hear them.</div>}
      <div className="voice-actions">
        <button className="btn" onClick={toggleMute}>{muted ? 'Unmute' : 'Mute'} <kbd>M</kbd></button>
        <button className="btn" onClick={leaveVoice}>Leave voice</button>
      </div>
    </div>
  );
}

// 🔊 while someone talks, 🔇 when muted, 🎙️ when they're in voice, … while connecting.
export function VoiceBadge({ id }) {
  const me = useGame((s) => s.me);
  const joined = useVoice((s) => s.joined);
  const speaking = useVoice((s) => s.speaking[id]);
  const peer = useVoice((s) => s.peers[id]);
  const mutedMe = useVoice((s) => s.muted);
  if (!joined || (id !== me && !peer)) return null;
  const muted = id === me ? mutedMe : peer.muted;
  const connecting = id !== me && peer.state !== 'connected';
  const [icon, title] = muted
    ? ['🔇', 'muted']
    : speaking
      ? ['🔊', 'talking']
      : connecting
        ? ['…', `connecting (${peer.state || 'new'})`]
        : ['🎙️', 'in voice'];
  return <span className={`voice-badge ${speaking && !muted ? 'talking' : ''}`} title={title}>{icon}</span>;
}
