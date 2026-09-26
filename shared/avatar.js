// Player character options.

// A broad range from deep to light, with warm and cool undertones.
export const SKIN_TONES = ['#3b2219', '#4a2c1d', '#5c3a24', '#7a4a2e', '#8d5a3b', '#a8704a', '#c68642', '#d9a066', '#e8b98f', '#f1c9a5', '#f7dcc4', '#ffe7d6'];

export const HAIR_STYLES = [
  { id: 'short', label: 'Short' },
  { id: 'buzz', label: 'Buzz cut' },
  { id: 'curly', label: 'Curly' },
  { id: 'afro', label: 'Afro' },
  { id: 'braids', label: 'Braids / locs' },
  { id: 'long', label: 'Long' },
  { id: 'bob', label: 'Bob' },
  { id: 'ponytail', label: 'Ponytail' },
  { id: 'bun', label: 'Bun' },
  { id: 'headscarf', label: 'Headscarf' },
  { id: 'bald', label: 'Bald' },
];

export const HAIR_COLORS = ['#111827', '#3b2314', '#6b3e1f', '#b45309', '#d6a24a', '#f5d67a', '#9ca3af', '#e5e7eb', '#be185d', '#2563eb'];
export const FACIAL_HAIR = [
  { id: 'none', label: 'None' },
  { id: 'mustache', label: 'Mustache' },
  { id: 'beard', label: 'Beard' },
];
export const BOTTOMS = [
  { id: 'pants', label: 'Pants' },
  { id: 'skirt', label: 'Skirt' },
];
export const SHIRT_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#a855f7', '#f97316', '#14b8a6', '#ec4899', '#eab308', '#334155', '#f8fafc'];

const pick = (list, v, fallback) => (list.some((x) => (x.id ?? x) === v) ? v : fallback);

// Clamp anything a client sends to the known options.
export function sanitizeAvatar(a = {}) {
  return {
    skin: pick(SKIN_TONES, a.skin, SKIN_TONES[6]),
    hair: pick(HAIR_STYLES, a.hair, 'short'),
    hairColor: pick(HAIR_COLORS, a.hairColor, HAIR_COLORS[1]),
    facialHair: pick(FACIAL_HAIR, a.facialHair, 'none'),
    bottoms: pick(BOTTOMS, a.bottoms, 'pants'),
    shirt: pick(SHIRT_COLORS, a.shirt, SHIRT_COLORS[0]),
  };
}

export function randomAvatar() {
  const r = (list) => list[Math.floor(Math.random() * list.length)];
  return sanitizeAvatar({
    skin: r(SKIN_TONES),
    hair: r(HAIR_STYLES.filter((h) => h.id !== 'bald')).id,
    hairColor: r(HAIR_COLORS.slice(0, 6)),
    shirt: r(SHIRT_COLORS),
  });
}
