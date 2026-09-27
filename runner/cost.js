// What a turn cost, read from the CLI's own transcript. The runner remembers how
// far it has read each transcript, so every turn only counts what's new.
//
// Claude Code (~/.claude/projects/<project>/<session>.jsonl, the hooks'
// `transcript_path`): each assistant message carries `message.usage` (tokens) and
// `message.model`, repeated once per content block, so messages count once by id.
// Subagents write their own transcripts in <session>/subagents/. There's no
// price in there, so dollars are estimated from PRICES below.
//
// GitHub Copilot CLI (~/.copilot/session-state/<session>/events.jsonl, agentStop's
// `transcriptPath`): after each agentStop it writes a `session.usage_checkpoint`
// with the session's running `totalNanoAiu` (AI credits × 1e9, what its summary
// prints as "AI Credits") and `totalPremiumRequests`. A turn costs the growth.
// It lands a few milliseconds after the hook fires, so reading waits briefly.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// USD per million tokens. AN ESTIMATE: Anthropic's list prices for the API, which
// isn't what a Claude subscription bills. Checked against Claude Code's own
// `cost-state` totals on 2026-09-26; update when prices change. Most specific
// prefix first. `read` is a cache hit; `write5m`/`write1h` are cache writes with a
// 5-minute or 1-hour lifetime (1.25× and 2× the input price).
export const PRICES_UPDATED = '2026-09-26';
export const PRICES = [
  ['claude-fable-5-1', { input: 10, output: 50, read: 0.25, write5m: 12.5, write1h: 20 }],
  ['claude-mythos-5-1', { input: 10, output: 50, read: 0.25, write5m: 12.5, write1h: 20 }],
  ['claude-fable-5', { input: 10, output: 50, read: 1, write5m: 12.5, write1h: 20 }],
  ['claude-mythos-5', { input: 10, output: 50, read: 1, write5m: 12.5, write1h: 20 }],
  ['claude-opus-5-5', { input: 4, output: 20, read: 0.2, write5m: 5, write1h: 8 }],
  ['claude-opus-5', { input: 5, output: 25, read: 0.5, write5m: 6.25, write1h: 10 }],
  ['claude-opus-4-5', { input: 5, output: 25, read: 0.5, write5m: 6.25, write1h: 10 }],
  ['claude-opus-4-6', { input: 5, output: 25, read: 0.5, write5m: 6.25, write1h: 10 }],
  ['claude-opus-4-7', { input: 5, output: 25, read: 0.5, write5m: 6.25, write1h: 10 }],
  ['claude-opus-4-8', { input: 5, output: 25, read: 0.5, write5m: 6.25, write1h: 10 }],
  ['claude-opus-4', { input: 15, output: 75, read: 1.5, write5m: 18.75, write1h: 30 }],
  ['claude-sonnet-5', { input: 2, output: 10, read: 0.2, write5m: 2.5, write1h: 4 }],
  ['claude-sonnet-4', { input: 3, output: 15, read: 0.3, write5m: 3.75, write1h: 6 }],
  ['claude-haiku-4', { input: 1, output: 5, read: 0.1, write5m: 1.25, write1h: 2 }],
  ['claude-3-5-haiku', { input: 0.8, output: 4, read: 0.08, write5m: 1, write1h: 1.6 }],
];

export function priceFor(model) {
  const m = String(model || '').toLowerCase();
  return PRICES.find(([prefix]) => m.startsWith(prefix))?.[1] || null;
}

// Estimated USD for one assistant message's usage, or null for a model we can't price.
export function usageCost(usage, model) {
  const p = priceFor(model);
  if (!p || !usage) return null;
  const n = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
  const written = n(usage.cache_creation_input_tokens);
  const split = usage.cache_creation;
  // Older transcripts only give the total written; the API's default lifetime is 5 minutes.
  const w1h = split ? Math.min(written, n(split.ephemeral_1h_input_tokens)) : 0;
  const w5m = written - w1h;
  const usd =
    (n(usage.input_tokens) * p.input +
      n(usage.output_tokens) * p.output +
      n(usage.cache_read_input_tokens) * p.read +
      w5m * p.write5m +
      w1h * p.write1h) /
    1e6;
  // Fast mode is billed at twice the standard rate.
  return usage.speed === 'fast' ? usd * 2 : usd;
}

const SEEN_IDS = 2000;

// Add up the complete JSONL lines in `text` into `st`, the per-file state.
// Returns { usd, priced, credits } for these lines.
export function tallyLines(text, st) {
  const out = { usd: 0, priced: 0, credits: null };
  for (const line of text.split('\n')) {
    // Cheap checks first: most lines are neither kind.
    if (!line.includes('"usage') && !line.includes('usage_checkpoint')) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e?.type === 'assistant' && e.message?.usage) {
      const id = e.message.id || e.requestId || e.uuid;
      if (id) {
        if (st.ids.has(id)) continue;
        st.ids.add(id);
        if (st.ids.size > SEEN_IDS) st.ids.delete(st.ids.values().next().value);
      }
      const usd = usageCost(e.message.usage, e.message.model);
      if (usd !== null) {
        out.usd += usd;
        out.priced++;
      }
    } else if (e?.type === 'session.usage_checkpoint') {
      const nano = Number(e.data?.totalNanoAiu);
      if (!Number.isFinite(nano) || nano < 0) continue;
      // A running total; a drop means a fresh count (a new process on the same file).
      const base = nano >= (st.nanoAiu ?? 0) ? st.nanoAiu ?? 0 : 0;
      out.credits = (out.credits ?? 0) + (nano - base) / 1e9;
      st.nanoAiu = nano;
    }
  }
  return out;
}

// Copilot's sessionStart/userPromptSubmitted hooks carry the session id but not the path.
export function copilotTranscript(sessionId, env = process.env) {
  if (!/^[\w-]{8,}$/.test(String(sessionId || ''))) return null;
  const home = env.COPILOT_HOME || path.join(os.homedir(), '.copilot');
  return path.join(home, 'session-state', sessionId, 'events.jsonl');
}

// Claude Code keeps each subagent's transcript beside the session's.
function subagentFiles(file) {
  if (!file.endsWith('.jsonl') || path.basename(file) === 'events.jsonl') return [];
  const dir = path.join(file.slice(0, -'.jsonl'.length), 'subagents');
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

const MAX_READ = 64 * 1024 * 1024;

// One per agent session. Nothing here throws: a missing, unreadable or rotated
// file just means no cost for that turn.
export function createCostTracker({ sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const files = new Map(); // path -> { offset, ino, ids, nanoAiu }

  function state(file) {
    let st = files.get(file);
    if (!st) files.set(file, (st = { offset: 0, ino: null, ids: new Set(), nanoAiu: null }));
    return st;
  }

  // Read what's new in `file` (only whole lines) and tally it.
  function readNew(file) {
    const st = state(file);
    let fd;
    try {
      fd = fs.openSync(file, 'r');
      const stat = fs.fstatSync(fd);
      // Replaced or truncated: start over on the new file.
      if ((st.ino !== null && stat.ino !== st.ino) || stat.size < st.offset) {
        st.offset = 0;
        st.nanoAiu = null;
      }
      st.ino = stat.ino;
      const len = Math.min(stat.size - st.offset, MAX_READ);
      if (len <= 0) return tallyLines('', st);
      const buf = Buffer.alloc(len);
      const got = fs.readSync(fd, buf, 0, len, st.offset);
      const end = buf.lastIndexOf(10, got - 1); // last newline: a half-written line waits for next time
      if (end < 0) return tallyLines('', st);
      st.offset += end + 1;
      return tallyLines(buf.subarray(0, end + 1).toString('utf8'), st);
    } catch {
      return null;
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  }

  return {
    // A turn is starting: anything already in the transcript belongs to earlier turns.
    // A file we already follow keeps its place.
    mark(file) {
      if (!file) return;
      for (const f of [file, ...subagentFiles(file)]) {
        if (files.has(f)) continue;
        const st = state(f); // not there yet: it will be read from the start
        try {
          const stat = fs.statSync(f);
          if (path.basename(f) === 'events.jsonl') readNew(f); // learn Copilot's running total
          else Object.assign(st, { offset: stat.size, ino: stat.ino });
        } catch {}
      }
    },

    // The turn ended: what did it cost? { amount, unit } or null.
    async turn(file, { waitMs = 1500 } = {}) {
      try {
        if (!file) return null;
        let usd = 0;
        let priced = 0;
        let credits = null;
        const add = (r) => {
          if (!r) return;
          usd += r.usd;
          priced += r.priced;
          if (r.credits !== null) credits = (credits ?? 0) + r.credits;
        };
        add(readNew(file));
        for (const f of subagentFiles(file)) add(readNew(f));
        // Copilot writes this turn's checkpoint just after the hook fires.
        const copilot = path.basename(file) === 'events.jsonl';
        for (let waited = 0; copilot && credits === null && waited < waitMs; waited += 100) {
          await sleep(100);
          add(readNew(file));
        }
        if (credits !== null) return { amount: round(credits), unit: 'credits' };
        if (priced) return { amount: round(usd), unit: 'usd' };
        return null;
      } catch {
        return null;
      }
    },
  };
}

const round = (n) => Math.round(n * 1e6) / 1e6;
