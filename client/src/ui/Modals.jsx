import { useEffect, useMemo, useState } from 'react';
import { useGame, send, openModal, closeModal } from '../net.js';
import { STATUS_COLORS } from '../scene/Characters.jsx';
import { LevelBadge, XpBar, SkillChips, EngineChip } from './Hud.jsx';
import { useHost } from '../host.js';
import {
  SKILLS, SKILL_INFO, COSMETICS, progress, playbookCapacity, turnXp, KUDOS_XP,
} from '../../../shared/progression.js';

function Modal({ title, children, onClose = closeModal, wide, className = '' }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''} ${className}`}>
        <div className="modal-head">
          <b className="modal-title">{title}</b>
          <span className="grow" />
          <button className="icon-btn" onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

const ago = (iso) => {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

// ---------------------------------------------------------------- boards

const COLUMNS = {
  issues: [
    ['open', '📥 Open'],
    ['progress', '🚧 In progress'],
    ['closed', '✅ Closed'],
  ],
  prs: [
    ['draft', '✏️ Draft'],
    ['review', '👀 In review'],
    ['approved', '👍 Approved'],
    ['merged', '🎉 Merged'],
    ['closed', '🗑️ Closed'],
  ],
};

function columnOf(kind, item, activeRefs) {
  if (kind === 'issues') {
    if (item.state !== 'OPEN') return 'closed';
    return activeRefs.has(`issue:${item.number}`) ? 'progress' : 'open';
  }
  if (item.state === 'MERGED') return 'merged';
  if (item.state === 'CLOSED') return 'closed';
  if (item.isDraft) return 'draft';
  return item.reviewDecision === 'APPROVED' ? 'approved' : 'review';
}

export function BoardModal({ kind }) {
  const board = useGame((s) => s.boards[kind]);
  const agents = useGame((s) => s.agents);
  const host = useHost();
  const [selected, setSelected] = useState(null);
  useEffect(() => send({ t: 'board', kind }), [kind]);

  const activeRefs = useMemo(
    () => new Set(Object.values(agents).filter((a) => a.deskId && a.task?.ref).map((a) => `${a.task.ref.type}:${a.task.ref.number}`)),
    [agents],
  );
  const workersOn = (type, n) => Object.values(agents).filter((a) => a.deskId && a.task?.ref?.type === type && a.task.ref.number === n);

  const items = board?.items || [];
  const title = kind === 'issues' ? `📌 ${host.issuesLabel}` : '🔀 Pull Requests';
  return (
    <Modal title={title} wide className="board-modal">
      <div className="board-toolbar">
        <span className="muted small">{board?.at ? `Updated ${ago(board.at)}` : board?.error ? '' : 'Loading…'}</span>
        <button className="btn" onClick={() => send({ t: 'board', kind, force: true })}>🔄 Refresh</button>
      </div>
      {board?.error && <div className="error-box">{board.error}</div>}
      <div className="columns">
        {COLUMNS[kind].map(([col, label]) => {
          const inCol = items.filter((i) => columnOf(kind, i, activeRefs) === col);
          return (
            <div key={col} className="column">
              <div className="column-head">{label}<span>{inCol.length}</span></div>
              <div className="column-body">
                {inCol.length === 0 && <div className="muted small">Nothing here</div>}
                {inCol.map((item) => {
                  const on = workersOn(kind === 'issues' ? 'issue' : 'pr', item.number);
                  return (
                    <div key={item.number} className={`card ${kind}`} onClick={() => setSelected(item)}>
                      <div className="card-num">
                        {kind === 'prs' ? host.prRef(item.number) : `#${item.number}`}
                        {item.type && <span>{item.type}</span>}
                        {item.stateName && item.state === 'OPEN' && <span>· {item.stateName}</span>}
                        {item.mergeable === 'CONFLICTING' && <span className="warn-tag">⚠️ conflicts</span>}
                      </div>
                      <div className="card-title">{item.title}</div>
                      <div className="card-meta">
                        by {item.author?.login} {item.additions !== undefined && <><span className="add">+{item.additions}</span> <span className="del">-{item.deletions}</span></>} · {ago(item.createdAt)}
                      </div>
                      {on.length > 0 && <div className="card-workers">{on.map((a) => `🤖 ${a.name}`).join(' ')}</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {selected && <ItemDetail kind={kind} item={selected} onClose={() => setSelected(null)} />}
    </Modal>
  );
}

// Briefs for Azure DevOps repos use the Azure CLI's azure-devops extension,
// which picks up the organization and project from the git remote.
function adoBrief(skill, item) {
  if (skill === 'issue')
    return `Work on Azure DevOps work item #${item.number}: "${item.title}".\n\nRead it first with \`az boards work-item show --id ${item.number}\`. Create a new branch, implement the change, verify it, push the branch, then open a pull request with \`az repos pr create --work-items ${item.number}\` so the work item is linked.`;
  if (skill === 'review')
    return `Review Azure DevOps pull request !${item.number}: "${item.title}" (${item.headRefName} → ${item.baseRefName}).\n\nRead it with \`az repos pr show --id ${item.number}\`, then \`git fetch origin\` and read the diff with \`git diff origin/${item.baseRefName}...origin/${item.headRefName}\`. Look for bugs, risky changes and missing tests, then give me a short summary with concrete suggestions. Don't push any commits.`;
  return `Azure DevOps pull request !${item.number} ("${item.title}") has merge conflicts with ${item.baseRefName}.\n\nCheck out ${item.headRefName}, merge origin/${item.baseRefName} into it, and resolve every conflict so the intent of both sides is kept. Run the tests, then push the branch and summarize what you resolved.`;
}

function ItemDetail({ kind, item, onClose }) {
  const isIssue = kind === 'issues';
  const host = useHost();
  const ref = isIssue ? `#${item.number}` : host.prRef(item.number);
  const hireFor = (skill) => {
    const text = host.ado
      ? adoBrief(skill, item)
      : skill === 'issue'
        ? `Work on GitHub issue #${item.number}: "${item.title}".\n\nRead it first with \`gh issue view ${item.number} --comments\`. Create a new branch, implement the change, verify it, then open a pull request that closes #${item.number}.`
        : skill === 'review'
          ? `Review pull request #${item.number}: "${item.title}".\n\nUse \`gh pr view ${item.number} --comments\` and \`gh pr diff ${item.number}\`. Look for bugs, risky changes and missing tests, then give me a short summary with concrete suggestions. Don't push any commits.`
          : `Pull request #${item.number} ("${item.title}") has merge conflicts with ${item.baseRefName}.\n\nCheck out ${item.headRefName}, merge ${item.baseRefName} into it, and resolve every conflict so the intent of both sides is kept. Run the tests, then push the branch and summarize what you resolved.`;
    const noun = isIssue ? (host.ado ? item.type || 'Work item' : 'Issue') : 'PR';
    openModal({ type: 'hire', kind: skill, title: `${noun} ${ref}`, text, ref: { type: isIssue ? 'issue' : 'pr', number: item.number } });
  };
  return (
    <div className="detail-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="detail">
        <div className="modal-head">
          <b>{ref} {item.title}</b>
          <span className="grow" />
          <button className="icon-btn" onClick={onClose}>×</button>
        </div>
        <div className="detail-meta">
          <span className={`state state-${item.state.toLowerCase()}`}>{(item.stateName || item.state).toLowerCase()}</span>
          {item.type && <span className="muted small">{item.type}</span>}
          {!isIssue && <span className="muted small">{item.headRefName} → {item.baseRefName}</span>}
          <span className="muted small">by {item.author?.login} · {ago(item.createdAt)}</span>
        </div>
        <pre className="detail-body">{(item.body || '(no description)').slice(0, 2400)}</pre>
        <div className="modal-foot">
          <a href={item.url} target="_blank" rel="noreferrer" className="muted small">Open on {host.ado ? 'Azure DevOps' : 'GitHub'} ↗</a>
          <span className="grow" />
          {isIssue && item.state === 'OPEN' && <button className="btn primary" onClick={() => hireFor('issue')}>🤖 Hand to a worker</button>}
          {!isIssue && item.state === 'OPEN' && item.mergeable === 'CONFLICTING' && (
            <button className="btn warn" onClick={() => hireFor('conflict')}>🔀 Resolve conflicts</button>
          )}
          {!isIssue && item.state === 'OPEN' && <button className="btn primary" onClick={() => hireFor('review')}>🔍 Review with a worker</button>}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- hire / borrow

export function HireModal({ deskId, kind: initialKind = 'general', title, text: initialText = '', ref, agentId: preselect }) {
  const agents = useGame((s) => s.agents);
  const runners = useGame((s) => s.runners);
  const myName = useGame((s) => s.myName);
  const [kind, setKind] = useState(initialKind);
  const [text, setText] = useState(initialText);
  const [worktree, setWorktree] = useState(Boolean(initialText) && initialKind !== 'review');
  const mine = (a) => a.owner.toLowerCase() === myName.toLowerCase();
  const haveRunner = runners.some((r) => r.owner.toLowerCase() === myName.toLowerCase());

  const candidates = useMemo(
    () =>
      Object.values(agents)
        .filter((a) => a.online && !a.deskId && (mine(a) || a.lendable))
        .sort((a, b) => b.skillLevels[kind] - a.skillLevels[kind] || b.total - a.total),
    [agents, kind],
  );
  const busy = Object.values(agents).filter((a) => a.deskId).length;
  const [choice, setChoice] = useState(preselect || null);
  const effective = choice ?? (candidates[0]?.skillLevels[kind] > 1 || !haveRunner ? candidates[0]?.id ?? 'new' : 'new');
  // Engines come from whichever runner will host the agent: yours for a recruit, the owner's otherwise.
  const hostName = effective === 'new' ? myName : agents[effective]?.owner || '';
  const engines = runners.find((r) => r.owner.toLowerCase() === hostName.toLowerCase())?.engines || [];
  const [engineChoice, setEngineChoice] = useState(null);
  const engine = [engineChoice, agents[effective]?.engine].find((e) => e && engines.some((x) => x.id === e)) || engines[0]?.id;

  const hire = () => {
    if (effective === 'new' && !haveRunner) return;
    send({
      t: 'hire',
      deskId,
      agentId: effective === 'new' ? null : effective,
      task: text.trim() ? { text: text.trim(), kind, title, ref } : { kind },
      worktree,
      engine,
    });
    closeModal();
  };

  return (
    <Modal title={title ? `🤖 Hand ${title} to a worker` : `🪑 Hire for ${deskId ? `Desk ${deskId}` : 'a desk'}`}>
      <div className="modal-body">
        <label className="field-label">Task type (earns XP in this skill)</label>
        <div className="kind-row">
          {SKILLS.map((s) => (
            <button key={s} className={`kind-btn ${kind === s ? 'on' : ''}`} style={{ '--c': SKILL_INFO[s].color }} onClick={() => setKind(s)}>
              {SKILL_INFO[s].icon} {SKILL_INFO[s].label}
            </button>
          ))}
        </div>

        <label className="field-label">Who takes it? <span className="muted small">sorted by {SKILL_INFO[kind].label} level · {busy} busy at desks</span></label>
        <div className="picker">
          <div className={`pick ${effective === 'new' ? 'on' : ''} ${haveRunner ? '' : 'disabled'}`} onClick={() => haveRunner && setChoice('new')}>
            <div className="pick-main">✨ <b>New recruit</b> <span className="muted small">Lv 1 · empty playbook · runs on your machine</span></div>
            {!haveRunner && <div className="muted small">Start your runner to recruit your own agents</div>}
          </div>
          {candidates.map((a, i) => {
            const lessons = a.lessons?.[kind] || 0;
            return (
              <div key={a.id} className={`pick ${effective === a.id ? 'on' : ''}`} onClick={() => setChoice(a.id)}>
                <div className="pick-main">
                  <span className="dot" style={{ background: a.color }} />
                  <b>{a.name}</b>
                  <LevelBadge level={a.level} />
                  <EngineChip engine={a.engine} />
                  <span className="skill-chip" style={{ borderColor: SKILL_INFO[kind].color }}>
                    {SKILL_INFO[kind].icon} {SKILL_INFO[kind].short} {a.skillLevels[kind]}
                  </span>
                  <span className="muted small">📖 {lessons}/{playbookCapacity(a.skillLevels[kind])} lessons · {a.stats.tasks} tasks</span>
                  <span className="grow" />
                  {i === 0 && a.skillLevels[kind] > 1 && <span className="rec">recommended</span>}
                  <span className={`owner ${mine(a) ? 'you' : ''}`}>{mine(a) ? 'yours' : `borrow from ${a.owner}`}</span>
                </div>
              </div>
            );
          })}
          {!candidates.length && <div className="muted small pad">No agents at home right now. Coworkers' agents show up here when their runners are online and lending.</div>}
        </div>

        {engines.length > 0 && (
          <>
            <label className="field-label">Engine <span className="muted small">what {hostName === myName ? 'your' : `${hostName}'s`} runner offers; the playbook and XP carry over between engines</span></label>
            <div className="kind-row">
              {engines.map((e) => (
                <button key={e.id} className={`kind-btn ${engine === e.id ? 'on' : ''}`} style={{ '--c': e.id === 'copilot' ? '#d9d0fb' : '#f4c7b3' }} onClick={() => setEngineChoice(e.id)}>
                  {e.label}
                </button>
              ))}
            </div>
          </>
        )}

        <label className="field-label">Brief <span className="muted small">(optional; you can prompt later)</span></label>
        <textarea
          className="textarea"
          rows={5}
          value={text}
          autoFocus
          placeholder="What should they work on?"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              hire();
            }
          }}
        />
        <label className="check">
          <input type="checkbox" checked={worktree} onChange={(e) => setWorktree(e.target.checked)} /> 🌿 Work in its own git worktree & branch
        </label>
      </div>
      <div className="modal-foot">
        <span className="muted small">Enter to send · Shift+Enter for a new line</span>
        <span className="grow" />
        <button className="btn" onClick={closeModal}>Cancel</button>
        <button className="btn primary" disabled={effective === 'new' && !haveRunner} onClick={hire}>Hire & start</button>
      </div>
    </Modal>
  );
}

export function PromptModal({ agentId }) {
  const agent = useGame((s) => s.agents[agentId]);
  const [text, setText] = useState('');
  const [kind, setKind] = useState(agent?.task?.kind || 'general');
  if (!agent) return null;
  const submit = () => {
    if (!text.trim()) return;
    send({ t: 'prompt', agentId, text: text.trim(), kind });
    closeModal();
  };
  return (
    <Modal title={`💬 Prompt ${agent.name}`}>
      <div className="modal-body">
        <div className="kind-row">
          {SKILLS.map((s) => (
            <button key={s} className={`kind-btn ${kind === s ? 'on' : ''}`} style={{ '--c': SKILL_INFO[s].color }} onClick={() => setKind(s)}>
              {SKILL_INFO[s].icon} {SKILL_INFO[s].label} <small>Lv {agent.skillLevels[s]}</small>
            </button>
          ))}
        </div>
        <textarea
          className="textarea"
          rows={5}
          autoFocus
          value={text}
          placeholder={`Tell ${agent.name} what to do…`}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
      </div>
      <div className="modal-foot">
        <span className="muted small">{agent.owner}'s agent · Enter to send</span>
        <span className="grow" />
        <button className="btn" onClick={closeModal}>Cancel</button>
        <button className="btn primary" onClick={submit}>Send</button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- guild roster

export function RosterModal() {
  const agents = useGame((s) => s.agents);
  const myName = useGame((s) => s.myName);
  const [sort, setSort] = useState('total');
  const list = Object.values(agents).sort((a, b) => (sort === 'total' ? b.total - a.total : b.skillLevels[sort] - a.skillLevels[sort] || b.total - a.total));
  const owners = Object.values(
    list.reduce((acc, a) => {
      const o = (acc[a.owner] ??= { owner: a.owner, agents: 0, xp: 0, lent: 0 });
      o.agents++;
      o.xp += a.total;
      o.lent += a.stats.borrowed;
      return acc;
    }, {}),
  ).sort((a, b) => b.xp - a.xp);

  return (
    <Modal title="🏆 Guild Hall" wide>
      <div className="modal-body">
        <div className="owner-row">
          {owners.map((o, i) => (
            <div key={o.owner} className="owner-card">
              <b>{i === 0 ? '👑 ' : ''}{o.owner}</b>
              <span className="muted small">{o.agents} agents · {o.xp.toLocaleString()} XP · lent {o.lent}×</span>
            </div>
          ))}
        </div>
        <div className="sort-row">
          <span className="muted small">Rank by</span>
          <button className={`kind-btn ${sort === 'total' ? 'on' : ''}`} style={{ '--c': '#a855f7' }} onClick={() => setSort('total')}>⭐ Overall</button>
          {SKILLS.map((s) => (
            <button key={s} className={`kind-btn ${sort === s ? 'on' : ''}`} style={{ '--c': SKILL_INFO[s].color }} onClick={() => setSort(s)}>
              {SKILL_INFO[s].icon} {SKILL_INFO[s].label}
            </button>
          ))}
        </div>
        <table className="roster">
          <thead>
            <tr><th>#</th><th>Agent</th><th>Owner</th><th>Level</th><th>Skills</th><th>Tasks</th><th>PRs</th><th>👏</th><th>Where</th></tr>
          </thead>
          <tbody>
            {list.map((a, i) => (
              <tr key={a.id} onClick={() => openModal({ type: 'agent', agentId: a.id })}>
                <td>{i + 1}</td>
                <td>
                  <span className="dot" style={{ background: a.color }} /> <b>{a.name}</b>
                  <div className="muted small">{a.title}</div>
                </td>
                <td>{a.owner.toLowerCase() === myName.toLowerCase() ? <b>you</b> : a.owner}{a.online && !a.lendable && ' 🔒'}</td>
                <td>
                  <LevelBadge level={a.level} /> <span className="muted small">{a.total.toLocaleString()} XP</span>
                  <XpBar xp={a.total / 1.5} thin color={a.color} />
                </td>
                <td><SkillChips agent={a} highlight={sort} /></td>
                <td>{a.stats.tasks}</td>
                <td>{a.stats.prsOpened}/{a.stats.prsMerged}</td>
                <td>{a.stats.kudos}</td>
                <td>
                  {a.deskId ? <span className="pill" style={{ background: STATUS_COLORS[a.status] }}>desk {a.deskId}</span>
                    : a.online ? <span className="pill" style={{ background: '#a7f3d0' }}>available</span>
                    : <span className="pill" style={{ background: '#e2e8f0' }}>offline</span>}
                </td>
              </tr>
            ))}
            {!list.length && (
              <tr><td colSpan={9} className="muted pad">No agents yet. Walk up to an empty desk and press E to recruit one.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

export function AgentModal({ agentId }) {
  const agent = useGame((s) => s.agents[agentId]);
  const pb = useGame((s) => s.playbooks[agentId]);
  const myName = useGame((s) => s.myName);
  const [tab, setTab] = useState(null);
  useEffect(() => send({ t: 'playbook', agentId }), [agentId]);
  if (!agent) return null;
  const openTab = tab || SKILLS.reduce((b, s) => ((agent.lessons?.[s] || 0) > (agent.lessons?.[b] || 0) ? s : b), 'general');
  const mine = agent.owner.toLowerCase() === myName.toLowerCase();
  const available = agent.online && !agent.deskId && (mine || agent.lendable);
  const nextCosmetic = COSMETICS.find((c) => c.level > agent.level);
  const overall = progress(agent.total / 1.5);

  return (
    <Modal title={`🤖 ${agent.name}`} wide>
      <div className="modal-body agent-card">
        <div className="agent-hero">
          <div className="avatar" style={{ background: agent.color }}>{agent.name[0]}</div>
          <div className="grow">
            <div className="hero-line">
              <LevelBadge level={agent.level} /> <b className="hero-title">{agent.title}</b> <EngineChip engine={agent.engine} />
            </div>
            <div className="muted small">
              {mine ? 'Your agent' : `${agent.owner}'s agent`} · {agent.total.toLocaleString()} XP · next level in {Math.ceil((overall.need - overall.into) * 1.5)} XP
              {nextCosmetic && ` · unlocks ${nextCosmetic.label} at Lv ${nextCosmetic.level}`}
            </div>
            <XpBar xp={agent.total / 1.5} color={agent.color} />
          </div>
          {agent.deskId ? (
            <button className="btn" onClick={() => openModal({ type: 'terminal', agentId })}>🖥️ Open terminal</button>
          ) : (
            <button className="btn primary" disabled={!available} title={available ? '' : 'Offline, at a desk, or not lending'} onClick={() => openModal({ type: 'hire', agentId, kind: 'general' })}>
              {mine ? '🪑 Hire to a desk' : `🤝 Borrow from ${agent.owner}`}
            </button>
          )}
        </div>

        <div className="skills-grid">
          {SKILLS.map((s) => {
            const p = progress(agent.xp[s] || 0);
            const cap = playbookCapacity(p.level);
            return (
              <div key={s} className="skill-row">
                <span className="skill-label">{SKILL_INFO[s].icon} {SKILL_INFO[s].label}</span>
                <b>Lv {p.level}</b>
                <XpBar xp={agent.xp[s] || 0} color={SKILL_INFO[s].color} />
                <span className="muted small">📖 {agent.lessons?.[s] || 0}/{cap} lessons</span>
              </div>
            );
          })}
        </div>

        <div className="stats-row">
          {[
            ['Tasks', agent.stats.tasks], ['PRs opened', agent.stats.prsOpened], ['PRs merged', agent.stats.prsMerged],
            ['Reviews', agent.stats.reviews], ['Kudos', agent.stats.kudos], ['Times borrowed', agent.stats.borrowed],
          ].map(([k, v]) => (
            <div key={k} className="stat"><b>{v}</b><span>{k}</span></div>
          ))}
        </div>

        <div className="cosmetics">
          {COSMETICS.map((c) => (
            <span key={c.id} className={`cosmetic ${agent.level >= c.level ? 'got' : ''}`}>{agent.level >= c.level ? '✓' : '🔒'} {c.label} · Lv {c.level}</span>
          ))}
        </div>

        <div className="playbook">
          <div className="tabs">
            {SKILLS.map((s) => (
              <button key={s} className={`tab ${openTab === s ? 'on' : ''}`} onClick={() => setTab(s)}>
                {SKILL_INFO[s].icon} {SKILL_INFO[s].label} ({agent.lessons?.[s] || 0})
              </button>
            ))}
          </div>
          <pre className="playbook-body">
            {pb?.error
              ? `Playbook unavailable: ${pb.error}`
              : !pb
                ? 'Loading playbook from the owner’s machine…'
                : pb.playbooks?.[openTab]?.trim() || `No ${SKILL_INFO[openTab].label} lessons yet. ${agent.name} writes lessons here after finishing tasks, and higher levels let it keep more.`}
          </pre>
        </div>
      </div>
    </Modal>
  );
}

export function HelpModal() {
  const sample = turnXp({ toolCalls: 12, durationMs: 4 * 60000, prOpened: true });
  return (
    <Modal title="How Agent Guild works">
      <div className="modal-body help">
        <h4>Controls</h4>
        <div className="help-grid">
          <kbd>WASD</kbd><span>walk around</span>
          <kbd>E</kbd><span>interact: open a terminal, hire at an empty desk, open a board</span>
          <kbd>P</kbd><span>prompt the agent you're next to</span>
          <kbd>K</kbd><span>give kudos (+{KUDOS_XP} XP, once per task)</span>
          <kbd>C</kbd><span>view the agent's card and playbook</span>
          <kbd>X</kbd><span>send the agent home (it keeps its XP and playbook)</span>
          <kbd>T</kbd><span>chat</span>
          <kbd>G</kbd><span>Guild Hall leaderboard</span>
          <kbd>Ctrl ]</kbd><span>step away from a terminal</span>
        </div>
        <h4>Leveling</h4>
        <p>Agents earn XP in the skill a task belongs to: 📌 Issue Fixer, 🔍 Reviewer, 🔀 Conflict Resolver or 🧰 Generalist. A finished task pays for tool calls and focus time, with bonuses for opening, reviewing and merging PRs. For example, a 4-minute fix with 12 tool calls that opens a PR earns <b>{sample.amount} XP</b>.</p>
        <p><b>Levels make agents stronger.</b> After each task, an agent writes what it learned into its per-skill <i>playbook</i>, and that playbook is injected into every session it starts. Higher skill levels let it keep more lessons, so a Lv 8 Reviewer brings 19 learned lessons about your repo to a review, while a new recruit brings none. Levels also unlock hats, an aura and a crown.</p>
        <h4>Engines</h4>
        <p>An agent can run on <b>Claude Code</b> or <b>GitHub Copilot CLI</b>, whichever its owner's runner has installed. You pick the engine when hiring. The agent's level, XP and playbook stay the same on either engine, because the lessons are about your repo, not about the tool.</p>
        <h4>Borrowing</h4>
        <p>Every agent runs on its owner's machine through their runner. When you hire at a desk you can pick any coworker's agent that is at home and lending. It runs on their machine, and you both watch the same terminal. XP goes to the agent, and the Guild Hall shows who lends the most.</p>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- team & invites

function Copyable({ label, value, secret }) {
  const [copied, setCopied] = useState(false);
  const [shown, setShown] = useState(!secret);
  return (
    <div className="copyable">
      <label className="field-label">{label}</label>
      <div className="copy-row">
        <code className="copy-value">{shown ? value : value.replace(/ag_[\w-]+/g, 'ag_••••••••')}</code>
        {secret && <button className="btn" onClick={() => setShown(!shown)}>{shown ? 'Hide' : 'Show'}</button>}
        <button
          className="btn"
          onClick={() => {
            navigator.clipboard?.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

export function TeamModal() {
  const admin = useGame((s) => s.admin);
  const members = useGame((s) => s.members);
  const invite = useGame((s) => s.invite);
  const links = useGame((s) => s.myLinks);
  const players = useGame((s) => s.players);
  const runners = useGame((s) => s.runners);
  const [name, setName] = useState('');
  useEffect(() => {
    send({ t: 'my-links' });
    if (admin) send({ t: 'members' });
    return () => useGame.setState({ invite: null });
  }, [admin]);
  const myKey = (() => {
    try {
      return JSON.parse(localStorage.getItem('guild-login') || '{}').key || '';
    } catch {
      return '';
    }
  })();
  const online = (n) => players.some((p) => p.name === n);
  const hosting = (n) => runners.some((r) => r.owner === n);

  return (
    <Modal title="👥 Team">
      <div className="modal-body">
        <h4 className="section-title">Host your own agents</h4>
        <p className="muted small">
          Run this in a clone of Agent Guild (<code>npm install</code> first). Your agents run on your machine with your Claude login, in your checkout of the team repo.
        </p>
        {links && <Copyable label="Runner command" value={links.runnerCmd.replace('<your key>', myKey)} secret />}

        {admin && (
          <>
            <h4 className="section-title">Invite someone</h4>
            <form
              className="copy-row"
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim()) send({ t: 'invite', name: name.trim() });
                setName('');
              }}
            >
              <input className="input" value={name} maxLength={24} placeholder="Their name, e.g. Alice" onChange={(e) => setName(e.target.value)} />
              <button className="btn primary">Create key</button>
            </form>
            {invite && (
              <div className="invite-box">
                <b>Key for {invite.name}.</b> <span className="muted small">It's shown only this once. Send it privately.</span>
                <Copyable label="Join link (opens the office signed in)" value={invite.joinUrl} secret />
                <Copyable label="Their runner command" value={invite.runnerCmd} secret />
              </div>
            )}
            <h4 className="section-title">Members</h4>
            <table className="roster">
              <tbody>
                {(members || []).map((m) => (
                  <tr key={m.name}>
                    <td>
                      <b>{m.name}</b> {m.admin && <span className="owner you">admin</span>}
                    </td>
                    <td className="muted small">{online(m.name) ? '🟢 in the office' : '⚪ away'}{hosting(m.name) ? ' · 🖥️ runner online' : ''}</td>
                    <td className="muted small">{m.keys} key{m.keys > 1 ? 's' : ''}</td>
                    <td>
                      {!m.admin && (
                        <button className="btn danger" onClick={() => confirm(`Revoke every key for ${m.name}? Their browser and runner are disconnected.`) && send({ t: 'revoke', name: m.name })}>
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </Modal>
  );
}
