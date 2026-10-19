# session-rail

다른 모드들이 카드를 꽂는 `세션` 패널 하나를 여는 모드입니다. 그 자체로는 카드가 없고, [`usage-rail`](../../tree/usage-rail)(사용량 카드)과 [`todo-stack`](../../tree/todo-stack)(할 일 카드)이 이 패널에 자기 카드를 넣습니다. 두 모드는 이 모드를 의존성으로 선언하므로, 둘 중 하나를 설치하면 함께 설치됩니다.

- 세션이 시작되면 패널을 엽니다. 다만 엔진은 사용자가 요청하지 않은 패널을 화면 폭이 144칸 이상일 때만 붙입니다. 데스크톱 앱처럼 그보다 좁으면 **첫 프롬프트를 보낼 때** 엽니다.
- 패널이 닫혀 있거나 아직 안 붙었으면, 프롬프트 바로 위에 **세션 패널 열기** 버튼이 뜹니다. 누르면 폭과 상관없이 열립니다.
- 패널을 직접 닫으면 그 세션에서는 프롬프트를 보내도 다시 열지 않습니다. 위의 버튼이나 `/session-rail`로 다시 엽니다.
- 패널을 붙일 수 없는 화면이면 그 이유를 알림으로 한 번 알려줍니다.

## 어디에 뜨나요

- **터미널**: 전체 화면 레이아웃(기본값)이면 대화 오른쪽에 세로 패널로 붙습니다(폭 110칸 이상). 그보다 좁거나 메인 화면 레이아웃(tmux, `CLAUDE_CODE_NO_FLICKER=0`)이면 프롬프트 바로 위에 붙습니다.
- **Claude 데스크톱 앱**: 앱이 플러그인 패널을 두는 자리에 `세션` 탭으로 나옵니다. 앱의 세션 정보 레일(환경 · 컨텍스트 · 결과물) 안에는 들어가지 않습니다. 그 레일에는 모드가 그릴 수 있는 자리가 없습니다.

## 다른 모드에서 카드 넣기

`{ component: 'Pane', requestId: 'session-rail' }`의 `ui.render`를 훅으로 걸고, `next(e)`가 돌려주는 트리를 자기 카드와 함께 감싸서 돌려줍니다. 위에 둘 카드는 `next(e)`보다 앞에, 아래에 둘 카드는 뒤에 놓으면 모드가 불러와지는 순서와 상관없이 순서가 유지됩니다.

```tsx
on('ui.render', { component: 'Pane', requestId: 'session-rail' }, async ($, e, next) => {
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
