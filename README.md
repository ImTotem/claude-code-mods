# claude-code-mods

Claude Code 세션 레일(오른쪽에 붙는 패널)에 띄우는 모드 모음입니다. 모드마다 브랜치가 따로 있고, 이 `main` 브랜치에는 모드 목록(마켓플레이스)만 있습니다.

| 모드 | 브랜치 | 하는 일 |
| --- | --- | --- |
| `usage-rail` | [`usage-rail`](../../tree/usage-rail) | 설정의 사용량 화면에 나오는 플랜 한도(현재 세션 5시간, 주간 등)를 막대와 초기화까지 남은 시간으로 보여주고, 컨텍스트 사용량과 세션 비용도 함께 보여줍니다. |
| `todo-stack` | [`todo-stack`](../../tree/todo-stack) | 모델이 만드는 할 일을 요청별 그룹으로 묶어 최신 요청이 위에 오도록 계속 쌓습니다. 컨텍스트 압축이나 새 요청 때문에 모델 목록에서 빠진 할 일도 남겨 둡니다. |

각 모드의 자세한 사용법은 그 브랜치의 README에 있습니다.

## 설치

터미널 세션의 프롬프트에서:

```
/plugin install usage-rail --marketplace ImTotem/claude-code-mods
/plugin install todo-stack --marketplace ImTotem/claude-code-mods
```

`y`로 마켓플레이스 추가를 승인한 다음 범위(user 권장)를 고르면 됩니다.

셸에서:

```
claude plugin install usage-rail --marketplace ImTotem/claude-code-mods
claude plugin install todo-stack --marketplace ImTotem/claude-code-mods
```

`/plugin`을 쓸 수 없는 데스크톱 앱에서는 프롬프트 상자 옆의 **+** → **Plugins** → **Add marketplace**에 `ImTotem/claude-code-mods`를 넣고 **Add plugin**을 누르세요.

비공개 저장소라면 GitHub에서 이 저장소를 읽을 수 있고, 그 컴퓨터에 github.com용 git 자격 증명(SSH 키, 또는 `gh auth login` 후 `gh auth setup-git`)이 있어야 설치됩니다.

## 브랜치 구성

- `main`: `.claude-plugin/marketplace.json`과 이 README만 있습니다. 마켓플레이스의 각 항목은 같은 저장소의 모드 브랜치를 가리킵니다(`"ref": "<모드 이름>"`).
- `usage-rail`, `todo-stack`: 모드 하나가 브랜치 루트에 있고, 서로 이력을 공유하지 않습니다. 모드 수정은 해당 브랜치에만 커밋합니다.

모드 브랜치에 새 커밋을 올린 뒤 설치된 쪽에서 최신으로 받으려면:

```
claude plugin marketplace update claude-code-mods
claude plugin update usage-rail
```

새 모드를 추가할 때는 모드 이름으로 orphan 브랜치를 만들고, `main`의 `marketplace.json`에 같은 형식의 항목을 하나 추가하면 됩니다.
