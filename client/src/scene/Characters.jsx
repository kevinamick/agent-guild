import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { hatFor, badgeTier, SKILL_INFO, bestSkill } from '../../../shared/progression.js';

export const STATUS_COLORS = {
  starting: '#94a3b8',
  ready: '#38bdf8',
  working: '#facc15',
  waiting: '#f87171',
  done: '#22c55e',
  home: '#94a3b8',
};

const mat = (color, rough = 0.8) => <meshStandardMaterial color={color} roughness={rough} />;

/** Hair sits in head space: the head is a 0.38 sphere centered at the origin, face toward +z. */
function Hair({ style, color }) {
  const cap = (scale = [1.06, 0.9, 1.06], y = 0.08) => (
    <mesh position={[0, y, -0.02]} scale={scale} castShadow>
      <sphereGeometry args={[0.38, 24, 18, 0, Math.PI * 2, 0, Math.PI / 2.1]} />
      {mat(color)}
    </mesh>
  );
  switch (style) {
    case 'bald':
      return null;
    case 'buzz':
      return cap([1.015, 0.95, 1.015], 0.04);
    case 'curly':
      return (
        <group>
          {cap([1.08, 0.95, 1.08])}
          {Array.from({ length: 12 }, (_, i) => {
            const a = (i / 12) * Math.PI * 2;
            return (
              <mesh key={i} position={[Math.cos(a) * 0.3, 0.28 + (i % 3) * 0.04, Math.sin(a) * 0.3 - 0.04]} castShadow>
                <sphereGeometry args={[0.12, 10, 8]} />
                {mat(color, 0.95)}
              </mesh>
            );
          })}
        </group>
      );
    case 'afro':
      return (
        <mesh position={[0, 0.28, -0.2]} castShadow>
          <sphereGeometry args={[0.52, 22, 16]} />
          {mat(color, 1)}
        </mesh>
      );
    case 'braids':
      return (
        <group>
          {cap()}
          {/* Around the back and down both sides, so they frame the face. */}
          {Array.from({ length: 11 }, (_, i) => {
            const a = Math.PI * (0.12 + (i / 10) * 0.76) + Math.PI;
            return (
              <mesh key={i} position={[Math.cos(a) * 0.37, -0.2, -Math.sin(a) * 0.37 * -1 - 0.02]} castShadow>
                <capsuleGeometry args={[0.045, 0.5, 4, 8]} />
                {mat(color)}
              </mesh>
            );
          })}
        </group>
      );
    case 'long':
      return (
        <group>
          {cap()}
          <mesh position={[0, -0.22, -0.02]} castShadow>
            <cylinderGeometry args={[0.4, 0.46, 0.72, 24, 1, true, Math.PI * 0.3, Math.PI * 1.4]} />
            <meshStandardMaterial color={color} roughness={0.8} side={THREE.DoubleSide} />
          </mesh>
        </group>
      );
    case 'bob':
      return (
        <group>
          {cap([1.1, 0.95, 1.1])}
          <mesh position={[0, -0.04, -0.06]} castShadow>
            <cylinderGeometry args={[0.41, 0.42, 0.32, 20, 1, true, Math.PI * 0.32, Math.PI * 1.36]} />
            <meshStandardMaterial color={color} roughness={0.8} side={THREE.DoubleSide} />
          </mesh>
        </group>
      );
    case 'ponytail':
      return (
        <group>
          {cap()}
          <mesh position={[0, 0.12, -0.4]} castShadow>
            <sphereGeometry args={[0.09, 10, 8]} />
            {mat(color)}
          </mesh>
          <mesh position={[0, -0.12, -0.46]} rotation={[0.25, 0, 0]} castShadow>
            <capsuleGeometry args={[0.08, 0.36, 4, 8]} />
            {mat(color)}
          </mesh>
        </group>
      );
    case 'bun':
      return (
        <group>
          {cap()}
          <mesh position={[0, 0.36, -0.2]} castShadow>
            <sphereGeometry args={[0.16, 14, 12]} />
            {mat(color)}
          </mesh>
        </group>
      );
    case 'headscarf':
      // Wraps the head and neck and leaves the face open (its shell sits behind the face).
      return (
        <group>
          <mesh position={[0, 0.02, -0.09]} castShadow>
            <sphereGeometry args={[0.43, 24, 18]} />
            {mat(color, 0.9)}
          </mesh>
          <mesh position={[0, -0.36, -0.06]} castShadow>
            <cylinderGeometry args={[0.3, 0.42, 0.3, 20]} />
            {mat(color, 0.9)}
          </mesh>
        </group>
      );
    default:
      return cap();
  }
}

function FacialHair({ kind, color }) {
  if (kind === 'beard')
    return (
      <mesh position={[0, -0.14, 0.12]} scale={[1, 0.8, 0.85]} castShadow>
        <sphereGeometry args={[0.3, 18, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2]} />
        {mat(color)}
      </mesh>
    );
  if (kind === 'mustache')
    return (
      <mesh position={[0, -0.09, 0.355]} rotation={[0, 0, 0]}>
        <boxGeometry args={[0.2, 0.05, 0.05]} />
        {mat(color)}
      </mesh>
    );
  return null;
}

/** A walking human: the players. `avatar` comes from shared/avatar.js. */
export function Person({ name, avatar, moving, bubble, isMe }) {
  const body = useRef();
  const legL = useRef();
  const legR = useRef();
  const a = avatar || {};
  const shirt = a.shirt || '#3b82f6';
  const skin = a.skin || '#c68642';
  useFrame(({ clock }) => {
    const t = clock.elapsedTime * 12;
    const walking = moving?.current;
    const swing = walking ? Math.sin(t) * 0.5 : 0;
    if (legL.current) legL.current.rotation.x = swing;
    if (legR.current) legR.current.rotation.x = -swing;
    if (body.current) body.current.position.y = walking ? Math.abs(Math.sin(t)) * 0.05 : 0;
  });
  return (
    <group>
      <group ref={body}>
        <mesh position={[0, 0.95, 0]} castShadow>
          <capsuleGeometry args={[0.3, 0.45, 6, 14]} />
          <meshStandardMaterial color={shirt} roughness={0.7} />
        </mesh>
        {[-1, 1].map((sd) => (
          <group key={sd}>
            <mesh position={[sd * 0.36, 1.0, 0]} rotation={[0, 0, sd * 0.25]} castShadow>
              <capsuleGeometry args={[0.09, 0.35, 4, 8]} />
              <meshStandardMaterial color={shirt} roughness={0.7} />
            </mesh>
            <mesh position={[sd * 0.44, 0.74, 0]}>
              <sphereGeometry args={[0.07, 10, 8]} />
              {mat(skin, 0.6)}
            </mesh>
          </group>
        ))}
        {a.bottoms === 'skirt' && (
          <mesh position={[0, 0.62, 0]} castShadow>
            <cylinderGeometry args={[0.3, 0.44, 0.36, 20]} />
            <meshStandardMaterial color="#1e293b" roughness={0.8} />
          </mesh>
        )}
        <group position={[0, 1.62, 0]}>
          <mesh castShadow>
            <sphereGeometry args={[0.38, 24, 18]} />
            {mat(skin, 0.6)}
          </mesh>
          {[-1, 1].map((sd) => (
            <group key={sd} position={[sd * 0.13, 0.02, 0.33]}>
              <mesh>
                <sphereGeometry args={[0.062, 12, 10]} />
                <meshStandardMaterial color="#f8fafc" roughness={0.4} />
              </mesh>
              <mesh position={[0, 0, 0.04]}>
                <sphereGeometry args={[0.036, 10, 8]} />
                <meshStandardMaterial color="#111827" />
              </mesh>
            </group>
          ))}
          <Hair style={a.hair} color={a.hairColor || '#3b2314'} />
          <FacialHair kind={a.facialHair} color={a.hairColor || '#3b2314'} />
        </group>
      </group>
      <mesh ref={legL} position={[-0.13, 0.42, 0]} castShadow>
        <capsuleGeometry args={[0.1, 0.35, 4, 8]} />
        <meshStandardMaterial color={a.bottoms === 'skirt' ? skin : '#1e293b'} />
      </mesh>
      <mesh ref={legR} position={[0.13, 0.42, 0]} castShadow>
        <capsuleGeometry args={[0.1, 0.35, 4, 8]} />
        <meshStandardMaterial color={a.bottoms === 'skirt' ? skin : '#1e293b'} />
      </mesh>
      {name !== undefined && (
        <Html position={[0, 2.45, 0]} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
          <div className="tag-stack">
            {bubble && <div className="speech">{bubble}</div>}
            {!isMe && (
              <div className="nametag person">
                {name}
              </div>
            )}
          </div>
        </Html>
      )}
    </group>
  );
}

function Hat({ kind, color }) {
  if (!kind) return null;
  if (kind === 'beanie')
    return (
      <group position={[0, 0.22, 0]}>
        <mesh scale={[1.02, 0.75, 1.02]}>
          <sphereGeometry args={[0.36, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color={color} roughness={0.9} />
        </mesh>
        <mesh position={[0, 0.3, 0]}>
          <sphereGeometry args={[0.09, 10, 8]} />
          <meshStandardMaterial color="#fff" roughness={1} />
        </mesh>
      </group>
    );
  if (kind === 'party')
    return (
      <group position={[0.05, 0.5, 0]} rotation={[0, 0, -0.18]}>
        <mesh>
          <coneGeometry args={[0.2, 0.55, 18]} />
          <meshStandardMaterial color="#f472b6" />
        </mesh>
        <mesh position={[0, 0.3, 0]}>
          <sphereGeometry args={[0.07, 10, 8]} />
          <meshStandardMaterial color="#fde047" emissive="#fde047" emissiveIntensity={0.4} />
        </mesh>
      </group>
    );
  if (kind === 'tophat')
    return (
      <group position={[0, 0.34, 0]}>
        <mesh>
          <cylinderGeometry args={[0.36, 0.36, 0.04, 24]} />
          <meshStandardMaterial color="#111827" />
        </mesh>
        <mesh position={[0, 0.22, 0]}>
          <cylinderGeometry args={[0.22, 0.24, 0.42, 24]} />
          <meshStandardMaterial color="#111827" />
        </mesh>
        <mesh position={[0, 0.07, 0]}>
          <cylinderGeometry args={[0.245, 0.245, 0.08, 24]} />
          <meshStandardMaterial color="#dc2626" />
        </mesh>
      </group>
    );
  // crown
  return (
    <group position={[0, 0.36, 0]}>
      <mesh>
        <cylinderGeometry args={[0.24, 0.26, 0.16, 20, 1, true]} />
        <meshStandardMaterial color="#facc15" metalness={0.7} roughness={0.25} side={THREE.DoubleSide} />
      </mesh>
      {[0, 1, 2, 3, 4].map((i) => {
        const a = (i / 5) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(a) * 0.24, 0.14, Math.sin(a) * 0.24]}>
            <coneGeometry args={[0.05, 0.14, 8]} />
            <meshStandardMaterial color="#facc15" metalness={0.7} roughness={0.25} />
          </mesh>
        );
      })}
    </group>
  );
}

/** An agent: round bot with a headset, a status antenna, and level cosmetics. */
export function Bot({ agent, seated, walking }) {
  const antenna = useRef();
  const head = useRef();
  const legs = useRef();
  const statusColor = STATUS_COLORS[agent.status] || STATUS_COLORS.home;
  const hat = hatFor(agent.level);
  const tier = badgeTier(agent.level);
  const best = bestSkill(agent.xp);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (antenna.current) antenna.current.material.emissiveIntensity = agent.status === 'working' ? 0.6 + Math.sin(t * 8) * 0.4 : 0.5;
    if (head.current) {
      head.current.rotation.x = agent.status === 'working' && seated ? Math.sin(t * 5) * 0.05 + 0.08 : 0;
      head.current.position.y = walking ? 1.55 + Math.abs(Math.sin(t * 12)) * 0.05 : seated ? 1.35 : 1.55;
    }
    if (legs.current) legs.current.visible = !seated;
  });

  const y = seated ? -0.2 : 0;
  return (
    <group>
      {agent.level >= 11 && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
          <ringGeometry args={[0.55, 0.75, 40]} />
          <meshBasicMaterial color={SKILL_INFO[best].color} transparent opacity={0.55} />
        </mesh>
      )}
      <group position={[0, y, 0]}>
        <mesh position={[0, 0.95, 0]} castShadow>
          <capsuleGeometry args={[0.3, 0.35, 6, 14]} />
          <meshStandardMaterial color={agent.color} roughness={0.55} />
        </mesh>
        <group ref={legs}>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 0.13, 0.42, 0]} castShadow>
              <capsuleGeometry args={[0.1, 0.3, 4, 8]} />
              <meshStandardMaterial color="#334155" />
            </mesh>
          ))}
        </group>
        <group ref={head} position={[0, 1.55, 0]}>
          <mesh castShadow>
            <sphereGeometry args={[0.36, 24, 18]} />
            <meshStandardMaterial color={agent.color} roughness={0.45} />
          </mesh>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 0.12, 0.03, 0.32]}>
              <sphereGeometry args={[0.055, 10, 8]} />
              <meshStandardMaterial color="#0f172a" />
            </mesh>
          ))}
          <mesh rotation={[0, 0, 0]} position={[0, 0.02, 0]}>
            <torusGeometry args={[0.38, 0.035, 8, 24, Math.PI]} />
            <meshStandardMaterial color="#1f2937" />
          </mesh>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 0.38, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.1, 0.1, 0.08, 14]} />
              <meshStandardMaterial color="#1f2937" />
            </mesh>
          ))}
          {!hat || hat === 'beanie' ? (
            <group position={[0, hat ? 0.62 : 0.36, 0]}>
              <mesh position={[0, 0.08, 0]}>
                <cylinderGeometry args={[0.015, 0.015, 0.18, 6]} />
                <meshStandardMaterial color="#475569" />
              </mesh>
              <mesh ref={antenna} position={[0, 0.2, 0]}>
                <sphereGeometry args={[0.07, 12, 10]} />
                <meshStandardMaterial color={statusColor} emissive={statusColor} emissiveIntensity={0.5} />
              </mesh>
            </group>
          ) : (
            <mesh ref={antenna} position={[0.3, 0.25, 0.1]}>
              <sphereGeometry args={[0.06, 12, 10]} />
              <meshStandardMaterial color={statusColor} emissive={statusColor} emissiveIntensity={0.5} />
            </mesh>
          )}
          <Hat kind={hat} color={agent.color} />
          {agent.level >= 20 && (
            <mesh position={[0, 0.95, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.25, 0.03, 8, 30]} />
              <meshStandardMaterial color="#fde68a" emissive="#fde68a" emissiveIntensity={1} />
            </mesh>
          )}
        </group>
      </group>
      <Html position={[0, seated ? 2.4 : 2.6, 0]} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
        <div className="tag-stack">
          {agent.status === 'working' && <div className="status-bubble working">⌨️ working</div>}
          {agent.status === 'done' && <div className="status-bubble done">✅ done!</div>}
          {agent.status === 'waiting' && <div className="status-bubble waiting">✋ needs you</div>}
          <div className="nametag bot">
            <span className={`lv lv-${tier}`}>Lv {agent.level}</span>
            {agent.name}
          </div>
        </div>
      </Html>
    </group>
  );
}
