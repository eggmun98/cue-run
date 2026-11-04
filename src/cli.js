import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { ConfigError, SAMPLE_CONFIG, configPath, loadConfig, saveConfig } from './config.js';
import { ResolveError, normalizeCommand, plan } from './resolve.js';
import { runSteps } from './run.js';

const { version } = createRequire(import.meta.url)('../package.json');

// 내장 명령. 설정 파일에 같은 이름의 명령이 있어도 내장 명령이 먼저다.
export const BUILTINS = ['help', 'list', 'set', 'unset', 'edit', 'init'];

const HELP = `cue-run ${version}

사용법
  q <명령> [값...]        설정 파일에 등록한 명령 실행
  q -n <명령> [값...]     실행하지 않고 실행될 명령만 보기

내장 명령
  q list                 등록한 명령과 변수 보기
  q set <이름> <값>       전역 변수 저장
  q unset <이름>          전역 변수 지우기
  q edit                 설정 파일 열기
  q init                 예시 설정 파일 만들기

설정 파일: ${configPath()}
`;

export function main(argv) {
  try {
    return dispatch(argv);
  } catch (error) {
    if (error instanceof ConfigError || error instanceof ResolveError) {
      process.stderr.write(`${error.message}\n`);
      return 1;
    }
    throw error;
  }
}

function dispatch(argv) {
  let dryRun = false;
  const rest = [...argv];
  while (rest[0]?.startsWith('-')) {
    const flag = rest.shift();
    if (flag === '-h' || flag === '--help') return print(HELP);
    if (flag === '-v' || flag === '--version') return print(`${version}\n`);
    if (flag === '-n' || flag === '--dry-run') dryRun = true;
    else return fail(`알 수 없는 옵션: ${flag}\n`);
  }

  const [name, ...values] = rest;
  switch (name) {
    case undefined:
    case 'help':
      return print(HELP);
    case 'init':
      return init();
    case 'edit':
      return edit();
    case 'list':
      return list(loadConfig());
    case 'set':
      return setVar(values);
    case 'unset':
      return unsetVar(values);
    default:
      return runSteps(plan(loadConfig(), name, values), { dryRun });
  }
}

function print(text) {
  process.stdout.write(text);
  return 0;
}

function fail(text) {
  process.stderr.write(text);
  return 1;
}

function init() {
  const file = configPath();
  if (fs.existsSync(file)) return fail(`설정 파일이 이미 있습니다: ${file}\n`);
  saveConfig(SAMPLE_CONFIG, file);
  return print(`예시 설정 파일을 만들었습니다: ${file}\n`);
}

function edit() {
  const file = configPath();
  if (!fs.existsSync(file)) return fail(`설정 파일이 없습니다: ${file}\n'q init'으로 먼저 만들어 주세요.\n`);
  const editor = process.env.VISUAL || process.env.EDITOR;
  const result = editor
    ? spawnSync(`${editor} "${file}"`, { shell: true, stdio: 'inherit' })
    : process.platform === 'win32'
      ? spawnSync('cmd', ['/c', 'start', '""', file], { stdio: 'inherit' })
      : spawnSync(process.platform === 'darwin' ? 'open' : 'xdg-open', [file], { stdio: 'inherit' });
  return result.status ?? 1;
}

function list(config) {
  const lines = [`설정 파일: ${configPath()}`, '', '명령'];
  const names = Object.keys(config.commands);
  const width = Math.max(4, ...names.map((n) => n.length));
  for (const name of names) {
    const command = normalizeCommand(name, config.commands[name]);
    const detail = command.steps
      ? `[${command.steps.join(' → ')}]`
      : `${command.run}${command.args.length ? `   (값: ${command.args.join(' ')})` : ''}${command.cwd ? `   @ ${command.cwd}` : ''}`;
    const shadowed = BUILTINS.includes(name) ? '   ※ 내장 명령과 이름이 같아 실행되지 않음' : '';
    lines.push(`  ${name.padEnd(width)}  ${detail}${shadowed}`);
  }
  if (names.length === 0) lines.push('  (없음)');
  lines.push('', '변수');
  const vars = Object.entries(config.vars);
  for (const [key, value] of vars) lines.push(`  ${key} = ${value}`);
  if (vars.length === 0) lines.push('  (없음)');
  const rules = config.rules ?? [];
  if (rules.length > 0) {
    lines.push('', '규칙');
    for (const rule of rules) {
      const when = Object.entries(rule.when ?? {}).map(([key, pattern]) => `${key} ~ /${pattern}/`).join(', ');
      const set = Object.entries(rule.vars ?? {}).map(([key, value]) => `${key} = ${value}`).join(', ');
      lines.push(`  ${when}  →  ${set}`);
    }
  }
  return print(`${lines.join('\n')}\n`);
}

function setVar([key, ...value]) {
  if (!key || value.length === 0) return fail('사용법: q set <이름> <값>\n');
  const config = loadConfig();
  config.vars[key] = value.join(' ');
  saveConfig(config);
  return print(`${key} = ${config.vars[key]}\n`);
}

function unsetVar([key]) {
  if (!key) return fail('사용법: q unset <이름>\n');
  const config = loadConfig();
  if (!Object.hasOwn(config.vars, key)) return fail(`'${key}' 변수가 없습니다.\n`);
  delete config.vars[key];
  saveConfig(config);
  return print(`${key} 변수를 지웠습니다.\n`);
}
