import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createKeyStore } from './keys.js';

const store = () => createKeyStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'keys-')), 'keys.json'));

test('keys map to exactly one office, and only the owner key is owner', () => {
  const k = store();
  k.ensure('owner-key', 'Kevin', true, { owner: true });
  const alice = k.issue('Alice', false, 'main');
  const lab = k.issue('Kevin', true, 'lab');
  assert.deepEqual([k.lookup('owner-key').office, k.lookup('owner-key').owner], ['main', true]);
  assert.deepEqual([k.lookup(lab).office, k.lookup(lab).owner, k.lookup(lab).admin], ['lab', false, true]);
  assert.equal(k.lookup(alice).owner, false);
  assert.equal(k.lookup('nope'), null);
});

test('members and revocation stay inside one office', () => {
  const k = store();
  k.issue('Sam', false, 'main');
  const labSam = k.issue('Sam', false, 'lab');
  assert.equal(k.members('main').length, 1);
  assert.equal(k.revoke('Sam', 'main'), 1);
  assert.ok(k.lookup(labSam), "revoking main's Sam leaves lab's Sam");
  k.ensure('owner-key', 'Kevin', true, { owner: true });
  assert.equal(k.revoke('Kevin', 'main'), 0, 'the owner cannot be revoked');
});

test('legacy keys without an office belong to main', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keys-'));
  const file = path.join(dir, 'keys.json');
  fs.writeFileSync(file, JSON.stringify({ [require_hash('old')]: { name: 'Old', admin: true, createdAt: 1 } }));
  const k = createKeyStore(file);
  assert.equal(k.lookup('old').office, 'main');
  assert.equal(k.members('main')[0].name, 'Old');
});

import crypto from 'node:crypto';
function require_hash(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}
