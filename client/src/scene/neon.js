// Lays out a name for the neon sign on the back wall: one to three balanced
// lines (by length), each with its height on the sign (0 top, 1 bottom) and a
// font size that suits the line count. Width is handled when drawing: lettering
// shrinks to fit the canvas.

const LAYOUTS = {
  1: { ys: [0.5], px: 260 },
  2: { ys: [0.3, 0.72], px: 230 },
  3: { ys: [0.19, 0.5, 0.81], px: 165 },
};

export function signLines(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return signLines('Agent Guild');
  // Two or more words stack (like Agent / Guild); really long names take a third line.
  const count = words.length === 1 ? 1 : Math.min(3, words.length, Math.max(2, Math.ceil(words.join(' ').length / 18)));
  const lines = balance(words, count);
  const { ys, px } = LAYOUTS[lines.length];
  return { lines: lines.map((t, i) => [t, ys[i]]), px };
}

// Splits words into `count` lines whose longest line is as short as possible.
function balance(words, count) {
  if (count === 1) return [words.join(' ')];
  let best = null;
  for (let i = 1; i <= words.length - count + 1; i++) {
    const rest = balance(words.slice(i), count - 1);
    const lines = [words.slice(0, i).join(' '), ...rest];
    const longest = Math.max(...lines.map((l) => l.length));
    if (!best || longest < best.longest) best = { lines, longest };
  }
  return best.lines;
}
