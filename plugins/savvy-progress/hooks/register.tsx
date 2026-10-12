import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelUsage, Register } from 'claude-code'

import type { Mascot, SubAgent, Todo, Turn } from '../types'

const PANE = 'savvy-agents'
const todos = atom({ plugin: 'savvy-progress', key: 'todos' } as const, [] as Todo[])
const agents = atom({ plugin: 'savvy-progress', key: 'agents' } as const, [] as SubAgent[])
const turn = atom({ plugin: 'savvy-progress', key: 'turn' } as const, null as Turn | null)
const mascots = atom({ plugin: 'savvy-progress', key: 'mascots' } as const, {} as Record<string, Mascot>)
const isCollapsed = atom({ plugin: 'savvy-progress', key: 'isCollapsed' } as const, false)
const isFinishedOpen = atom({ plugin: 'savvy-progress', key: 'isFinishedOpen' } as const, true)
const isBandHidden = atom({ plugin: 'savvy-progress', key: 'isBandHidden' } as const, false)

// Colors picked to read on both the desktop app's dark theme and a terminal.
const C = {
  coral: '#E07A5F',
  green: '#3FB68B',
  blue: '#4A8FE7',
  amber: '#E8A33D',
  red: '#E0604F',
  magenta: '#C0508F',
  violet: '#8B7CF6',
  track: '#3A3A3A',
  crab: '#D97757',
}

// USD per million tokens, API list prices. An estimate: subscriptions are not billed per token.
const PRICES: Array<[RegExp, number, number]> = [
  [/haiku/i, 1, 5],
  [/sonnet/i, 3, 15],
  [/opus|fable/i, 5, 25],
]

function costOf(model: string, u: ModelUsage): number {
  const [, input, output] = PRICES.find(([re]) => re.test(model)) ?? [/./, 3, 15]
  return (
    (u.input_tokens * input +
      u.cache_creation_input_tokens * input * 1.25 +
      u.cache_read_input_tokens * input * 0.1 +
      u.output_tokens * output) /
    1_000_000
  )
}

const tokensOf = (u: ModelUsage) => u.input_tokens + u.output_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens

// "Opus 5.5" from "claude-opus-5-5[1m]".
function prettyModel(model: string): string {
  const m = model.match(/(opus|sonnet|haiku|fable)[-_]?(\d+)(?:[-.](\d+))?/i)
  if (!m) return model
  const name = m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1).toLowerCase()
  return m[3] ? `${name} ${m[2]}.${m[3]}` : `${name} ${m[2]}`
}

// Effort level -> the word and color the panel shows.
const EFFORT: Record<string, [string, string]> = {
  low: ['light', C.green],
  medium: ['medium', C.blue],
  high: ['careful', C.amber],
  xhigh: ['heavy', C.red],
  max: ['max', C.magenta],
}
const effortLook = (effort: string): [string, string] => EFFORT[effort] ?? ['', C.blue]

// Pixel crab, 12x9. b body, d shade, e eye, h hat, a accessory.
const CRAB = [
  '............',
  '............',
  '............',
  '..b.bbbbb.b.',
  '..bbbbbbbbb.',
  '.bbebbbbebbb',
  '.bbbbbbbbbbb',
  '..dbbbbbbbd.',
  '..b.b...b.b.',
]
const HATS: Record<string, string[]> = {
  beret: ['....hhhh....', '...hhhhhh...', '..hhhhhhhh..'],
  hardhat: ['............', '....hhhh....', '..hhhhhhhh..'],
  cap: ['............', '...hhhhh....', '...hhhhhhhh.'],
  crown: ['............', '...h.h.h.h..', '...hhhhhhh..'],
  headphones: ['............', '...hhhhhhh..', '..h.......h.'],
  wizard: ['.....h......', '....hhh.....', '...hhhhh....'],
  antenna: ['.........a..', '.........h..', '.........h..'],
  none: ['............', '............', '............'],
}

type Look = { color: string; hatColor: string; hat: string }

// Built-in looks, matched against the subagent's type and description.
const ROLES: Array<[RegExp, Look]> = [
  [/design|graphic|\bui\b|ux|css|style|visual|brand/i, { color: C.crab, hatColor: '#5B4A8A', hat: 'beret' }],
  [/review|test|qa|verify|check|audit/i, { color: C.crab, hatColor: '#E6C84A', hat: 'hardhat' }],
  [/explore|research|search|find|investigat|competitor/i, { color: C.crab, hatColor: '#E6C84A', hat: 'crown' }],
  [/plan|architect|strategy/i, { color: C.crab, hatColor: C.violet, hat: 'wizard' }],
  [/code|dev|implement|build|fix|page|engineer/i, { color: C.crab, hatColor: '#9AA0A6', hat: 'headphones' }],
]
const DEFAULT_LOOK: Look = { color: C.crab, hatColor: '#4FB3C9', hat: 'antenna' }

const NAMED: Record<string, string> = {
  red: '#D9534F', orange: '#E8893A', yellow: '#E6C84A', green: '#3F8F5A', teal: '#2AA198', cyan: '#4FB3C9',
  blue: '#4A7FD1', purple: '#7A5CC7', magenta: '#C0508F', pink: '#E27AA8', brown: '#8A5A3A', gray: '#888888', white: '#EEEEEE', black: '#222222',
}
const hex = (c: string) => NAMED[c.toLowerCase()] ?? c

function lookFor(text: string, custom: Record<string, Mascot>): Look {
  const t = text.toLowerCase()
  const mine = Object.entries(custom).find(([word]) => t.includes(word.toLowerCase()))?.[1]
  const role = ROLES.find(([re]) => re.test(t))?.[1] ?? DEFAULT_LOOK
  return mine ? { color: role.color, hatColor: hex(mine.color), hat: mine.hat in HATS ? mine.hat : role.hat } : role
}

function crabSvg(look: Look, isDim = false): string {
  const hat = HATS[look.hat] ?? HATS.none!
  const rows = [...hat, ...CRAB.slice(3)]
  const fill: Record<string, string> = { b: look.color, d: '#B85F43', e: '#1A1A1A', h: look.hatColor, a: '#F2F2F2' }
  let rects = ''
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      const f = fill[ch]
      if (f) rects += `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${f}"/>`
    }),
  )
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 9" shape-rendering="crispEdges"${isDim ? ' opacity="0.7"' : ''}>${rects}</svg>`
}

// A thin progress line, as SVG for the desktop app.
function barSvg(fraction: number, color: string): string {
  const w = Math.round(Math.max(0, Math.min(1, fraction)) * 1000)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 6" preserveAspectRatio="none"><rect width="1000" height="6" rx="3" fill="${C.track}"/><rect width="${w}" height="6" rx="3" fill="${color}"/></svg>`
}

// The band's track: dotted rail with a pill naming the current task.
function pillSvg(fraction: number, label: string): string {
  const W = 240
  const H = 22
  const pillW = Math.min(150, Math.max(70, label.length * 7.2 + 24))
  const x = Math.round(Math.max(0, Math.min(W - pillW, fraction * W - pillW / 2)))
  let dots = ''
  for (let i = 6; i < W; i += 7) {
    const y = 8 + ((i * 7) % 7)
    dots += `<circle cx="${i}" cy="${y}" r="1" fill="#6B6B8A"/><circle cx="${i + 3}" cy="${y + 5}" r="0.8" fill="#55556E"/>`
  }
  const safe = label.replace(/[<>&"]/g, '')
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">` +
    `<rect width="${W}" height="${H}" rx="11" fill="#26263A"/>${dots}` +
    `<rect x="${x}" y="1" width="${pillW}" height="${H - 2}" rx="10" fill="${C.violet}"/>` +
    `<text x="${x + pillW / 2}" y="15" text-anchor="middle" font-family="system-ui, sans-serif" font-size="12" font-weight="600" fill="#FFFFFF">${safe}</text></svg>`
  )
}

const fmtTokens = (n: number) => (n >= 1_000_000 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`)
const fmtTime = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
const textBar = (fraction: number, width: number) => {
  const filled = Math.round(Math.max(0, Math.min(1, fraction)) * width)
  return ['━'.repeat(filled), '━'.repeat(width - filled)] as const
}

function todosFrom(tool: string, input: Record<string, unknown>, result: unknown, list: Todo[], fallbackId: string): Todo[] | undefined {
  if (tool === 'TodoWrite') {
    const items = (input.todos as Array<{ content: string; status: Todo['status'] }>) ?? []
    return items.map((t, i) => ({ id: `todo-${i}`, content: t.content, status: t.status }))
  }
  if (tool === 'TaskCreate') {
    const id = (result as { task?: { id: string } } | undefined)?.task?.id ?? fallbackId
    return [...list, { id, content: String(input.subject ?? ''), status: 'pending' }]
  }
  if (tool === 'TaskUpdate') {
    const id = String(input.taskId)
    if (input.status === 'deleted') return list.filter(t => t.id !== id)
    return list.map(t =>
      t.id === id
        ? { ...t, status: (input.status as Todo['status'] | undefined) ?? t.status, content: (input.subject as string | undefined) ?? t.content }
        : t,
    )
  }
  return undefined
}

function progressOf(a: SubAgent): number {
  if (a.status !== 'running') return 1
  if (a.todos.length > 0) return a.todos.filter(t => t.status === 'completed').length / a.todos.length
  return Math.min(0.9, a.steps / 25)
}

// Overall progress: the main task list, else the agents' average.
function overall(plan: Todo[], subs: SubAgent[]): number {
  if (plan.length > 0) return plan.filter(t => t.status === 'completed').length / plan.length
  if (subs.length > 0) return subs.reduce((s, a) => s + progressOf(a), 0) / subs.length
  return 0
}

// One short name for the run ("Launch kit"), from Haiku; the prompt's opening words until then.
async function nameTheRun($: EngineInterface) {
  const t = await read($, turn)
  if (!t || t.isTitled) return
  await update($, turn, v => (v ? { ...v, isTitled: true } : v))
  const reply = await $.model.complete({
    model: 'haiku',
    system: 'Name the task in 2 or 3 words, Sentence case, no punctuation or quotes. Reply with the name only.',
    prompt: t.prompt.slice(0, 2000),
    maxTokens: 20,
    timeoutMs: 15000,
  })
  const name = reply.isAnswered ? reply.text.trim().split('\n')[0]!.replace(/["'.]/g, '').slice(0, 32) : ''
  if (name) await update($, turn, v => (v ? { ...v, title: name } : v))
}

// What the main thread is doing now, for the band's pill when there is no task list.
function activityOf(tool: string): string {
  if (/^(Read|NotebookRead)/.test(tool)) return 'Reading'
  if (/^(Edit|MultiEdit|NotebookEdit)$/.test(tool)) return 'Editing'
  if (tool === 'Write') return 'Writing'
  if (/^(Bash|PowerShell|Monitor)$/.test(tool)) return 'Running'
  if (/^(Glob|Grep|ToolSearch|LSP)$/.test(tool)) return 'Searching'
  if (/^Web/.test(tool)) return 'Browsing'
  if (/^(Agent|Task|Workflow)$/.test(tool)) return 'Delegating'
  if (/^(TodoWrite|Task[A-Z])/.test(tool)) return 'Planning'
  if (/^mcp__/.test(tool)) return 'Connecting'
  return 'Working'
}

async function openPane($: EngineInterface) {
  await $.ui.open({ id: PANE, title: 'Agents', columns: 46 })
}

let ticker: { cancel: () => void } | undefined

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'savvy', description: 'Open or close the Savvy Progress agents panel' })
    await $.command.register({
      name: 'crab-style',
      description: 'Customize agent crabs: /crab-style <keyword> <hat color> <hat>',
      argumentHint: `<keyword> <color> <${Object.keys(HATS).join('|')}>`,
    })
    const saved = (await $.store.get('mascots')) as Record<string, Mascot> | undefined
    if (saved) await update($, mascots, () => saved)
    return next(e)
  })

  on('command.run', { command: 'savvy' }, async $ => {
    const pane = (await $.ui.panes()).find(p => p.id === PANE)
    if (pane?.isShown) {
      await $.ui.close({ id: PANE })
      return { text: 'Agents panel closed.' }
    }
    await openPane($)
    return { text: 'Agents panel opened.' }
  })

  on('command.run', { command: 'crab-style' }, async ($, e) => {
    const [word, color, hat = 'cap'] = e.args.trim().split(/\s+/)
    if (!word || !color) {
      const current = await read($, mascots)
      const list = Object.entries(current).map(([k, m]) => `${k}: ${m.color} ${m.hat}`).join(', ') || 'none'
      return { text: `Usage: /crab-style <keyword> <color> <hat>. Hats: ${Object.keys(HATS).join(', ')}. Custom styles: ${list}` }
    }
    if (!(hat in HATS)) return { text: `Unknown hat "${hat}". Pick one of: ${Object.keys(HATS).join(', ')}` }
    const next = await update($, mascots, m => ({ ...m, [word]: { color, hat } }))
    await $.store.set('mascots', next)
    return { text: `Agents matching "${word}" now wear a ${color} ${hat}.` }
  })

  on('turn.start', async ($, e, next) => {
    const now = await $.clock.now()
    const prompt = e.text.replace(/^\/\S+\s*/, '')
    const title = prompt.split(/[.\n:!?,]/)[0]!.trim().split(/\s+/).slice(0, 4).join(' ') || 'Working'
    await update($, turn, () => ({ title, prompt, isTitled: false, startedAt: now, endedAt: null, steps: 0, tools: 0, tokens: 0, usd: 0, activity: 'Thinking', isWorking: true }))
    await update($, todos, list => (list.length > 0 && list.every(t => t.status === 'completed') ? [] : list))
    await update($, agents, list => list.filter(a => a.status === 'running'))
    await update($, isBandHidden, () => false)
    ticker?.cancel()
    ticker = $.clock.every(250, () => $.ui.invalidate('ui.render'))
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const id = e.agentId
    if (id && e.effort !== undefined) {
      const effort = String(e.effort)
      await update($, agents, list => list.map(a => (a.id === id && !a.effort ? { ...a, effort } : a)))
    }
    const result = yield* next(e)
    const usage = result.usage
    if (usage) {
      const usd = costOf(usage.model, usage)
      if (id) {
        await update($, agents, list =>
          list.map(a =>
            a.id === id
              ? {
                  ...a,
                  steps: a.steps + 1,
                  model: usage.model,
                  input: a.input + usage.input_tokens,
                  output: a.output + usage.output_tokens,
                  cacheRead: a.cacheRead + usage.cache_read_input_tokens,
                  cacheWrite: a.cacheWrite + usage.cache_creation_input_tokens,
                  lastContext: usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens,
                  usd: a.usd + usd,
                }
              : a,
          ),
        )
      } else {
        await update($, turn, t => (t ? { ...t, steps: t.steps + 1, usd: t.usd + usd, tokens: t.tokens + tokensOf(usage) } : t))
      }
    }
    return result
  })

  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    if (result.deny === undefined) {
      const agent: SubAgent = {
        id: result.agentId ?? e.tool_use_id,
        label: e.description || e.name || e.subagentType,
        kind: e.subagentType,
        model: result.model,
        effort: '',
        steps: 0,
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        lastContext: 0,
        usd: 0,
        todos: [],
        status: 'running',
        startedAt: await $.clock.now(),
        endedAt: null,
      }
      await update($, agents, list => [...list.filter(a => a.id !== agent.id), agent].slice(-40))
      $.clock.after(0, () => void nameTheRun($))
      if ((await read($, agents)).filter(a => a.status === 'running').length >= 2) void openPane($)
    }
    return result
  })

  on('tool.call', async ($, e, next) => {
    if (!e.agentId) await update($, turn, t => (t ? { ...t, tools: t.tools + 1, activity: activityOf(e.tool) } : t))
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError) return ran
    const input = e as unknown as Record<string, unknown>
    if (e.agentId) {
      const id = e.agentId
      const current = (await read($, agents)).find(a => a.id === id)
      const nextTodos = current && todosFrom(e.tool, input, ran.result, current.todos, e.tool_use_id)
      if (nextTodos) await update($, agents, list => list.map(a => (a.id === id ? { ...a, todos: nextTodos } : a)))
    } else {
      const nextTodos = todosFrom(e.tool, input, ran.result, await read($, todos), e.tool_use_id)
      if (nextTodos) await update($, todos, () => nextTodos)
    }
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const now = await $.clock.now()
    if (e.agentId) {
      const id = e.agentId
      const status = e.reason === 'error' || e.isAborted ? ('failed' as const) : ('done' as const)
      await update($, agents, list => list.map(a => (a.id === id ? { ...a, status, endedAt: now } : a)))
    } else {
      await update($, turn, t => (t ? { ...t, isWorking: false, endedAt: now } : t))
    }
    if (!(await read($, turn))?.isWorking && !(await read($, agents)).some(a => a.status === 'running')) {
      ticker?.cancel()
      ticker = undefined
    }
    return next(e)
  })

  // The band above the prompt: ● title  [track with the current task]  75%  crab ×4  ✕
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const t = await read($, turn)
    const plan = await read($, todos)
    const subs = await read($, agents)
    const running = subs.filter(a => a.status === 'running')
    const isActive = (t?.isWorking ?? false) || running.length > 0
    if (e.props.hasSurvey || !isActive || (await read($, isBandHidden))) return next(e)

    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const Svg = 'Svg' in els ? els.Svg : undefined
    const custom = await read($, mascots)
    const now = await $.clock.now()

    // With no task list and no agents there is nothing to measure: sweep instead.
    const isMeasured = plan.length > 0 || subs.length > 0
    const sweep = 1 - Math.abs(((now / 2500) % 2) - 1)
    const fraction = isMeasured ? overall(plan, subs) : sweep
    const done = plan.filter(x => x.status === 'completed').length
    const current = plan.find(x => x.status === 'in_progress') ?? plan.find(x => x.status === 'pending')
    const word = (current?.content ?? running[0]?.label ?? t?.activity ?? 'Working').split(/\s+/)[0]!.replace(/[^\p{L}\p{N}-]/gu, '')
    const label = plan.length > 0 ? `${word} ${Math.min(done + 1, plan.length)}/${plan.length}` : word
    const pct = isMeasured ? `${Math.round(fraction * 100)}%` : fmtTime(now - (t?.startedAt ?? now))
    const crab = lookFor(running[0]?.label ?? '', custom)

    const track = Svg ? (
      <Svg source={pillSvg(fraction, label)} alt={`${label}, ${pct}`} width={240} height={22} />
    ) : (
      (() => {
        const width = Math.max(10, Math.min(28, e.props.bodyColumns - 40))
        const pos = Math.round(fraction * width)
        return (
          <Box flexDirection="row">
            <Text color="#55556E">{'·'.repeat(Math.max(0, pos))}</Text>
            <Text backgroundColor={C.violet} color="#FFFFFF" bold>
              {' '}
              {label}{' '}
            </Text>
            <Text color="#55556E">{'·'.repeat(Math.max(0, width - pos))}</Text>
          </Box>
        )
      })()
    )

    return (
      <Box flexDirection="row" alignItems="center" gap={2}>
        <Box flexDirection="row" gap={1}>
          <Text color={C.violet}>●</Text>
          <Text bold wrap="truncate-end">
            {t?.title ?? 'Working'}
          </Text>
        </Box>
        {track}
        <Text dimColor>{pct}</Text>
        {subs.length > 0 && (
          <Box flexDirection="row" alignItems="center" gap={1}>
            {Svg ? <Svg source={crabSvg(crab)} alt="agents" width={24} height={18} /> : <Text color={C.crab}>▟█▙</Text>}
            <Button key="open-agents" label={`×${subs.length}`} plain onPress={() => void openPane($)} />
          </Box>
        )}
        <Button key="hide-band" label="✕" plain role="dismiss" onPress={() => update($, isBandHidden, () => true)} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const Svg = 'Svg' in els ? els.Svg : undefined
    const subs = await read($, agents)
    const plan = await read($, todos)
    const t = await read($, turn)
    const custom = await read($, mascots)
    const collapsed = await read($, isCollapsed)
    const finishedOpen = await read($, isFinishedOpen)
    const now = await $.clock.now()
    const cols = Math.max(24, e.props.bodyColumns)

    const totalUsd = subs.reduce((s, a) => s + a.usd, 0) + (t?.usd ?? 0)
    const totalTokens = subs.reduce((s, a) => s + a.input + a.output + a.cacheRead + a.cacheWrite, 0) + (t?.tokens ?? 0)
    const elapsed = t ? (t.endedAt ?? now) - t.startedAt : 0

    const running = subs.filter(a => a.status === 'running').reverse()
    const finished = subs.filter(a => a.status !== 'running').reverse()
    const taken = (content: string) =>
      subs.some(a => a.label.toLowerCase().includes(content.toLowerCase()) || content.toLowerCase().includes(a.label.toLowerCase()))
    const planned = plan.filter(p => p.status === 'pending' && !taken(p.content))

    const divider = <Text color={C.track}>{'─'.repeat(cols)}</Text>

    const tile = (key: string, label: string, value: string) => (
      <Box key={key} flexDirection="column" flexGrow={1} backgroundColor="#2A2A2A" paddingX={1}>
        <Text color="#9A9A9A">{label}</Text>
        <Text bold>{value}</Text>
      </Box>
    )

    const row = (a: SubAgent) => {
      const isRunning = a.status === 'running'
      const look = lookFor(`${a.kind} ${a.label}`, custom)
      const [effortWord, effortColor] = effortLook(a.effort)
      const done = a.todos.filter(x => x.status === 'completed').length
      const activeTodo = a.todos.find(x => x.status === 'in_progress')
      const progress =
        a.todos.length > 0
          ? `${done}/${a.todos.length}${isRunning && activeTodo ? ` · ${activeTodo.content}` : ''}`
          : isRunning
            ? `step ${a.steps}`
            : `${a.steps}/${a.steps}`
      const ctxPct = Math.max(0, Math.round((a.lastContext / (a.lastContext > 200_000 || /1m/i.test(a.model) ? 1_000_000 : 200_000)) * 100))
      const tokens = a.input + a.output + a.cacheRead + a.cacheWrite
      const metrics = `ctx ${ctxPct}% · ${fmtTokens(tokens)} ≈$${a.usd.toFixed(2)} ${fmtTime((a.endedAt ?? now) - a.startedAt)}`
      const mark =
        a.status === 'failed' ? <Text color={C.red}>✗</Text> : isRunning ? <Text color={C.coral}>●</Text> : <Text color={C.green}>✓</Text>
      const frac = progressOf(a)
      const [barOn, barOff] = textBar(frac, Math.max(8, cols - 8))

      const sprite = Svg ? (
        <Svg source={crabSvg(look)} alt={`${a.label} crab`} width={40} height={30} />
      ) : (
        <Box flexDirection="column" width={6}>
          <Text color={look.hatColor}> ▄▄▄ </Text>
          <Text color={look.color}>▐▛█▜▌</Text>
          <Text color={look.color}> ▘ ▝ </Text>
        </Box>
      )

      if (collapsed) {
        return (
          <Box key={`agent-${a.id}`} flexDirection="row" justifyContent="space-between" gap={1}>
            <Text bold wrap="truncate-end">
              {a.label}
            </Text>
            <Box flexDirection="row" gap={1}>
              <Text dimColor>{progress.split(' · ')[0]}</Text>
              {mark}
            </Box>
          </Box>
        )
      }

      return (
        <Box key={`agent-${a.id}`} flexDirection="column">
          <Box flexDirection="row" gap={1} alignItems="center">
            <Box width={6} flexShrink={0} alignItems="center">
              {sprite}
            </Box>
            <Box flexDirection="column" flexGrow={1} flexShrink={1}>
              <Box flexDirection="row" justifyContent="space-between" gap={1}>
                <Text bold wrap="truncate-end">
                  {a.label}
                </Text>
                {mark}
              </Box>
              <Box flexDirection="row" gap={1}>
                {effortWord && <Text color={effortColor}>{effortWord}</Text>}
                <Text color="#9A9A9A">
                  {prettyModel(a.model)}
                  {a.effort ? ` · ${a.effort}` : ''}
                </Text>
              </Box>
              <Box flexDirection="row" justifyContent="space-between" gap={1}>
                <Text wrap="truncate-end">{progress}</Text>
                <Text color="#9A9A9A">{metrics}</Text>
              </Box>
              {Svg ? (
                <Svg source={barSvg(frac, effortColor)} alt={`${Math.round(frac * 100)}% done`} height={4} />
              ) : (
                <Box flexDirection="row">
                  <Text color={effortColor}>{barOn}</Text>
                  <Text color={C.track}>{barOff}</Text>
                </Box>
              )}
            </Box>
          </Box>
        </Box>
      )
    }

    const list = (items: SubAgent[]) =>
      items.map((a, i) => (
        <Box key={`wrap-${a.id}`} flexDirection="column">
          {row(a)}
          {i < items.length - 1 && !collapsed && divider}
        </Box>
      ))

    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>{t?.title ?? 'Agents'}</Text>
        <Box flexDirection="row" gap={1}>
          {tile('cost', 'Cost', `≈$${totalUsd.toFixed(2)}`)}
          {tile('tokens', 'Tokens', fmtTokens(totalTokens))}
          {tile('time', 'Time', fmtTime(elapsed))}
        </Box>
        <Box flexDirection="row" justifyContent="space-between">
          <Button key="collapse" label={collapsed ? 'Expand' : 'Collapse'} plain onPress={() => update($, isCollapsed, v => !v)} />
          {finished.length > 0 && (
            <Button key="clear" label="Clear finished" plain onPress={() => update($, agents, l => l.filter(a => a.status === 'running'))} />
          )}
        </Box>

        {subs.length === 0 && planned.length === 0 && (
          <Text color="#9A9A9A">No agents yet. Helpers Claude starts show up here. Restyle their crabs with /crab-style.</Text>
        )}

        {running.length > 0 && (
          <Box flexDirection="column">
            <Text color="#9A9A9A">Running · {running.length}</Text>
            {list(running)}
          </Box>
        )}

        {finished.length > 0 && (
          <Box flexDirection="column">
            {running.length > 0 && divider}
            <Button
              key="toggle-finished"
              label={`${finishedOpen ? '▾' : '▸'} Finished · ${finished.length}`}
              plain
              onPress={() => update($, isFinishedOpen, v => !v)}
            />
            {finishedOpen && list(finished)}
          </Box>
        )}

        {planned.length > 0 && (
          <Box flexDirection="column">
            {divider}
            <Text color="#9A9A9A">Planned · {planned.length}</Text>
            {planned.map(p => (
              <Box key={`plan-${p.id}`} flexDirection="row" justifyContent="space-between">
                <Text color="#9A9A9A" wrap="truncate-end">
                  {plan.indexOf(p) + 1}. {p.content}
                </Text>
                <Text color="#9A9A9A">◷</Text>
              </Box>
            ))}
          </Box>
        )}
      </Box>
    )
  })
}
