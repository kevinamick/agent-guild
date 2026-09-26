import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useGame, send, onPty, openModal, closeModal } from '../net.js';
import { STATUS_COLORS } from '../scene/Characters.jsx';
import { LevelBadge, SkillChips, EngineChip } from './Hud.jsx';
import { SKILL_INFO } from '../../../shared/progression.js';

export function TerminalModal({ agentId }) {
  const host = useRef();
  const agent = useGame((s) => s.agents[agentId]);
  const players = useGame((s) => s.players);

  useEffect(() => {
    const term = new XTerm({
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      fontSize: 13,
      cursorBlink: true,
      theme: { background: '#1b1d2e', foreground: '#e2e8f0', cursor: '#facc15' },
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current);
    const resize = () => {
      try {
        fit.fit();
        send({ t: 'resize', agentId, cols: term.cols, rows: term.rows });
      } catch {}
    };
    requestAnimationFrame(resize);
    const off = onPty(agentId, (data, reset) => {
      if (reset) term.reset();
      term.write(data);
    });
    send({ t: 'sub', agentId });
    term.onData((data) => send({ t: 'input', agentId, data }));
    // Ctrl+] steps away: Esc belongs to Claude Code (interrupt).
    term.attachCustomKeyEventHandler((e) => {
      if (e.type === 'keydown' && e.ctrlKey && e.key === ']') {
        closeModal();
        return false;
      }
      return true;
    });
    term.focus();
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      off();
      send({ t: 'unsub', agentId });
      term.dispose();
    };
  }, [agentId]);

  if (!agent) return null;
  const task = agent.task;
  return (
    <div className="modal-backdrop">
      <div className="modal terminal-modal">
        <div className="modal-head">
          <span className="dot" style={{ background: agent.color }} />
          <b>{agent.name}</b>
          <LevelBadge level={agent.level} />
          <EngineChip engine={agent.engine} />
          <span className="muted small">{agent.title} · {agent.owner}'s agent</span>
          {task?.kind && (
            <span className="kind-tag" style={{ background: SKILL_INFO[task.kind].color }}>
              {SKILL_INFO[task.kind].icon} {SKILL_INFO[task.kind].label}
            </span>
          )}
          <span className="grow" />
          <span className="pill" style={{ background: STATUS_COLORS[agent.status] }}>{agent.status}</span>
          <span className="muted small">👀 {players.length}</span>
          <button className="icon-btn" onClick={closeModal}>×</button>
        </div>
        <div className="term-host" ref={host} />
        <div className="modal-foot">
          <span className="muted small">
            Everyone in the office shares this terminal · <kbd>Ctrl</kbd>+<kbd>]</kbd> to step away
            {task?.borrowed && ` · borrowed by ${task.requestedBy}`}
          </span>
          <span className="grow" />
          <SkillChips agent={agent} highlight={task?.kind} />
          <button className="btn" onClick={() => send({ t: 'kudos', agentId })}>👏 Kudos</button>
          <button className="btn" onClick={() => openModal({ type: 'prompt', agentId })}>💬 Prompt</button>
          <button className="btn danger" onClick={() => { send({ t: 'dismiss', agentId }); closeModal(); }}>🏠 Send home</button>
        </div>
      </div>
    </div>
  );
}
