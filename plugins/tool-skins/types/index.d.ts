export type SkinName = string

declare module 'claude-code' {
  interface PluginState {
    'tool-skins': { theme: SkinName }
  }
}
