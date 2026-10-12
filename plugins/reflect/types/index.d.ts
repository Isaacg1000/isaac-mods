export type Suggestion = { feedback: string; rule: string; savedTo: string | null }

declare module 'claude-code' {
  interface PluginState {
    reflect: { suggestion: Suggestion | null }
  }
}
