# cue-run

어느 폴더에서든 내가 정한 짧은 명령으로 긴 명령을 실행합니다.

```
q build admin   →   (~/work/shop 폴더에서) pnpm --filter admin build
```

의존성이 없고 macOS, Windows, Linux에서 같은 설정으로 동작합니다. Node 18 이상이 필요합니다.

## 설치

```
npm install -g cue-run
q init      # ~/.cue-run.json 예시 설정 만들기
q edit      # 설정 파일 열기
```

## 설정 파일

`~/.cue-run.json` (Windows: `C:\Users\{사용자}\.cue-run.json`). 위치를 바꾸려면 `CUE_RUN_CONFIG` 환경 변수를 지정합니다.

```json
{
  "vars": {
    "api": "~/work/api",
    "shop": "~/work/shop"
  },
  "commands": {
    "gs": "git status",
    "test": { "cwd": "{api}", "run": "npm test" },
    "serve": { "cwd": "{api}/dist", "run": "node server.js" },
    "build": {
      "cwd": "{shop}",
      "run": "pnpm --filter {app} build",
      "args": ["app"],
      "vars": { "app": "web" }
    },
    "go": ["test", "serve", "echo done"]
  }
}
```

### 명령 모양

| 모양 | 뜻 |
|---|---|
| `"git status"` | 지금 폴더에서 그대로 실행 |
| `{ "run": ..., "cwd": ..., "args": [...], "vars": {...} }` | 실행 폴더, 받을 값, 이 명령 전용 변수 지정 |
| `["test", "serve", "echo done"]` | 순서대로 실행. 등록한 명령 이름이거나 실제 명령. 하나가 실패하면 멈춤 |

- `run`: 실행할 명령
- `cwd`: 실행 폴더. 없으면 지금 폴더. `~`는 홈 폴더
- `args`: 명령 뒤에 친 값을 순서대로 받을 변수 이름
- `vars`: 이 명령에서만 쓰는 변수(기본값)

### 변수

`{이름}`이 값으로 바뀝니다. 같은 이름이 여러 곳에 있으면 이 순서로 먼저 있는 값을 씁니다.

1. 실행할 때 친 값 (`args`)
2. 명령 안 `vars`
3. 전역 `vars`

변수 값 안에서 다른 변수를 쓸 수 있습니다(`"{api}/dist"`). 값이 없는 변수가 있으면 실행하지 않고 알려 줍니다.

### 규칙 (rules)

변수 값이 정규식에 맞으면 다른 변수를 바꿉니다. 예: `admin`으로 시작하는 앱은 포트 4000, 나머지는 기본값 3000.

```json
{
  "vars": { "port": "3000" },
  "commands": {
    "dev": { "run": "pnpm --filter {app} dev --port {port}", "args": ["app"] }
  },
  "rules": [
    { "when": { "app": "^admin" }, "vars": { "port": "4000" } }
  ]
}
```

```
q dev web          →   pnpm --filter web dev --port 3000
q dev admin-panel  →   pnpm --filter admin-panel dev --port 4000
```

- `when`의 변수가 모두 정규식에 맞아야 적용됩니다. JSON 안에서는 `\d`를 `\\d`로 씁니다.
- 위에서부터 차례로 적용하므로 여러 규칙이 맞으면 아래 규칙이 이깁니다.
- 실행할 때 직접 넘긴 값(`args`)은 규칙보다 먼저입니다.
- 우선순위: 실행할 때 친 값 > 규칙 > 명령 안 `vars` > 전역 `vars`

`args`에 없는 남은 값은 명령 끝에 붙습니다: `q gs -s` → `git status -s` (묶음 안의 명령에는 붙지 않습니다).

## 내장 명령

```
q list                 등록한 명령과 변수 보기
q set <이름> <값>       전역 변수 저장
q unset <이름>          전역 변수 지우기
q edit                 설정 파일 열기 ($VISUAL, $EDITOR, 없으면 OS 기본 앱)
q init                 예시 설정 파일 만들기
q -n <명령> [값...]     실행하지 않고 실행될 명령만 보기
```

`help`, `list`, `set`, `unset`, `edit`, `init`은 내장 명령이라 같은 이름으로 등록한 명령은 실행되지 않습니다.

## 라이선스

MIT
