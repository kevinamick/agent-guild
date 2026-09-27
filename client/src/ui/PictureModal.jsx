import { useEffect, useRef, useState } from 'react';
import { useGame, send, openModal, closeModal, SERVER_HTTP } from '../net.js';
import { Modal } from './Modals.jsx';

// Pictures are shrunk in the browser before upload: the socket carries at most
// 4 MB and the server refuses anything over 1.5 MB.
const MAX_SIDE = 1024;
const TARGET_BYTES = 500 * 1024;
const ACCEPT = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

const canManage = (picture, name, admin) => admin || picture.by.toLowerCase() === name.toLowerCase();
const toBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

async function decode(file) {
  try {
    return await createImageBitmap(file);
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

/** A local image file -> { blob, width, height }: WebP (or JPEG), longest side <= 1024, <= 500 KB. */
export async function shrinkPicture(file) {
  if (!ACCEPT.includes(file.type)) throw new Error('Pick a PNG, JPEG, WebP or GIF image.');
  if (file.size > 50 * 1024 * 1024) throw new Error('That file is too large (50 MB max).');
  let img;
  try {
    img = await decode(file);
  } catch {
    throw new Error('That image could not be opened.');
  }
  try {
    let scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
    for (let attempt = 0; attempt < 4; attempt++, scale *= 0.7) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const g = canvas.getContext('2d');
      g.drawImage(img, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.85, 0.7, 0.55]) {
        let blob = await toBlob(canvas, 'image/webp', quality);
        if (blob?.type !== 'image/webp') {
          // No WebP encoder (older Safari): JPEG, on white since JPEG has no transparency.
          g.globalCompositeOperation = 'destination-over';
          g.fillStyle = '#fff';
          g.fillRect(0, 0, canvas.width, canvas.height);
          blob = await toBlob(canvas, 'image/jpeg', quality);
        }
        if (blob && blob.size <= TARGET_BYTES) return { blob, width: canvas.width, height: canvas.height };
      }
    }
    throw new Error('That picture could not be made small enough.');
  } finally {
    img.close?.();
  }
}

const toBase64 = (blob) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

function HangForm({ spot, initialCaption = '', onBack }) {
  const [pic, setPic] = useState(null); // { blob, url, width, height }
  const [caption, setCaption] = useState(initialCaption);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const input = useRef();
  useEffect(() => () => pic && URL.revokeObjectURL(pic.url), [pic]);
  // Pressing E (or Replace) is what opened this, so go straight to the file picker.
  useEffect(() => input.current?.click(), []);

  const choose = async (file) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const small = await shrinkPicture(file);
      setPic({ ...small, url: URL.createObjectURL(small.blob) });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const hang = async () => {
    if (!pic || busy) return;
    setBusy(true);
    send({ t: 'picture', spot, data: await toBase64(pic.blob), caption: caption.trim() });
    closeModal();
  };

  return (
    <Modal title={onBack ? '🖼️ Replace the picture' : '🖼️ Hang a picture'}>
      <div className="modal-body">
        <div
          className="picture-drop"
          onClick={() => input.current.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            choose(e.dataTransfer.files[0]);
          }}
        >
          {pic ? <img src={pic.url} alt="" /> : <span>{busy ? 'Preparing…' : 'Choose a picture from your computer, or drop one here'}</span>}
        </div>
        <input ref={input} type="file" accept={ACCEPT.join(',')} hidden onChange={(e) => choose(e.target.files[0])} />
        <label className="field-label">Caption (optional)</label>
        <input
          className="input"
          maxLength={80}
          value={caption}
          placeholder="e.g. Team offsite 2026"
          onChange={(e) => setCaption(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && hang()}
        />
        {error && <div className="error-box">{error}</div>}
      </div>
      <div className="modal-foot">
        <span className="muted small">{pic ? `${pic.width}×${pic.height} · ` : ''}everyone in this office will see it</span>
        <span className="grow" />
        <button className="btn" onClick={onBack || closeModal}>{onBack ? 'Back' : 'Cancel'}</button>
        <button className="btn primary" disabled={!pic || busy} onClick={hang}>Hang it</button>
      </div>
    </Modal>
  );
}

export function PictureModal({ spot }) {
  const picture = useGame((s) => s.pictures.find((p) => p.spot === spot));
  const myName = useGame((s) => s.myName);
  const admin = useGame((s) => s.admin);
  const [replacing, setReplacing] = useState(false);
  if (!picture || replacing) {
    return <HangForm spot={spot} initialCaption={picture?.caption} onBack={picture ? () => setReplacing(false) : null} />;
  }
  const can = canManage(picture, myName, admin);
  const takeDown = () => {
    if (!confirm('Take this picture down?')) return;
    send({ t: 'picture-remove', spot });
    closeModal();
  };
  return (
    <Modal title={`🖼️ ${picture.caption || 'A picture'}`} wide>
      <div className="modal-body picture-view">
        <img src={SERVER_HTTP + picture.url} alt={picture.caption} />
      </div>
      <div className="modal-foot">
        <span className="muted small">
          Hung by <b>{picture.by}</b> · {new Date(picture.at).toLocaleDateString()}
        </span>
        <span className="grow" />
        {can && <button className="btn danger" onClick={takeDown}>Take down</button>}
        {can && <button className="btn" onClick={() => setReplacing(true)}>Replace…</button>}
        <button className="btn" onClick={closeModal}>Close</button>
      </div>
    </Modal>
  );
}

// The prompt when standing at a picture spot (part of the interaction bar).
export function PictureBar({ spot }) {
  const picture = useGame((s) => s.pictures.find((p) => p.spot === spot));
  const myName = useGame((s) => s.myName);
  const admin = useGame((s) => s.admin);
  const Key = ({ k, children }) => (
    <span className="keyhint">
      <kbd>{k}</kbd>
      {children}
    </span>
  );
  if (!picture) {
    return (
      <div className="interaction panel">
        <span className="focus-name">🖼️ Empty wall spot</span>
        <Key k="E">Hang a picture</Key>
      </div>
    );
  }
  return (
    <div className="interaction panel">
      <span className="focus-name">🖼️ {picture.caption || 'A picture'}</span>
      <span className="muted small">hung by {picture.by}</span>
      <Key k="E">View</Key>
      {canManage(picture, myName, admin) && <Key k="X">Take down</Key>}
    </div>
  );
}

// Keys pressed while standing at a picture spot.
export function interactPicture(key, spot) {
  const { pictures, myName, admin } = useGame.getState();
  const picture = pictures.find((p) => p.spot === spot);
  if (key === 'e') openModal({ type: 'picture', spot });
  if (key === 'x' && picture && canManage(picture, myName, admin) && confirm('Take this picture down?')) send({ t: 'picture-remove', spot });
}
