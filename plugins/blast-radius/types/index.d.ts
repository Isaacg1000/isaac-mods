export type Blast = {
  command: string
  reason: string
  files: string[]
  fileCount: number
  dirCount: number
  bytes: number
  isTruncated: boolean
  notes: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'blast-radius': { pending: Blast | null }
  }
}
