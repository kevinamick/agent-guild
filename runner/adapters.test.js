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

test('on Windows, az.cmd beats the extensionless az bash script next to it', () => {
  const dir = dirWith('az', 'az.cmd');
  assert.equal(resolveBin('az', { env: { PATH: dir, PATHEXT: '.COM;.EXE;.BAT;.CMD' }, platform: 'win32' }), path.join(dir, 'az.cmd'));
  const npm = dirWith('copilot', 'copilot.cmd', 'copilot.ps1');
  assert.equal(resolveBin('copilot', { env: { PATH: npm, PATHEXT: '.COM;.EXE;.BAT;.CMD' }, platform: 'win32' }), path.join(npm, 'copilot.cmd'));
  const exe = dirWith('copilot', 'copilot.exe');
  assert.equal(resolveBin('copilot', { env: { PATH: exe }, platform: 'win32' }), path.join(exe, 'copilot.exe'));
});

test('real executables start directly', () => {
  assert.deepEqual(spawnSpec('C:\\npm\\copilot.exe', ['-i', 'x']), { file: 'C:\\npm\\copilot.exe', args: ['-i', 'x'] });
});

// A batch file on disk (spawnSpec reads it to see whether it forwards %*).
function batch(name, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmd-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, content);
  return file;
}

test('batch files run through cmd.exe with a quoted, escaped command line', () => {
  const file = batch('run.cmd', '@echo off\r\necho hi\r\n');
  const spec = spawnSpec(file, ['account', 'get-access-token'], { env: { ComSpec: 'C:\\Windows\\system32\\cmd.exe' } });
  assert.equal(spec.file, 'C:\\Windows\\system32\\cmd.exe');
  assert.equal(spec.windowsVerbatimArguments, true);
  assert.deepEqual(spec.args.slice(0, 3), ['/d', '/s', '/c']);
  // The whole command is wrapped in one pair of quotes for /s, and each argument is quoted.
  assert.match(spec.commandLine, /^\/d \/s \/c ".*\^"account\^" \^"get-access-token\^""$/);
});

test('paths with spaces survive cmd.exe', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'Program Files '));
  const file = path.join(dir, 'az.cmd');
  fs.writeFileSync(file, '@"%~dp0\\..\\python.exe" -IBm azure.cli %*');
  const spec = spawnSpec(file, ['account']);
  assert.ok(!/[^^] /.test(spec.args[3].slice(1, spec.args[3].indexOf('.cmd'))), 'every space in the path is ^-escaped');
});

test("task text can't break out into cmd.exe commands", () => {
  const evil = 'Fix login & del /q C:\\* | calc > x.txt %PATH% "quoted" ^';
  for (const [content, twice] of [['@echo off\r\n', false], ['@node x.js %*\r\n', true]]) {
    const spec = spawnSpec(batch('copilot.cmd', content), ['-i', evil]);
    const line = spec.args[3];
    // Every cmd metacharacter in the user's text is escaped (twice when the file re-parses %*).
    for (const ch of ['&', '|', '>', '%', '"']) {
      const bare = new RegExp(`(^|[^^])\\${ch}`, 'g');
      const inner = line.slice(1, -1).slice(line.indexOf('Fix'));
      assert.ok(!bare.test(inner), `unescaped ${ch} with twice=${twice}: ${inner}`);
    }
    if (twice) assert.ok(line.includes('^^^&'), 'forwarded (%*) arguments are escaped twice');
  }
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
