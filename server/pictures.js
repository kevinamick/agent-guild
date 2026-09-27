// Pictures people hang on the office walls. Each office keeps its own store under
// its data dir: one image file per hung picture plus pictures.json for metadata.
// Browsers downscale before uploading; the server only checks and stores bytes.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const MAX_PICTURE_BYTES = 1.5 * 1024 * 1024;
export const CAPTION_MAX = 80;

export const PICTURE_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

// File names are random ids we generated ourselves, so anything else is refused
// before it gets near the file system (no traversal, no guessing other files).
const FILE_RE = /^[a-f0-9]{32}\.(png|jpg|webp|gif)$/;
export const isPictureFile = (name) => typeof name === 'string' && FILE_RE.test(name);

const startsWith = (buf, bytes, at = 0) => buf.length >= at + bytes.length && bytes.every((b, i) => buf[at + i] === b);
const ascii = (s) => [...s].map((c) => c.charCodeAt(0));

/** The image type from its magic bytes, or null. SVG is never accepted: it can carry scripts. */
export function sniffImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return 'jpg';
  if (startsWith(buf, ascii('GIF87a')) || startsWith(buf, ascii('GIF89a'))) return 'gif';
  if (startsWith(buf, ascii('RIFF')) && startsWith(buf, ascii('WEBP'), 8)) return 'webp';
  return null;
}

/** Base64 from the socket -> { buf, ext } or { error }. */
export function decodePicture(data) {
  if (typeof data !== 'string' || !data) return { error: 'No picture was sent.' };
  // Check the encoded length first so a huge string is never decoded.
  if (data.length > Math.ceil(MAX_PICTURE_BYTES / 3) * 4 + 4) return { error: 'That picture is too big (1.5 MB max).' };
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return { error: 'That picture could not be read.' };
  const buf = Buffer.from(data, 'base64');
  if (buf.length > MAX_PICTURE_BYTES) return { error: 'That picture is too big (1.5 MB max).' };
  const ext = sniffImage(buf);
  if (!ext) return { error: 'Only PNG, JPEG, WebP or GIF pictures can be hung.' };
  return { buf, ext };
}

export function cleanCaption(text) {
  return String(text ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
    .slice(0, CAPTION_MAX);
}

/**
 * One office's pictures. `spots` are the allowed wall spots (PICTURE_SPOTS), so an
 * office can never hold more pictures than it has spots.
 */
export function createPictureStore(dir, spots) {
  fs.mkdirSync(dir, { recursive: true });
  const META = path.join(dir, 'pictures.json');
  const spotIds = new Set(spots.map((s) => s.id));
  const hung = new Map(); // spotId -> { file, by, caption, at }

  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(META, 'utf8'));
  } catch {}
  for (const [spot, p] of Object.entries(saved)) {
    if (spotIds.has(spot) && isPictureFile(p?.file) && fs.existsSync(path.join(dir, p.file))) {
      hung.set(spot, { file: p.file, by: String(p.by), caption: cleanCaption(p.caption), at: +p.at || 0 });
    }
  }
  // Files nobody points at any more (e.g. a crash between write and save).
  const inUse = new Set([...hung.values()].map((p) => p.file));
  for (const name of fs.readdirSync(dir)) if (isPictureFile(name) && !inUse.has(name)) fs.rmSync(path.join(dir, name), { force: true });

  function save() {
    fs.writeFileSync(META + '.tmp', JSON.stringify(Object.fromEntries(hung), null, 2));
    fs.renameSync(META + '.tmp', META);
  }

  const mayChange = (p, who) => who.admin || p.by.toLowerCase() === who.name.toLowerCase();

  return {
    list: () => [...hung].map(([spot, p]) => ({ spot, ...p })),

    /** Hang (or replace) the picture at a spot. `who` is { name, admin } from the key. */
    hang(spot, data, caption, who) {
      if (!spotIds.has(spot)) return { error: 'There is no picture spot there.' };
      const old = hung.get(spot);
      if (old && !mayChange(old, who)) return { error: `Only ${old.by} or an admin can replace that picture.` };
      const pic = decodePicture(data);
      if (pic.error) return pic;
      const file = `${crypto.randomBytes(16).toString('hex')}.${pic.ext}`;
      fs.writeFileSync(path.join(dir, file), pic.buf);
      hung.set(spot, { file, by: who.name, caption: cleanCaption(caption), at: Date.now() });
      save();
      if (old) fs.rmSync(path.join(dir, old.file), { force: true });
      return { ok: true, replaced: Boolean(old) };
    },

    remove(spot, who) {
      const old = hung.get(spot);
      if (!old) return { error: 'There is no picture there.' };
      if (!mayChange(old, who)) return { error: `Only ${old.by} or an admin can take that picture down.` };
      hung.delete(spot);
      save();
      fs.rmSync(path.join(dir, old.file), { force: true });
      return { ok: true, by: old.by };
    },

    /** Absolute path and content type of a hung picture's file, or null. */
    file(name) {
      if (!isPictureFile(name) || ![...hung.values()].some((p) => p.file === name)) return null;
      return { path: path.join(dir, name), type: PICTURE_TYPES[name.split('.').pop()] };
    },
  };
}
