// Draws an agent's live terminal (rows of coloured text runs from the server)
// onto a canvas used as its laptop screen.
import * as THREE from 'three';

const W = 1024;
const H = 640;
const BG = '#1b1d2e';
const FG = '#d6deeb';
const FONT = '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace';

export function screenTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8; // stays legible when the laptop is seen at an angle
  paintMessage(tex, 'starting…');
  return tex;
}

function paintMessage(tex, text) {
  const g = tex.image.getContext('2d');
  g.fillStyle = BG;
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#64748b';
  g.font = `28px ${FONT}`;
  g.fillText(text, 32, 56);
  tex.needsUpdate = true;
}

export function drawTerminal(tex, screen) {
  const g = tex.image.getContext('2d');
  const n = screen.n || screen.rows.length || 1;
  // Zoom to the widest line in use (at least 60 columns), so short output stays
  // readable on a small laptop while full-width TUIs still fit edge to edge.
  const used = Math.max(0, ...screen.rows.map((row) => (row || []).reduce((w, [text]) => w + [...text].length, 0)));
  const cols = Math.min(screen.cols || 120, Math.max(60, used + 2));
  const lineH = H / n;
  const charW = W / cols;
  const size = Math.max(6, Math.min(lineH * 0.88, charW * 1.9));
  g.fillStyle = BG;
  g.fillRect(0, 0, W, H);
  g.font = `${size}px ${FONT}`;
  g.textBaseline = 'top';
  // Monospace glyphs rarely match the cell width exactly, so stretch each run to fit.
  const stretch = charW / (g.measureText('M').width || charW);
  for (let y = 0; y < n; y++) {
    let x = 0;
    for (const [text, fg, bg] of screen.rows[y] || []) {
      const cells = [...text].length;
      if (bg) {
        g.fillStyle = bg;
        g.fillRect(x * charW, y * lineH, cells * charW, lineH);
      }
      if (text.trim()) {
        g.save();
        g.translate(x * charW, y * lineH + (lineH - size) / 2);
        g.scale(stretch, 1);
        g.fillStyle = fg || FG;
        g.fillText(text, 0, 0);
        g.restore();
      }
      x += cells;
    }
  }
  tex.needsUpdate = true;
}
