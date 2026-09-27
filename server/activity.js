// The office's activity log on disk (activity.json) and when each person was last
// in the office (lastseen.json). Both are written debounced, not on every event.
import fs from 'node:fs';
import { trimLog, LOG_MAX, LOG_MAX_AGE } from './recap.js';

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function debouncedWriter(file, data, delayMs) {
  let timer = null;
  const flush = () => {
    clearTimeout(timer);
    timer = null;
    fs.writeFileSync(file + '.tmp', JSON.stringify(data()));
    fs.renameSync(file + '.tmp', file);
  };
  return {
    schedule() {
      if (!timer) timer = setTimeout(flush, delayMs);
    },
    flush,
  };
}

export function createActivityLog(file, { max = LOG_MAX, maxAge = LOG_MAX_AGE, delayMs = 2000, now = Date.now } = {}) {
  const loaded = readJson(file, []);
  let entries = trimLog(Array.isArray(loaded) ? loaded.filter((e) => e && typeof e.type === 'string' && Number.isFinite(e.at)) : [], now(), { max, maxAge });
  const writer = debouncedWriter(file, () => entries, delayMs);
  return {
    /** Appends { at, type, ...data } and returns the entry. */
    add(type, data = {}) {
      const entry = { ...data, type: String(type), at: now() };
      entries.push(entry);
      entries = trimLog(entries, now(), { max, maxAge });
      writer.schedule();
      return entry;
    },
    since(at) {
      return entries.filter((e) => e.at >= at);
    },
    entries: () => entries,
    flush: () => writer.flush(),
  };
}

// { [lower-case name]: last time they were in the office }
export function createLastSeen(file, { delayMs = 2000, now = Date.now } = {}) {
  const seen = readJson(file, {});
  const writer = debouncedWriter(file, () => seen, delayMs);
  return {
    get: (name) => seen[String(name).toLowerCase()] ?? null,
    touch(name, at = now()) {
      seen[String(name).toLowerCase()] = at;
      writer.schedule();
    },
    flush: () => writer.flush(),
  };
}
