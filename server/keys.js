// Personal access keys. A key is the whole identity: the name a player or runner
// appears as comes from the key, never from the client. Only hashes are stored.
import fs from 'node:fs';
import crypto from 'node:crypto';

const hash = (key) => crypto.createHash('sha256').update(String(key)).digest('hex');

export function createKeyStore(file) {
  let keys = {};
  try {
    keys = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {}
  const save = () => {
    fs.writeFileSync(file + '.tmp', JSON.stringify(keys, null, 2), { mode: 0o600 });
    fs.renameSync(file + '.tmp', file);
  };
  return {
    isEmpty: () => Object.keys(keys).length === 0,
    lookup: (key) => (key ? keys[hash(key)] || null : null),
    ensure(key, name, admin = false) {
      if (!keys[hash(key)]) {
        keys[hash(key)] = { name, admin, createdAt: Date.now() };
        save();
      }
    },
    issue(name, admin = false) {
      const key = `ag_${crypto.randomBytes(18).toString('base64url')}`;
      keys[hash(key)] = { name, admin, createdAt: Date.now() };
      save();
      return key;
    },
    revoke(name) {
      const before = Object.keys(keys).length;
      for (const [h, k] of Object.entries(keys)) if (k.name.toLowerCase() === name.toLowerCase() && !k.admin) delete keys[h];
      save();
      return before - Object.keys(keys).length;
    },
    members() {
      const byName = new Map();
      for (const k of Object.values(keys)) {
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
