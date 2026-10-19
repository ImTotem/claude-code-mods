import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'

import type { UsageCredit, UsageFetch, UsageSnapshot, UsageWindow } from '../types'

// The pane session-rail opens; this mod adds its card to it, and opens it
// too: a pane id is one pane whichever plugin opens it.
const RAIL = 'session-rail'
const RAIL_TITLE = '세션'
// The endpoint the Usage screen reads, called with the session's own
// credential through $.session.authorize; never more than once a minute.
const USAGE_PATH = '/api/oauth/usage'
const FETCH_GAP_MS = 60_000
const POLL_MS = 5 * 60_000
const TICK_MS = 30_000
const BAR_COLOR = '#3d7eea'

// The windows the app's usage card shows, in its order and words.
const LABELS: Record<string, string> = {
  five_hour: '세션 한도',
  seven_day: '매주',
}
const KINDS = Object.keys(LABELS)
const WEEKDAYS: Record<string, string> = {
  Sun: '일',
  Mon: '월',
  Tue: '화',
  Wed: '수',
  Thu: '목',
  Fri: '금',
  Sat: '토',
}

const snapshot = atom({ plugin: 'usage-rail', key: 'snapshot' } as const, null)
const now = atom({ plugin: 'usage-rail', key: 'now' } as const, 0)
const lastFetch = atom({ plugin: 'usage-rail', key: 'lastFetch' } as const, null)

type Json = Record<string, unknown>

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const numberOf = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)
const stringOf = (value: unknown) => (typeof value === 'string' && value !== '' ? value : undefined)

// The usage endpoint's credit with dollars and periods: the cloud session
// credit. Its current period's end is when the credit expires.
function creditOf(body: Json, at: number): UsageCredit | undefined {
  const raw = body.wattle_ember
  if (!isRecord(raw)) return undefined

  const limit = numberOf(raw.limit_dollars)
  const used = numberOf(raw.used_dollars)
  const remaining =
    numberOf(raw.remaining_dollars) ?? (limit !== undefined && used !== undefined ? limit - used : undefined)
  if (limit === undefined || remaining === undefined) return undefined

  const periods = Array.isArray(raw.periods) ? raw.periods.filter(isRecord) : []
  const current = periods.find(period => {
    const starts = Date.parse(stringOf(period.starts_at) ?? '')
    const ends = Date.parse(stringOf(period.ends_at) ?? '')
    return starts <= at && at < ends
  })
  const endsAt = stringOf(current?.ends_at) ?? stringOf(raw.resets_at)
  const label = stringOf(raw.label)

  const credit: UsageCredit = {
    label: label === undefined || /cloud session/i.test(label) ? '클라우드 세션 크레딧' : label,
    currency: 'USD',
    limit,
    remaining,
    percent: numberOf(raw.utilization) ?? (limit > 0 ? ((limit - remaining) / limit) * 100 : 0),
  }
  if (endsAt !== undefined) credit.endsAt = endsAt

  return credit
}

function fromEndpoint(body: Json, at: number): UsageSnapshot {
  const windows: UsageWindow[] = []
  for (const kind of KINDS) {
    const raw = body[kind]
    const percent = isRecord(raw) ? numberOf(raw.utilization) : undefined
    if (!isRecord(raw) || percent === undefined) continue

    const resetsAt = stringOf(raw.resets_at)
    windows.push(resetsAt === undefined ? { kind, percent } : { kind, percent, resetsAt })
  }

  const shot: UsageSnapshot = { windows, measuredAt: at }
  const credit = creditOf(body, at)
  if (credit !== undefined) shot.credit = credit

  return shot
}

// What the last response's rate-limit headers said, where the endpoint
// cannot be read (no first-party credential, a gateway).
function fromHeaders(limits: readonly SessionRateLimit[], at: number): UsageSnapshot {
  const windows = limits
    .filter(limit => KINDS.includes(limit.kind))
    .map(({ kind, percentUsed, resetsAt }) =>
      resetsAt === undefined ? { kind, percent: percentUsed } : { kind, percent: percentUsed, resetsAt },
    )
    .sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind))

  return { windows, measuredAt: at }
}

async function readEndpoint($: EngineInterface, at: number): Promise<UsageSnapshot | undefined> {
  const record = (fetched: UsageFetch) => update($, lastFetch, () => fetched)

  const authorization = await $.session.authorize()
  if (authorization === null) {
    await record({ at, status: null, error: 'no first-party credential' })
    return undefined
  }

  const base = ((await $.env.get('ANTHROPIC_BASE_URL')) ?? 'https://api.anthropic.com').replace(/\/+$/, '')
  const response = await $.http.fetch(`${base}${USAGE_PATH}`, {
    auth: authorization.handle,
    headers: { accept: 'application/json', 'anthropic-beta': 'oauth-2025-04-20' },
  })
  if (!response.ok) {
    await record({ at, status: response.status, error: response.text.slice(0, 200) })
    return undefined
  }

  const body: unknown = JSON.parse(response.text)
  await record({ at, status: response.status })

  return isRecord(body) ? fromEndpoint(body, at) : undefined
}

let lastReadAt = 0

async function refresh($: EngineInterface, limits?: readonly SessionRateLimit[], force = false) {
  const at = await $.clock.now()
  await update($, now, () => at)
  if (!force && at - lastReadAt < FETCH_GAP_MS) return

  lastReadAt = at
  const fetched = await readEndpoint($, at).catch(async (error: unknown) => {
    await update($, lastFetch, () => ({ at, status: null, error: String(error).slice(0, 200) }))
    return undefined
  })
  const shot = fetched ?? fromHeaders(limits ?? (await $.session.usage()).rateLimits, at)
  await update($, snapshot, () => shot)
}

// Wall-clock parts in the configured zone; UTC where the zone is unknown.
function clockAt(ms: number, timeZone: string) {
  const date = new Date(ms)
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      month: 'numeric',
      day: 'numeric',
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZoneName: 'shortOffset',
    }).formatToParts(date)
    const part = (type: string) => parts.find(one => one.type === type)?.value ?? ''

    return {
      month: Number(part('month')),
      day: Number(part('day')),
      weekday: WEEKDAYS[part('weekday')] ?? part('weekday'),
      hour: Number(part('hour')),
      minute: part('minute'),
      zone: part('timeZoneName'),
    }
  } catch {
    return {
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      weekday: Object.values(WEEKDAYS)[date.getUTCDay()] ?? '',
      hour: date.getUTCHours(),
      minute: String(date.getUTCMinutes()).padStart(2, '0'),
      zone: 'UTC',
    }
  }
}

function time(hour: number, minute: string): string {
  return `${hour < 12 ? '오전' : '오후'} ${hour % 12 === 0 ? 12 : hour % 12}:${minute}`
}

// "3시간 54분 후 재설정" within a day, "재설정: (일) 오후 9:00" past it.
function resetText(resetsAt: string | undefined, at: number, timeZone: string): string | undefined {
  const target = Date.parse(resetsAt ?? '')
  if (Number.isNaN(target)) return undefined

  const minutes = Math.max(0, Math.round((target - at) / 60_000))
  if (minutes < 24 * 60) {
    const hours = Math.floor(minutes / 60)
    const rest = minutes % 60
    if (hours === 0) return `${rest}분 후 재설정`

    return rest === 0 ? `${hours}시간 후 재설정` : `${hours}시간 ${rest}분 후 재설정`
  }

  const clock = clockAt(target, timeZone)

  return `재설정: (${clock.weekday}) ${time(clock.hour, clock.minute)}`
}

function expiryText(endsAt: string | undefined, timeZone: string): string | undefined {
  const target = Date.parse(endsAt ?? '')
  if (Number.isNaN(target)) return undefined

  const clock = clockAt(target, timeZone)

  return `만료: ${clock.month}월 ${clock.day}일 ${time(clock.hour, clock.minute)} ${clock.zone}`
}

function dollars(amount: number): string {
  return `US$${Number.isInteger(amount) ? amount : amount.toFixed(2)}`
}

export const register: Register = (on, options) => {
  const timeZone = typeof options.timeZone === 'string' && options.timeZone !== '' ? options.timeZone : 'UTC'

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'usage-rail',
      description: '세션 패널을 열어 사용량(세션 한도, 매주, 클라우드 세션 크레딧)을 보여줍니다',
    })

    if (e.isInteractive) {
      await refresh($, undefined, true).catch(() => undefined)
      $.clock.every(TICK_MS, () => {
        void $.clock.now().then(at => update($, now, () => at))
      })
      $.clock.every(POLL_MS, () => {
        void refresh($).catch(() => undefined)
      })
    }

    return next(e)
  })

  on('command.run', { command: 'usage-rail' }, async $ => {
    await refresh($, undefined, true).catch(() => undefined)
    const opened = await $.ui.open({ id: RAIL, title: RAIL_TITLE })

    return {
      text: opened.isPlaced
        ? '사용량 패널을 열었습니다.'
        : `사용량 패널을 열지 못했습니다: ${opened.reason}`,
    }
  })

  // After each turn: read again, at most once a minute.
  on('session.measure', async ($, e, next) => {
    await refresh($, e.rateLimits).catch(() => undefined)

    return next(e)
  })

  // The card goes above whatever the other mods add, so it leads the pane.
  on('ui.render', { component: 'Pane', requestId: RAIL }, async ($, e, next) => {
    const table = $.ui.resolve(e)
    const { Box, Text } = table
    // The terminal's table names an Svg it draws as nothing; it gets cells.
    const Svg = e.surface !== 'terminal' && 'Svg' in table ? table.Svg : undefined
    const below = await next(e)
    const shot = await read($, snapshot)
    const fetched = await read($, lastFetch)
    const at = Math.max(await read($, now), shot?.measuredAt ?? 0)
    const width = Math.max(10, e.props.bodyColumns - 4)

    // A thin rounded bar where the surface draws SVG, a line of cells elsewhere.
    const bar = (percent: number) => {
      const used = Math.max(0, Math.min(100, percent))
      if (Svg !== undefined) {
        const source =
          `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="6" viewBox="0 0 100 6" preserveAspectRatio="none">` +
          `<rect width="100" height="6" rx="3" fill="rgba(128,128,128,0.3)"/>` +
          (used > 0 ? `<rect width="${used.toFixed(2)}" height="6" rx="3" fill="${BAR_COLOR}"/>` : '') +
          `</svg>`
        return <Svg source={source} alt={`${Math.round(used)}% 사용됨`} height={6} />
      }

      const filled = Math.round((used / 100) * width)
      return (
        <Text>
          <Text color={BAR_COLOR}>{'━'.repeat(filled)}</Text>
          <Text dimColor>{'━'.repeat(width - filled)}</Text>
        </Text>
      )
    }

    const item = (name: string, value: string, percent: number, note: string | undefined) => (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between" gap={1}>
          <Text weight="semibold" wrap="truncate-end">
            {name}
          </Text>
          <Text dimColor size="footnote" tabular>
            {value}
          </Text>
        </Box>
        {bar(percent)}
        {note !== undefined && (
          <Text dimColor size="footnote">
            {note}
          </Text>
        )}
      </Box>
    )

    const items = [
      ...(shot?.windows ?? []).map(window =>
        item(
          LABELS[window.kind] ?? window.kind,
          `${Math.round(window.percent)}% 사용됨`,
          window.percent,
          resetText(window.resetsAt, at, timeZone),
        ),
      ),
      ...(shot?.credit === undefined
        ? []
        : [
            item(
              shot.credit.label,
              `${dollars(shot.credit.limit)} 중 ${dollars(shot.credit.remaining)} 남음`,
              shot.credit.percent,
              expiryText(shot.credit.endsAt, timeZone),
            ),
          ]),
    ]

    const empty =
      fetched?.error !== undefined
        ? `사용량을 불러오지 못했습니다 (${fetched.status ?? fetched.error})`
        : '사용량을 불러오는 중입니다'

    const card = (
      <Box key="usage-card" flexDirection="column" gap={1} borderStyle="round" borderDimColor paddingX={1}>
        <Text weight="bold">사용량</Text>
        {items.length === 0 ? (
          <Text dimColor wrap="wrap">
            {empty}
          </Text>
        ) : (
          items
        )}
      </Box>
    )

    return (
      <Box flexDirection="column" gap={1}>
        {card}
        {below}
      </Box>
    )
  })
}
