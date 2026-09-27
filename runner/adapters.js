// Engines an agent can run on. Each adapter turns "start this agent" into a
// command line, and wires the CLI's own hooks back to the runner so the office
// sees working/done/needs-you and awards XP. The playbook is injected the way
// each CLI prefers: a system-prompt flag for Claude, an instructions dir for Copilot.
import fs from 'node:fs';
import path from 'node:path';

const hookCommand = (url, event) =>
  `curl -s -m 2 -X POST -H 'content-type: application/json' --data-binary @- ${url}/${event} >/dev/null 2>&1 || true`;

export const ADAPTERS = {
  claude: {
    label: 'Claude Code',
    bin: 'claude',
    build({ agent, dir, playbook, hookUrl, instructions, task, opts }) {
      const hooks = {};
      for (const event of ['SessionStart', 'UserPromptSubmit', 'Stop', 'Notification']) {
        hooks[event] = [{ hooks: [{ type: 'command', command: hookCommand(hookUrl, event) }] }];
      }
      hooks.PreToolUse = [{ matcher: '*', hooks: [{ type: 'command', command: hookCommand(hookUrl, 'PreToolUse') }] }];
      const settingsFile = path.join(dir, 'claude-settings.json');
      fs.writeFileSync(settingsFile, JSON.stringify({ hooks }));
      const args = [
        '--permission-mode', opts['permission-mode'],
        '--settings', settingsFile,
        '--add-dir', playbook,
        '--append-system-prompt', instructions,
        '-n', `${agent.name} (guild)`,
      ];
      if (task?.text) args.push(task.text);
      return { cmd: 'claude', args, env: {} };
    },
  },

  copilot: {
    label: 'GitHub Copilot',
    bin: 'copilot',
    build({ agent, dir, playbook, hookUrl, instructions, task, opts, env }) {
      // A throwaway local plugin carries the hooks, so neither the repo nor
      // ~/.copilot is touched. Copilot reads hooks.json at the plugin root.
      const pluginDir = path.join(dir, 'copilot-plugin');
      fs.mkdirSync(pluginDir, { recursive: true });
      fs.writeFileSync(
        path.join(pluginDir, 'plugin.json'),
        JSON.stringify({ name: 'agent-guild', version: '1.0.0', description: 'Reports agent status to the Agent Guild office' }),
      );
      const map = { sessionStart: 'SessionStart', userPromptSubmitted: 'UserPromptSubmit', preToolUse: 'PreToolUse', agentStop: 'Stop', notification: 'Notification' };
      // Copilot runs `bash` on macOS/Linux and `powershell` on Windows.
      const psCommand = (event) =>
        `$b = [Console]::In.ReadToEnd(); try { Invoke-RestMethod -Uri '${hookUrl}/${event}' -Method Post -ContentType 'application/json' -Body $b -TimeoutSec 2 | Out-Null } catch {}`;
      const hooks = Object.fromEntries(
        Object.entries(map).map(([ev, ours]) => [ev, [{ type: 'command', bash: hookCommand(hookUrl, ours), powershell: psCommand(ours), timeoutSec: 5 }]]),
      );
      fs.writeFileSync(path.join(pluginDir, 'hooks.json'), JSON.stringify({ version: 1, hooks }));

      // The playbook reaches Copilot as an extra AGENTS.md.
      const instrDir = path.join(dir, 'copilot-instructions');
      fs.mkdirSync(instrDir, { recursive: true });
      fs.writeFileSync(path.join(instrDir, 'AGENTS.md'), instructions);
      const extraDirs = [env.COPILOT_CUSTOM_INSTRUCTIONS_DIRS, instrDir].filter(Boolean).join(',');

      const args = ['--plugin-dir', pluginDir, '--add-dir', playbook, '-n', `${agent.name} (guild)`];
      if (opts['copilot-args']) args.push(...opts['copilot-args'].split(/\s+/).filter(Boolean));
      if (task?.text) args.push('-i', task.text);
      return { cmd: 'copilot', args, env: { COPILOT_CUSTOM_INSTRUCTIONS_DIRS: extraDirs } };
    },
  },
};

// Any other command (e.g. scripts/fake-agent.js). It gets the task as its first
// argument and can report status by POSTing to $AGENT_GUILD_HOOK_URL/<event>.
export function customAdapter(cmd) {
  return {
    label: path.basename(cmd),
    bin: cmd,
    custom: true,
    build({ task }) {
      return { cmd, args: task?.text ? [task.text] : [], env: {} };
    },
  };
}

// Find an executable on PATH and return its full path. Besides the bare name
// (`copilot`), this finds `copilot.exe` (e.g. installed by WinGet) and, on
// Windows, the other PATHEXT forms such as the `copilot.cmd` shim npm creates.
export function resolveBin(bin, { env = process.env, platform = process.platform } = {}) {
  if (bin.includes('/') || bin.includes('\\')) return fs.existsSync(bin) ? bin : null;
  // On Windows, launchers (PATHEXT: .exe, .cmd, …) come before extensionless files:
  // the Azure CLI and npm install an extensionless bash script next to the real
  // `az.cmd` / `copilot.cmd`, and Windows can't start the script.
  const exts =
    platform === 'win32'
      ? [...new Set((env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean).map((e) => e.toLowerCase())), '']
      : ['', '.exe'];
  const sep = platform === 'win32' ? ';' : ':';
  for (const dir of (env.PATH || env.Path || '').split(sep).filter(Boolean)) {
    for (const ext of exts) {
      const file = path.join(dir, bin + ext);
      try {
        fs.accessSync(file, fs.constants.X_OK);
        if (fs.statSync(file).isFile()) return file;
      } catch {}
    }
  }
  return null;
}

export const onPath = (bin) => Boolean(resolveBin(bin));

// Batch files (.cmd/.bat) can only run through cmd.exe, which re-parses its whole
// command line: paths with spaces break and characters like & | < > % in an
// argument (say, a task title) would run as commands. So the path and every
// argument are quoted and cmd's metacharacters escaped with ^, following
// cross-spawn (MIT). Batch files that forward their arguments with %* (npm shims,
// az.cmd) have them parsed a second time, so those get escaped twice.
const CMD_META = /([()\][%!^"`<>&|;, *?])/g;

function cmdEscapeArg(arg, twice) {
  let a = String(arg)
    .replace(/(?=(\\+?)?)\1"/g, '$1$1\\"') // backslashes before a quote, then escape the quote
    .replace(/(?=(\\+?)?)\1$/, '$1$1'); // trailing backslashes, so they don't escape our closing quote
  a = `"${a}"`.replace(CMD_META, '^$1');
  return twice ? a.replace(CMD_META, '^$1') : a;
}

export function spawnSpec(file, args, { env = process.env } = {}) {
  if (!/\.(cmd|bat)$/i.test(file)) return { file, args };
  let twice = false;
  try {
    twice = /%\*/.test(fs.readFileSync(file, 'utf8'));
  } catch {}
  const line = [path.win32.normalize(file).replace(CMD_META, '^$1'), ...args.map((a) => cmdEscapeArg(a, twice))].join(' ');
  const cmdArgs = ['/d', '/s', '/c', `"${line}"`];
  // child_process needs windowsVerbatimArguments; node-pty takes the line as a string.
  return { file: env.ComSpec || env.comspec || 'cmd.exe', args: cmdArgs, commandLine: cmdArgs.join(' '), windowsVerbatimArguments: true };
}

// Normalize hook payloads: Copilot sends toolName/toolArgs, Claude tool_name/tool_input.
export function normalizeHook(body) {
  if (body.toolName && !body.tool_name) body.tool_name = body.toolName;
  if (body.toolArgs && !body.tool_input) {
    body.tool_input = typeof body.toolArgs === 'string' ? safeJson(body.toolArgs) : body.toolArgs;
  }
  return body;
}

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return { command: s };
  }
}
