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
  research: [
    /\b(research|investigat\w*|spike|feasibility|look into|find out|dig into|explore (how|whether|options)|evaluat\w*|compare|comparison)\b/i,
    /\b(pros and cons|trade-?offs?|options for|alternatives to|which (library|approach|tool|framework|option)|best (way|approach|practice)s?|write[- ]?up|summari[sz]e (how|what|the))\b/i,
    /^\s*(how|why|where|when|what|which)\b[^?\n]*\?/i, // a question about the code or the world
  ],
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
  research: [/\bgh search\b/, /\bcurl\b[^\n]*https?:\/\//, /\b(npm|pnpm|yarn) (view|info|search)\b/, /\bpip (show|index|search)\b/],
  issue: [/\bgh issue (view|develop|comment|close)\b/, /\baz boards work-item\b/, /\bgh pr create\b|\baz repos pr create\b/],
};

const EDIT_TOOLS = /^(edit|write|multiedit|create|str_replace\w*|apply_patch|notebookedit)$/i;
export const isEditTool = (name) => EDIT_TOOLS.test(String(name || ''));
// Looking things up on the web (Claude Code's and Copilot's tools).
const WEB_TOOLS = /^(websearch|webfetch|web_search|web_fetch|fetch|search_web)$/i;
export const isWebTool = (name) => WEB_TOOLS.test(String(name || ''));
// Reading the codebase without touching it.
const READ_TOOLS = /^(read|view|grep|glob|ls|search|find|read_file|list_dir)$/i;
export const isReadTool = (name) => READ_TOOLS.test(String(name || ''));

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
    research: 2 * count(PROMPT.research, text),
  };
}

// A whole turn: the prompt plus every command run, file edited, web lookup and file read.
export function detectKind({ prompt = '', commands: raw = [], edits = 0, web = 0, reads = 0 } = {}) {
  const scores = promptScores(prompt);
  // `git --no-pager -C repo diff` is still `git diff`.
  const commands = raw.map((c) => String(c).replace(/\bgit(\s+(--no-pager|-C\s+\S+|-c\s+\S+))+/g, 'git'));
  for (const cmd of commands) for (const k of Object.keys(COMMAND)) scores[k] += 3 * count(COMMAND[k], cmd);
  // Reading history and diffs is a weaker sign of review (plenty of other work does it too).
  scores.review += Math.min(2, commands.filter((c) => /\bgit (show|diff|log -p)\b/.test(c)).length);
  // Research is looking things up and reading around without changing anything.
  scores.research += 3 * Math.min(2, web);
  if (edits === 0 && reads >= 6 && scores.review === 0 && scores.conflict === 0) scores.research += 2;
  if (edits > 0) {
    // Changing code is building or fixing, unless it's resolving a merge; reviewers
    // and researchers mostly read, so edits count against them.
    if (scores.conflict === 0) scores.issue += Math.min(3, 1 + edits);
    scores.review -= Math.min(2, edits);
    scores.research -= Math.min(2, edits);
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
