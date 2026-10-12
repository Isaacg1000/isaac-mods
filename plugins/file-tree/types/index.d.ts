export type FileStatus = 'reading' | 'editing' | 'read' | 'edited' | 'created' | 'committed'

export type TrackedFile = { path: string; status: FileStatus; wasCreated: boolean; touches: number }

declare module 'claude-code' {
  interface PluginState {
    'file-tree': { files: TrackedFile[]; root: string }
  }
}
