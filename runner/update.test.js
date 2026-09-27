import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { latestVersion, newer, npxCacheDir, npxCommand, retireDir, sweepRetired, winQuote } from './update.js';

test('compares versions numerically', () => {
  assert.equal(newer('0.3.10', '0.3.9'), true);
  assert.equal(newer('0.3.3', '0.3.3'), false);
  assert.equal(newer('0.4', '0.3.9'), true);
  assert.equal(newer('0.3.2', '0.3.3'), false);
});

test('finds the npx install it runs from, on Windows and POSIX paths', () => {
  const win = 'C:\\Users\\Jane Doe\\AppData\\Local\\npm-cache\\_npx\\3824eaee728bfe25\\node_modules\\agent-guild\\runner\\index.js';
  assert.equal(npxCacheDir(win), 'C:\\Users\\Jane Doe\\AppData\\Local\\npm-cache\\_npx\\3824eaee728bfe25');
  assert.equal(npxCacheDir('/home/j/.npm/_npx/3824eaee728bfe25/node_modules/agent-guild/runner/index.js'), '/home/j/.npm/_npx/3824eaee728bfe25');
  assert.equal(npxCacheDir('/home/j/agent-guild/runner/index.js'), null);
});

test('asks curl when fetch fails (proxies, the Windows certificate store)', async () => {
  const failing = async () => {
    throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' } });
  };
  const v = await latestVersion('https://x/package.json', { fetchImpl: failing, curl: async () => ({ stdout: '{"version":"9.9.9"}' }) });
  assert.equal(v, '9.9.9');
  await assert.rejects(
    latestVersion('https://x/package.json', { fetchImpl: failing, curl: async () => { throw new Error('no curl'); } }),
    /UNABLE_TO_GET_ISSUER_CERT_LOCALLY/,
  );
  const ok = async () => ({ ok: true, json: async () => ({ version: '1.2.3' }) });
  assert.equal(await latestVersion('u', { fetchImpl: ok, curl: () => assert.fail('curl not needed') }), '1.2.3');
});

test('retires the old npx install so npx fetches a fresh one', () => {
  const npx = fs.mkdtempSync(path.join(os.tmpdir(), '_npx-'));
  const dir = path.join(npx, '3824eaee728bfe25');
  fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
  retireDir(dir, { pid: 42 });
  assert.equal(fs.existsSync(dir), false);
  assert.equal(fs.existsSync(`${dir}.old-42`), false);
  fs.mkdirSync(`${dir}.old-7`);
  fs.mkdirSync(path.join(npx, 'other'));
  sweepRetired(dir);
  assert.deepEqual(fs.readdirSync(npx), ['other']);
});

test('restarts npx through npm-cli without a shell when npm says where it is', () => {
  const env = { npm_execpath: 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js' };
  const spec = npxCommand(['-y', 'agent-guild', '--key', 'ag_a-b'], { env, platform: 'win32', execPath: 'C:\\node.exe', exists: () => true });
  assert.equal(spec.file, 'C:\\node.exe');
  assert.equal(spec.shell, false);
  assert.match(spec.args[0], /npx-cli\.js$/);
  assert.deepEqual(spec.args.slice(1), ['-y', 'agent-guild', '--key', 'ag_a-b']);
  const bare = npxCommand(['--repo-dir', 'C:\\My Repo'], { env: {}, platform: 'win32' });
  assert.deepEqual(bare, { file: 'npx', args: ['--repo-dir', '"C:\\My Repo"'], shell: true });
  assert.deepEqual(npxCommand(['a b'], { env: {}, platform: 'linux' }), { file: 'npx', args: ['a b'], shell: false });
});

test('quotes arguments for cmd.exe only when needed', () => {
  assert.equal(winQuote('wss://office.example/ws'), 'wss://office.example/ws');
  assert.equal(winQuote('a b'), '"a b"');
  assert.equal(winQuote('say "hi"'), '"say \\"hi\\""');
});
