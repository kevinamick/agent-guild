import { create } from 'zustand';
import { useGame, onRtc, sendRtc, send, rtcConfig, toast, openModal } from '../net.js';

// Screen sharing on the office TV. One person shares at a time and everyone else
// in the office watches over WebRTC. It's a mesh: the sharer keeps one
// connection per viewer, and each viewer asks for its own (so late joiners and
// reconnects just ask again). Signaling rides the shared 'rtc' relay tagged
// { channel: 'tv' }; the server only tracks who holds the TV (state.tv.sharer).
//
// Messages (data.kind): viewer -> sharer 'want' | 'answer' | 'ice' | 'bye',
// sharer -> viewer 'offer' | 'ice' | 'bye'. `side` on 'ice' says who sent it,
// and `n` numbers each offer: a viewer that asks twice gets two offers, and the
// answer and candidates for the first must never land on the second connection.

const CHANNEL = 'tv';

export const useTv = create(() => ({
  stream: null, // what the TV shows: my own capture while I share, otherwise the sharer's stream
  sharing: false, // I'm sharing (or waiting for the server to hand me the TV)
  connecting: false, // watching: asked the sharer, no picture yet
}));

let local = null; // sharer: { stream, claimed }
const peers = new Map(); // sharer: viewerId -> RTCPeerConnection (with .n, its offer number)
let offers = 0;
let viewer = null; // viewer: { from, me, pc, n, pending: [{ n, candidate }], tries, timer }

const nameOf = (id) => useGame.getState().players.find((p) => p.id === id)?.name || 'Someone';

// ---------------------------------------------------------------- sharing

export async function startSharing() {
  const { tv, me } = useGame.getState();
  if (local || (tv.sharer && tv.sharer !== me)) return;
  if (!navigator.mediaDevices?.getDisplayMedia) return toast('Screen sharing needs a desktop browser.', 'error');
  let stream;
  try {
    // Tab/system audio comes along when the browser offers it (Chrome, Edge).
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 30 } }, audio: true });
  } catch (e) {
    if (e.name === 'TypeError') {
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true }); // browsers that refuse audio
      } catch {}
    } else if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') {
      toast(`Couldn't share your screen: ${e.message}`, 'error');
    }
    if (!stream) return;
  }
  const s = useGame.getState();
  if (local || (s.tv.sharer && s.tv.sharer !== s.me)) {
    // Someone took the TV while the picker was open.
    stream.getTracks().forEach((t) => t.stop());
    return toast(`${nameOf(s.tv.sharer)} is already sharing on the TV.`, 'error');
  }
  const video = stream.getVideoTracks()[0];
  if (video) {
    video.contentHint = 'detail'; // keep text sharp rather than smooth motion
    // The browser's own "Stop sharing" button ends the track.
    video.addEventListener('ended', () => stopSharing());
  }
  local = { stream, claimed: false };
  closeViewer(true);
  useTv.setState({ sharing: true, stream, connecting: false });
  send({ t: 'tv', share: true });
}

export function stopSharing({ tellServer = true } = {}) {
  if (!local) return;
  const { stream } = local;
  local = null;
  stream.getTracks().forEach((t) => t.stop());
  for (const [id, pc] of peers) {
    sendRtc(id, { channel: CHANNEL, kind: 'bye' });
    pc.close();
  }
  peers.clear();
  useTv.setState({ sharing: false, stream: null });
  if (tellServer) send({ t: 'tv', share: false });
  sync();
}

// E at the TV: share when it's free, stop when it's mine, otherwise watch big.
export function tvInteract() {
  const { tv, me } = useGame.getState();
  if (local) return stopSharing();
  if (tv.sharer && tv.sharer !== me) return openModal({ type: 'tv' });
  startSharing();
}

// Sharer side: a viewer asked for the stream, so (re)make its connection.
async function serve(viewerId) {
  peers.get(viewerId)?.close();
  const pc = new RTCPeerConnection(rtcConfig());
  const n = ++offers;
  pc.n = n;
  pc.pending = [];
  peers.set(viewerId, pc);
  for (const track of local.stream.getTracks()) pc.addTrack(track, local.stream);
  pc.onicecandidate = (e) => e.candidate && sendRtc(viewerId, { channel: CHANNEL, kind: 'ice', side: 'sharer', n, candidate: e.candidate.toJSON() });
  pc.onconnectionstatechange = () => {
    if (pc.connectionState !== 'failed' && pc.connectionState !== 'closed') return;
    pc.close();
    if (peers.get(viewerId) === pc) peers.delete(viewerId);
  };
  try {
    await pc.setLocalDescription(await pc.createOffer());
    if (peers.get(viewerId) === pc) sendRtc(viewerId, { channel: CHANNEL, kind: 'offer', n, description: pc.localDescription.toJSON() });
  } catch (e) {
    console.warn('tv: offer failed', e);
  }
}

// ---------------------------------------------------------------- watching

function watch(sharer) {
  closeViewer(false);
  viewer = { from: sharer, me: useGame.getState().me, pc: null, n: 0, pending: [], tries: 0, timer: null };
  useTv.setState({ stream: null, connecting: true });
  ask(viewer);
}

function ask(v) {
  if (viewer !== v) return;
  sendRtc(v.from, { channel: CHANNEL, kind: 'want' });
  clearTimeout(v.timer);
  // No picture yet (the sharer was mid-reconnect, or the offer got lost)? Ask again, backing off.
  v.timer = setTimeout(() => {
    if (viewer !== v || v.pc?.connectionState === 'connected') return;
    v.tries++;
    ask(v);
  }, Math.min(30000, 8000 * 2 ** v.tries));
}

async function accept(v, description, n) {
  v.pc?.close();
  const pc = new RTCPeerConnection(rtcConfig());
  v.pc = pc;
  v.n = n;
  v.pending = v.pending.filter((c) => c.n >= n); // candidates for earlier offers are useless now
  pc.ontrack = (e) => {
    if (viewer !== v || v.pc !== pc) return;
    const stream = e.streams[0] || new MediaStream([e.track]);
    useTv.setState({ stream, connecting: false });
  };
  pc.onicecandidate = (e) => e.candidate && sendRtc(v.from, { channel: CHANNEL, kind: 'ice', side: 'viewer', n, candidate: e.candidate.toJSON() });
  pc.onconnectionstatechange = () => {
    if (viewer !== v || v.pc !== pc) return;
    if (pc.connectionState === 'failed') {
      useTv.setState({ stream: null, connecting: true });
      v.tries++;
      ask(v);
    }
  };
  try {
    await pc.setRemoteDescription(description);
    if (v.pc !== pc) return;
    const mine = v.pending.filter((c) => c.n === n);
    v.pending = v.pending.filter((c) => c.n !== n);
    await flush(pc, mine.map((c) => c.candidate));
    await pc.setLocalDescription(await pc.createAnswer());
    if (v.pc === pc) sendRtc(v.from, { channel: CHANNEL, kind: 'answer', n, description: pc.localDescription.toJSON() });
  } catch (e) {
    console.warn('tv: answer failed', e);
  }
}

function closeViewer(sayBye) {
  if (!viewer) return;
  clearTimeout(viewer.timer);
  viewer.pc?.close();
  if (sayBye) sendRtc(viewer.from, { channel: CHANNEL, kind: 'bye' });
  viewer = null;
  useTv.setState({ stream: local?.stream || null, connecting: false });
}

// ICE candidates can arrive before the description they belong to; hold them until then.
function addIce(pc, queue, candidate) {
  if (pc?.remoteDescription) pc.addIceCandidate(candidate).catch(() => {});
  else queue.push(candidate);
}
async function flush(pc, queue) {
  for (const c of queue.splice(0)) await pc.addIceCandidate(c).catch(() => {});
}

onRtc(async (from, data) => {
  if (data?.channel !== CHANNEL) return;
  switch (data.kind) {
    case 'want':
      if (local) serve(from);
      else sendRtc(from, { channel: CHANNEL, kind: 'bye' }); // stale view of who's sharing
      break;
    case 'answer': {
      const pc = peers.get(from);
      if (!pc || pc.n !== data.n || pc.signalingState !== 'have-local-offer') return; // an answer to a replaced offer
      try {
        await pc.setRemoteDescription(data.description);
        await flush(pc, pc.pending);
      } catch (e) {
        console.warn('tv: bad answer', e);
      }
      break;
    }
    case 'offer':
      if (viewer?.from === from && !local && data.n > viewer.n) accept(viewer, data.description, data.n);
      break;
    case 'ice':
      if (data.side === 'sharer' && viewer?.from === from) {
        // Hold candidates until their offer is applied (they can overtake it, or arrive mid-setup).
        if (data.n === viewer.n && viewer.pc?.remoteDescription) viewer.pc.addIceCandidate(data.candidate).catch(() => {});
        else if (data.n >= viewer.n) viewer.pending.push({ n: data.n, candidate: data.candidate });
      }
      if (data.side === 'viewer' && peers.get(from)?.n === data.n) addIce(peers.get(from), peers.get(from).pending, data.candidate);
      break;
    case 'bye':
      if (peers.has(from)) {
        peers.get(from).close();
        peers.delete(from);
      }
      if (viewer?.from === from) {
        viewer.pc?.close();
        viewer.pc = null;
        useTv.setState({ stream: null, connecting: true }); // the office state says what happens next
      }
      break;
  }
});

// ---------------------------------------------------------------- office state

// Follow the server's view of who holds the TV: watch whoever shares, reclaim
// the TV after our own reconnect, drop connections to people who left.
function sync() {
  const { status, tv, me, players } = useGame.getState();
  if (status === 'idle' || status === 'closed') {
    stopSharing({ tellServer: false });
    closeViewer(false);
    return;
  }
  if (status !== 'online') return; // reconnecting: media keeps flowing peer to peer meanwhile
  const sharer = tv?.sharer || null;
  if (local) {
    if (sharer === me) local.claimed = true;
    else if (sharer) {
      // Someone else holds the TV. If we never got it, the server already said why.
      if (local.claimed) toast(`${nameOf(sharer)} took over the TV while you were reconnecting.`, 'error');
      return stopSharing({ tellServer: false });
    } else if (local.claimed) {
      // The server let go when our socket dropped; we're still sharing, so take it back.
      local.claimed = false;
      send({ t: 'tv', share: true });
    }
    const here = new Set(players.map((p) => p.id));
    for (const [id, pc] of peers) {
      if (here.has(id)) continue;
      pc.close();
      peers.delete(id);
    }
  }
  if (sharer && sharer !== me && !local) {
    if (viewer?.from !== sharer || viewer.me !== me) watch(sharer);
  } else if (viewer) {
    closeViewer(Boolean(sharer));
  }
}

useGame.subscribe((s, prev) => {
  if (s.status !== prev.status || s.me !== prev.me || s.tv?.sharer !== prev.tv?.sharer || s.players !== prev.players) sync();
});
