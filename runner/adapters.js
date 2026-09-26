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
      const hooks = Object.fromEntries(Object.entries(map).map(([ev, ours]) => [ev, [{ type: 'command', bash: hookCommand(hookUrl, ours), timeoutSec: 5 }]]));
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

export function onPath(bin) {
  if (bin.includes('/')) return fs.existsSync(bin);
  return (process.env.PATH || '').split(path.delimiter).some((d) => {
    try {
      fs.accessSync(path.join(d, bin), fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
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
