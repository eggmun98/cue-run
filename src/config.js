import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 설정 파일 위치. CUE_RUN_CONFIG 환경 변수로 바꿀 수 있다(테스트, 여러 설정 전환용).
export function configPath() {
  return process.env.CUE_RUN_CONFIG || path.join(os.homedir(), '.cue-run.json');
}

export const SAMPLE_CONFIG = {
  vars: {
    greeting: 'hello',
  },
  commands: {
    gs: 'git status',
    hi: { run: 'echo {greeting} {name}', args: ['name'], vars: { name: 'world' } },
    home: { cwd: '~', run: 'ls' },
    both: ['gs', 'hi'],
  },
};

export class ConfigError extends Error {}

export function loadConfig(file = configPath()) {
  if (!fs.existsSync(file)) {
    throw new ConfigError(`설정 파일이 없습니다: ${file}\n'q init'으로 예시 설정을 만들 수 있습니다.`);
  }
  let config;
  try {
    config = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new ConfigError(`설정 파일을 읽을 수 없습니다: ${file}\n${error.message}`);
  }
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    throw new ConfigError(`설정 파일은 JSON 객체여야 합니다: ${file}`);
  }
  config.vars ??= {};
  config.commands ??= {};
  return config;
}

export function saveConfig(config, file = configPath()) {
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
}
