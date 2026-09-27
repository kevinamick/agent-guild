// Engines an agent can run on. Each adapter turns "start this agent" into a
// command line, and wires the CLI's own hooks back to the runner so the office
// sees working/done/needs-you and awards XP. The playbook is injected the way
// each CLI prefers: a system-prompt flag for Claude, an instructions dir for Copilot.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// `reply` hooks print the runner's answer, which the CLI adds to the agent's context.
const hookCommand = (url, event, reply = false) =>
  `curl -s -m 2 -X POST -H 'content-type: application/json' --data-binary @- ${url}/${event}${reply ? ' 2>/dev/null' : ' >/dev/null 2>&1'} || true`;

export const ADAPTERS = {
  claude: {
    label: 'Claude Code',
    bin: 'claude',
    build({ agent, dir, playbook, hookUrl, instructions, task, opts }) {
      const hooks = {};
      for (const event of ['SessionStart', 'UserPromptSubmit', 'Stop', 'Notification']) {
        hooks[event] = [{ hooks: [{ type: 'command', command: hookCommand(hookUrl, event, event === 'UserPromptSubmit') }] }];
      }
      for (const event of ['PreToolUse', 'PostToolUse']) {
        hooks[event] = [{ matcher: '*', hooks: [{ type: 'command', command: hookCommand(hookUrl, event) }] }];
      }
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
    // What the UserPromptSubmit hook prints: extra context for this turn.
    hookReply: (context) => JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: context } }),
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
      // Not permissionRequest: Copilot fires it for every tool, even ones already allowed.
      // A real prompt comes with a notification.
      const map = {
        sessionStart: 'SessionStart', userPromptSubmitted: 'UserPromptSubmit', preToolUse: 'PreToolUse', postToolUse: 'PostToolUse',
        agentStop: 'Stop', notification: 'Notification',
      };
      // Copilot runs `bash` on macOS/Linux and `powershell` on Windows.
      // No proxy for a call to 127.0.0.1: Windows PowerShell's proxy auto-detection alone
      // can outlast the timeout on a corporate network. A reply can come back as bytes,
      // which would reach Copilot as a column of numbers, so it's decoded to text.
      const psCommand = (event, reply) => {
        const call = `Invoke-WebRequest -UseBasicParsing -Uri '${hookUrl}/${event}' -Method Post -ContentType 'application/json' -Body $b -TimeoutSec 4`;
        const head = `$b = [Console]::In.ReadToEnd(); [System.Net.WebRequest]::DefaultWebProxy = $null;`;
        return reply
          ? `${head} try { $r = (${call}).Content; if ($r -is [byte[]]) { $r = [System.Text.Encoding]::UTF8.GetString($r) }; $r } catch {}`
          : `${head} try { ${call} | Out-Null } catch {}`;
      };
      const hooks = Object.fromEntries(
        Object.entries(map).map(([ev, ours]) => {
          const reply = ours === 'UserPromptSubmit';
          return [ev, [{ type: 'command', bash: hookCommand(hookUrl, ours, reply), powershell: psCommand(ours, reply), timeoutSec: 5 }]];
        }),
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
    hookReply: (context) => JSON.stringify({ additionalContext: context }),
  },
};

// Any other command (e.g. scripts/fake-agent.js). It gets the task as its first
// argument and can report status by POSTing to $AGENT_GUILD_HOOK_URL/<event>.
export function customAdapter(cmd) {
  return {
    label: path.basename(cmd),
    bin: cmd,
    custom: true,
    hookReply: (context) => JSON.stringify({ additionalContext: context }),
    build({ task }) {
      return { cmd, args: task?.text ? [task.text] : [], env: {} };
    },
  };
}

// Windows only starts these directly (batch files via cmd.exe). PATHEXT also
// lists .VBS/.JS/.WSF etc., which need a script host, so those are skipped, and
// so are extensionless files such as the `copilot` sh script npm writes next to
// copilot.cmd for Git Bash: it exists, but CreateProcess can't run it.
const WIN_RUNNABLE = ['.com', '.exe', '.bat', '.cmd'];

// process.env is case-insensitive on Windows, but a copy of it isn't.
function getEnv(env, name, platform) {
  if (env[name] !== undefined || platform !== 'win32') return env[name];
  const key = Object.keys(env).find((k) => k.toUpperCase() === name.toUpperCase());
  return key && env[key];
}

// PATH entries as Windows reads them: `;`-separated, maybe quoted, and maybe
// holding an unexpanded %VAR% when Path was saved as a plain string.
export function pathDirs({ env = process.env, platform = process.platform } = {}) {
  const raw = getEnv(env, 'PATH', platform) || '';
  if (platform !== 'win32') return raw.split(':').filter(Boolean);
  return raw
    .split(';')
    .map((d) => d.trim().replace(/^"(.*)"$/, '$1').replace(/%([^%]+)%/g, (m, v) => getEnv(env, v, platform) ?? m))
    .filter(Boolean);
}

// Where Windows installers put CLIs. A terminal opened before an install keeps
// its old PATH, so a CLI can be installed yet not on the PATH we were given.
export function knownDirs({ env = process.env, platform = process.platform } = {}) {
  if (platform !== 'win32') return [];
  const get = (name) => getEnv(env, name, platform);
  const local = get('LOCALAPPDATA');
  const dirs = [
    get('npm_config_prefix'), // npm -g puts copilot.cmd here; npx tells us where
    get('APPDATA') && path.join(get('APPDATA'), 'npm'), // npm's default prefix
    get('USERPROFILE') && path.join(get('USERPROFILE'), '.local', 'bin'), // Claude Code's installer (claude.exe)
    local && path.join(local, 'Microsoft', 'WinGet', 'Links'), // winget install GitHub.Copilot
    local && path.join(local, 'Microsoft', 'WindowsApps'), // App Execution Aliases
  ].filter(Boolean);
  const onPath = new Set(pathDirs({ env, platform }).map((d) => path.resolve(d).toLowerCase()));
  return [...new Set(dirs)].filter((d) => !onPath.has(path.resolve(d).toLowerCase()));
}

function winExts(env) {
  const exts = (getEnv(env, 'PATHEXT', 'win32') || '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => WIN_RUNNABLE.includes(e));
  for (const e of WIN_RUNNABLE) if (!exts.includes(e)) exts.push(e);
  return exts;
}

// Can we start this file? Windows has no execute bit (X_OK only means "exists"
// there). App Execution Aliases (the 0-byte …\WindowsApps\*.exe links that
// Store/MSIX apps install) are reparse points stat can't open (EACCES or
// UNKNOWN), though CreateProcess runs them; lstat still sees them. A missing
// file or a dangling symlink (ENOENT) is still a no.
function runnable(file, platform, fsi = fs) {
  try {
    if (!fsi.statSync(file).isFile()) return false;
    if (platform !== 'win32') fsi.accessSync(file, fs.constants.X_OK);
    return true;
  } catch (e) {
    if (platform !== 'win32' || e.code === 'ENOENT' || e.code === 'ENOTDIR') return false;
    try {
      return !fsi.lstatSync(file).isDirectory();
    } catch {
      return false;
    }
  }
}

const hasWinExt = (file) => WIN_RUNNABLE.includes(path.extname(file).toLowerCase());
const isPs1 = (file) => /\.ps1$/i.test(file);

// `where.exe <bin>`: Windows' own lookup, for when ours comes up empty.
export function whereExe(bin) {
  try {
    return execFileSync('where.exe', [bin], { encoding: 'utf8', timeout: 5000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

// Find an executable and return its full path, or null.
// macOS/Linux: the bare name on PATH, or `<name>.exe` (a Windows install seen
// from WSL). Windows: what cmd.exe would run, i.e. `<name><ext>` for each
// PATHEXT extension in order (npm's copilot.cmd, WinGet's copilot.exe), never
// the extensionless sh shim npm puts beside copilot.cmd; then the folders
// installers use (knownDirs); then whatever `where.exe` finds; and last a
// PowerShell-only `<name>.ps1`. Paths work too, with or without the extension.
// `where` and `fs` are there so tests can play Windows.
export function resolveBin(bin, { env = process.env, platform = process.platform, where = whereExe, cwd = process.cwd(), fs: fsi = fs } = {}) {
  const ok = (f) => runnable(f, platform, fsi);
  if (platform !== 'win32') {
    const exts = ['', '.exe'];
    if (bin.includes('/')) return exts.map((e) => bin + e).find(ok) ?? null;
    for (const dir of pathDirs({ env, platform })) for (const ext of exts) if (ok(path.join(dir, bin + ext))) return path.join(dir, bin + ext);
    return null;
  }
  const exts = hasWinExt(bin) || isPs1(bin) ? [''] : winExts(env);
  if (bin.includes('/') || bin.includes('\\')) return [...exts, '.ps1'].map((e) => bin + e).find((f) => (hasWinExt(f) || isPs1(f)) && ok(f)) ?? null;
  const dirs = [...pathDirs({ env, platform }), ...knownDirs({ env, platform })];
  for (const dir of dirs) {
    for (const ext of exts) {
      const file = path.join(dir, bin + ext);
      if (ok(file)) return file;
    }
  }
  // where.exe searches the current directory first; a copilot.cmd sitting in
  // the repo we were pointed at shouldn't get to run.
  const here = path.resolve(cwd).toLowerCase();
  const found = where(bin).find((f) => hasWinExt(f) && path.dirname(path.resolve(f)).toLowerCase() !== here && ok(f));
  if (found) return found;
  if (isPs1(bin) || exts.length === 1) return null;
  for (const dir of dirs) if (ok(path.join(dir, `${bin}.ps1`))) return path.join(dir, `${bin}.ps1`);
  return null;
}

export const onPath = (bin) => Boolean(resolveBin(bin));

// Why an engine wasn't found, for the error message: each folder searched, every
// file in them named like the engine (and whether it can be started), and what
// `where.exe` says.
export function explainMissing(bins, { env = process.env, platform = process.platform, where = whereExe } = {}) {
  const dirs = pathDirs({ env, platform });
  const extra = knownDirs({ env, platform });
  const lines = [`PATH (${dirs.length} entries):`, ...dirs.map((d) => `    ${d}`)];
  if (extra.length) lines.push('Also looked in:', ...extra.map((d) => `    ${d}`));
  for (const bin of bins) {
    const seen = [];
    for (const dir of [...dirs, ...extra]) {
      let names = [];
      try {
        names = fs.readdirSync(dir).filter((n) => n.toLowerCase() === bin || n.toLowerCase().startsWith(`${bin}.`));
      } catch {}
      for (const n of names) {
        const file = path.join(dir, n);
        let why = runnable(file, platform) ? 'usable' : 'skipped: not an executable file';
        if (platform === 'win32' && !hasWinExt(n) && !isPs1(n)) why = "skipped: no .exe/.cmd extension, so Windows can't start it";
        seen.push(`    ${file}  (${why})`);
      }
    }
    lines.push(`${bin}: ${seen.length ? 'files by that name:' : 'no file by that name in those folders'}`, ...seen);
    if (platform === 'win32') {
      const found = where(bin);
      lines.push(`    where.exe ${bin}: ${found.length ? found.join(', ') : 'nothing'}`);
    }
  }
  return lines.join('\n');
}

// Engines chosen with --cli: names (claude, copilot), optionally with the file
// to use (`copilot=C:\tools\copilot.exe`), or just the path to the CLI itself.
export function parseCliList(value) {
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((item) => {
      const eq = item.indexOf('=');
      if (eq > 0) return { id: item.slice(0, eq).trim().toLowerCase(), path: item.slice(eq + 1).trim() };
      if (/[\\/]/.test(item)) return { id: path.basename(item.replace(/\\/g, '/')).replace(/\.[^.]*$/, '').toLowerCase(), path: item };
      return { id: item.toLowerCase() };
    });
}

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

// npm's .cmd shims only run `node <script>` (or an .exe), so those skip cmd.exe
// and start the target directly: no escaping can carry a newline (a multi-line
// task or Claude's --append-system-prompt) through cmd, nor lift its 8191-char
// limit. PowerShell-only .ps1 launchers go through powershell.exe -File.
export function spawnSpec(file, args, { env = process.env, node = process.execPath } = {}) {
  if (isPs1(file)) {
    const ps = env.SystemRoot ? path.win32.join(env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : 'powershell.exe';
    return { file: ps, args: ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file, ...args] };
  }
  if (!/\.(cmd|bat)$/i.test(file)) return { file, args };
  const shim = npmShimTarget(file);
  if (shim?.node) {
    // Like the shim: a node.exe beside it wins (npm's own folder), else ours.
    const local = path.join(path.dirname(file), 'node.exe');
    return { file: fs.existsSync(local) ? local : node, args: [shim.target, ...args] };
  }
  if (shim) return { file: shim.target, args };
  let twice = false;
  try {
    twice = /%\*/.test(fs.readFileSync(file, 'utf8'));
  } catch {}
  const line = [path.win32.normalize(file).replace(CMD_META, '^$1'), ...args.map((a) => cmdEscapeArg(a, twice))].join(' ');
  const cmdArgs = ['/d', '/s', '/c', `"${line}"`];
  // child_process needs windowsVerbatimArguments; node-pty takes the line as a string.
  return { file: env.ComSpec || env.comspec || 'cmd.exe', args: cmdArgs, commandLine: cmdArgs.join(' '), windowsVerbatimArguments: true };
}

// What an npm cmd-shim runs, or null: { target, node } where node says it's a
// script for node. Its last line reads `… "%_prog%"  "%dp0%\node_modules\pkg\cli.js" %*`
// with _prog set to node, or just `"%dp0%\node_modules\pkg\bin.exe"   %*`.
export function npmShimTarget(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  const m = text.match(/"%(?:~dp0|dp0%)\\([^"]+?)"\s+%\*/);
  if (!m) return null;
  const target = path.join(path.dirname(file), ...m[1].split('\\'));
  if (!fs.existsSync(target)) return null;
  if (/_prog=node"/i.test(text) && /\.[cm]?js$/i.test(m[1])) return { target, node: true };
  if (/\.exe$/i.test(m[1]) && !/_prog/i.test(text)) return { target, node: false };
  return null;
}

// Normalize hook payloads: Copilot sends toolName/toolArgs, Claude tool_name/tool_input.
export function normalizeHook(body) {
  if (body.toolName && !body.tool_name) body.tool_name = body.toolName;
  if (body.toolInput && !body.tool_input) body.tool_input = body.toolInput;
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
