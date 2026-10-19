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
    'usage-rail': {
      snapshot: UsageSnapshot | null
      now: number
      // The person closed the pane by hand; it stays closed until /usage-rail.
      isDismissed: boolean
      // The pane could not be placed and the person was told once.
      isWarned: boolean
    }
  }
}
