export type CacheSettings = { ttlMinutes: number; keepWarm: boolean; maxPings: number }

declare module 'claude-code' {
  interface PluginState {
    'cache-tax': { settings: CacheSettings }
  }
}
