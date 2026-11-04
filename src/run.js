import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const dim = (text) => (process.stderr.isTTY ? `\x1b[2m${text}\x1b[22m` : text);

/** 단계들을 순서대로 실행한다. 하나라도 실패하면 멈추고 그 종료 코드를 돌려준다. */
export function runSteps(steps, { dryRun = false } = {}) {
  const showHeader = dryRun || steps.length > 1;
  for (const step of steps) {
    if (showHeader) process.stderr.write(dim(`▶ ${step.name}${step.cwd ? ` (${step.cwd})` : ''}\n  ${step.run}\n`));
    if (dryRun) continue;

    if (step.cwd && !fs.existsSync(step.cwd)) {
      process.stderr.write(`실행 폴더가 없습니다: ${step.cwd}\n`);
      return 1;
    }
    const result = spawnSync(step.run, { shell: true, stdio: 'inherit', cwd: step.cwd });
    if (result.error) {
      process.stderr.write(`${result.error.message}\n`);
      return 1;
    }
    const code = result.status ?? (result.signal === 'SIGINT' ? 130 : 1);
    if (code !== 0) {
      if (steps.length > 1) process.stderr.write(`'${step.name}' 단계가 실패해서 멈췄습니다 (종료 코드 ${code}).\n`);
      return code;
    }
  }
  return 0;
}
