import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveBin, spawnSpec, ADAPTERS } from './adapters.js';

function dirWith(...files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bins-'));
  for (const f of files) fs.writeFileSync(path.join(dir, f), '', { mode: 0o755 });
  return dir;
}

test('finds copilot.exe when there is no plain copilot', () => {
  const dir = dirWith('copilot.exe');
  assert.equal(resolveBin('copilot', { env: { PATH: dir }, platform: 'linux' }), path.join(dir, 'copilot.exe'));
});

test('prefers the plain name when both exist', () => {
  const dir = dirWith('copilot', 'copilot.exe');
  assert.equal(resolveBin('copilot', { env: { PATH: dir }, platform: 'linux' }), path.join(dir, 'copilot'));
});

test('on Windows, also finds PATHEXT forms like the npm copilot.cmd shim', () => {
  const dir = dirWith('copilot.cmd');
  const found = resolveBin('copilot', { env: { PATH: dir, PATHEXT: '.COM;.EXE;.BAT;.CMD' }, platform: 'win32' });
  assert.equal(found, path.join(dir, 'copilot.cmd'));
  assert.equal(resolveBin('copilot', { env: { PATH: dir }, platform: 'linux' }), null, '.cmd is not an executable on Linux');
});

test('returns null when nothing is installed', () => {
  assert.equal(resolveBin('copilot', { env: { PATH: dirWith() }, platform: 'linux' }), null);
});

test('batch shims go through cmd.exe; real executables start directly', () => {
  assert.deepEqual(spawnSpec('C:\\npm\\copilot.exe', ['-i', 'x']), { file: 'C:\\npm\\copilot.exe', args: ['-i', 'x'] });
  const cmd = spawnSpec('C:\\npm\\copilot.cmd', ['-i', 'x']);
  assert.deepEqual(cmd.args.slice(-3), ['C:\\npm\\copilot.cmd', '-i', 'x']);
  assert.match(cmd.file, /cmd(\.exe)?$/i);
});

test('Copilot hooks carry both bash and PowerShell commands', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-'));
  ADAPTERS.copilot.build({ agent: { name: 'T' }, dir, playbook: dir, hookUrl: 'http://127.0.0.1:1/hook/s/a', instructions: 'x', task: null, opts: {}, env: {} });
  const hooks = JSON.parse(fs.readFileSync(path.join(dir, 'copilot-plugin', 'hooks.json'), 'utf8')).hooks;
  for (const entry of Object.values(hooks)) {
    assert.match(entry[0].bash, /curl .*127\.0\.0\.1/);
    assert.match(entry[0].powershell, /Invoke-RestMethod -Uri 'http:\/\/127\.0\.0\.1/);
  }
  assert.match(hooks.agentStop[0].powershell, /\/Stop'/);
});
