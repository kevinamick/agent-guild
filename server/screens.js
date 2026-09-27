// A virtual terminal per agent, fed the same PTY output the office relays, so the
// server always knows what each agent's screen looks like. Offices get compact
// snapshots (only the rows that changed) to draw on the desk laptops.
import xterm from '@xterm/headless';

const { Terminal } = xterm;

// xterm's 256-colour palette: 16 ANSI colours, a 6×6×6 cube, then 24 greys.
const ANSI = ['#1b1d2e', '#ef4444', '#22c55e', '#eab308', '#3b82f6', '#a855f7', '#06b6d4', '#d6deeb',
  '#64748b', '#f87171', '#4ade80', '#facc15', '#60a5fa', '#c084fc', '#22d3ee', '#ffffff'];
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
export function paletteColor(i) {
  if (i < 16) return ANSI[i];
  if (i < 232) {
    const v = [0, 95, 135, 175, 215, 255];
    const k = i - 16;
    return hex((v[Math.floor(k / 36)] << 16) | (v[Math.floor(k / 6) % 6] << 8) | v[k % 6]);
  }
  const g = 8 + (i - 232) * 10;
  return hex((g << 16) | (g << 8) | g);
}

function colorOf(cell, fg) {
  if (fg ? cell.isFgDefault() : cell.isBgDefault()) return null;
  const c = fg ? cell.getFgColor() : cell.getBgColor();
  return (fg ? cell.isFgRGB() : cell.isBgRGB()) ? hex(c) : paletteColor(c);
}

// One row as runs of same-coloured text: [[text, fg|null, bg|null], ...].
function rowRuns(line, cols, cell) {
  const runs = [];
  if (!line) return runs;
  for (let x = 0; x < cols; x++) {
    line.getCell(x, cell);
    if (cell.getWidth() === 0) continue; // second half of a wide character
    let fg = colorOf(cell, true);
    let bg = colorOf(cell, false);
    if (cell.isInverse()) [fg, bg] = [bg || '#1b1d2e', fg || '#d6deeb'];
    const ch = cell.getChars() || ' ';
    const last = runs[runs.length - 1];
    if (last && last[1] === fg && last[2] === bg) last[0] += ch;
    else runs.push([ch, fg, bg]);
  }
  // Trailing blanks carry nothing worth drawing.
  const end = runs[runs.length - 1];
  if (end && !end[2]) {
    end[0] = end[0].replace(/\s+$/, '');
    if (!end[0]) runs.pop();
  }
  return runs;
}

// `windowsPty` ({ backend: 'conpty', buildNumber }) when the agent runs on Windows,
// so wrapped lines are interpreted the way ConPTY paints them.
export function createScreen(cols = 120, rows = 34, windowsPty) {
  const term = new Terminal({ cols, rows, scrollback: 0, allowProposedApi: true, ...(windowsPty ? { windowsPty } : {}) });
  let dirty = false;
  let sent = []; // JSON of each row as last sent
  const markDirty = () => (dirty = true);
  return {
    write(data) {
      term.write(data, markDirty);
    },
    resize(c, r) {
      if (c > 10 && r > 4 && (c !== term.cols || r !== term.rows)) {
        term.resize(Math.min(c, 400), Math.min(r, 200));
        dirty = true;
        sent = [];
      }
    },
    reset(data = '') {
      term.reset();
      sent = [];
      if (data) term.write(data, markDirty);
      else dirty = true;
    },
    // The whole visible screen.
    snapshot() {
      const buf = term.buffer.active;
      const cell = buf.getNullCell();
      return Array.from({ length: term.rows }, (_, y) => rowRuns(buf.getLine(buf.viewportY + y), term.cols, cell));
    },
    // Rows changed since the last call as { index: runs }, or null if nothing did.
    changes() {
      if (!dirty) return null;
      dirty = false;
      const rows = this.snapshot();
      const out = {};
      let any = false;
      rows.forEach((row, i) => {
        const json = JSON.stringify(row);
        if (json !== sent[i]) {
          out[i] = row;
          sent[i] = json;
          any = true;
        }
      });
      return any ? { rows: out, n: rows.length, cols: term.cols } : null;
    },
    full() {
      const rows = this.snapshot();
      return { rows: Object.fromEntries(rows.map((r, i) => [i, r])), n: rows.length, cols: term.cols, full: true };
    },
    dispose() {
      term.dispose();
    },
  };
}
