import { useMemo } from 'react';
import { Html } from '@react-three/drei';
import { DESKS, BOARDS, DOOR, PLANTERS } from '../../../shared/layout.js';
import { Pictures } from './Pictures.jsx';
import { useGame } from '../net.js';
import { Laptop } from './Laptop.jsx';
import { Tv } from './Tv.jsx';
import { Room } from './Room.jsx';
import { Workstations, DESK_TOP_Y } from './Workstations.jsx';
import { LoungeNook, CoffeeBar } from './Lounge.jsx';
import { Plants } from './Plants.jsx';
import { Corkboard, GuildHall, GuildDigest } from './Boards.jsx';
import { Stairs, Mezzanine } from './Mezzanine.jsx';

// What's per desk: the laptop (its agent's live terminal) and the "free desk" marker.
// The desks and chairs themselves are instanced (see Workstations.jsx).
function Desk({ desk, status, agentId }) {
  return (
    <group>
      <group position={[desk.x, DESK_TOP_Y + 0.005, desk.z + (desk.ry === 0 ? -0.05 : 0.05)]} rotation={[0, desk.ry === 0 ? Math.PI : 0, 0]}>
        <Laptop agentId={agentId} />
      </group>
      {!status && (
        <Html position={[desk.seatX, 1.5, desk.seatZ]} center distanceFactor={14} zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
          <div className="desk-free">+</div>
        </Html>
      )}
    </group>
  );
}

export function Office() {
  const agents = useGame((s) => s.agents);
  const desks = useGame((s) => s.desks);
  const boards = useGame((s) => s.boards);
  const occupancy = useMemo(() => {
    const o = {};
    for (const [deskId, agentId] of Object.entries(desks)) o[deskId] = agents[agentId]?.status || 'starting';
    return o;
  }, [desks, agents]);

  const provider = useGame((s) => s.office.provider);
  const bounties = useGame((s) => s.bounties);
  // Bountied issues are always among the six pinned to the corkboard (biggest first).
  const bountyOf = (i) => bounties.find((b) => b.number === i.number)?.amount || 0;
  const openIssues = (boards.issues?.items || []).filter((i) => i.state === 'OPEN').sort((a, b) => bountyOf(b) - bountyOf(a));
  const openPrs = (boards.prs?.items || []).filter((p) => p.state === 'OPEN');

  return (
    <group>
      <Room />
      <Html position={[DOOR.x, 0.2, DOOR.z]} center zIndexRange={[3, 0]} style={{ pointerEvents: 'none' }}>
        <div className="floor-label">entrance</div>
      </Html>

      <Workstations />
      {DESKS.map((d) => (
        <Desk key={d.id} desk={d} status={occupancy[d.id]} agentId={desks[d.id]} />
      ))}

      <Stairs />
      <Mezzanine />

      <Corkboard board={provider === 'ado' ? { ...BOARDS[0], label: 'Work Items' } : BOARDS[0]} items={openIssues} bounties={bounties} />
      <Corkboard board={BOARDS[1]} items={openPrs} />
      <GuildHall board={BOARDS[2]} agents={agents} />
      <GuildDigest board={BOARDS[2]} />
      <Pictures />
      <Tv />
      <LoungeNook />
      <CoffeeBar />
      <Plants items={PLANTERS} />
    </group>
  );
}
