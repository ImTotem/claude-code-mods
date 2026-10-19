import { expect, mock, test } from 'claude-code/testing'
import type { On, RenderElement, SessionUsage } from 'claude-code'
import type { Engine } from 'claude-code/testing'

const NOW = Date.parse('2026-10-19T00:00:00Z')

// The pane session-rail opens; this mod adds a card to it.
const PANE = {
  plugin: 'usage-rail',
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

const USAGE: SessionUsage = {
  startedAt: NOW,
  context: { tokens: 81_000, window: 200_000, percent: 41 },
  rateLimits: [
    { kind: 'seven_day', percentUsed: 18, resetsAt: '2026-10-22T03:00:00Z' },
    { kind: 'five_hour', percentUsed: 42.5, resetsAt: '2026-10-19T02:13:00Z' },
  ],
  cost: { usd: 1.234 },
}

// What the engine answers beneath the plugin: the clock, the figures, the
// pane's own drawing (nothing), and the panes opened.
function engine(on: On) {
  mock.clock(on, { now: NOW })
  const opens: string[] = []
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('session.usage', () => ({ value: USAGE }))
  on('ui.render', { component: 'Pane' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return h(Box, { key: 'bottom' }) as RenderElement
  })
  on('ui.open', ($, e) => {
    opens.push(e.id)
    return { value: { isPlaced: true } }
  })

  return opens
}

async function measure($: Engine) {
  await $.session.measure({
    context: USAGE.context,
    rateLimits: USAGE.rateLimits,
    cost: { usd: 1.234 },
    changed: ['context', 'rateLimits', 'cost'],
  })
}

test('the card shows the limits a measurement reports, 5-hour first', async ($, on) => {
  engine(on)
  await measure($)

  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const names = await ui.findAll({ type: 'Text', text: /현재 세션|주간/ })
    expect(names.map(name => name.text)).toEqual(['현재 세션 (5시간)', '주간 · 모든 모델'])
    expect(await ui.find({ type: 'Text', text: '43%' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '2시간 13분 후 초기화' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '3일 3시간 후 초기화' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '81k / 200k' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '$1.23' })).toBeDefined()
    await ui.unmount()
  }
})

test('folding the card leaves its header and a one-line summary', async ($, on) => {
  engine(on)
  await measure($)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'usage-fold' })
  expect(await ui.find({ type: 'Text', text: '5시간 43% · 주간 18%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '현재 세션 (5시간)' })).toBeUndefined()

  await ui.press({ key: 'usage-fold' })
  expect(await ui.find({ type: 'Text', text: '현재 세션 (5시간)' })).toBeDefined()
})

test('before any reading the card says so, and its button fetches the figures', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /한도 정보가 아직 없습니다/ })).toBeDefined()

  await ui.press({ key: 'usage-refresh' })
  expect(await ui.find({ type: 'Text', text: '현재 세션 (5시간)' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '갱신 방금' })).toBeDefined()
})

test("the card leads the pane and keeps the other mods' cards below it", {
  plugins: [
    {
      name: 'other-card',
      register(on) {
        on('ui.render', { component: 'Pane', requestId: 'session-rail' }, async ($, e, next) => {
          const { Box, Text } = $.ui.resolve(e)
          const below = await next(e)
          return h(Box, { flexDirection: 'column' }, below, h(Text, {}, 'other card')) as RenderElement
        })
      },
    },
  ],
}, async ($, on) => {
  engine(on)
  await measure($)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const texts = (await ui.findAll({ type: 'Text', text: /사용량|other card/ })).map(text => text.text)
  expect(texts).toEqual(['사용량', 'other card'])
})

test('the command opens the session pane', async ($, on) => {
  const opens = engine(on)
  const ran = await $.command.run({
    command: 'usage-rail',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })
  expect(ran).toMatchObject({ text: '사용량 패널을 열었습니다.' })
  expect(opens).toEqual(['session-rail'])
})
