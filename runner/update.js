// Pieces of the runner's self-update (see selfUpdate in index.js), kept apart
// so the Windows cases can be tested anywhere.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export function newer(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

// The npx install this file runs from (…/npm-cache/_npx/<hash>), or null.
export function npxCacheDir(file) {
  return file.match(/^(.*[\\/]_npx[\\/][^\\/]+)[\\/]/)?.[1] ?? null;
}

// The version in package.json at `url`. Node's fetch ignores HTTPS_PROXY and
// the Windows certificate store, which corporate networks often need, so if it
// fails we ask curl (built into Windows 10+), which honours both.
export async function latestVersion(url, { fetchImpl = fetch, curl = (u) => run('curl', ['-fsSL', '-m', '6', u], { windowsHide: true }) } = {}) {
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()).version;
  } catch (e) {
    try {
      return JSON.parse((await curl(url)).stdout).version;
    } catch {
      throw new Error(e.cause?.code || e.cause?.message || e.message);
    }
  }
}

// Take an npx install out of npx's sight. Renaming is atomic, so npx reinstalls
// even if Windows (antivirus, a stray handle) won't let every file be deleted
// right now; the renamed copy is removed now or on a later start.
export function retireDir(dir, { pid = process.pid } = {}) {
  const old = `${dir}.old-${pid}`;
  try {
    fs.renameSync(dir, old);
  } catch {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    return;
  }
  try {
    fs.rmSync(old, { recursive: true, force: true, maxRetries: 3 });
  } catch {}
}

// Remove copies a previous update renamed but couldn't delete.
export function sweepRetired(dir) {
  const parent = path.dirname(dir);
  let names = [];
  try {
    names = fs.readdirSync(parent);
  } catch {}
  for (const n of names) {
    if (!/\.old-\d+$/.test(n)) continue;
    try {
      fs.rmSync(path.join(parent, n), { recursive: true, force: true });
    } catch {}
  }
}

// How to start `npx <args>` again. Under npx, npm tells us where it lives
// (npm_execpath), so we run its npx-cli.js with this node: no shell, so the
// arguments arrive exactly as given. Otherwise plain npx; on Windows that's
// npx.cmd, which only cmd.exe can start, so quote what cmd would split.
export function npxCommand(args, { env = process.env, platform = process.platform, execPath = process.execPath, exists = fs.existsSync } = {}) {
  const npmCli = env.npm_execpath;
  const cli = npmCli && /npm-cli\.js$/.test(npmCli) && path.join(path.dirname(npmCli), 'npx-cli.js');
  if (cli && exists(cli)) return { file: execPath, args: [cli, ...args], shell: false };
  if (platform !== 'win32') return { file: 'npx', args, shell: false };
  return { file: 'npx', args: args.map(winQuote), shell: true };
}

export function winQuote(arg) {
  const s = String(arg);
  return /^[\w\-.:/\\@=+,]+$/.test(s) ? s : `"${s.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`;
}
