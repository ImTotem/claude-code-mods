import { expect, mock, test } from 'claude-code/testing'
import type { On, SessionUsage } from 'claude-code'

const NOW = Date.parse('2026-10-19T00:00:00Z')

const PANE = {
  plugin: 'usage-rail',
  component: 'Pane',
  requestId: 'usage-rail',
  props: {
    title: '사용량',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
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

function engine(on: On, usage: SessionUsage = USAGE) {
  mock.clock(on, { now: NOW })
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('session.usage', () => ({ value: usage }))
}

test('the pane shows the limits a measurement reports, 5-hour first', async ($, on) => {
  engine(on)
  await $.session.measure({
    context: USAGE.context,
    rateLimits: USAGE.rateLimits,
    cost: { usd: 1.234 },
    changed: ['context', 'rateLimits', 'cost'],
  })

  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const labels = await ui.findAll({ type: 'Text', text: /현재 세션|주간/ })
    expect(labels.map(label => label.text)).toEqual(['현재 세션 (5시간)', '주간 · 모든 모델'])
    expect(await ui.find({ type: 'Text', text: '43%' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '2시간 13분 후 초기화' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '3일 3시간 후 초기화' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '81k / 200k 토큰' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '$1.23' })).toBeDefined()
    await ui.unmount()
  }
})

test('before any reading the pane says so, and refresh fetches the figures', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /한도 정보가 아직 없습니다/ })).toBeDefined()

  await ui.press({ key: 'refresh' })
  expect(await ui.find({ type: 'Text', text: '현재 세션 (5시간)' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '갱신 방금' })).toBeDefined()
})

test('the command opens the pane and reports when it could not', async ($, on) => {
  engine(on)
  on('ui.open', () => ({ value: { isPlaced: false, reason: 'too narrow' } }))
  const ran = await $.command.run({
    command: 'usage-rail',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })
  expect(ran).toMatchObject({ text: '사용량 패널을 열지 못했습니다: too narrow' })
})

// A surface stand-in: what `$.ui.open` placed, as `$.ui.panes()` lists it.
function surface(on: On, placed: { reason?: string } = {}) {
  const seen = { opens: 0, toasts: [] as string[], isUp: false }
  on('ui.panes', () => ({
    value: seen.isUp ? [{ id: 'usage-rail', title: '사용량', isShown: true, isFocused: false, isPlaced: true }] : [],
  }))
  on('ui.open', () => {
    seen.opens += 1
    if (placed.reason !== undefined) return { value: { isPlaced: false, reason: placed.reason } }
    seen.isUp = true
    return { value: { isPlaced: true } }
  })
  on('ui.toast', ($, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('prompt.submit', ($, e) => ({ text: e.text }))

  return seen
}

const PROMPT = { text: '작업해줘', wait: false, origin: { kind: 'composer' } } as const
const COMMAND = {
  command: 'usage-rail',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 80 },
} as const

// The person's own close (the pane's close mark) is the engine's to raise and
// a test cannot: isDismissed is left to the session.
test("the person's prompt opens the pane once; the command opens it again", async ($, on) => {
  engine(on)
  const seen = surface(on)

  await $.prompt.submit(PROMPT)
  expect(seen.opens).toBe(1)
  await $.prompt.submit(PROMPT)
  expect(seen.opens).toBe(1)

  await $.command.run(COMMAND)
  expect(seen.opens).toBe(2)
  expect(seen.isUp).toBe(true)
})

test('a pane no surface places is reported once', async ($, on) => {
  engine(on)
  const seen = surface(on, { reason: 'no attached surface places panes' })

  await $.prompt.submit(PROMPT)
  await $.prompt.submit(PROMPT)
  expect(seen.opens).toBe(2)
  expect(seen.toasts).toEqual(['사용량 패널을 열지 못했습니다: no attached surface places panes'])
})
