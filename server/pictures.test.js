import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sniffImage, decodePicture, isPictureFile, cleanCaption, createPictureStore, MAX_PICTURE_BYTES } from './pictures.js';
import { PICTURE_SPOTS } from '../shared/layout.js';

const pad = (head) => Buffer.concat([Buffer.from(head), Buffer.alloc(32)]);
const PNG = pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPG = pad([0xff, 0xd8, 0xff, 0xe0]);
const GIF = pad([...Buffer.from('GIF89a')]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 1, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(32)]);
const b64 = (buf) => buf.toString('base64');

test('images are recognised by their magic bytes only', () => {
  assert.equal(sniffImage(PNG), 'png');
  assert.equal(sniffImage(JPG), 'jpg');
  assert.equal(sniffImage(GIF), 'gif');
  assert.equal(sniffImage(WEBP), 'webp');
  assert.equal(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>')), null);
  assert.equal(sniffImage(Buffer.from('<?xml version="1.0"?><svg/>          ')), null);
  assert.equal(sniffImage(Buffer.concat([Buffer.from('RIFF....WAVE'), Buffer.alloc(32)])), null);
  assert.equal(sniffImage(Buffer.from([0x89, 0x50, 0x4e, 0x47])), null, 'too short');
  assert.equal(sniffImage('not a buffer'), null);
});

test('uploads are size-capped and must be clean base64 of an image', () => {
  assert.equal(decodePicture(b64(PNG)).ext, 'png');
  assert.ok(decodePicture(b64(Buffer.from('<svg onload="x"></svg> padding padding'))).error);
  assert.ok(decodePicture('').error);
  assert.ok(decodePicture(null).error);
  assert.ok(decodePicture({ length: 3 }).error);
  assert.ok(decodePicture('iVBORw0KGgo../../etc').error, 'not base64');
  const big = Buffer.concat([PNG, Buffer.alloc(MAX_PICTURE_BYTES)]);
  assert.match(decodePicture(b64(big)).error, /too big/);
  const justFits = Buffer.concat([PNG, Buffer.alloc(MAX_PICTURE_BYTES - PNG.length)]);
  assert.equal(decodePicture(b64(justFits)).ext, 'png');
});

test('only our own random file names are valid', () => {
  assert.ok(isPictureFile(`${'a1'.repeat(16)}.png`));
  assert.ok(isPictureFile(`${'0'.repeat(32)}.webp`));
  for (const bad of ['../keys.json', `${'a'.repeat(32)}.svg`, `${'a'.repeat(31)}.png`, `${'A'.repeat(32)}.png`,
    `../${'a'.repeat(32)}.png`, `${'a'.repeat(32)}.png/..`, 'pictures.json', `${'a'.repeat(32)}.png\0`, 42, null]) {
    assert.equal(isPictureFile(bad), false, String(bad));
  }
});

test('captions are trimmed, single-line and short', () => {
  assert.equal(cleanCaption('  team\noffsite\u0007 '), 'team offsite');
  assert.equal(cleanCaption('x'.repeat(200)).length, 80);
  assert.equal(cleanCaption(undefined), '');
});

test('the store enforces spots and who may replace or remove, and persists', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pictures-'));
  const kevin = { name: 'Kevin', admin: false };
  const alice = { name: 'Alice', admin: false };
  const admin = { name: 'Lee', admin: true };
  const store = createPictureStore(dir, PICTURE_SPOTS);

  assert.ok(store.hang('nowhere', b64(PNG), '', kevin).error, 'unknown spot');
  assert.ok(store.hang('l1', b64(Buffer.from('<svg/> and then some more bytes')), '', kevin).error, 'svg refused');
  assert.deepEqual(store.hang('l1', b64(PNG), 'Offsite', kevin), { ok: true, replaced: false });
  const [first] = store.list();
  assert.equal(first.spot, 'l1');
  assert.equal(first.by, 'Kevin');
  assert.equal(first.caption, 'Offsite');
  assert.ok(isPictureFile(first.file));
  assert.equal(store.file(first.file).type, 'image/png');
  assert.equal(store.file('../pictures.json'), null);
  assert.equal(store.file(`${'b'.repeat(32)}.png`), null, 'a well-formed but unknown id');

  assert.match(store.hang('l1', b64(JPG), '', alice).error, /Kevin/, 'someone else cannot replace it');
  assert.match(store.remove('l1', alice).error, /Kevin/, 'someone else cannot take it down');
  assert.deepEqual(store.hang('l1', b64(JPG), '', { name: 'kevin', admin: false }), { ok: true, replaced: true });
  const [second] = store.list();
  assert.notEqual(second.file, first.file, 'a replacement gets a new id');
  assert.ok(second.file.endsWith('.jpg'));
  assert.equal(fs.existsSync(path.join(dir, first.file)), false, 'the old file is deleted');

  store.hang('r2', b64(GIF), '', alice);
  const reopened = createPictureStore(dir, PICTURE_SPOTS);
  assert.deepEqual(reopened.list().map((p) => p.spot).sort(), ['l1', 'r2'], 'pictures survive a restart');
  assert.deepEqual(reopened.remove('r2', admin), { ok: true, by: 'Alice' }, 'an admin can take anything down');
  assert.ok(reopened.remove('r2', admin).error);
  assert.deepEqual(fs.readdirSync(dir).filter(isPictureFile), [second.file]);
});

test('the store never holds more pictures than spots, and ignores tampered metadata', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pictures-'));
  const store = createPictureStore(dir, PICTURE_SPOTS);
  for (const s of PICTURE_SPOTS) assert.ok(store.hang(s.id, b64(PNG), '', { name: 'Kevin' }).ok);
  assert.equal(store.list().length, PICTURE_SPOTS.length);
  fs.writeFileSync(path.join(dir, 'pictures.json'), JSON.stringify({ l1: { file: '../../keys.json', by: 'x' }, zz: { file: store.list()[1].file } }));
  const reopened = createPictureStore(dir, PICTURE_SPOTS);
  assert.deepEqual(reopened.list(), []);
  assert.deepEqual(fs.readdirSync(dir).filter(isPictureFile), [], 'orphaned files are cleaned up');
});
