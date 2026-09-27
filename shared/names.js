// Agent names: what people may call their agents. Shared by the server (which
// enforces it) and the client (which checks as you type).
export const AGENT_NAME_MAX = 20;

// Returns { name } (tidied) or { error } explaining what's wrong.
export function cleanAgentName(raw) {
  const name = String(raw ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!name) return { error: 'Give the agent a name.' };
  if (name.length > AGENT_NAME_MAX) return { error: `Names can be at most ${AGENT_NAME_MAX} characters.` };
  // Letters and digits in any script, plus spaces and a little punctuation; no
  // markup or control characters, since names show up in tags, toasts and prompts.
  if (!/^[\p{L}\p{N}][\p{L}\p{N}\p{M} '._-]*$/u.test(name)) return { error: 'Use letters, numbers, spaces and . _ - \' only, starting with a letter or number.' };
  return { name };
}

export const sameName = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
