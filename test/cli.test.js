import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../bin/q.js', import.meta.url));

function setup(config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cue-run-'));
  const file = path.join(dir, 'config.json');
  if (config) fs.writeFileSync(file, JSON.stringify(config));
  const q = (...args) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', env: { ...process.env, CUE_RUN_CONFIG: file } });
  return { dir, file, q };
}

test('등록한 명령을 실행하고 값을 넘긴다', () => {
  const { q } = setup({ commands: { say: { run: 'node -e "console.log(process.argv[1])" {word}', args: ['word'] } } });
  const result = q('say', 'hello');
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), 'hello');
});

test('cwd 폴더에서 실행한다', () => {
  const { dir, q } = setup();
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ vars: { here: dir }, commands: { where: { cwd: '{here}', run: 'node -e "console.log(process.cwd())"' } } }));
  const result = q('where');
  assert.equal(fs.realpathSync(result.stdout.trim()), fs.realpathSync(dir));
});

test('묶음은 실패한 단계에서 멈춘다', () => {
  const { q } = setup({ commands: { ok: 'node -e "console.log(1)"', bad: 'node -e "process.exit(3)"', seq: ['ok', 'bad', 'ok'] } });
  const result = q('seq');
  assert.equal(result.status, 3);
  assert.equal(result.stdout.trim(), '1');
});

test('-n은 실행하지 않고 명령만 보여 준다', () => {
  const { q } = setup({ commands: { boom: 'node -e "process.exit(9)"' } });
  const result = q('-n', 'boom');
  assert.equal(result.status, 0);
  assert.match(result.stderr, /process\.exit\(9\)/);
});

test('set과 unset은 전역 변수를 저장하고 지운다', () => {
  const { file, q } = setup({ commands: {} });
  assert.equal(q('set', 'app', 'admin').status, 0);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).vars.app, 'admin');
  assert.equal(q('unset', 'app').status, 0);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).vars.app, undefined);
});

test('init은 예시 설정을 만들고, 이미 있으면 덮어쓰지 않는다', () => {
  const { file, q } = setup();
  assert.equal(q('init').status, 0);
  assert.ok(fs.existsSync(file));
  assert.equal(q('init').status, 1);
});

test('설정 파일이 없으면 init을 안내한다', () => {
  const { q } = setup();
  const result = q('gs');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /q init/);
});

test('list는 명령과 변수를 보여 준다', () => {
  const { q } = setup({ vars: { root: '/work' }, commands: { gs: 'git status', go: ['gs'] } });
  const result = q('list');
  assert.match(result.stdout, /gs\s+git status/);
  assert.match(result.stdout, /go\s+\[gs\]/);
  assert.match(result.stdout, /root = \/work/);
});
