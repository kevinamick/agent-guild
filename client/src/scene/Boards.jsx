// The boards: black steel framed cork pinboards for issues / work items and pull
// requests (post-its with brass pins, bounty ribbons), and the Guild Hall's dark
// glass displays (the leaderboard, and the "Last 24h" digest above it).
import { useEffect, useMemo, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { noteColor } from '../ui/noteColors.js';
import { useGame } from '../net.js';
import { decorKit, box, merge } from './decor.js';

const PIN = new THREE.SphereGeometry(0.05, 12, 8);
const frames = {};
// A steel frame round a w x h panel (t thick, sticking out `depth`), plus a backing plate.
function frameGeometry(w, h, t = 0.08, depth = 0.12) {
  const key = `${w}:${h}:${t}`;
  return (frames[key] ??= merge([
    box(w + t * 2, t, depth, [0, h / 2 + t / 2, 0]),
    box(w + t * 2, t, depth, [0, -h / 2 - t / 2, 0]),
    box(t, h, depth, [-w / 2 - t / 2, 0, 0]),
    box(t, h, depth, [w / 2 + t / 2, 0, 0]),
    box(w, h, 0.04, [0, 0, -depth / 2 + 0.02]),
  ]));
}

function useBoardMaterials() {
  const gl = useThree((s) => s.gl);
  const k = decorKit(gl);
  return useMemo(
    () => ({
      k,
      cork: new THREE.MeshStandardMaterial({ map: k.tex.cork, roughness: 1 }),
      // dark smoked glass with a faint sheen
      display: new THREE.MeshStandardMaterial({ color: '#14211c', roughness: 0.18, metalness: 0.1, envMap: k.env, envMapIntensity: 0.35 }),
    }),
    [k],
  );
}

function StickyNote({ item, index, color, bounty, pin }) {
  const col = index % 3;
  const row = Math.floor(index / 3);
  return (
    // In front of the cork (z 0.07), or only the pin and text show.
    <group position={[-1.9 + col * 1.9, 0.75 - row * 1.35, 0.1]} rotation={[0, 0, ((index * 37) % 7 - 3) * 0.015]}>
      <mesh>
        <planeGeometry args={[1.55, 1.15]} />
        {/* A little glow keeps post-it colours bright under the office lights. */}
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.3} roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.5, 0.03]} geometry={PIN} material={pin} />
      <Html transform position={[0, 0, 0.01]} scale={0.38} zIndexRange={[4, 0]} style={{ pointerEvents: 'none' }}>
        <div className="note-3d">
          <b>#{item.number}</b>
          <span>{item.title}</span>
        </div>
      </Html>
      {bounty && (
        <group position={[0.52, -0.5, 0.02]} rotation={[0, 0, 0.12]}>
          <mesh>
            <planeGeometry args={[0.62, 0.3]} />
            <meshStandardMaterial color="#facc15" emissive="#facc15" emissiveIntensity={0.4} />
          </mesh>
          <Html transform position={[0, 0, 0.01]} scale={0.38} zIndexRange={[4, 0]} style={{ pointerEvents: 'none' }}>
            <div className="note-bounty-3d">💰 {bounty.amount}</div>
          </Html>
        </group>
      )}
    </group>
  );
}

export function Corkboard({ board, items, bounties = [] }) {
  const m = useBoardMaterials();
  const rot = board.side ? [0, Math.PI / 2, 0] : [0, 0, 0];
  return (
    <group position={[board.x, 2.6, board.z]} rotation={rot}>
      <mesh geometry={frameGeometry(6.24, 3.14)} material={m.k.steel} castShadow />
      <mesh position={[0, 0, 0.05]} material={m.cork}>
        <planeGeometry args={[6.24, 3.14]} />
      </mesh>
      <Html transform position={[0, 1.95, 0.1]} scale={0.7} zIndexRange={[4, 0]} style={{ pointerEvents: 'none' }}>
        <div className="board-title-3d">{board.label}</div>
      </Html>
      {items.slice(0, 6).map((item, i) => (
        <StickyNote key={item.number} item={item} index={i} color={noteColor(item, board.id)} bounty={bounties.find((b) => b.number === item.number)} pin={m.k.brass} />
      ))}
    </group>
  );
}

// A dark glass display in a steel frame with a thin brass line inside it.
function Display({ w, h, children }) {
  const m = useBoardMaterials();
  return (
    <>
      <mesh geometry={frameGeometry(w, h, 0.1, 0.12)} material={m.k.steel} castShadow />
      <mesh geometry={frameGeometry(w - 0.12, h - 0.12, 0.02, 0.1)} material={m.k.brass} position={[0, 0, 0.01]} />
      <mesh position={[0, 0, 0.05]} material={m.display}>
        <planeGeometry args={[w - 0.16, h - 0.16]} />
      </mesh>
      {children}
    </>
  );
}

// Alternates between the all-time levels and this week's XP (with last week's MVP).
export function GuildHall({ board, agents }) {
  const mvp = useGame((s) => s.week?.mvp);
  const [weekly, setWeekly] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setWeekly((w) => !w), 12000);
    return () => clearInterval(t);
  }, []);
  const top = weekly
    ? Object.values(agents).filter((a) => a.week?.xp > 0).sort((a, b) => b.week.xp - a.week.xp || b.week.bounties - a.week.bounties).slice(0, 5)
    : Object.values(agents).sort((a, b) => b.total - a.total).slice(0, 5);
  return (
    <group position={[board.x, 2.6, board.z]} rotation={[0, Math.PI / 2, 0]}>
      <Display w={5.2} h={3.1}>
        <Html transform position={[0, 0, 0.1]} scale={0.4} zIndexRange={[4, 0]} style={{ pointerEvents: 'none' }}>
          <div className="guild-3d">
            <div className="guild-3d-title">{weekly ? '📅 This week' : '🏆 Guild Hall'}</div>
            {top.length === 0 && <div className="guild-3d-empty">{weekly ? 'No XP earned yet this week.' : 'No agents yet. Hire one at a desk!'}</div>}
            {top.map((a, i) => (
              <div key={a.id} className="guild-3d-row">
                <span>{['🥇', '🥈', '🥉', '4', '5'][i]}</span>
                <span className="dot" style={{ background: a.color }} />
                <b>{a.name}</b>
                <em>{weekly ? `${a.week.xp} XP${a.week.bounties ? ` · 💰${a.week.bounties}` : ''}` : `Lv ${a.level}`}</em>
                <small>{a.owner}</small>
              </div>
            ))}
            {weekly && mvp && <div className="guild-3d-mvp">⭐ Last week's MVP: <b>{mvp.name}</b> ({mvp.xp} XP)</div>}
          </div>
        </Html>
      </Display>
    </group>
  );
}

// Above the Guild Hall board: office-wide highlights from the last 24 hours.
export function GuildDigest({ board }) {
  const d = useGame((s) => s.digest);
  const stats = d && [
    ['✅', d.tasks, d.tasks === 1 ? 'task' : 'tasks'],
    ['⭐', d.xp.toLocaleString(), 'XP'],
    ['🔀', d.prsOpened, d.prsOpened === 1 ? 'PR' : 'PRs'],
    ['🎉', d.levelUps, d.levelUps === 1 ? 'level-up' : 'level-ups'],
  ];
  return (
    <group position={[board.x, 5.6, board.z]} rotation={[0, Math.PI / 2, 0]}>
      <Display w={5.2} h={1.9}>
        <Html transform position={[0, 0, 0.1]} scale={0.4} zIndexRange={[4, 0]} style={{ pointerEvents: 'none' }}>
          <div className="digest-3d">
            <div className="digest-3d-title">🕒 Last 24h</div>
            {!d || (!d.tasks && !d.xp) ? (
              <div className="guild-3d-empty">A quiet day so far</div>
            ) : (
              <>
                <div className="digest-3d-stats">
                  {stats.map(([icon, n, label]) => (
                    <span key={label}><b>{icon} {n}</b>{label}</span>
                  ))}
                </div>
                <div className="digest-3d-top">
                  {d.top.map((a, i) => (
                    <span key={a.id}>
                      {['🥇', '🥈', '🥉'][i]} <b>{a.name}</b> <em>+{a.xp}</em>
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        </Html>
      </Display>
    </group>
  );
}
