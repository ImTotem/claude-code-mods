import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

// Other mods add their cards by hooking ui.render for
// { component: 'Pane', requestId: 'session-rail' } and wrapping next(e).
const PANE = 'session-rail'
const TITLE = '세션'
// Prompts the person typed, here or through Remote Control.
const PERSONAL_ORIGINS: readonly string[] = ['composer', 'bridge']

const isOpen = atom({ plugin: 'session-rail', key: 'isOpen' } as const, false)
const isDismissed = atom({ plugin: 'session-rail', key: 'isDismissed' } as const, false)
const isWarned = atom({ plugin: 'session-rail', key: 'isWarned' } as const, false)

async function open($: EngineInterface) {
  const opened = await $.ui.open({ id: PANE, title: TITLE })
  await update($, isOpen, () => opened.isPlaced)

  return opened
}

// The open session.start makes is unasked, and an unasked pane waits undrawn
// below 144 columns, which an app's transcript seldom reaches; one made from
// the person's own prompt or press is placed at any width.
async function showPane($: EngineInterface) {
  if (await read($, isDismissed)) return
  const pane = (await $.ui.panes()).find(one => one.id === PANE)
  if (pane?.isPlaced === true) return

  const opened = await open($)
  if (opened.isPlaced || (await read($, isWarned))) return

  await update($, isWarned, () => true)
  $.ui.toast(`세션 패널을 열지 못했습니다: ${opened.reason}`)
}

async function reopen($: EngineInterface) {
  await update($, isDismissed, () => false)

  return open($)
}

// The footer button: open the pane, or close it as the person's own close
// would, so a prompt does not bring it back.
async function toggle($: EngineInterface) {
  if (!(await read($, isOpen))) return reopen($)

  await update($, isDismissed, () => true)
  await $.ui.close({ id: PANE })
  await update($, isOpen, () => false)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'session-rail',
      description: '세션 패널(사용량 · 할 일 카드)을 엽니다',
    })

    if (e.isInteractive) await open($).catch(() => undefined)

    return next(e)
  })

  on('command.run', { command: 'session-rail' }, async $ => {
    const opened = await reopen($)

    return {
      text: opened.isPlaced ? '세션 패널을 열었습니다.' : `세션 패널을 열지 못했습니다: ${opened.reason}`,
    }
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.isMeta !== true && PERSONAL_ORIGINS.includes(e.origin.kind)) {
      await showPane($).catch(() => undefined)
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  // usage-rail's and todo-stack's commands open this pane too.
  on('ui.open', { id: PANE }, async ($, e, next) => {
    const opened = await next(e)
    if (opened.value?.isPlaced === true) {
      await update($, isOpen, () => true)
      await update($, isDismissed, () => false)
    }

    return opened
  }).catch(($, e, next) => next(e))

  on('ui.close', { id: PANE }, async ($, e, next) => {
    await update($, isOpen, () => false)
    if (e.origin.kind === 'person') await update($, isDismissed, () => true)

    return next(e)
  }).catch(($, e, next) => next(e))

  // The pane itself: the cards the other mods add, stacked.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const { Box } = $.ui.resolve(e)
    const cards = await next(e)

    return (
      <Box flexDirection="column" gap={1}>
        {cards}
      </Box>
    )
  })

  // A button at the right of the prompt footer, beside the mode labels,
  // that opens the pane and closes it again.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const { Box, Button } = $.ui.resolve(e)
    const modes = await next(e)
    const isShown = await read($, isOpen)

    return (
      <Box flexDirection="row" gap={1}>
        {modes}
        <Button
          key="toggle-rail"
          plain
          dimColor={!isShown}
          label="세션 패널"
          onPress={() => toggle($)}
        />
      </Box>
    )
  })
}
