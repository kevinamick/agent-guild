import { useEffect, useState } from 'react';
import { useGame, connect, send, openModal, toast } from './net.js';
import { World, keys } from './scene/World.jsx';
import { TopLeft, TopRight, InteractionBar, Toasts, Chat } from './ui/Hud.jsx';
import { TerminalModal } from './ui/Terminal.jsx';
import { CharacterModal } from './ui/Character.jsx';
import { BoardModal, HireModal, PromptModal, RosterModal, AgentModal, HelpModal, TeamModal } from './ui/Modals.jsx';
import { PictureModal, interactPicture } from './ui/PictureModal.jsx';
import { Soundscape } from './ui/Sound.jsx';


function readSaved() {
  try {
    return JSON.parse(localStorage.getItem('guild-login') || '{}');
  } catch {
    return {};
  }
}

function Login() {
  const saved = readSaved();
  // Invite links carry the key in the #fragment so it never reaches server logs.
  const fromLink = new URLSearchParams(location.hash.slice(1)).get('key');
  const [key, setKey] = useState(fromLink || saved.key || '');
  const error = useGame((s) => s.error);
  const status = useGame((s) => s.status);
  useEffect(() => {
    if (fromLink) history.replaceState(null, '', location.pathname);
  }, []);
  const join = (e) => {
    e.preventDefault();
    if (!key.trim()) return;
    try {
      localStorage.setItem('guild-login', JSON.stringify({ key: key.trim() }));
    } catch {}
    connect({ key: key.trim() });
  };
  return (
    <div className="login">
      <form className="login-card panel" onSubmit={join}>
        <div className="login-logo">🏢</div>
        <h1>Agent Guild</h1>
        <p className="muted">A shared office where your Claude Code agents level up, and your coworkers can borrow them.</p>
        <label className="field-label">Your key</label>
        <input className="input mono" type="password" autoFocus={!key} value={key} onChange={(e) => setKey(e.target.value)} placeholder="ag_… from your invite" />
        {error && <div className="error-box">{error}</div>}
        <button className="btn primary big" disabled={status === 'connecting'}>{status === 'connecting' ? 'Walking in…' : 'Walk in →'}</button>
        <p className="muted small">No key? Ask whoever runs the office to invite you.</p>
      </form>
    </div>
  );
}

function ModalRouter() {
  const modal = useGame((s) => s.modal);
  if (!modal) return null;
  switch (modal.type) {
    case 'terminal':
      return <TerminalModal key={modal.agentId} agentId={modal.agentId} />;
    case 'board':
      return <BoardModal key={modal.kind} kind={modal.kind} />;
    case 'hire':
      return <HireModal {...modal} />;
    case 'prompt':
      return <PromptModal agentId={modal.agentId} />;
    case 'roster':
      return <RosterModal />;
    case 'agent':
      return <AgentModal agentId={modal.agentId} />;
    case 'help':
      return <HelpModal />;
    case 'team':
      return <TeamModal />;
    case 'character':
      return <CharacterModal first={modal.first} />;
    case 'picture':
      return <PictureModal key={modal.spot} spot={modal.spot} />;
    default:
      return null;
  }
}

function interact(key) {
  const { focus, agents } = useGame.getState();
  if (key === 'g') return openModal({ type: 'roster' });
  if (key === '?') return openModal({ type: 'help' });
  if (!focus) return;
  if (focus.type === 'boss') {
    if (key === 'e') openModal({ type: 'roster' });
    return;
  }
  if (focus.type === 'board') {
    if (key !== 'e') return;
    return focus.board === 'guild' ? openModal({ type: 'roster' }) : openModal({ type: 'board', kind: focus.board });
  }
  if (focus.type === 'desk') {
    if (key === 'e' || key === 'h') openModal({ type: 'hire', deskId: focus.deskId, kind: 'general' });
    return;
  }
  if (focus.type === 'picture') return interactPicture(key, focus.spot);
  const agent = agents[focus.agentId];
  if (!agent) return;
  if (key === 'e') openModal({ type: 'terminal', agentId: agent.id });
  if (key === 'p') openModal({ type: 'prompt', agentId: agent.id });
  if (key === 'c') openModal({ type: 'agent', agentId: agent.id });
  if (key === 'k') send({ t: 'kudos', agentId: agent.id });
  if (key === 'x') {
    if (agent.status === 'working' && !confirm(`${agent.name} is still working. Send them home anyway?`)) return;
    send({ t: 'dismiss', agentId: agent.id });
  }
}

function useGameKeys() {
  useEffect(() => {
    const typing = () => ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName) || document.activeElement?.closest?.('.xterm');
    const down = (e) => {
      if (useGame.getState().modal || typing() || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
        keys.add(k);
        e.preventDefault();
        return;
      }
      if (e.repeat) return;
      if (['e', 'p', 'x', 'k', 'h', 'c', 'g', '?'].includes(k)) {
        e.preventDefault();
        interact(k);
      }
    };
    const up = (e) => keys.delete(e.key.toLowerCase());
    const clear = () => keys.clear();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', clear);
    const unsub = useGame.subscribe((s, prev) => s.modal && !prev.modal && keys.clear());
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', clear);
      unsub();
    };
  }, []);
}

function ReconnectBanner() {
  const status = useGame((s) => s.status);
  if (status !== 'reconnecting') return null;
  return <div className="reconnect">Reconnecting to the office… your agents keep working</div>;
}

function Game() {
  useGameKeys();
  const first = useGame((s) => Object.keys(s.agents).length === 0);
  useEffect(() => {
    send({ t: 'board', kind: 'issues' });
    send({ t: 'board', kind: 'prs' });
    if (first) setTimeout(() => toast('Tip: walk to a desk with a “+” and press E to hire your first agent'), 1200);
    const t = setInterval(() => {
      send({ t: 'board', kind: 'issues' });
      send({ t: 'board', kind: 'prs' });
    }, 60000);
    return () => clearInterval(t);
  }, []);
  return (
    <>
      <World />
      <TopLeft />
      <TopRight />
      <InteractionBar />
      <Chat />
      <Toasts />
      <ModalRouter />
      <ReconnectBanner />
      <Soundscape />
    </>
  );
}

export default function App() {
  const status = useGame((s) => s.status);
  return status === 'online' || status === 'reconnecting' ? <Game /> : <Login />;
}

