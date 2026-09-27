import { useGame } from '../net.js';
import { useTv } from '../rtc/screenShare.js';

export function useSharer() {
  const id = useGame((s) => s.tv?.sharer || null);
  const me = useGame((s) => s.me);
  const name = useGame((s) => s.players.find((p) => p.id === s.tv?.sharer)?.name || 'Someone');
  return id ? { id, mine: id === me, name } : null;
}

// The interaction bar while standing at the TV. `Key` is the bar's key-hint component.
export function TvPrompt({ Key }) {
  const sharer = useSharer();
  const sharing = useTv((s) => s.sharing);
  if (sharing || sharer?.mine)
    return (
      <div className="interaction panel">
        <span className="focus-name">📺 You're sharing your screen</span>
        <span className="muted small">everyone in the office can watch</span>
        <Key k="E">Stop sharing</Key>
      </div>
    );
  if (sharer)
    return (
      <div className="interaction panel">
        <span className="focus-name">📺 {sharer.name} is sharing their screen</span>
        <Key k="E">Watch full screen</Key>
      </div>
    );
  return (
    <div className="interaction panel">
      <span className="focus-name">📺 TV · nobody is sharing</span>
      <Key k="E">Share your screen</Key>
    </div>
  );
}
