# claude-code-mods

Claude Code에 `세션` 패널 하나를 띄우고, 거기에 플랜 사용량과 할 일 카드를 쌓는 모드 모음입니다. 모드마다 개발 브랜치가 따로 있고, 이 `main` 브랜치는 각 브랜치를 `plugins/<모드>/`로 가져와 마켓플레이스로 배포합니다.

| 모드 | 개발 브랜치 → 배포 폴더 | 하는 일 |
| --- | --- | --- |
| `session-rail` | [`session-rail`](../../tree/session-rail) → [`plugins/session-rail`](plugins/session-rail) | `세션` 패널을 열고, 프롬프트 아래 오른쪽에 패널을 여닫는 **세션 패널** 버튼을 둡니다. 아래 두 모드가 이 패널에 카드를 넣습니다. |
| `usage-rail` | [`usage-rail`](../../tree/usage-rail) → [`plugins/usage-rail`](plugins/usage-rail) | **사용량** 카드: Claude 앱의 사용량 카드처럼 세션 한도 · 매주 · 클라우드 세션 크레딧을 막대와 재설정·만료 시각으로 보여줍니다. |
| `todo-stack` | [`todo-stack`](../../tree/todo-stack) → [`plugins/todo-stack`](plugins/todo-stack) | **할 일** 카드: 모델이 만드는 할 일을 요청별로 묶지 않고, 모든 세션이 함께 쓰는 하나의 스택에 새 할 일이 위에 오도록 계속 쌓습니다. 컨텍스트 압축이나 새 요청 때문에 모델 목록에서 빠진 할 일도 남겨 둡니다. |

`usage-rail`과 `todo-stack`은 `session-rail`을 의존성으로 선언해서, 둘 중 하나를 설치하면 `session-rail`도 함께 설치됩니다. 각 모드의 자세한 사용법은 그 브랜치의 README에 있습니다.

데스크톱 앱의 세션 정보 레일(환경 · 컨텍스트 · 결과물) 안에는 카드를 넣을 수 없습니다. 모드 API에 그 레일에 그릴 자리가 없어서, `세션` 패널은 앱이 플러그인 패널을 두는 자리에 따로 뜹니다.

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

claude.ai나 데스크톱 앱에서는 **Customize > Plugins > Add > Add marketplace**에 `ImTotem/claude-code-mods`를 넣고, 목록에 나온 모드를 설치하세요. 이렇게 계정에 설치하면 의존성이 자동으로 깔리지 않으니 `session-rail`도 함께 켜 주세요. 계정에 설치한 플러그인은 같은 계정으로 로그인한 Claude Code 세션에 동기화된 플러그인(`<모드>@synced`)으로 들어옵니다. 모드는 Claude Code에서만 동작합니다.

**업데이트가 적용되는 때**: Claude Code는 시작할 때 디스크에 있는 버전을 먼저 로드하고, 새 버전은 그 뒤에 백그라운드에서 받습니다. 그래서 새 버전이 나온 뒤 처음 연 세션에서는 이전 버전이 돌고, `/reload-plugins`를 하거나 다음에 시작할 때부터 새 버전이 적용됩니다. 같은 모드를 셸(`<모드>@claude-code-mods`)과 계정(`<모드>@synced`) 양쪽에 설치했다면 셸에 설치한 쪽이 우선하므로, 한쪽만 남겨 두세요.

비공개 저장소라면 GitHub에서 이 저장소를 읽을 수 있고, 그 컴퓨터에 github.com용 git 자격 증명(SSH 키, 또는 `gh auth login` 후 `gh auth setup-git`)이 있어야 설치됩니다.

## 브랜치 구성

- `session-rail`, `usage-rail`, `todo-stack`: 개발 브랜치입니다. 모드 하나가 브랜치 루트에 있고, 서로 이력을 공유하지 않습니다. 모드 수정은 해당 브랜치에만 커밋합니다.
- `main`: 배포 브랜치입니다. 각 모드 브랜치를 `git subtree`로 `plugins/<모드>/`에 가져와 두고, `.claude-plugin/marketplace.json`이 그 폴더를 가리킵니다. claude.ai의 Add marketplace는 기본 브랜치 안에 있는 플러그인 폴더만 읽기 때문에 이렇게 둡니다.

모드 브랜치에 커밋한 내용을 배포하려면 `main`에서:

```
scripts/publish.sh usage-rail
git push origin main
```

설치된 쪽에서 최신으로 받으려면 터미널에서는 `claude plugin marketplace update claude-code-mods` 뒤 `claude plugin update usage-rail@claude-code-mods`, claude.ai에서는 마켓플레이스의 **Check for updates**를 누르면 됩니다.

새 모드는 모드 이름으로 orphan 브랜치를 만들어 개발하고, `main`에서 `scripts/publish.sh <모드>`를 실행한 뒤 `marketplace.json`에 항목을 하나 추가합니다.
