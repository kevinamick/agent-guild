#!/usr/bin/env node
// A stand-in for `claude` when testing the office without spending tokens:
// `agent-guild-runner --agent-cmd scripts/fake-agent.js`. It fires the same hook
// events Claude Code would and writes a playbook lesson after each task.
import fs from 'node:fs';
import path from 'node:path';

const HOOK = process.env.AGENT_GUILD_HOOK_URL;
const NAME = process.env.AGENT_GUILD_AGENT || 'agent';
const PLAYBOOK = process.env.AGENT_GUILD_PLAYBOOK_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hook = (event, body = {}) =>
  fetch(`${HOOK}/${event}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    .then((r) => r.text())
    .catch(() => '');

let line = '';
let busy = false;
const out = (s) => process.stdout.write(s);
const prompt = () => out('\r\n\x1b[33m❯\x1b[0m ');

async function work(text) {
  busy = true;
  // Like a real CLI, the prompt hook's answer joins the context: a note naming the
  // playbook file for this kind of task.
  const reply = await hook('UserPromptSubmit', { prompt: text });
  let noted = null;
  try {
    noted = JSON.parse(reply).additionalContext?.match(/ to (\S+\.md) as a "- " bullet/)?.[1];
  } catch {}
  out(`\r\n\x1b[2m${NAME} is thinking…\x1b[0m\r\n`);
  const steps = [['Bash', { command: 'git status' }], ['Read', { file_path: 'README.md' }], ['Edit', { file_path: 'src/app.js' }]];
  if (/open a pr/i.test(text)) steps.push(['Bash', { command: 'gh pr create --fill' }]);
  if (/review/i.test(text)) steps.push(['Bash', { command: 'gh pr review 2 --comment -b "lgtm"' }]);
  if (/merge|conflict|rebase/i.test(text)) steps.push(['Bash', { command: 'git merge origin/main' }]);
  if (/needs? permission/i.test(text)) {
    // Like Copilot on Windows: hooks stamped with times, arriving out of order.
    const t = Date.now();
    await hook('PreToolUse', { tool_name: 'bash', tool_input: { command: 'rm -rf build' }, timestamp: t });
    await hook('PermissionRequest', { toolName: 'bash', toolInput: { command: 'rm -rf build' }, timestamp: t + 2 });
    await hook('PreToolUse', { tool_name: 'bash', tool_input: { command: 'rm -rf build' }, timestamp: t + 1 });
    out('\x1b[33mAllow bash: rm -rf build? (y/n)\x1b[0m\r\n');
    await sleep(2500);
  }
  for (const [tool_name, tool_input] of steps) {
    await hook('PreToolUse', { tool_name, tool_input });
    out(`\x1b[32m●\x1b[0m ${tool_name}(${tool_input.command || tool_input.file_path})\r\n`);
    await sleep(400);
  }
  const kind = /review/i.test(text) ? 'review' : /issue/i.test(text) ? 'issue' : 'general';
  const file = noted || (PLAYBOOK && path.join(PLAYBOOK, `${kind}.md`));
  if (file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `- Lesson from "${text.slice(0, 40)}": run the tests before pushing\n`);
  }
  out(`\x1b[1mDone:\x1b[0m ${text.slice(0, 60)}\r\n`);
  await hook('Stop', {});
  busy = false;
  prompt();
}

process.stdin.setRawMode?.(true);
process.stdin.setEncoding('utf8');
out(`\x1b[1;35m${NAME}\x1b[0m (fake agent) ready. Type a prompt.\r\n`);
hook('SessionStart', {});
prompt();

const initial = process.argv.slice(2).join(' ').trim();
if (initial) work(initial);

process.stdin.on('data', (chunk) => {
  const data = chunk.replace(/\x1b\[20[01]~/g, '');
  for (const ch of data) {
    if (ch === '\u0003') process.exit(0);
    if (ch === '\r') {
      const text = line.trim();
      line = '';
      if (text && !busy) work(text);
      else prompt();
    } else if (ch === '\u007f') {
      if (line) {
        line = line.slice(0, -1);
        out('\b \b');
      }
    } else if (ch >= ' ' || ch === '\n') {
      line += ch === '\n' ? ' ' : ch;
      out(ch === '\n' ? ' ' : ch);
    }
  }
});
