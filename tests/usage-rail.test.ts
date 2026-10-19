import { expect, mock, test } from 'claude-code/testing'
import type { On, RenderElement, SessionUsage } from 'claude-code'
import type { Engine } from 'claude-code/testing'

// Monday 2026-10-19, 09:00 in Seoul.
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

// What /api/oauth/usage answers for the app's card in the screenshot.
const ENDPOINT = {
  five_hour: { utilization: 29, resets_at: '2026-10-19T03:54:00Z' },
  seven_day: { utilization: 4, resets_at: '2026-10-25T12:00:00Z' },
  seven_day_sonnet: { utilization: 1, resets_at: '2026-10-25T12:00:00Z' },
  wattle_ember: {
    label: 'Cloud session credits',
    utilization: 23,
    limit_dollars: 100,
    used_dollars: 23,
    remaining_dollars: 77,
    resets_at: null,
    periods: [{ starts_at: '2026-10-06T07:59:00Z', ends_at: '2026-11-05T07:59:00Z' }],
  },
}

const HEADERS: SessionUsage = {
  startedAt: NOW,
  context: { tokens: 81_000, window: 200_000, percent: 41 },
  rateLimits: [{ kind: 'five_hour', percentUsed: 12, resetsAt: '2026-10-19T02:00:00Z' }],
}

type Answer = { status: number; text: string } | 'no-credential' | 'silent'

// The engine beneath the plugin: the clock, the session's credential, the
// network, the headers' figures, the pane's own drawing (nothing), the opens.
function engine(
  on: On,
  answer: Answer = { status: 200, text: JSON.stringify(ENDPOINT) },
  headers: SessionUsage = HEADERS,
) {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  mock.env(on, { ANTHROPIC_BASE_URL: 'https://api.anthropic.com' })
  const seen = { urls: [] as string[], opens: [] as string[], clock }
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.authorize', () => ({
    value: answer === 'no-credential' ? null : { handle: 'handle-1', kind: 'bearer' as const },
  }))
  on('http.fetch', async ($, e) => {
    seen.urls.push(e.url)
    if (answer === 'silent') await new Promise(() => undefined)
    const { status, text } = typeof answer === 'string' ? { status: 0, text: '' } : answer
    return { value: { status, ok: status >= 200 && status < 300, headers: {}, text } }
  })
  on('session.usage', () => ({ value: headers }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('ui.render', { component: 'Pane' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return h(Box, { key: 'bottom' }) as RenderElement
  })
  on('ui.open', ($, e) => {
    seen.opens.push(e.id)
    return { value: { isPlaced: true } }
  })

  return seen
}

// As the app hosts a cloud session: not interactive. The read runs on a timer.
async function start($: Engine, seen: ReturnType<typeof engine>) {
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: false })
  await seen.clock.advance(1)
}

const texts = async (ui: { findAll: (query: { type: string }) => Promise<{ text: string }[]> }) =>
  (await ui.findAll({ type: 'Text' })).map(text => text.text).filter(text => text !== '')

test("the card shows the app's three rows, in its words", async ($, on) => {
  const seen = engine(on)
  await start($, seen)
  expect(seen.urls).toEqual(['https://api.anthropic.com/api/oauth/usage'])

  for (const surface of ['desktop', 'terminal', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const shown = await texts(ui)
    for (const line of [
      '사용량',
      '세션 한도',
      '29% 사용됨',
      '3시간 54분 후 재설정',
      '매주',
      '4% 사용됨',
      '재설정: (일) 오후 9:00',
      '클라우드 세션 크레딧',
      'US$100 중 US$77 남음',
      '만료: 11월 5일 오후 4:59 GMT+9',
    ]) {
      expect(shown, `${surface}: ${line}`).toContain(line)
    }
    expect(shown.some(text => /Sonnet|컨텍스트|비용/.test(text))).toBe(false)
    await ui.unmount()
  }
})

test('the bar is an SVG where the surface draws one, a line of cells on the terminal', async ($, on) => {
  const seen = engine(on)
  await start($, seen)

  const desktop = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await desktop.findAll({ type: 'Svg' })).toHaveLength(3)
  await desktop.unmount()

  const terminal = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await terminal.findAll({ type: 'Svg' })).toHaveLength(0)
  expect(JSON.stringify(await terminal.drawn())).toContain('━━━')
})

test('the time zone option sets how resets and expiry read', { options: { timeZone: 'America/Los_Angeles' } }, async (
  $,
  on,
) => {
  const seen = engine(on)
  await start($, seen)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const shown = await texts(ui)
  expect(shown).toContain('재설정: (일) 오전 5:00')
  expect(shown).toContain('만료: 11월 4일 오후 11:59 GMT-8')
})

test("where the endpoint refuses, the last response's headers stand in", async ($, on) => {
  const seen = engine(on, { status: 401, text: 'unauthorized' })
  await start($, seen)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const shown = await texts(ui)
  expect(shown).toContain('12% 사용됨')
  expect(shown).toContain('2시간 후 재설정')
  // The credit comes from the endpoint alone: its row stays, saying why it is empty.
  expect(shown).toContain('클라우드 세션 크레딧')
  expect(shown).toContain('—')
  expect(shown).toContain('불러오지 못했습니다')
})

test('with nothing to show the card says why', async ($, on) => {
  const seen = engine(on, 'no-credential', { ...HEADERS, rateLimits: [] })
  await start($, seen)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: '사용량을 불러오지 못했습니다 (no first-party credential)' })).toBeDefined()
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
  const seen = engine(on)
  await start($, seen)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const shown = (await texts(ui)).filter(text => text === '사용량' || text === 'other card')
  expect(shown).toEqual(['사용량', 'other card'])
})

test('the command opens the session pane', async ($, on) => {
  const seen = engine(on)
  const ran = await $.command.run({
    command: 'usage-rail',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })
  expect(ran).toMatchObject({ text: '사용량 패널을 열었습니다.' })
  expect(seen.opens).toEqual(['session-rail'])
})

test('a read that never answers ends as a failure after 15 seconds', async ($, on) => {
  const seen = engine(on, 'silent', { ...HEADERS, rateLimits: [] })
  await start($, seen)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: '사용량을 불러오는 중입니다' })).toBeDefined()

  await seen.clock.advance(15_000)
  expect(await ui.find({ type: 'Text', text: '사용량을 불러오지 못했습니다 (no answer in 15s)' })).toBeDefined()
})

test('an answer with no usage rows says so, keeps the answer for a look, and tries again', async ($, on) => {
  const seen = engine(on, { status: 200, text: JSON.stringify({ unknown_window: { utilization: 3 } }) }, {
    ...HEADERS,
    rateLimits: [],
  })
  await start($, seen)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(
    await ui.find({ type: 'Text', text: '사용량을 불러오지 못했습니다 (200 no usage rows in the answer (unknown_window))' }),
  ).toBeDefined()

  // A failed read is tried again a minute later, not on the very next prompt.
  await $.prompt.submit({ text: '다음', wait: false, origin: { kind: 'composer' } })
  await seen.clock.advance(1)
  expect(seen.urls).toHaveLength(1)
  await seen.clock.advance(60_000)
  await $.prompt.submit({ text: '다음', wait: false, origin: { kind: 'composer' } })
  await seen.clock.advance(1)
  expect(seen.urls).toHaveLength(2)
})

test("a credential without the profile scope says so, and is not asked again for half an hour", async ($, on) => {
  const refusal = JSON.stringify({
    type: 'error',
    error: { type: 'permission_error', message: 'OAuth token does not meet scope requirement user:profile' },
  })
  const seen = engine(on, { status: 403, text: refusal }, { ...HEADERS, rateLimits: [] })
  await start($, seen)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(
    await ui.find({
      type: 'Text',
      text: '이 세션의 인증에는 사용량 조회 권한(user:profile)이 없어 사용량을 볼 수 없습니다. 클라우드 세션의 제한입니다.',
    }),
  ).toBeDefined()

  await seen.clock.advance(29 * 60_000)
  await $.prompt.submit({ text: '다음', wait: false, origin: { kind: 'composer' } })
  await seen.clock.advance(1)
  expect(seen.urls).toHaveLength(1)
  await seen.clock.advance(60_000)
  await $.prompt.submit({ text: '다음', wait: false, origin: { kind: 'composer' } })
  await seen.clock.advance(1)
  expect(seen.urls).toHaveLength(2)
})

test('in a cloud session the windows come from the headers and the credit row says why it is empty', async (
  $,
  on,
) => {
  const refusal = JSON.stringify({
    type: 'error',
    error: { type: 'permission_error', message: 'OAuth token does not meet scope requirement user:profile' },
  })
  const seen = engine(on, { status: 403, text: refusal })
  await start($, seen)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const shown = await texts(ui)
  expect(shown).toContain('세션 한도')
  expect(shown).toContain('12% 사용됨')
  expect(shown).toContain('클라우드 세션 크레딧')
  expect(shown).toContain('이 세션에서는 조회할 수 없습니다 (사용량 조회 권한 없음)')
})

test('a rate-limited read says so and waits ten minutes', async ($, on) => {
  const limited = JSON.stringify({ error: { type: 'rate_limit_error', message: 'Rate limited. Please try again later.' } })
  const seen = engine(on, { status: 429, text: limited })
  await start($, seen)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: '요청이 많아 잠시 뒤에 다시 불러옵니다' })).toBeDefined()

  await seen.clock.advance(9 * 60_000)
  await $.prompt.submit({ text: '다음', wait: false, origin: { kind: 'composer' } })
  await seen.clock.advance(1)
  expect(seen.urls).toHaveLength(1)
  await seen.clock.advance(60_000)
  await $.prompt.submit({ text: '다음', wait: false, origin: { kind: 'composer' } })
  await seen.clock.advance(1)
  expect(seen.urls).toHaveLength(2)
})

test('the bar keeps round ends: widths in percent, radii in pixels, nothing stretched', async ($, on) => {
  const seen = engine(on)
  await start($, seen)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const [first] = await ui.findAll({ type: 'Svg' })
  const source = String(first?.props.source)
  expect(source).not.toContain('preserveAspectRatio')
  expect(source).toContain('width="100%" height="8"')
  expect(source).toContain('width="29.00%" height="8" rx="4"')
  expect(first?.props.height).toBe(8)
})
