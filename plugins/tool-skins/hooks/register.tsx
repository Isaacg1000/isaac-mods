import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

type Kind = 'read' | 'edit' | 'write' | 'run' | 'search' | 'web' | 'agent' | 'task' | 'mcp' | 'other'
type Theme = { label: string; colors: Record<Kind, string>; error: string; icons: Record<Kind, string>; editBorder: string }

const GLYPHS: Record<Kind, string> = {
  read: '◫', edit: '✎', write: '✚', run: '❯', search: '⌕', web: '◍', agent: '✦', task: '☰', mcp: '⇄', other: '•',
}
const EMOJI: Record<Kind, string> = {
  read: '📖', edit: '✏️', write: '📝', run: '⚡', search: '🔍', web: '🌐', agent: '🤖', task: '📋', mcp: '🔌', other: '🔧',
}

const THEMES: Record<string, Theme> = {
  'tokyo-night': {
    label: 'Tokyo Night',
    colors: { read: '#7aa2f7', edit: '#e0af68', write: '#9ece6a', run: '#bb9af7', search: '#7dcfff', web: '#2ac3de', agent: '#ff9e64', task: '#73daca', mcp: '#b4f9f8', other: '#a9b1d6' },
    error: '#f7768e', icons: GLYPHS, editBorder: '#e0af68',
  },
  nord: {
    label: 'Nord',
    colors: { read: '#88c0d0', edit: '#ebcb8b', write: '#a3be8c', run: '#b48ead', search: '#8fbcbb', web: '#81a1c1', agent: '#d08770', task: '#5e81ac', mcp: '#8fbcbb', other: '#d8dee9' },
    error: '#bf616a', icons: GLYPHS, editBorder: '#ebcb8b',
  },
  dracula: {
    label: 'Dracula',
    colors: { read: '#8be9fd', edit: '#f1fa8c', write: '#50fa7b', run: '#bd93f9', search: '#8be9fd', web: '#ff79c6', agent: '#ffb86c', task: '#50fa7b', mcp: '#ff79c6', other: '#f8f8f2' },
    error: '#ff5555', icons: GLYPHS, editBorder: '#ff79c6',
  },
  gruvbox: {
    label: 'Gruvbox',
    colors: { read: '#83a598', edit: '#fabd2f', write: '#b8bb26', run: '#d3869b', search: '#8ec07c', web: '#83a598', agent: '#fe8019', task: '#8ec07c', mcp: '#d3869b', other: '#ebdbb2' },
    error: '#fb4934', icons: GLYPHS, editBorder: '#fabd2f',
  },
  solarized: {
    label: 'Solarized',
    colors: { read: '#268bd2', edit: '#b58900', write: '#859900', run: '#6c71c4', search: '#2aa198', web: '#268bd2', agent: '#cb4b16', task: '#2aa198', mcp: '#d33682', other: '#93a1a1' },
    error: '#dc322f', icons: GLYPHS, editBorder: '#b58900',
  },
  catppuccin: {
    label: 'Catppuccin Mocha',
    colors: { read: '#89b4fa', edit: '#f9e2af', write: '#a6e3a1', run: '#cba6f7', search: '#94e2d5', web: '#74c7ec', agent: '#fab387', task: '#94e2d5', mcp: '#f5c2e7', other: '#cdd6f4' },
    error: '#f38ba8', icons: EMOJI, editBorder: '#f9e2af',
  },
  'rose-pine': {
    label: 'Rose Pine',
    colors: { read: '#9ccfd8', edit: '#f6c177', write: '#31748f', run: '#c4a7e7', search: '#9ccfd8', web: '#ebbcba', agent: '#eb6f92', task: '#31748f', mcp: '#ebbcba', other: '#e0def4' },
    error: '#eb6f92', icons: EMOJI, editBorder: '#ebbcba',
  },
}
const NAMES = Object.keys(THEMES)

function kindOf(tool: string): Kind {
  if (/^mcp__/.test(tool)) return 'mcp'
  if (/^(Read|NotebookRead|ListMcpResourcesTool|ReadMcpResource)/.test(tool)) return 'read'
  if (/^(Edit|MultiEdit|NotebookEdit)$/.test(tool)) return 'edit'
  if (tool === 'Write') return 'write'
  if (/^(Bash|PowerShell|Monitor)$/.test(tool)) return 'run'
  if (/^(Glob|Grep|ToolSearch|LSP)$/.test(tool)) return 'search'
  if (/^Web/.test(tool)) return 'web'
  if (/^(Agent|Task|Workflow|SendMessage)$/.test(tool)) return 'agent'
  if (/^(TodoWrite|Task[A-Z])/.test(tool)) return 'task'
  return 'other'
}

const theme = atom({ plugin: 'tool-skins', key: 'theme' } as const, 'tokyo-night')

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'skin',
      description: 'Switch the Claude Skins theme (no argument lists them)',
      argumentHint: `<${NAMES.join('|')}|off>`,
    })
    const saved = await $.store.get('theme')
    if (typeof saved === 'string' && (saved in THEMES || saved === 'off')) await update($, theme, () => saved)
    return next(e)
  })

  on('command.run', { command: 'skin' }, async ($, e) => {
    const wanted = e.args.trim().toLowerCase()
    const current = await read($, theme)
    if (!wanted) {
      const rows = NAMES.map(n => `${n === current ? '▸' : ' '} ${n} (${THEMES[n]!.label})`).join('\n')
      return { text: `Themes:\n${rows}\n  off\nUse /skin <name>.` }
    }
    if (!(wanted in THEMES) && wanted !== 'off') return { text: `No theme "${wanted}". Try: ${NAMES.join(', ')}, off` }
    await update($, theme, () => wanted)
    await $.store.set('theme', wanted)
    return { text: wanted === 'off' ? 'Skins off.' : `Skin set to ${THEMES[wanted]!.label}.` }
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const t = THEMES[await read($, theme)]
    if (!t) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const kind = kindOf(e.props.tool)
    const color = e.props.isErrored ? t.error : t.colors[kind]
    const icon = e.props.isErrored ? '✗' : t.icons[kind]
    const inner = await next(e)
    const isEdit = kind === 'edit' || kind === 'write'
    return (
      <Box flexDirection="row">
        <Box width={3} flexShrink={0}>
          <Text color={color} bold={e.props.isRunning}>
            {icon}
          </Text>
        </Box>
        {isEdit ? (
          <Box flexGrow={1} flexShrink={1} flexDirection="column" borderStyle="round" borderColor={t.editBorder} paddingX={1}>
            {inner}
          </Box>
        ) : (
          <Box flexGrow={1} flexShrink={1} flexDirection="column">
            {inner}
          </Box>
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const t = THEMES[await read($, theme)]
    if (!t) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const kind: Kind = e.props.mode === 'tool-use' ? 'run' : e.props.mode === 'thinking' ? 'agent' : 'read'
    return (
      <Box flexDirection="row">
        <Box width={3} flexShrink={0}>
          <Text color={t.colors[kind]}>{t.icons[kind]}</Text>
        </Box>
        {await next(e)}
      </Box>
    )
  })
}
