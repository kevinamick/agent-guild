import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveBin, spawnSpec, ADAPTERS, explainMissing, knownDirs, parseCliList, pathDirs } from './adapters.js';

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

// Windows, played on any OS: platform 'win32', a fake PATH, and a stub where.exe.
const win = (env, more = {}) => ({ env, platform: 'win32', where: () => [], ...more });

test('on Windows, skips the extensionless sh shim npm writes beside copilot.cmd', () => {
  const dir = dirWith('copilot', 'copilot.cmd', 'copilot.ps1');
  assert.equal(resolveBin('copilot', win({ PATH: dir })), path.join(dir, 'copilot.cmd'));
  assert.equal(resolveBin('copilot', win({ PATH: dirWith('copilot') })), null, 'the sh script alone cannot be started');
});

test('on Windows, follows PATHEXT order and reads Path in any case', () => {
  const dir = dirWith('copilot.cmd', 'copilot.exe');
  assert.equal(resolveBin('copilot', win({ Path: `"${dir}";`, PATHEXT: '.COM;.EXE;.BAT;.CMD;.VBS;.JS' })), path.join(dir, 'copilot.exe'));
  assert.equal(resolveBin('copilot', win({ path: dir, PATHEXT: '.CMD;.EXE' })), path.join(dir, 'copilot.cmd'));
  assert.deepEqual(pathDirs(win({ Path: `%TOOLS%\\bin;;"C:\\x y"`, TOOLS: 'C:\\t' })), ['C:\\t\\bin', 'C:\\x y']);
});

test('on Windows, finds CLIs installed where PATH does not reach yet', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'home-'));
  const links = path.join(home, 'Local', 'Microsoft', 'WinGet', 'Links');
  const local = path.join(home, '.local', 'bin');
  const npm = path.join(home, 'Roaming', 'npm');
  for (const [d, f] of [[links, 'copilot.exe'], [local, 'claude.exe'], [npm, 'az.cmd']]) {
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, f), '');
  }
  const env = { PATH: dirWith(), LOCALAPPDATA: path.join(home, 'Local'), USERPROFILE: home, APPDATA: path.join(home, 'Roaming') };
  assert.equal(resolveBin('copilot', win(env)), path.join(links, 'copilot.exe'));
  assert.equal(resolveBin('claude', win(env)), path.join(local, 'claude.exe'));
  assert.equal(resolveBin('az', win(env)), path.join(npm, 'az.cmd'));
  assert.ok(!knownDirs(win({ ...env, PATH: npm })).includes(npm), 'folders already on PATH are not repeated');
  assert.deepEqual(knownDirs({ env, platform: 'linux' }), []);
});

test('on Windows, falls back to where.exe, but not to a shim in the repo itself', () => {
  const elsewhere = dirWith('copilot.exe');
  const repo = dirWith('copilot.cmd', 'copilot');
  const where = () => [path.join(repo, 'copilot'), path.join(repo, 'copilot.cmd'), path.join(elsewhere, 'copilot.exe')];
  assert.equal(resolveBin('copilot', win({ PATH: dirWith() }, { where, cwd: repo })), path.join(elsewhere, 'copilot.exe'));
  assert.equal(resolveBin('copilot', win({ PATH: dirWith() }, { where: () => [path.join(repo, 'copilot.cmd')], cwd: repo })), null);
});

test('on Windows, accepts App Execution Aliases that stat cannot open, not dangling links', () => {
  const dir = dirWith();
  const alias = path.join(dir, 'copilot.exe');
  const fakeFs = {
    statSync: (f) => {
      if (f !== alias) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      throw Object.assign(new Error('EACCES: permission denied, stat'), { code: 'EACCES' });
    },
    lstatSync: () => ({ isDirectory: () => false, isSymbolicLink: () => true }),
    accessSync: () => {},
  };
  assert.equal(resolveBin('copilot', win({ PATH: dir }, { fs: fakeFs })), alias);
  const dangling = dirWith();
  fs.symlinkSync(path.join(dangling, 'gone.exe'), path.join(dangling, 'copilot.exe'));
  assert.equal(resolveBin('copilot', win({ PATH: dangling })), null);
});

test('on Windows, a PowerShell-only copilot.ps1 is the last resort and runs via PowerShell', () => {
  const dir = dirWith('copilot.ps1');
  const found = resolveBin('copilot', win({ PATH: dir }));
  assert.equal(found, path.join(dir, 'copilot.ps1'));
  const spec = spawnSpec(found, ['-i', 'x'], { env: { SystemRoot: 'C:\\Windows' } });
  assert.match(spec.file, /powershell\.exe$/i);
  assert.deepEqual(spec.args.slice(-4), ['-File', found, '-i', 'x']);
});

test('on Windows, a path given with --cli works with or without its extension', () => {
  const dir = dirWith('copilot', 'copilot.exe');
  assert.equal(resolveBin(path.join(dir, 'copilot'), win({})), path.join(dir, 'copilot.exe'));
  assert.equal(resolveBin(path.join(dir, 'copilot.exe'), win({})), path.join(dir, 'copilot.exe'));
  assert.equal(resolveBin(path.join(dir, 'nope'), win({})), null);
});

test('npm cmd shims start their target directly, other batch files via cmd.exe', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-'));
  fs.mkdirSync(path.join(dir, 'node_modules', '@github', 'copilot'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules', '@github', 'copilot', 'npm-loader.js'), '');
  // What npm's cmd-shim writes for a node script, and for a native binary.
  fs.writeFileSync(
    path.join(dir, 'copilot.cmd'),
    '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n) ELSE (\r\n  SET "_prog=node"\r\n  SET PATHEXT=%PATHEXT:;.JS;=;%\r\n)\r\n\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@github\\copilot\\npm-loader.js" %*\r\n',
  );
  const task = 'fix "this" & that\n100%';
  assert.deepEqual(spawnSpec(path.join(dir, 'copilot.cmd'), ['-i', task], { node: '/node' }), {
    file: '/node',
    args: [path.join(dir, 'node_modules', '@github', 'copilot', 'npm-loader.js'), '-i', task],
  });
  fs.mkdirSync(path.join(dir, 'node_modules', 'claude'));
  fs.writeFileSync(path.join(dir, 'node_modules', 'claude', 'claude.exe'), '');
  fs.writeFileSync(path.join(dir, 'claude.cmd'), '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n"%dp0%\\node_modules\\claude\\claude.exe"   %*\r\n');
  assert.deepEqual(spawnSpec(path.join(dir, 'claude.cmd'), ['x']), { file: path.join(dir, 'node_modules', 'claude', 'claude.exe'), args: ['x'] });
  // Any other batch file keeps going through cmd.exe.
  const other = path.join(dir, 'tool.cmd');
  fs.writeFileSync(other, '@"%~dp0\\..\\python.exe" -IBm tool %*\r\n');
  const spec = spawnSpec(other, ['x'], { env: { ComSpec: 'C:\\Windows\\system32\\cmd.exe' } });
  assert.equal(spec.file, 'C:\\Windows\\system32\\cmd.exe');
  assert.equal(spec.windowsVerbatimArguments, true);
});

test('--cli takes names, name=path pairs, or paths', () => {
  assert.deepEqual(parseCliList('claude, Copilot'), [{ id: 'claude' }, { id: 'copilot' }]);
  assert.deepEqual(parseCliList('copilot=C:\\tools\\copilot.exe'), [{ id: 'copilot', path: 'C:\\tools\\copilot.exe' }]);
  assert.deepEqual(parseCliList('C:\\Users\\me\\.local\\bin\\claude.exe'), [{ id: 'claude', path: 'C:\\Users\\me\\.local\\bin\\claude.exe' }]);
});

test('explains what was on PATH when no engine is found', () => {
  const dir = dirWith('copilot', 'copilot.ps1.bak');
  const text = explainMissing(['copilot', 'claude'], win({ PATH: dir }, { where: (b) => (b === 'copilot' ? ['C:\\x\\copilot.exe'] : []) }));
  assert.match(text, /PATH \(1 entries\)/);
  assert.match(text, /copilot {2}\(skipped: no \.exe\/\.cmd extension/);
  assert.match(text, /where\.exe copilot: C:\\x\\copilot\.exe/);
  assert.match(text, /claude: no file by that name/);
});
