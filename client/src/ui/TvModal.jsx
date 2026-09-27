import { useEffect, useRef } from 'react';
import { closeModal } from '../net.js';
import { useTv } from '../rtc/screenShare.js';
import { Modal } from './Modals.jsx';
import { useSharer } from './TvPrompt.jsx';

// Full-screen view of whoever is sharing on the TV.
export function TvModal() {
  const stream = useTv((s) => s.stream);
  const sharer = useSharer();
  const video = useRef();
  useEffect(() => {
    if (!sharer) closeModal(); // they stopped sharing
  }, [sharer?.id]);
  useEffect(() => {
    if (!video.current) return;
    video.current.srcObject = stream;
    video.current.play().catch(() => {});
  }, [stream]);
  if (!sharer) return null;
  return (
    <Modal title={`📺 ${sharer.name}'s screen`} wide className="tv-modal">
      <div className="tv-modal-body">
        {/* Muted: the shared audio already plays from the TV when you're near it. */}
        <video ref={video} autoPlay playsInline muted onDoubleClick={() => video.current?.requestFullscreen?.()} />
        {!stream && <div className="tv-modal-wait">Connecting to {sharer.name}'s screen…</div>}
      </div>
      <div className="modal-foot">
        <span className="muted small">Double-click the picture for your browser's full screen · Esc to close</span>
        <span className="grow" />
        <button className="btn" onClick={() => video.current?.requestFullscreen?.()}>⛶ Full screen</button>
      </div>
    </Modal>
  );
}
