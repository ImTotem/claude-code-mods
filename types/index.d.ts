export type UsageLimit = { kind: string; percentUsed: number; resetsAt?: string }

export type UsageSnapshot = {
  limits: UsageLimit[]
  contextTokens?: number
  contextWindow: number
  contextPercent?: number
  costUsd?: number
  measuredAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'usage-rail': { snapshot: UsageSnapshot | null; now: number }
  }
}
