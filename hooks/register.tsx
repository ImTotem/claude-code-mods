import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

// Other mods add their cards by hooking ui.render for
// { component: 'Pane', requestId: 'session-rail', plugin: '*' } and wrapping
// next(e): a Pane hook hears its own plugin's panes unless its matcher names
// whose.
const PANE = 'session-rail'
const TITLE = '세션'
// Prompts the person typed, here or through Remote Control.
const PERSONAL_ORIGINS: readonly string[] = ['composer', 'bridge']

const isOpen = atom({ plugin: 'session-rail', key: 'isOpen' } as const, false)
const isDismissed = atom({ plugin: 'session-rail', key: 'isDismissed' } as const, false)
const isWarned = atom({ plugin: 'session-rail', key: 'isWarned' } as const, false)

// Asked as the desktop app's widget, the pane's small form, which the app may
// seat in its session rail (the column beside the chat) or a corner of the
// chat; the person expands it to the full pane. Elsewhere it opens as before.
async function open($: EngineInterface) {
  const opened = await $.ui.open({ id: PANE, title: TITLE, placement: 'widget' })
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

// Another mod's command: open the pane, and say why where it cannot be drawn.
async function openFor($: EngineInterface) {
  const opened = await reopen($)
  if (!opened.isPlaced) $.ui.toast(`세션 패널을 열지 못했습니다: ${opened.reason}`)
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

    // Opened at the start on every surface, the apps included: a pane opened
    // before an app attaches waits open, and is drawn when one does.
    await open($).catch(() => undefined)

    return next(e)
  })

  // An app attached: the pane opened at the start may be drawn now, so the
  // footer button reads what the engine holds.
  on('session.attach', async ($, e, next) => {
    const attached = await next(e)
    const pane = (await $.ui.panes().catch(() => [])).find(one => one.id === PANE)
    if (pane !== undefined) await update($, isOpen, () => pane.isPlaced)

    return attached
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'session-rail' }, async $ => {
    const opened = await reopen($)

    return {
      text: opened.isPlaced ? '세션 패널을 열었습니다.' : `세션 패널을 열지 못했습니다: ${opened.reason}`,
    }
  })

  // /usage-rail and /todo-stack show their cards, so they open this pane too.
  // A pane another plugin holds refuses their own open, so it is opened here,
  // as the person's command asks, and the command runs on (once: no .catch
  // here, which would run it again after a failure of its own).
  on('command.run', { command: 'usage-rail' }, async ($, e, next) => {
    await openFor($).catch(() => undefined)

    return next(e)
  })

  on('command.run', { command: 'todo-stack' }, async ($, e, next) => {
    await openFor($).catch(() => undefined)

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.isMeta !== true && PERSONAL_ORIGINS.includes(e.origin.kind)) {
      await showPane($).catch(() => undefined)
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  // An open of this pane, the person's or one this plugin made for another.
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
      <Box flexDirection="column" gap={e.props.placement === 'widget' ? 'sm' : 1}>
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
