import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { ResolveError, interpolate, plan, shellQuote } from '../src/resolve.js';

const config = {
  vars: { root: '/work', front: '{root}/front', game: 'default_game' },
  commands: {
    gs: 'git status',
    build: { cwd: '{front}', run: 'pnpm build -F={game}', args: ['game'] },
    hi: { run: 'echo {msg}', vars: { msg: 'hello' } },
    vr: { cwd: '{root}', run: 'make build' },
    go: ['vr', 'build', 'echo done'],
    outer: ['go', 'gs'],
    loopA: ['loopB'],
    loopB: ['loopA'],
    broken: { run: 'echo {nope}' },
    home: { cwd: '~/x', run: 'ls' },
  },
};

test('문자열 명령은 지금 폴더에서 그대로 실행한다', () => {
  assert.deepEqual(plan(config, 'gs'), [{ name: 'gs', run: 'git status', cwd: undefined }]);
});

test('남은 값은 맨 바깥 명령 끝에 붙는다', () => {
  assert.equal(plan(config, 'gs', ['-s'])[0].run, 'git status -s');
});

test('args 값이 변수 자리에 들어가고 전역 vars보다 먼저다', () => {
  assert.deepEqual(plan(config, 'build', ['admin']), [
    { name: 'build', run: 'pnpm build -F=admin', cwd: '/work/front' },
  ]);
});

test('값을 안 주면 전역 vars 기본값을 쓴다', () => {
  assert.equal(plan(config, 'build')[0].run, 'pnpm build -F=default_game');
});

test('명령 안 vars를 쓴다', () => {
  assert.equal(plan(config, 'hi')[0].run, 'echo hello');
});

test('묶음은 순서대로 펼쳐지고, 등록되지 않은 항목은 실제 명령으로 실행한다', () => {
  const steps = plan(config, 'go', ['web']);
  assert.deepEqual(
    steps.map((s) => s.run),
    ['make build', 'pnpm build -F=web', 'echo done'],
  );
});

test('묶음 안에 묶음을 넣을 수 있다', () => {
  assert.deepEqual(
    plan(config, 'outer').map((s) => s.name),
    ['vr', 'build', 'go: echo done', 'gs'],
  );
});

test('묶음 안 명령에는 남은 값을 붙이지 않는다', () => {
  assert.equal(plan(config, 'outer', ['x', 'y']).at(-1).run, 'git status');
});

test('자기 자신을 다시 부르는 묶음은 막는다', () => {
  assert.throws(() => plan(config, 'loopA'), ResolveError);
});

test('값이 없는 변수는 실행 전에 알려 준다', () => {
  assert.throws(() => plan(config, 'broken'), /\{nope\}/);
});

test('없는 명령은 알려 준다', () => {
  assert.throws(() => plan(config, 'missing'), /'missing' 명령이 없습니다/);
});

test('cwd의 ~는 홈 폴더로 바뀐다', () => {
  assert.equal(plan(config, 'home')[0].cwd, path.join(os.homedir(), 'x'));
});

test('명령줄 값은 변수로 다시 해석하지 않는다', () => {
  assert.equal(interpolate('echo {a}', { a: '{root}', root: 'x' }, { literal: new Set(['a']) }), 'echo {root}');
});

const ruled = {
  vars: { port: '3000', app: 'web', front: '/front' },
  commands: {
    dev: { cwd: '{front}', run: 'pnpm dev {app} --port {port}', args: ['app', 'port'] },
  },
  rules: [
    { when: { app: '^admin' }, vars: { port: '4000' } },
    { when: { app: '^admin-beta' }, vars: { port: '5000' } },
  ],
};

test('규칙의 정규식에 맞으면 변수를 바꾼다', () => {
  assert.equal(plan(ruled, 'dev', ['admin'])[0].run, 'pnpm dev admin --port 4000');
});

test('맞는 규칙이 없으면 기본값을 쓴다', () => {
  assert.equal(plan(ruled, 'dev', ['shop'])[0].run, 'pnpm dev shop --port 3000');
  assert.equal(plan(ruled, 'dev')[0].run, 'pnpm dev web --port 3000');
});

test('여러 규칙이 맞으면 아래 규칙이 이긴다', () => {
  assert.equal(plan(ruled, 'dev', ['admin-beta'])[0].run, 'pnpm dev admin-beta --port 5000');
});

test('명령줄에서 직접 준 값은 규칙보다 먼저다', () => {
  assert.equal(plan(ruled, 'dev', ['admin', '8080'])[0].run, 'pnpm dev admin --port 8080');
});

test('when의 변수가 모두 맞아야 규칙이 적용된다', () => {
  const config = { ...ruled, rules: [{ when: { app: '^admin', port: '^4000$' }, vars: { port: '1' } }] };
  assert.equal(plan(config, 'dev', ['admin'])[0].run, 'pnpm dev admin --port 3000');
});

test('잘못된 정규식은 어느 규칙인지 알려 준다', () => {
  const config = { ...ruled, rules: [{ when: { app: '(' }, vars: {} }] };
  assert.throws(() => plan(config, 'dev'), /rules\[0\]\.when\.app/);
});

test('공백이나 특수문자가 있는 값은 따옴표로 감싼다', () => {
  assert.equal(shellQuote('admin', 'darwin'), 'admin');
  assert.equal(shellQuote('a b', 'darwin'), "'a b'");
  assert.equal(shellQuote("it's", 'darwin'), `'it'\\''s'`);
  assert.equal(shellQuote('a b', 'win32'), '"a b"');
});
