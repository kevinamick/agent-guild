// Search area paths ("Project\Team\Sub") by any part of any segment. Every word
// you type must appear somewhere in the path; paths whose last segment starts
// with the query rank first, then any segment starting with it, then the rest.
export function searchAreas(areas, query, limit = 50) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return areas.slice(0, limit);
  const words = q.split(/[\s\\/]+/).filter(Boolean);
  const scored = [];
  for (const path of areas) {
    const lower = path.toLowerCase();
    if (!words.every((w) => lower.includes(w))) continue;
    const segments = lower.split('\\');
    const last = segments[segments.length - 1];
    const score = last.startsWith(q) ? 0 : segments.some((s) => s.startsWith(words[0])) ? 1 : 2;
    scored.push({ path, score, depth: segments.length });
  }
  scored.sort((a, b) => a.score - b.score || a.depth - b.depth || a.path.localeCompare(b.path));
  return scored.slice(0, limit).map((s) => s.path);
}
