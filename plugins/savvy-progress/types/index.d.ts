export type Todo = { id: string; content: string; status: 'pending' | 'in_progress' | 'completed' }

export type SubAgent = {
  id: string
  label: string
  kind: string
  model: string
  effort: string
  steps: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  lastContext: number
  usd: number
  todos: Todo[]
  status: 'running' | 'done' | 'failed'
  startedAt: number
  endedAt: number | null
}

export type Turn = {
  title: string
  prompt: string
  isTitled: boolean
  startedAt: number
  endedAt: number | null
  steps: number
  tools: number
  tokens: number
  usd: number
  isWorking: boolean
}

export type Mascot = { color: string; hat: string }

declare module 'claude-code' {
  interface PluginState {
    'savvy-progress': {
      todos: Todo[]
      agents: SubAgent[]
      turn: Turn | null
      mascots: Record<string, Mascot>
      isCollapsed: boolean
      isFinishedOpen: boolean
      isBandHidden: boolean
    }
  }
}
