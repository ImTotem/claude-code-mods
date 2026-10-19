import { atom, read, update } from 'claude-code'
import type {
  Color,
  EngineInterface,
  Register,
  SessionContextUsage,
  SessionCost,
  SessionRateLimit,
} from 'claude-code'

import type { UsageLimit, UsageSnapshot } from '../types'

// The pane session-rail opens; this mod adds its card to it.
const RAIL = 'session-rail'
const TICK_MS = 30_000

const snapshot = atom({ plugin: 'usage-rail', key: 'snapshot' } as const, null)
const now = atom({ plugin: 'usage-rail', key: 'now' } as const, 0)
const isCollapsed = atom({ plugin: 'usage-rail', key: 'isCollapsed' } as const, false)

// The windows the settings' Usage screen lists, in its order; any other kind
// the API reports is drawn after them under its own name.
const LABELS: Record<string, string> = {
  five_hour: '현재 세션 (5시간)',
  seven_day: '주간 · 모든 모델',
  seven_day_opus: '주간 · Opus',
  seven_day_sonnet: '주간 · Sonnet',
  spend_limit: '지출 한도',
}
const ORDER = Object.keys(LABELS)
// The names the folded card's one line uses.
const SHORT: Record<string, string> = {
  five_hour: '5시간',
  seven_day: '주간',
  seven_day_opus: 'Opus',
  seven_day_sonnet: 'Sonnet',
  spend_limit: '지출',
}

type Figures = {
  rateLimits: readonly SessionRateLimit[]
  context: SessionContextUsage
  cost?: SessionCost
}

// State takes JSON data only, so fields the engine has no figure for are left
// out rather than written as undefined.
function toSnapshot(figures: Figures, measuredAt: number): UsageSnapshot {
  const limits: UsageLimit[] = figures.rateLimits.map(({ kind, percentUsed, resetsAt }) =>
    resetsAt === undefined ? { kind, percentUsed } : { kind, percentUsed, resetsAt },
  )
  const rank = (kind: string) => (ORDER.includes(kind) ? ORDER.indexOf(kind) : ORDER.length)
  limits.sort((a, b) => rank(a.kind) - rank(b.kind))

  const shot: UsageSnapshot = { limits, contextWindow: figures.context.window, measuredAt }
  if (figures.context.tokens !== undefined) shot.contextTokens = figures.context.tokens
  if (figures.context.percent !== undefined) shot.contextPercent = figures.context.percent
  if (figures.cost !== undefined) shot.costUsd = figures.cost.usd

  return shot
}

async function refresh($: EngineInterface, figures?: Figures) {
  const at = await $.clock.now()
  const shot = toSnapshot(figures ?? (await $.session.usage()), at)
  await update($, snapshot, () => shot)
  await update($, now, () => at)
}

function bar(percent: number, width: number): string {
  const filled = Math.round((Math.max(0, Math.min(100, percent)) / 100) * width)

  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

function tone(percent: number): Color {
  return percent >= 90 ? 'error' : percent >= 70 ? 'warning' : 'success'
}

function untilReset(resetsAt: string | undefined, at: number): string | undefined {
  const target = resetsAt === undefined ? NaN : Date.parse(resetsAt)
  if (Number.isNaN(target)) return undefined

  const minutes = Math.max(0, Math.round((target - at) / 60_000))
  if (minutes < 1) return '곧 초기화'

  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60
  const parts =
    days > 0
      ? [`${days}일`, hours > 0 ? `${hours}시간` : '']
      : hours > 0
        ? [`${hours}시간`, mins > 0 ? `${mins}분` : '']
        : [`${mins}분`]

  return `${parts.filter(Boolean).join(' ')} 후 초기화`
}

function tokens(count: number): string {
  if (count < 1000) return String(count)

  const thousands = count / 1000

  return `${thousands >= 100 ? Math.round(thousands) : Math.round(thousands * 10) / 10}k`
}

function ago(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return '방금'
  if (minutes < 60) return `${minutes}분 전`

  return `${Math.floor(minutes / 60)}시간 전`
}

function label(kind: string): string {
  return LABELS[kind] ?? kind
}

// What /usage-rail answers, for a surface with no pane.
function summary(shot: UsageSnapshot | null, at: number): string {
  if (shot === null) return '아직 측정된 사용량이 없습니다.'

  const lines = shot.limits.map(limit => {
    const reset = untilReset(limit.resetsAt, at)
    return `${label(limit.kind)}: ${Math.round(limit.percentUsed)}%${reset === undefined ? '' : ` · ${reset}`}`
  })
  if (lines.length === 0) lines.push('플랜 한도: 아직 정보가 없습니다 (첫 응답 이후, 구독 계정에서만 제공)')
  if (shot.contextPercent !== undefined) {
    lines.push(
      `컨텍스트: ${shot.contextPercent}% (${tokens(shot.contextTokens ?? 0)} / ${tokens(shot.contextWindow)} 토큰)`,
    )
  }
  if (shot.costUsd !== undefined) lines.push(`세션 비용: $${shot.costUsd.toFixed(2)}`)

  return lines.join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'usage-rail',
      description: '사용량(5시간·주간 한도, 컨텍스트, 비용)을 새로 불러와 보여줍니다',
    })

    if (e.isInteractive) {
      await refresh($).catch(() => undefined)
      $.clock.every(TICK_MS, () => {
        void $.clock.now().then(at => update($, now, () => at))
      })
    }

    return next(e)
  })

  on('command.run', { command: 'usage-rail' }, async $ => {
    await refresh($).catch(() => undefined)

    return { text: summary(await read($, snapshot), await $.clock.now()) }
  })

  on('session.measure', async ($, e, next) => {
    await refresh($, e)

    return next(e)
  })

  // The card goes above whatever the other mods add, so it leads the pane.
  on('ui.render', { component: 'Pane', requestId: RAIL }, async ($, e, next) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const below = await next(e)
    const shot = await read($, snapshot)
    const isFolded = await read($, isCollapsed)
    const at = Math.max(await read($, now), shot?.measuredAt ?? 0)
    const width = Math.max(10, e.props.bodyColumns - 4)

    const row = (name: string, value: string, percent: number) => (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between" gap={1}>
          <Text wrap="truncate-end">{name}</Text>
          <Text weight="semibold" tabular color={tone(percent)}>
            {value}
          </Text>
        </Box>
        <Text mono color={tone(percent)}>
          {bar(percent, width)}
        </Text>
      </Box>
    )

    const limits =
      shot === null || shot.limits.length === 0 ? (
        <Text dimColor wrap="wrap">
          한도 정보가 아직 없습니다. 첫 응답 이후에 표시됩니다. (구독 계정에서만 제공)
        </Text>
      ) : (
        shot.limits.map(limit => (
          <Box flexDirection="column">
            {row(label(limit.kind), `${Math.round(limit.percentUsed)}%`, limit.percentUsed)}
            {untilReset(limit.resetsAt, at) !== undefined && (
              <Text dimColor>{untilReset(limit.resetsAt, at)}</Text>
            )}
          </Box>
        ))
      )

    const folded = shot?.limits
      .slice(0, 2)
      .map(limit => `${SHORT[limit.kind] ?? limit.kind} ${Math.round(limit.percentUsed)}%`)
      .join(' · ')

    const card = (
      <Box key="usage-card" flexDirection="column" gap={1} borderStyle="round" borderDimColor paddingX={1}>
        <Box flexDirection="row" justifyContent="space-between" gap={1}>
          <Button key="usage-fold" plain onPress={() => update($, isCollapsed, isOn => !isOn)}>
            <Text weight="semibold">사용량</Text>
            <Text dimColor>{isFolded ? ' ›' : ' ∨'}</Text>
          </Button>
          {isFolded && folded !== undefined && folded !== '' && <Text dimColor tabular>{folded}</Text>}
        </Box>
        {!isFolded && limits}
        {!isFolded &&
          shot?.contextPercent !== undefined &&
          row(
            '컨텍스트',
            `${tokens(shot.contextTokens ?? 0)} / ${tokens(shot.contextWindow)}`,
            shot.contextPercent,
          )}
        {!isFolded && shot?.costUsd !== undefined && (
          <Box flexDirection="row" justifyContent="space-between" gap={1}>
            <Text>세션 비용</Text>
            <Text tabular>{`$${shot.costUsd.toFixed(2)}`}</Text>
          </Box>
        )}
        {!isFolded && (
          <Box flexDirection="row" justifyContent="space-between" gap={1}>
            <Text dimColor>{shot === null ? '측정 전' : `갱신 ${ago(at - shot.measuredAt)}`}</Text>
            <Button
              key="usage-refresh"
              plain
              dimColor
              label="새로 불러오기"
              onPress={async () => {
                await refresh($)
                $.ui.toast('사용량을 새로 불러왔습니다')
              }}
            />
          </Box>
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
