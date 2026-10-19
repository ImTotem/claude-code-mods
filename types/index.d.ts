// One plan window: `five_hour` (세션 한도) or `seven_day` (매주).
export type UsageWindow = { kind: string; percent: number; resetsAt?: string }

// A dollar credit with an expiry, such as the cloud session credit.
export type UsageCredit = {
  label: string
  currency: string
  limit: number
  remaining: number
  percent: number
  endsAt?: string
}

export type UsageSnapshot = {
  windows: UsageWindow[]
  credit?: UsageCredit
  measuredAt: number
}

// The last read of the usage endpoint: its status, or why there was none.
export type UsageFetch = { at: number; status: number | null; error?: string }

declare module 'claude-code' {
  interface PluginState {
    'usage-rail': {
      snapshot: UsageSnapshot | null
      now: number
      lastFetch: UsageFetch | null
    }
  }
}
