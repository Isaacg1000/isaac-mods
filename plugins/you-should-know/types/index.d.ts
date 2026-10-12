export type Flags = { turnId: string; items: string[] }

declare module 'claude-code' {
  interface PluginState {
    'you-should-know': {
      flags: Flags | null
      isChecking: boolean
      focus: string
      isEnabled: boolean
    }
  }
}
