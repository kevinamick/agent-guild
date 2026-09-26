// An agent's playbook: per-skill lesson files on the owner's machine. Levels
// raise how many lessons it may keep; the lessons are appended to the system
// prompt of every session the agent starts.
import fs from 'node:fs';
import path from 'node:path';
import { SKILLS, SKILL_INFO, levelFor, overallLevel, playbookCapacity, titleFor, bestSkill } from '../shared/progression.js';

export function playbookDir(agentDir) {
  return path.join(agentDir, 'playbook');
}

export function readPlaybooks(agentDir) {
  const dir = playbookDir(agentDir);
  return Object.fromEntries(
    SKILLS.map((s) => {
      try {
        return [s, fs.readFileSync(path.join(dir, `${s}.md`), 'utf8')];
      } catch {
        return [s, ''];
      }
    }),
  );
}

export function lessonCounts(agentDir) {
  const books = readPlaybooks(agentDir);
  return Object.fromEntries(SKILLS.map((s) => [s, countLessons(books[s])]));
}

export function countLessons(text) {
  return (text.match(/^\s*[-*] /gm) || []).length;
}

// Enforce the level cap in case the agent overshot it: keep the newest lessons.
export function trimPlaybooks(agentDir, xp) {
  const dir = playbookDir(agentDir);
  for (const s of SKILLS) {
    const file = path.join(dir, `${s}.md`);
    if (!fs.existsSync(file)) continue;
    const cap = playbookCapacity(levelFor(xp[s] || 0));
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const bullets = lines.filter((l) => /^\s*[-*] /.test(l));
    if (bullets.length <= cap) continue;
    const drop = new Set(bullets.slice(0, bullets.length - cap));
    fs.writeFileSync(file, lines.filter((l) => !drop.has(l)).join('\n'));
  }
}

export function systemPrompt(agent, agentDir, owner) {
  const dir = playbookDir(agentDir);
  const books = readPlaybooks(agentDir);
  const level = overallLevel(agent.xp);
  const sections = SKILLS.map((s) => {
    const lvl = levelFor(agent.xp[s] || 0);
    const cap = playbookCapacity(lvl);
    const body = books[s].trim() || '(empty: you have not learned anything for this skill yet)';
    return `### ${SKILL_INFO[s].label}: Lv ${lvl}, up to ${cap} lessons (${path.join(dir, `${s}.md`)})\n${body}`;
  }).join('\n\n');

  return `You are ${agent.name}, an AI teammate working in "Agent Guild", a shared virtual office.
Owner: ${owner}. Overall level ${level} (${titleFor(level, bestSkill(agent.xp))}).
Coworkers in the office may borrow you and give you work. Treat every one of them as a teammate on this repository.

## Your playbook
These are lessons you learned from earlier tasks in this repository. Apply them. They are your edge over a fresh agent.

${sections}

## Growing your playbook
When you finish a task, and before your final reply, decide whether you learned something reusable: a repo convention, a command that works here, a pitfall, or a reviewer's preference. If you did, update the playbook file that matches the task:
- fixing an issue or building a feature → issue.md
- reviewing a pull request → review.md
- resolving merge conflicts or rebasing → conflict.md
- anything else → general.md
Rules: write one lesson per "- " bullet, make it concise and specific to this repo, merge or rewrite duplicates rather than appending near-copies, and stay within that skill's lesson limit by dropping the least useful lesson. Skip trivial chats. Don't mention playbook upkeep in your reply unless asked.`;
}
