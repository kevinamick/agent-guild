// Personal access keys. A key is the whole identity: the name a player or runner
// appears as, and the office they belong to, come from the key, never from the
// client. Only hashes are stored.
import fs from 'node:fs';
import crypto from 'node:crypto';

const hash = (key) => crypto.createHash('sha256').update(String(key)).digest('hex');
const sameName = (a, b) => a.toLowerCase() === b.toLowerCase();

export function createKeyStore(file) {
  let keys = {};
  try {
    keys = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {}
  const save = () => {
    fs.writeFileSync(file + '.tmp', JSON.stringify(keys, null, 2), { mode: 0o600 });
    fs.renameSync(file + '.tmp', file);
  };
  // Keys created before offices existed belong to the first office.
  const officeOf = (k) => k.office || 'main';
  return {
    isEmpty: () => Object.keys(keys).length === 0,
    lookup(key) {
      const k = key ? keys[hash(key)] : null;
      return k ? { ...k, office: officeOf(k), owner: Boolean(k.owner) } : null;
    },
    // Idempotent: also upgrades an existing key's flags (e.g. marking the owner).
    ensure(key, name, admin = false, { owner = false, office = 'main' } = {}) {
      const h = hash(key);
      const next = { createdAt: Date.now(), ...keys[h], name, admin, owner, office };
      if (JSON.stringify(next) !== JSON.stringify(keys[h])) {
        keys[h] = next;
        save();
      }
    },
    issue(name, admin = false, office = 'main', { owner = false } = {}) {
      const key = `ag_${crypto.randomBytes(18).toString('base64url')}`;
      keys[hash(key)] = { name, admin, owner, office, createdAt: Date.now() };
      save();
      return key;
    },
    // Never revokes the owner, and only within one office.
    revoke(name, office = 'main') {
      let removed = 0;
      for (const [h, k] of Object.entries(keys)) {
        if (officeOf(k) === office && sameName(k.name, name) && !k.owner && !k.admin) {
          delete keys[h];
          removed++;
        }
      }
      if (removed) save();
      return removed;
    },
    members(office = 'main') {
      const byName = new Map();
      for (const k of Object.values(keys)) {
        if (officeOf(k) !== office) continue;
        const m = byName.get(k.name) || { name: k.name, admin: false, keys: 0, createdAt: k.createdAt };
        m.admin ||= k.admin;
        m.keys++;
        m.createdAt = Math.min(m.createdAt, k.createdAt);
        byName.set(k.name, m);
      }
      return [...byName.values()].sort((a, b) => a.createdAt - b.createdAt);
    },
  };
}
