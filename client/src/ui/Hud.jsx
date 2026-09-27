import { useEffect, useRef, useState } from 'react';
import { useGame, send, openModal } from '../net.js';
import { STATUS_COLORS } from '../scene/Characters.jsx';
import { progress, badgeTier, SKILL_INFO } from '../../../shared/progression.js';
import { useHost } from '../host.js';
import { canUseAgent } from './Access.jsx';
import { PictureBar } from './PictureModal.jsx';
import { SoundButton } from './Sound.jsx';
import { VoiceButton, VoicePanel, VoiceBadge } from './Voice.jsx';
import { TvPrompt } from './TvPrompt.jsx';
import { ViewToggle } from './ViewToggle.jsx';

export function XpBar({ xp, color = '#a855f7', thin }) {
  const p = progress(xp);
  return (
    <div className={`xpbar ${thin ? 'thin' : ''}`} title={`${p.into} / ${p.need} XP to next level`}>
      <div style={{ width: `${Math.round(p.pct * 100)}%`, background: color }} />
    </div>
  );
}

const ENGINE_STYLE = {
  claude: { short: 'Claude', bg: '#f4c7b3' },
  copilot: { short: 'Copilot', bg: '#d9d0fb' },
};

export function EngineChip({ engine }) {
  if (!engine) return null;
  const e = ENGINE_STYLE[engine] || { short: engine, bg: '#e2e8f0' };
  return <span className="engine-chip" style={{ background: e.bg }}>{e.short}</span>;
}

export function LevelBadge({ level }) {
  return <span className={`lv lv-${badgeTier(level)}`}>Lv {level}</span>;
}

export function TopLeft() {
  const office = useGame((s) => s.office);
  const runners = useGame((s) => s.runners);
  return (
    <div className="panel top-left">
      <div className="office-name">🏢 {office.name}</div>
      <div className="muted small">
        {office.repo ? `⎇ ${office.repo}` : 'no repo yet'} · runners:{' '}
        {runners.length ? runners.map((r) => r.owner + (r.lend ? '' : ' 🔒')).join(', ') : 'none'}
      </div>
    </div>
  );
}

export function TopRight() {
  const host = useHost();
  return (
    <div className="top-right">
      <div className="btn-row panel">
        <button className="btn" onClick={() => openModal({ type: 'character' })}>🧍 Me</button>
        <button className="btn" onClick={() => openModal({ type: 'roster' })}>🏆 Guild</button>
        <button className="btn" onClick={() => openModal({ type: 'board', kind: 'issues' })}>📌 {host.issuesLabel}</button>
        <button className="btn" onClick={() => openModal({ type: 'board', kind: 'prs' })}>🔀 PRs</button>
        <button className="btn" onClick={() => openModal({ type: 'team' })}>👥 Team</button>
        <button className="btn" onClick={() => openModal({ type: 'help' })}>?</button>
        <ViewToggle />
        <VoiceButton />
        <SoundButton />
      </div>
      <VoicePanel />
      <OfficeList />
      <Workers />
    </div>
  );
}

function OfficeList() {
  const players = useGame((s) => s.players);
  const me = useGame((s) => s.me);
  return (
    <div className="panel side-panel">
      <div className="panel-title">IN THE OFFICE <span>{players.length}</span></div>
      {players.map((p) => (
        <div key={p.id} className="row">
          <span className="dot" style={{ background: p.color }} />
          <b>{p.name}</b>
          {p.id === me && <span className="muted">(you)</span>}
          <VoiceBadge id={p.id} />
        </div>
      ))}
    </div>
  );
}

function Workers() {
  const agents = useGame((s) => s.agents);
  const myName = useGame((s) => s.myName);
  const working = Object.values(agents).filter((a) => a.deskId);
  if (!working.length) return null;
  return (
    <div className="panel side-panel">
      <div className="panel-title">WORKERS <span>{working.length}</span></div>
      {working.map((a) => (
        <div key={a.id} className="worker" onClick={() => openModal({ type: 'terminal', agentId: a.id })}>
          <div className="row">
            <span className="dot" style={{ background: a.color }} />
            <LevelBadge level={a.level} />
            <b>{a.name}</b>
            <EngineChip engine={a.engine} />
            {a.owner.toLowerCase() !== myName.toLowerCase() && <span className="muted small">· {a.owner}'s</span>}
            <span className="pill" style={{ background: STATUS_COLORS[a.status] }}>{a.status}</span>
          </div>
          <div className="activity">{a.activity}</div>
          <XpBar xp={a.total / 1.5} thin color={a.color} />
        </div>
      ))}
    </div>
  );
}

export function InteractionBar() {
  const focus = useGame((s) => s.focus);
  const agents = useGame((s) => s.agents);
  const myName = useGame((s) => s.myName);
  const modal = useGame((s) => s.modal);
  const host = useHost();
  if (!focus || modal) return null;
  if (focus.type === 'picture') return <PictureBar spot={focus.spot} />;
  const Key = ({ k, children }) => (
    <span className="keyhint">
      <kbd>{k}</kbd>
      {children}
    </span>
  );
  if (focus.type === 'agent') {
    const a = agents[focus.agentId];
    if (!a) return null;
    return (
      <div className="interaction panel">
        <span className="focus-name" style={{ color: STATUS_COLORS[a.status] }}>
          {a.name} · Lv {a.level} · {a.status}
        </span>
        <EngineChip engine={a.engine} />
        <span className="muted small ellipsis">{a.owner}'s · {a.activity}</span>
        {canUseAgent(a, myName) ? (
          <>
            <Key k="E">Open terminal</Key>
            <Key k="P">Prompt</Key>
            <Key k="K">Kudos</Key>
            <Key k="C">Card</Key>
            <Key k="X">Send home</Key>
          </>
        ) : (
          <>
            <Key k="E">Watch</Key>
            <Key k="R">🔑 Request access</Key>
            <Key k="K">Kudos</Key>
            <Key k="C">Card</Key>
          </>
        )}
      </div>
    );
  }
  if (focus.type === 'boss')
    return (
      <div className="interaction panel">
        <span className="focus-name">🏢 Boss's desk</span>
        <span className="muted small">the whole floor at a glance</span>
        <Key k="E">Guild overview</Key>
      </div>
    );
  if (focus.type === 'tv') return <TvPrompt Key={Key} />;
  if (focus.type === 'desk')
    return (
      <div className="interaction panel">
        <span className="focus-name">Desk {focus.deskId} · empty</span>
        <Key k="E">Hire or borrow an agent</Key>
      </div>
    );
  const label = { issues: `📌 ${host.issuesLabel} board`, prs: '🔀 Pull requests board', guild: '🏆 Guild Hall roster' }[focus.board];
  return (
    <div className="interaction panel">
      <span className="focus-name">{label}</span>
      <Key k="E">Open</Key>
    </div>
  );
}

export function Toasts() {
  const toasts = useGame((s) => s.toasts);
  const agents = useGame((s) => s.agents);
  const claims = useGame((s) => s.fx).filter((f) => f.kind === 'bounty');
  return (
    <div className="toasts">
      {claims.map((f) => (
        <div key={f.id} className="bounty-banner">
          <span className="bounty-coins">💰</span>
          <div>
            <b>Bounty claimed!</b>
            <div>{agents[f.agentId]?.name || 'An agent'} landed #{f.number} for +{f.amount} XP</div>
          </div>
          <span className="bounty-coins">💰</span>
        </div>
      ))}
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`}>{t.text}</div>
      ))}
    </div>
  );
}

export function Chat() {
  const chat = useGame((s) => s.chat);
  const [text, setText] = useState('');
  const input = useRef();
  const log = useRef();
  useEffect(() => {
    const onKey = (e) => {
      if (e.key.toLowerCase() === 't' && !useGame.getState().modal && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    log.current?.scrollTo(0, log.current.scrollHeight);
  }, [chat]);
  const recent = chat.slice(-8);
  return (
    <div className="chat">
      {recent.length > 0 && (
        <div className="chat-log panel" ref={log}>
          {recent.map((m) => (
            <div key={m.id}>
              <b style={{ color: m.color }}>{m.from}</b> {m.text}
            </div>
          ))}
        </div>
      )}
      <input
        ref={input}
        className="chat-input panel"
        placeholder="Press T to chat"
        value={text}
        maxLength={280}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            if (text.trim()) send({ t: 'chat', text });
            setText('');
            e.currentTarget.blur();
          }
          if (e.key === 'Escape') e.currentTarget.blur();
        }}
      />
    </div>
  );
}

export function SkillChips({ agent, highlight }) {
  return (
    <div className="skill-chips">
      {Object.entries(SKILL_INFO).map(([s, info]) => (
        <span key={s} className={`skill-chip ${highlight === s ? 'hl' : ''}`} style={{ borderColor: info.color }} title={`${info.label}: ${agent.xp[s] || 0} XP`}>
          {info.icon} {agent.skillLevels[s]}
        </span>
      ))}
    </div>
  );
}
