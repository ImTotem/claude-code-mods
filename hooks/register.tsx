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

const PANE = 'usage-rail'
const TITLE = '사용량'
const TICK_MS = 30_000

const snapshot = atom({ plugin: 'usage-rail', key: 'snapshot' } as const, null)
const now = atom({ plugin: 'usage-rail', key: 'now' } as const, 0)

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

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'usage-rail',
      description: '세션 레일에 사용량(5시간·주간 한도, 컨텍스트, 비용) 패널을 엽니다',
    })

    if (e.isInteractive) {
      await refresh($).catch(() => undefined)
      $.clock.every(TICK_MS, () => {
        void $.clock.now().then(at => update($, now, () => at))
      })
      void $.ui.open({ id: PANE, title: TITLE })
    }

    return next(e)
  })

  on('command.run', { command: 'usage-rail' }, async $ => {
    await refresh($).catch(() => undefined)
    const opened = await $.ui.open({ id: PANE, title: TITLE })

    return {
      text: opened.isPlaced
        ? '사용량 패널을 열었습니다.'
        : `사용량 패널을 열지 못했습니다: ${opened.reason}`,
    }
  })

  on('session.measure', async ($, e, next) => {
    await refresh($, e)

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const shot = await read($, snapshot)
    const at = Math.max(await read($, now), shot?.measuredAt ?? 0)
    const width = Math.max(10, Math.min(36, e.props.bodyColumns - 7))

    const meter = (percent: number) => (
      <Box flexDirection="row" gap={1}>
        <Text mono color={tone(percent)}>
          {bar(percent, width)}
        </Text>
        <Text weight="semibold" tabular>
          {`${Math.round(percent)}%`}
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
            <Text weight="semibold">{LABELS[limit.kind] ?? limit.kind}</Text>
            {meter(limit.percentUsed)}
            {untilReset(limit.resetsAt, at) !== undefined && (
              <Text dimColor>{untilReset(limit.resetsAt, at)}</Text>
            )}
          </Box>
        ))
      )

    const context =
      shot?.contextPercent === undefined ? (
        <Text dimColor>첫 응답 이후에 표시됩니다.</Text>
      ) : (
        <Box flexDirection="column">
          {meter(shot.contextPercent)}
          <Text dimColor>
            {`${tokens(shot.contextTokens ?? 0)} / ${tokens(shot.contextWindow)} 토큰`}
          </Text>
        </Box>
      )

    return (
      <Box flexDirection="column" gap={1}>
        <Text size="heading" weight="bold">
          플랜 사용 한도
        </Text>
        <Box flexDirection="column" gap={1}>
          {limits}
        </Box>
        <Box flexDirection="column">
          <Text weight="semibold">컨텍스트</Text>
          {context}
        </Box>
        {shot?.costUsd !== undefined && (
          <Box flexDirection="row" gap={1}>
            <Text weight="semibold">세션 비용</Text>
            <Text tabular>{`$${shot.costUsd.toFixed(2)}`}</Text>
          </Box>
        )}
        <Box flexDirection="row" gap={1} alignItems="center">
          <Text dimColor>
            {shot === null ? '측정 전' : `갱신 ${ago(at - shot.measuredAt)}`}
          </Text>
          <Button key="refresh" label="새로고침" dimColor onPress={() => refresh($)} />
        </Box>
      </Box>
    )
  })
}
