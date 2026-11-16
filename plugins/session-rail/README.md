# session-rail

다른 모드들이 카드를 꽂는 `세션` 패널 하나를 여는 모드입니다. 그 자체로는 카드가 없고, [`usage-rail`](../../tree/usage-rail)(사용량 카드)과 [`todo-stack`](../../tree/todo-stack)(할 일 카드)이 이 패널에 자기 카드를 넣습니다. 두 모드는 이 모드를 의존성으로 선언하므로, 둘 중 하나를 설치하면 함께 설치됩니다.

- 세션이 시작되면 패널을 엽니다. 데스크톱 앱 세션도 마찬가지이며, 앱이 아직 세션에 붙지 않았으면 열린 채로 기다렸다가 앱이 붙을 때 그려집니다(Claude Code 2.1.325부터). 좁은 터미널(144칸 미만)에서는 엔진이 요청하지 않은 패널을 붙이지 않으므로 **첫 프롬프트를 보낼 때** 엽니다.
- 프롬프트 아래 오른쪽(모드 표시가 뜨는 자리)에 **세션 패널** 버튼이 늘 있습니다. 누르면 폭과 상관없이 열리고, 열려 있을 때 누르면 닫힙니다. 앱 상단 도구 모음에는 모드가 버튼을 넣을 자리가 없어서 이 자리에 둡니다.
- 패널을 직접 닫거나 버튼으로 닫으면 그 세션에서는 프롬프트를 보내도 다시 열지 않습니다. 버튼이나 `/session-rail`, `/usage-rail`, `/todo-stack`으로 다시 엽니다. 패널은 이 모드가 엽니다. Claude Code 2.1.325부터 다른 플러그인이 잡고 있는 패널은 열 수 없어서, `/usage-rail`과 `/todo-stack`이 실행될 때도 이 모드가 대신 엽니다.
- 패널을 붙일 수 없는 화면이면 그 이유를 알림으로 한 번 알려줍니다.

## 어디에 뜨나요

- **터미널**: 전체 화면 레이아웃(기본값)이면 대화 오른쪽에 세로 패널로 붙습니다(폭 110칸 이상). 그보다 좁거나 메인 화면 레이아웃(tmux, `CLAUDE_CODE_NO_FLICKER=0`)이면 프롬프트 바로 위에 붙습니다.
- **Claude 데스크톱 앱**: 패널을 **위젯**(패널의 작은 형태)으로 열어 달라고 요청합니다(Claude Code 2.1.325부터). 앱은 위젯을 세션 레일(채팅 옆 칸)이나 채팅 영역 구석에 둡니다. 어디에 둘지는 앱이 정합니다. 위젯에서는 클릭이 닿지 않을 수 있어서 카드는 한눈에 보는 요약만 그리고, 위젯을 펼치면 버튼이 있는 전체 패널이 됩니다. 위젯을 지원하지 않는 앱에서는 예전처럼 `세션` 탭으로 열립니다. 이미 열려 있던 패널은 그대로이니, 닫았다가 다시 열면 위젯으로 열립니다.

## 다른 모드에서 카드 넣기

`{ component: 'Pane', requestId: 'session-rail', plugin: '*' }`의 `ui.render`를 훅으로 걸고, `next(e)`가 돌려주는 트리를 자기 카드와 함께 감싸서 돌려줍니다. 위에 둘 카드는 `next(e)`보다 앞에, 아래에 둘 카드는 뒤에 놓으면 모드가 불러와지는 순서와 상관없이 순서가 유지됩니다.

Claude Code 2.1.325부터 패널 그리기 훅은 조건에 `plugin`을 적지 않으면 자기 플러그인이 연 패널만 듣습니다. 이 패널은 `session-rail`이 열므로 `plugin: '*'`(또는 `'session-rail'`)을 꼭 적어야 카드가 그려집니다. 패널을 직접 열지 말고, 자기 명령어로 패널을 보여주고 싶으면 이 모드에 그 명령어 훅을 추가하세요.

```tsx
on('ui.render', { component: 'Pane', requestId: 'session-rail', plugin: '*' }, async ($, e, next) => {
  const { Box, Text } = $.ui.resolve(e)
  const others = await next(e)
  return (
    <Box flexDirection="column" gap={1}>
      {others}
      <Text>내 카드</Text>
    </Box>
  )
})
```

`plugin.json`에는 `"dependencies": ["session-rail"]`를 넣습니다.

## 설치

```
/plugin install session-rail --marketplace ImTotem/claude-code-mods
```

보통은 `usage-rail`이나 `todo-stack`을 설치하면 함께 설치됩니다. 마켓플레이스는 이 저장소의 `main` 브랜치에 있습니다.

## 개발

이 브랜치의 루트가 모드 폴더입니다.

```
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```
