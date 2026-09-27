import { useGame, send } from '../net.js';

// Using someone else's agent takes their permission; watching doesn't.
export function canUseAgent(agent, myName) {
  if (!agent || !myName) return false;
  return agent.owner.toLowerCase() === myName.toLowerCase() || Boolean(agent.access?.[myName.toLowerCase()]);
}

export const requestAccess = (agentId) => send({ t: 'access-request', agentId });

export function RequestAccessButton({ agent, label }) {
  return (
    <button className="btn primary" onClick={() => requestAccess(agent.id)}>
      🔑 {label || `Ask ${agent.owner} for access`}
    </button>
  );
}

// For owners: people asking to use your agents, answered right here.
export function AccessRequests() {
  const requests = useGame((s) => s.accessRequests);
  if (!requests?.length) return null;
  const decide = (id, decision) => send({ t: 'access-decide', id, decision });
  return (
    <div className="access-requests panel" role="dialog" aria-label="Access requests">
      <div className="panel-title">ACCESS REQUESTS <span>{requests.length}</span></div>
      {requests.map((r) => (
        <div key={r.id} className="access-request">
          <div>
            <b>{r.from}</b> wants to use <b>{r.agentName}</b>
          </div>
          <div className="access-actions">
            <button className="btn primary small-btn" onClick={() => decide(r.id, 'once')} title="Until the agent next goes home">Allow once</button>
            <button className="btn small-btn" onClick={() => decide(r.id, 'always')}>Always</button>
            <button className="btn danger small-btn" onClick={() => decide(r.id, 'deny')}>Deny</button>
          </div>
        </div>
      ))}
    </div>
  );
}

// On the agent card: who else may use it (owner can revoke), or your own standing.
export function AgentAccess({ agent }) {
  const myName = useGame((s) => s.myName);
  const mine = agent.owner.toLowerCase() === myName.toLowerCase();
  const grants = Object.entries(agent.access || {});
  if (!mine) {
    const g = agent.access?.[myName.toLowerCase()];
    return (
      <div className="access-card">
        <b>Access</b>{' '}
        {g ? (
          <span className="muted small">{agent.owner} lets you use {agent.name}{g === 'always' ? '' : ' until it next goes home'}.</span>
        ) : (
          <>
            <span className="muted small">You can watch {agent.name}; using it takes {agent.owner}'s permission.</span> <RequestAccessButton agent={agent} />
          </>
        )}
      </div>
    );
  }
  return (
    <div className="access-card">
      <b>Who else can use {agent.name}</b>{' '}
      {grants.length === 0 && <span className="muted small">Only you. Others can watch, and ask you for access.</span>}
      {grants.map(([name, type]) => (
        <span key={name} className="grant">
          {name} <span className="muted small">{type === 'always' ? 'always' : 'until it goes home'}</span>
          <button className="icon-btn" title={`Take back ${name}'s access`} onClick={() => send({ t: 'access-revoke', agentId: agent.id, name })}>×</button>
        </span>
      ))}
    </div>
  );
}
