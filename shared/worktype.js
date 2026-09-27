// Works out what kind of work an agent's turn was, so XP lands in the right skill
// without anyone picking it: the prompt says what was asked, the commands and edits
// say what was actually done. Evidence is scored per skill; too little evidence
// returns null and the caller keeps the desk's current kind.

const PROMPT = {
  review: [
    /\breview(s|ed|ing)?\b/i,
    /\b(look (over|at|through)|go (over|through)|check|audit|critique|inspect|sanity[- ]check)\b[^.\n]{0,40}\b(pr|pull request|diff|changes?|commits?|branch)\b/i,
    /\bcode review\b|\blgtm\b|\bapprove\b|\bsafe to (ship|merge)\b|\bready to merge\b/i,
  ],
  conflict: [/\bmerge conflicts?\b|\bconflict(s|ed|ing)?\b/i, /\brebas(e|ing)\b/i, /\bmerge (main|master|develop|the base|upstream)\b/i],
  issue: [
    /\bissue\s*#?\d+|\bwork item\b|\buser story\b|\b(bug|story|task|feature)\s*#?\d+/i,
    /\b(fix|implement|build|add support|bug|feature|refactor)\b(?![/-])/i, // not branch names like feature/x
    /(^|\s)#\d+\b/,
  ],
};

const COMMAND = {
  review: [/\bgh pr (review|diff|checks)\b/, /\baz repos pr (show|list|set-vote|reviewer)\b/, /\bgit diff\b[^\n]*\.\.\./],
  conflict: [
    /\bgit (merge|rebase|mergetool|cherry-pick)\b(?![^\n]*--abort)/,
    /--(ours|theirs)\b/,
    /--diff-filter=U\b/,
  ],
  issue: [/\bgh issue (view|develop|comment|close)\b/, /\baz boards work-item\b/, /\bgh pr create\b|\baz repos pr create\b/],
};

const EDIT_TOOLS = /^(edit|write|multiedit|create|str_replace\w*|apply_patch|notebookedit)$/i;
export const isEditTool = (name) => EDIT_TOOLS.test(String(name || ''));

const count = (patterns, text) => patterns.filter((re) => re.test(text)).length;

// What the prompt alone suggests (used before any work happens, e.g. to pick the
// playbook file for the lesson note). Null when it doesn't clearly say.
export function kindFromPrompt(prompt) {
  return pick(promptScores(prompt), 2);
}

function promptScores(prompt) {
  const text = String(prompt || '');
  // "#12" next to "pull request" is the PR's number, not an issue reference.
  const issue = /\b(pr|pull request)\b/i.test(text) ? PROMPT.issue.slice(0, 2) : PROMPT.issue;
  return {
    review: 2 * count(PROMPT.review, text),
    conflict: 2 * count(PROMPT.conflict, text),
    issue: 2 * count(issue, text),
  };
}

// A whole turn: the prompt plus every command run and file edited.
export function detectKind({ prompt = '', commands: raw = [], edits = 0 } = {}) {
  const scores = promptScores(prompt);
  // `git --no-pager -C repo diff` is still `git diff`.
  const commands = raw.map((c) => String(c).replace(/\bgit(\s+(--no-pager|-C\s+\S+|-c\s+\S+))+/g, 'git'));
  for (const cmd of commands) for (const k of Object.keys(COMMAND)) scores[k] += 3 * count(COMMAND[k], cmd);
  // Reading history and diffs is a weaker sign of review (plenty of other work does it too).
  scores.review += Math.min(2, commands.filter((c) => /\bgit (show|diff|log -p)\b/.test(c)).length);
  if (edits > 0) {
    // Changing code is building or fixing, unless it's resolving a merge; reviewers
    // mostly read, so edits count against a review.
    if (scores.conflict === 0) scores.issue += Math.min(3, 1 + edits);
    scores.review -= Math.min(2, edits);
  }
  return pick(scores, 3);
}

// The best-scoring skill, if it has enough evidence and a clear lead.
function pick(scores, min) {
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [[best, top], [, next]] = ranked;
  if (top < min || top === next) return null;
  return best;
}
