export type Page = {
  url: string
  title: string
  markdown: string
  status: number
  error: string | null
  isLoading: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'terminal-browser': { page: Page | null; history: string[]; pageIndex: number }
  }
}
