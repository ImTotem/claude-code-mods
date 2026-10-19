import { expect, test } from 'claude-code/testing'
import type { On, RenderElement } from 'claude-code'

const PANE = {
  plugin: 'session-rail',
  component: 'Pane',
  requestId: 'session-rail',
  props: {
    title: '세션',
    isFocused: false,
    bodyColumns: 36,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  },
} as const

const FOOTER = {
  plugin: 'session-rail',
  component: 'SessionMode',
  props: { modes: ['focus'] },
} as const

const PROMPT = { text: '작업해줘', wait: false, origin: { kind: 'composer' } } as const

// A surface stand-in: it places the pane once the open is asked for (a press,
// a prompt), or never when `refuses` names why; and draws nothing of its own.
function surface(on: On, refuses?: string) {
  const seen = { opens: 0, isUp: false, toasts: [] as string[] }
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('ui.panes', () => ({
    value: seen.isUp ? [{ id: 'session-rail', title: '세션', isShown: true, isFocused: false, isPlaced: true }] : [],
  }))
  on('ui.open', () => {
    seen.opens += 1
    // The first open is session.start's, unasked, on a narrow surface.
    if (refuses !== undefined || seen.opens === 1) {
      return { value: { isPlaced: false, reason: refuses ?? 'unasked below 144 columns' } }
    }
    seen.isUp = true
    return { value: { isPlaced: true } }
  })
  on('ui.toast', ($, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.render', { component: 'Pane' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return h(Box, { key: 'bottom' }) as RenderElement
  })
  on('ui.close', () => {
    seen.isUp = false
    return { value: undefined }
  })
  // The engine's own footer labels.
  on('ui.render', { component: 'SessionMode' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, { dimColor: true }, e.props.modes.join(' & ')) as RenderElement
  })

  return seen
}

test('the footer button sits beside the mode labels and opens and closes the pane', async ($, on) => {
  const seen = surface(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  expect(seen.isUp).toBe(false)

  for (const surfaceName of ['terminal', 'desktop'] as const) {
    const footer = await $.ui.mount({ ...FOOTER, surface: surfaceName })
    const shown = (await footer.findAll({ type: 'Text' })).map(text => text.text)
    expect(shown).toContain('focus')
    expect(await footer.find({ type: 'Button', key: 'toggle-rail' })).toBeDefined()
    await footer.unmount()
  }

  const footer = await $.ui.mount({ ...FOOTER, surface: 'desktop' })
  await footer.press({ key: 'toggle-rail' })
  expect(seen.isUp).toBe(true)

  await footer.press({ key: 'toggle-rail' })
  expect(seen.isUp).toBe(false)

  // Closed from the button, a prompt does not bring it back; the button does.
  await $.prompt.submit(PROMPT)
  expect(seen.isUp).toBe(false)
  await footer.press({ key: 'toggle-rail' })
  expect(seen.isUp).toBe(true)
})

test("the person's prompt opens the pane, once", async ($, on) => {
  const seen = surface(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })

  await $.prompt.submit(PROMPT)
  expect(seen.opens).toBe(2)
  expect(seen.isUp).toBe(true)
  await $.prompt.submit(PROMPT)
  expect(seen.opens).toBe(2)
})

test('a pane no surface places is reported once', async ($, on) => {
  const seen = surface(on, 'no attached surface places panes')
  await $.prompt.submit(PROMPT)
  await $.prompt.submit(PROMPT)
  expect(seen.toasts).toEqual(['세션 패널을 열지 못했습니다: no attached surface places panes'])
})

test('the command opens the pane and says so', async ($, on) => {
  const seen = surface(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  const ran = await $.command.run({
    command: 'session-rail',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })
  expect(ran).toMatchObject({ text: '세션 패널을 열었습니다.' })
  expect(seen.isUp).toBe(true)
})

test("the pane stacks the other mods' cards", {
  plugins: [
    {
      name: 'usage-card',
      register(on) {
        on('ui.render', { component: 'Pane', requestId: 'session-rail' }, async ($, e, next) => {
          const { Box, Text } = $.ui.resolve(e)
          const below = await next(e)
          return h(Box, { flexDirection: 'column' }, h(Text, {}, '사용량'), below) as RenderElement
        })
      },
    },
    {
      name: 'todo-card',
      register(on) {
        on('ui.render', { component: 'Pane', requestId: 'session-rail' }, async ($, e, next) => {
          const { Box, Text } = $.ui.resolve(e)
          const above = await next(e)
          return h(Box, { flexDirection: 'column' }, above, h(Text, {}, '할 일')) as RenderElement
        })
      },
    },
  ],
}, async ($, on) => {
  surface(on)
  for (const surfaceName of ['terminal', 'desktop', 'mobile'] as const) {
    const pane = await $.ui.mount({ ...PANE, surface: surfaceName })
    const texts = (await pane.findAll({ type: 'Text' })).map(text => text.text)
    expect(texts).toEqual(['사용량', '할 일'])
    await pane.unmount()
  }
})

test("another mod's command opening the pane marks it open for the button", {
  plugins: [
    {
      name: 'other-mod',
      register(on) {
        on('session.start', async ($, e, next) => {
          await $.command.register({ name: 'other', description: 'opens the session pane' })
          return next(e)
        })
        on('command.run', { command: 'other' }, async $ => {
          await $.ui.open({ id: 'session-rail', title: '세션' })
          return { text: 'opened' }
        })
      },
    },
  ],
}, async ($, on) => {
  const seen = surface(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await $.command.run({
    command: 'other',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })
  expect(seen.isUp).toBe(true)

  // So the button's next press closes it rather than opening it again.
  const footer = await $.ui.mount({ ...FOOTER, surface: 'desktop' })
  await footer.press({ key: 'toggle-rail' })
  expect(seen.isUp).toBe(false)
})
