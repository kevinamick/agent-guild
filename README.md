# Agent Guild

A multiplayer 3D office for Claude Code agents, inspired by webdevcody's "agent office" demo. Agents earn XP and level up, and coworkers can borrow each other's agents.

- **Make your character.** Pick your skin tone, hairstyle (including curly, afro, braids/locs and a headscarf), hair color, facial hair, skirt or pants, and shirt color. Every look is open to everyone. Your character is saved on the server, so it follows you to any device.
- **Walk around a shared office** (WASD). Hire agents at empty desks, open their terminals, prompt them, and send them home.
- **Every agent is a real Claude Code or GitHub Copilot CLI session** in a PTY. The terminal is shared, so everyone in the office sees the same screen and can type into it.
- **Issue (or work item) and PR corkboards** read from GitHub or Azure DevOps. "Hand to a worker", "Review with a worker" and "Resolve conflicts" start an agent with a ready-made brief, optionally in its own git worktree and branch.
- **XP and levels.** Each agent levels up four skills: 📌 Issue Fixer, 🔍 Reviewer, 🔀 Conflict Resolver and 🧰 Generalist.
- **Levels make agents stronger.** After each task an agent writes reusable lessons into a per-skill *playbook*, and that playbook is appended to the system prompt of every session it starts. Higher skill levels let it keep more lessons (`3 + 2 × level`, up to 45). A Lv 8 Reviewer brings 19 learned lessons about your repo to a review; a new recruit brings none.
- **Cosmetics.** Beanie at Lv 3, party hat at 5, top hat at 8, mastery aura at 11, crown at 15, halo at 20. Level badges go bronze → silver → gold → diamond.
- **Borrowing.** Agents run on their **owner's** machine, with the owner's Claude login and repo checkout. Anyone in the office can hire a coworker's idle agent. Its XP and playbook grow no matter who borrowed it, and the Guild Hall tracks who lends the most.

## Engines: Claude Code and GitHub Copilot

A runner offers every supported CLI it finds on your `PATH`, and you pick the engine per agent in the hire dialog. An agent's level, XP and playbook carry over between engines.

| | Claude Code | GitHub Copilot CLI |
|---|---|---|
| install | `claude` | `npm i -g @github/copilot`, then `copilot login` (or an existing `gh` login) |
| status + XP | hooks via `--settings` | hooks via a throwaway per-agent plugin (`--plugin-dir`) |
| playbook | `--append-system-prompt` | an extra `AGENTS.md` via `COPILOT_CUSTOM_INSTRUCTIONS_DIRS` |
| autonomy | `--permission-mode auto` (default) | Copilot's normal approvals by default; the agent shows ✋ **needs you** and anyone can approve in the shared terminal. Pass `--copilot-args "--allow-all-tools"` for full autonomy |

Neither integration touches your repo or your global CLI config. Use `--cli copilot` or `--cli claude,copilot` to restrict what a runner offers. Any other command can be plugged in with `--agent-cmd`: it gets the task as its first argument and reports status by POSTing hook events to `$AGENT_GUILD_HOOK_URL/<event>` (see `scripts/fake-agent.js`).

## GitHub and Azure DevOps

The runner reads the repo's `origin` remote and talks to whichever host it finds.

| | GitHub | Azure DevOps |
|---|---|---|
| boards | Issues and PRs via `gh` | Work items (WIQL) and PRs via the REST API |
| sign-in | `gh auth login` | `AZURE_DEVOPS_EXT_PAT` (a PAT with Code and Work Items read), or `az login`. Public projects' PRs load without either |
| agent briefs | `gh issue view`, `gh pr diff`, `gh pr create` | `az boards work-item show`, `az repos pr show`, `az repos pr create --work-items` |
| PR bonus XP | `gh pr create/merge/review` | `az repos pr create`, `az repos pr update --status completed`, `az repos pr set-vote` |

For agents to open and review ADO pull requests themselves, install the Azure CLI plus its extension (`az extension add --name azure-devops`). It picks up the org and project from the git remote. Work items are closed when their state is Closed, Done, Removed or Resolved; everything else counts as open.

## How it fits together

```
 browser (3D office, xterm)  ─┐
 browser                     ─┼─ ws ─►  office server  ◄─ ws ─  runner (Kevin's machine) ── claude PTYs, playbooks, gh
 browser                     ─┘        (world, chat,           runner (Alice's machine) ── claude PTYs, playbooks, gh
                                        XP ledger, relay)
```

- `server/`: presence, chat, desks, the shared XP ledger (`data/agents.json`), and a relay between browsers and runners. It also serves the built client.
- `runner/`: one per person. It spawns `claude` in a PTY for each of its agents. It learns an agent's status from Claude Code hooks (passed with `--settings`, so your own settings are untouched), keeps playbooks in `~/.agent-guild/agents/<id>/playbook/`, creates worktrees, and answers `gh` queries for the boards.
- `shared/`: progression rules (XP curve, titles, playbook capacity) and the office layout, used by all three parts.

XP for one task (a prompt through to Claude's `Stop`): +10 for the task, +2 per tool call (max 40), +3 per minute of focus (max 30), +50 for opening a PR, +30 for posting a review, +80 for merging. The total is capped at 200. A chat with no tool use earns 2. Kudos from a coworker earn +20, once per person per task.

## Run it locally

```bash
npm install
npm run build

# 1. Office server. On first start it prints an admin key once (or pass --admin-key).
node server/index.js --admin Kevin

# 2. Open http://localhost:4600 and sign in with the key. Team → "Host your own agents" shows your runner command:
node runner/index.js --server ws://localhost:4600 --key <your key> --repo-dir ~/code/our-repo
```

Everyone signs in with a **personal key**, and their name comes from that key. Admins create keys in **👥 Team → Invite**, which gives a join link (the key rides in the `#fragment`, so it never hits server logs) and that person's runner command. Revoking a key disconnects that person's browser and runner. Keys are stored hashed in `data/keys.json`.

Runner flags:

| flag | default | |
|---|---|---|
| `--key` | `$GUILD_KEY` | your personal key (required) |
| `--private` | off | don't lend your agents to others |
| `--cli` | installed ones | engines to offer: `claude`, `copilot`, or both |
| `--permission-mode` | `auto` | passed to `claude` |
| `--copilot-args` | none | extra flags for Copilot agents, e.g. `--allow-all-tools` |
| `--home` | `~/.agent-guild` | where agents, playbooks and worktrees live |
| `--agent-cmd` | `claude` | e.g. `scripts/fake-agent.js` to test without spending tokens |

**Reconnects.** When a runner's link drops, or the server restarts or redeploys, the runner keeps its Claude sessions running. It hands them back on reconnect: same desk, same task, and terminal history restored from the runner. XP events that happen while the link is down are queued. Agents whose runner stays away for more than 10 minutes give up their desks. Browsers reconnect automatically.

For development, run `npm run dev` for Vite on :5173 (it proxies `/ws` to :4600). `npm test` runs the progression unit tests. `npm run smoke` is a self-contained end-to-end test: it starts its own server and two fake runners, then covers keys, invites, borrowing, XP and a server restart mid-task.

## Deploy (Vercel + Fly.io)

The static client goes on Vercel, and the office server goes on a single always-on Fly machine with a volume for `data/`. Runners stay on people's machines and connect out, so nobody opens ports.

```bash
# Fly: server
fly apps create agent-guild-kevinamick
fly volumes create guild_data --size 1 --region iad --yes
fly secrets set GUILD_ADMIN_KEY="$(cat .deploy/admin-key)"
fly deploy --ha=false

# Vercel: client, pointed at the Fly server
vercel deploy --prod --build-env VITE_GUILD_SERVER=wss://agent-guild-kevinamick.fly.dev
```

`fly.toml` pins one machine (`auto_stop_machines = "off"`), because presence and desks live in memory. `GUILD_CLIENT_URL` and `GUILD_PUBLIC_URL` there are used to build invite links.

## Controls

| key | action |
|---|---|
| WASD / arrows | walk |
| E | interact: open a terminal, hire at an empty desk, open a board |
| P | prompt the nearby agent |
| K | kudos |
| C | agent card: skills, stats and playbook |
| X | send the agent home (it keeps its XP and playbook) |
| T | chat |
| G | Guild Hall leaderboard |
| Ctrl+] | step away from a terminal (Esc still goes to Claude) |

## Trust and safety

- Anyone with a key can type into any agent's terminal, and a borrowed agent runs **on its owner's machine** with the owner's credentials. Only invite people you'd hand your keyboard to, or run your runner with `--private`.
- Claude Code asks before working in a folder it hasn't seen, and every new worktree counts. The runner doesn't answer for you. It marks the agent **✋ needs you**, and someone opens the terminal and confirms.
- Worktrees are removed when an agent goes home only if they have no uncommitted changes (`git worktree remove` without `--force`).

## Not included (yet)

The original demo's voice chat and screen share (WebRTC) aren't built.
