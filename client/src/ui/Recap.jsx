import { useEffect } from 'react';
import { useGame, send, openModal, closeModal } from '../net.js';
import { Modal } from './Modals.jsx';
import { SKILL_INFO } from '../../../shared/progression.js';

// "While you were away": what the guild did since you were last in the office.
// The server builds the recap; this shows it, with one click to whatever needs you.

export function openRecap() {
  const { recap } = useGame.getState();
  if (!recap) send({ t: 'recap' });
  useGame.setState({ modal: { type: 'recap' }, recapUnseen: false });
}

export const requestRecap = (hours) => send({ t: 'recap', hours });

export function awayFor(ms) {
  const min = Math.max(1, Math.round(ms / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return min % 60 ? `${h}h ${min % 60}m` : `${h}h`;
  return `${Math.round(h / 24)} days`;
}

const clock = (at) => {
  const d = new Date(at);
  const today = new Date().toDateString() === d.toDateString();
  return d.toLocaleString([], today ? { hour: '2-digit', minute: '2-digit' } : { weekday: 'short', hour: '2-digit', minute: '2-digit' });
};

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function RecapButton() {
  const unseen = useGame((s) => s.recapUnseen);
  return (
    <button className={`btn ${unseen ? 'recap-unseen' : ''}`} title="While you were away" onClick={openRecap}>
      📰{unseen && <span className="recap-dot" />}
    </button>
  );
}

function openAgent(agent) {
  if (agent?.deskId) openModal({ type: 'terminal', agentId: agent.id });
  else if (agent) openModal({ type: 'agent', agentId: agent.id });
}

function NeedsYou({ recap }) {
  const agents = useGame((s) => s.agents);
  const myName = useGame((s) => s.myName);
  const requests = useGame((s) => s.accessRequests);
  const mine = (a) => a.owner.toLowerCase() === myName.toLowerCase();
  // Live, so an answered hand or request drops off while the recap is open.
  const since = Object.fromEntries((recap?.highlights?.hands || []).map((h) => [h.agentId, h.since]));
  const hands = Object.values(agents)
    .filter((a) => a.deskId && a.status === 'waiting')
    .sort((a, b) => mine(b) - mine(a) || a.name.localeCompare(b.name));
  if (!hands.length && !requests.length) return null;
  const decide = (id, decision) => send({ t: 'access-decide', id, decision });
  return (
    <div className="recap-needs">
      <div className="recap-section">Needs you</div>
      {hands.map((a) => (
        <div key={a.id} className={`recap-alert ${mine(a) ? 'mine' : ''}`}>
          <span className="recap-alert-icon">✋</span>
          <div className="grow">
            <b>{a.name}</b> <span className="muted small">{mine(a) ? 'yours' : `${a.owner}'s`}{since[a.id] ? ` · hand up since ${clock(since[a.id])}` : ' · hand up'}</span>
            {a.activity && <div className="muted small ellipsis">{a.activity}</div>}
          </div>
          <button className="btn primary small-btn" onClick={() => openAgent(a)}>🖥️ Open terminal</button>
        </div>
      ))}
      {requests.map((r) => (
        <div key={r.id} className="recap-alert mine">
          <span className="recap-alert-icon">🔑</span>
          <div className="grow">
            <b>{r.from}</b> wants to use <b>{r.agentName}</b>
            <div className="muted small">asked {clock(r.at)}</div>
          </div>
          <button className="btn primary small-btn" onClick={() => decide(r.id, 'once')} title="Until the agent next goes home">Allow once</button>
          <button className="btn small-btn" onClick={() => decide(r.id, 'always')}>Always</button>
          <button className="btn danger small-btn" onClick={() => decide(r.id, 'deny')}>Deny</button>
        </div>
      ))}
    </div>
  );
}

function AgentRow({ row }) {
  const agent = useGame((s) => s.agents[row.id]);
  const color = agent?.color || row.color || '#94a3b8';
  return (
    <div className={`recap-agent ${row.mine ? 'mine' : ''}`}>
      <div className="recap-agent-head">
        <span className="dot" style={{ background: color }} />
        <b>{agent?.name || row.name}</b>
        <span className={`owner ${row.mine ? 'you' : ''}`}>{row.mine ? 'yours' : `${row.owner}'s`}</span>
        <span className="grow" />
        {agent && (
          <button className="btn small-btn" onClick={() => openAgent(agent)}>{agent.deskId ? '🖥️ Terminal' : '🪪 Card'}</button>
        )}
      </div>
      <div className="recap-chips">
        {row.tasks > 0 && <span className="recap-chip">✅ {plural(row.tasks, 'task')}</span>}
        {Object.entries(row.xp).map(([skill, xp]) => (
          <span key={skill} className="skill-chip" style={{ borderColor: SKILL_INFO[skill]?.color }} title={SKILL_INFO[skill]?.label}>
            {SKILL_INFO[skill]?.icon} +{xp} XP
          </span>
        ))}
        {row.levelUps.map((l, i) => (
          <span key={i} className="recap-chip levelup">🎉 {l.overall ? `Lv ${l.level} overall` : `${SKILL_INFO[l.skill]?.label || l.skill} Lv ${l.level}`}</span>
        ))}
        {row.lessonsTotal > 0 && <span className="recap-chip">📖 +{plural(row.lessonsTotal, 'lesson')}</span>}
        {row.prsOpened > 0 && <span className="recap-chip">🔀 {plural(row.prsOpened, 'PR')} opened</span>}
        {row.prsMerged > 0 && <span className="recap-chip">🎉 {plural(row.prsMerged, 'PR')} merged</span>}
        {row.borrowedBy.length > 0 && <span className="recap-chip">🤝 borrowed by {row.borrowedBy.join(', ')}</span>}
      </div>
      {row.tasksDone.length > 0 && (
        <ul className="recap-tasks">
          {row.tasksDone.map((t, i) => (
            <li key={i}>
              <span className="ellipsis">{SKILL_INFO[t.skill]?.icon} {t.summary}</span>
              <span className="muted small">{t.xp ? `+${t.xp} XP · ` : ''}{clock(t.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function RecapModal() {
  const recap = useGame((s) => s.recap);
  const office = useGame((s) => s.office);
  useEffect(() => useGame.setState({ recapUnseen: false }), []);
  const t = recap?.totals;
  const away = recap && (recap.until || Date.now()) - recap.since;
  const also = t && [
    t.hired && `${plural(t.hired, 'agent')} hired`,
    t.borrowed && `${t.borrowed} borrowed`,
    t.sentHome && `${t.sentHome} sent home`,
    t.accessRequests && plural(t.accessRequests, 'access request'),
  ].filter(Boolean);
  return (
    <Modal title="👋 While you were away" className="recap-modal">
      <div className="modal-body recap">
        {!recap ? (
          <p className="muted">Catching up…</p>
        ) : (
          <>
            <p className="recap-lead">
              In the <b>{away ? awayFor(away) : 'while'}</b> since {clock(recap.since)}, here's what happened in {office.name}.
            </p>
            <NeedsYou recap={recap} />
            {recap.empty || (!t.tasks && !t.xp && !recap.agents.length) ? (
              <p className="muted recap-quiet">All quiet: nobody finished any work{also?.length ? ` (${also.join(', ')})` : ''}.</p>
            ) : (
              <>
                <div className="stats-row recap-totals">
                  {[
                    ['✅', t.tasks, 'tasks done'], ['⭐', t.xp.toLocaleString(), 'XP earned'], ['🎉', t.levelUps, 'level-ups'],
                    ['📖', t.lessons, 'lessons learned'], ['🔀', t.prsOpened, 'PRs opened'], ['✔️', t.prsMerged, 'PRs merged'],
                  ].map(([icon, v, k]) => (
                    <div key={k} className="stat"><b>{icon} {v}</b><span>{k}</span></div>
                  ))}
                </div>
                <div className="recap-agents">
                  {recap.agents.map((row) => <AgentRow key={row.id} row={row} />)}
                </div>
                {also?.length > 0 && <p className="muted small">Also: {also.join(' · ')}.</p>}
              </>
            )}
          </>
        )}
      </div>
      <div className="modal-foot">
        <span className="muted small">Reopen any time with 📰 or from Help.</span>
        <span className="grow" />
        <button className="btn" onClick={() => requestRecap(24)}>🕒 Last 24h</button>
        <button className="btn primary" onClick={closeModal}>Got it</button>
      </div>
    </Modal>
  );
}
