import os from 'node:os';
import path from 'node:path';

// 명령 정의를 실제로 실행할 단계 목록(plan)으로 바꾼다. 실행은 run.js가 한다.
//
// 명령 정의는 세 가지 모양이다.
//   "git status"                                   문자열: 지금 폴더에서 그대로 실행
//   { run, cwd?, args?, vars? }                    객체: 실행 폴더·인자·명령 전용 변수
//   ["vr", "run", "echo done"]                     배열: 순서대로 실행. 등록된 명령 이름이거나 실제 명령
//
// 변수 우선순위: 실행할 때 넘긴 값(args) > 맞은 규칙(rules)의 vars > 명령 안 vars > 전역 vars.
//
// 규칙은 { when: { 변수: 정규식 }, vars: { ... } } 목록이다. when의 변수가 모두 정규식에 맞으면 vars를 덮어쓴다.
// 위에서부터 차례로 적용하므로 여러 규칙이 맞으면 아래 규칙이 이긴다.

const VAR_PATTERN = /\{([A-Za-z_][\w-]*)\}/g;
const MAX_VAR_DEPTH = 10;

export class ResolveError extends Error {}

export function normalizeCommand(name, def) {
  if (typeof def === 'string') return { run: def, args: [], vars: {} };
  if (Array.isArray(def)) return { steps: def };
  if (def && typeof def === 'object' && typeof def.run === 'string') {
    return { run: def.run, cwd: def.cwd, args: def.args ?? [], vars: def.vars ?? {} };
  }
  throw new ResolveError(`'${name}' 명령의 모양이 잘못됐습니다. 문자열, 배열, 또는 run이 있는 객체여야 합니다.`);
}

/**
 * text 안의 {이름}을 값으로 바꾼다. 값 안에 다른 {이름}이 있으면 그것도 바꾼다({root}/bin 같은 경로 조합).
 * literal에 든 이름(명령줄에서 받은 값)은 그대로 넣는다. 못 찾은 이름은 missing에 모은다.
 */
export function interpolate(text, vars, { literal = new Set(), missing = new Set(), quote = (v) => v } = {}, depth = 0) {
  if (depth > MAX_VAR_DEPTH) throw new ResolveError(`변수가 서로를 계속 참조합니다: ${text}`);
  return text.replace(VAR_PATTERN, (whole, name) => {
    if (!Object.hasOwn(vars, name)) {
      missing.add(name);
      return whole;
    }
    const value = String(vars[name]);
    if (literal.has(name)) return quote(value);
    return interpolate(value, vars, { literal, missing, quote }, depth + 1);
  });
}

// 명령줄에서 받은 값을 셸에 안전하게 넣는다. 평범한 값은 그대로 둔다.
export function shellQuote(value, platform = process.platform) {
  if (/^[\w@%+=:,./\\-]+$/.test(value)) return value;
  if (platform === 'win32') return `"${value.replace(/"/g, '""')}"`;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function expandHome(dir) {
  if (dir === '~') return os.homedir();
  if (dir.startsWith('~/') || dir.startsWith('~\\')) return path.join(os.homedir(), dir.slice(2));
  return dir;
}

/**
 * name 명령을 실행 단계 목록으로 바꾼다. 각 단계는 { name, run, cwd }.
 * argv는 명령 이름 뒤에 친 값들이다. 맨 바깥 명령만 남은 값을 명령 끝에 붙인다(q gs -s → git status -s).
 * 묶음 안의 명령에는 args로 선언한 값만 전달한다.
 */
export function plan(config, name, argv = [], stack = []) {
  if (stack.includes(name)) {
    throw new ResolveError(`묶음 명령이 자기 자신을 다시 부릅니다: ${[...stack, name].join(' → ')}`);
  }
  const commands = config.commands ?? {};
  if (!Object.hasOwn(commands, name)) {
    throw new ResolveError(`'${name}' 명령이 없습니다. 'q list'로 목록을 볼 수 있습니다.`);
  }
  const command = normalizeCommand(name, commands[name]);

  if (command.steps) {
    return command.steps.flatMap((step) =>
      Object.hasOwn(commands, step)
        ? plan(config, step, argv, [...stack, name])
        : [resolveStep(config, `${name}: ${step}`, { run: step, args: [], vars: {} }, [], false)],
    );
  }
  return [resolveStep(config, name, command, argv, stack.length === 0)];
}

/** 맞는 규칙의 vars를 차례로 덮어쓴 변수 목록을 돌려준다. literal에 든 변수(명령줄 값)는 그대로 비교한다. */
export function applyRules(rules = [], vars, literal = new Set()) {
  if (!Array.isArray(rules)) throw new ResolveError('rules는 배열이어야 합니다.');
  const result = { ...vars };
  rules.forEach((rule, index) => {
    if (!rule || typeof rule.when !== 'object' || typeof rule.vars !== 'object') {
      throw new ResolveError(`rules[${index}]에는 when과 vars 객체가 있어야 합니다.`);
    }
    const matches = Object.entries(rule.when).every(([key, pattern]) => {
      let regex;
      try {
        regex = new RegExp(pattern);
      } catch (error) {
        throw new ResolveError(`rules[${index}].when.${key}의 정규식이 잘못됐습니다: ${error.message}`);
      }
      if (!Object.hasOwn(result, key)) return false;
      const value = literal.has(key) ? String(result[key]) : interpolate(String(result[key]), result, { literal });
      return regex.test(value);
    });
    if (matches) Object.assign(result, rule.vars);
  });
  return result;
}

function resolveStep(config, name, command, argv, appendExtras) {
  const given = Object.fromEntries(command.args.map((arg, i) => [arg, argv[i]]).filter(([, v]) => v !== undefined));
  const literal = new Set(Object.keys(given));
  const vars = { ...applyRules(config.rules, { ...config.vars, ...command.vars, ...given }, literal), ...given };
  const options = { literal, missing: new Set(), quote: (v) => shellQuote(v) };

  let run = interpolate(command.run, vars, options);
  const cwd = command.cwd === undefined ? undefined : expandHome(interpolate(command.cwd, vars, { ...options, quote: (v) => v }));

  if (options.missing.size > 0) {
    const names = [...options.missing].map((n) => `{${n}}`).join(', ');
    throw new ResolveError(`'${name}' 명령에 값이 없는 변수가 있습니다: ${names}`);
  }
  const extras = argv.slice(command.args.length);
  if (appendExtras && extras.length > 0) run = `${run} ${extras.map((v) => shellQuote(v)).join(' ')}`;
  return { name, run, cwd };
}
