import { atom, read, update } from 'claude-code'
import type { ModelUsage, Register } from 'claude-code'

import type { Mascot, SubAgent, Todo, Turn } from '../types'

const PANE = 'savvy-agents'
const todos = atom({ plugin: 'savvy-progress', key: 'todos' } as const, [] as Todo[])
const agents = atom({ plugin: 'savvy-progress', key: 'agents' } as const, [] as SubAgent[])
const turn = atom({ plugin: 'savvy-progress', key: 'turn' } as const, null as Turn | null)
const mascots = atom({ plugin: 'savvy-progress', key: 'mascots' } as const, {} as Record<string, Mascot>)
const isCollapsed = atom({ plugin: 'savvy-progress', key: 'isCollapsed' } as const, false)

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

const EFFORT: Record<string, [string, string]> = {
  low: ['light', 'success'],
  medium: ['medium', 'suggestion'],
  high: ['careful', 'warning'],
  xhigh: ['thorough', 'magenta'],
  max: ['max', 'error'],
}
const effortLook = (effort: string): [string, string] => EFFORT[effort] ?? (effort ? [effort, 'subtle'] : ['', 'subtle'])

// Pixel crab, 10x8. b body, e eye, h hat.
const CRAB = ['..........', '..........', '.b.bbbb.b.', '.bbbbbbbb.', 'bbebbbbebb', '.bbbbbbbb.', '..bbbbbb..', '.b.b..b.b.']
const HAT_PIXELS: Record<string, [string, string]> = {
  beret: ['...hhhh...', '..hhhhhh..'],
  hardhat: ['...hhhh...', '.hhhhhhhh.'],
  crown: ['...h.h.h..', '...hhhhh..'],
  headphones: ['..hhhhhh..', '.h......h.'],
  wizard: ['....hh....', '...hhhh...'],
  cap: ['..hhhh....', '..hhhhhhh.'],
  none: ['..........', '..........'],
}
const HAT_TEXT: Record<string, string> = {
  beret: '  ▄▆▄  ',
  hardhat: ' ▄███▄ ',
  crown: ' ▚▞▚▞▚ ',
  headphones: ' ╭───╮ ',
  wizard: '   ▲   ',
  cap: ' ▄▄▄▖  ',
  none: '       ',
}

type Look = { color: string; hatColor: string; hat: string }

// Built-in looks, matched against the subagent's type and description.
const ROLES: Array<[RegExp, Look]> = [
  [/design|graphic|ui\b|ux|css|style|visual/i, { color: '#c06a8f', hatColor: '#5b4a8a', hat: 'beret' }],
  [/review|test|qa|verify|check|audit/i, { color: '#c98a3a', hatColor: '#e6c84a', hat: 'hardhat' }],
  [/explore|research|search|find|investigat/i, { color: '#b5763f', hatColor: '#3f8f5a', hat: 'cap' }],
  [/plan|architect|strategy/i, { color: '#5f8fb5', hatColor: '#7a5cc7', hat: 'wizard' }],
  [/code|dev|implement|build|fix|page|general/i, { color: '#D97757', hatColor: '#2f9e6a', hat: 'cap' }],
]
const DEFAULT_LOOK: Look = { color: '#D97757', hatColor: '#D97757', hat: 'none' }

const NAMED: Record<string, string> = {
  red: '#d9534f', orange: '#e8893a', yellow: '#e6c84a', green: '#3f8f5a', teal: '#2aa198', cyan: '#4fb3c9',
  blue: '#4a7fd1', purple: '#7a5cc7', magenta: '#c0508f', pink: '#e27aa8', brown: '#8a5a3a', gray: '#888888', white: '#eeeeee', black: '#222222',
}
const hex = (c: string) => NAMED[c.toLowerCase()] ?? c

function lookFor(agent: SubAgent, custom: Record<string, Mascot>): Look {
  const text = `${agent.kind} ${agent.label}`.toLowerCase()
  const mine = Object.entries(custom).find(([word]) => text.includes(word.toLowerCase()))?.[1]
  const role = ROLES.find(([re]) => re.test(text))?.[1] ?? DEFAULT_LOOK
  return mine ? { color: role.color, hatColor: hex(mine.color), hat: mine.hat in HAT_PIXELS ? mine.hat : role.hat } : role
}

function crabSvg(look: Look, isDim: boolean): string {
  const [h0, h1] = HAT_PIXELS[look.hat] ?? HAT_PIXELS.none!
  const rows = [h0, h1, ...CRAB.slice(2)]
  const colors: Record<string, string> = { b: look.color, e: '#1a1a1a', h: look.hatColor }
  let rects = ''
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      const fill = colors[ch]
      if (fill) rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}"/>`
    }),
  )
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 8" shape-rendering="crispEdges" opacity="${isDim ? 0.55 : 1}">${rects}</svg>`
}

const fmtTokens = (n: number) => (n >= 1_000_000 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`)
const fmtTime = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
const bar = (fraction: number, width: number) => {
  const filled = Math.round(Math.max(0, Math.min(1, fraction)) * width)
  return ['━'.repeat(filled), '━'.repeat(width - filled)] as const
}

function todosFrom(tool: string, input: Record<string, unknown>, result: unknown, list: Todo[], fallbackId: string): Todo[] | undefined {
  if (tool === 'TodoWrite') {
    const items = (input.todos as Array<{ content: string; activeForm?: string; status: Todo['status'] }>) ?? []
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

let ticker: { cancel: () => void } | undefined

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'savvy', description: 'Open or close the Savvy Progress agents panel' })
    await $.command.register({
      name: 'crab-style',
      description: 'Customize agent crabs: /crab-style <keyword> <hat color> <hat>',
      argumentHint: '<keyword> <color> <beret|hardhat|crown|headphones|wizard|cap|none>',
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
    await $.ui.open({ id: PANE, title: 'Agents', columns: 48 })
    return { text: 'Agents panel opened.' }
  })

  on('command.run', { command: 'crab-style' }, async ($, e) => {
    const [word, color, hat = 'cap'] = e.args.trim().split(/\s+/)
    if (!word || !color) {
      const current = await read($, mascots)
      const list = Object.entries(current).map(([k, m]) => `${k}: ${m.color} ${m.hat}`).join(', ') || 'none'
      return { text: `Usage: /crab-style <keyword> <color> <hat>. Hats: ${Object.keys(HAT_PIXELS).join(', ')}. Custom styles: ${list}` }
    }
    if (!(hat in HAT_PIXELS)) return { text: `Unknown hat "${hat}". Pick one of: ${Object.keys(HAT_PIXELS).join(', ')}` }
    const next = await update($, mascots, m => ({ ...m, [word]: { color, hat } }))
    await $.store.set('mascots', next)
    return { text: `Agents matching "${word}" now wear a ${color} ${hat}.` }
  })

  on('turn.start', async ($, e, next) => {
    const now = await $.clock.now()
    const title = e.text.replace(/^\/\S+\s*/, '').split(/[.\n:!?]/)[0]!.trim().slice(0, 40) || 'Agents'
    await update($, turn, () => ({ title, startedAt: now, endedAt: null, steps: 0, tools: 0, tokens: 0, usd: 0, isWorking: true }))
    await update($, todos, list => (list.length > 0 && list.every(t => t.status === 'completed') ? [] : list))
    await update($, agents, list => list.filter(a => a.status === 'running'))
    ticker?.cancel()
    ticker = $.clock.every(500, () => $.ui.invalidate('ui.render'))
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
      if ((await read($, agents)).filter(a => a.status === 'running').length >= 2) {
        void $.ui.open({ id: PANE, title: 'Agents', columns: 48 })
      }
    }
    return result
  })

  on('tool.call', async ($, e, next) => {
    if (!e.agentId) await update($, turn, t => (t ? { ...t, tools: t.tools + 1 } : t))
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

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const t = await read($, turn)
    const list = await read($, todos)
    const subs = await read($, agents)
    const running = subs.filter(a => a.status === 'running')
    if (e.props.hasSurvey || ((!t || !t.isWorking) && running.length === 0)) return next(e)

    const { Box, Text, Button } = $.ui.resolve(e)
    const now = await $.clock.now()
    const width = Math.max(10, Math.min(32, e.props.bodyColumns - 52))
    const done = list.filter(x => x.status === 'completed').length
    const active = list.find(x => x.status === 'in_progress')

    if (list.length === 0) {
      // No task list: an indeterminate sweep.
      const pos = Math.floor(now / 120) % (width * 2)
      const head = pos < width ? pos : width * 2 - pos - 1
      const cells = Array.from({ length: width }, (_, i) => Math.abs(i - head) <= 1)
      return (
        <Box flexDirection="row" gap={1}>
          <Text color="claude">savvy-progress</Text>
          <Box flexDirection="row">
            {cells.map(lit => (
              <Text color={lit ? 'claude' : 'subtle'}>━</Text>
            ))}
          </Box>
          <Text dimColor>
            {t ? `${t.steps} steps · ${fmtTime(now - t.startedAt)}` : ''}
            {running.length > 0 ? ` · ${running.length} agents` : ''}
          </Text>
          {subs.length > 0 && <Button key="open-agents" label="Agents" plain onPress={() => void $.ui.open({ id: PANE, title: 'Agents', columns: 48 })} />}
        </Box>
      )
    }
    const [filled, empty] = bar(done / list.length, width)
    const subUsd = subs.reduce((s, a) => s + a.usd, 0)
    return (
      <Box flexDirection="row" gap={1}>
        <Text color="claude">savvy-progress</Text>
        <Box flexDirection="row">
          <Text color="success">{filled}</Text>
          <Text color="subtle">{empty}</Text>
        </Box>
        <Text wrap="truncate-end">
          Tasks {done}/{list.length}
          {active ? ` · ${active.content}` : ''}
        </Text>
        {t && <Text dimColor>· ≈${(t.usd + subUsd).toFixed(2)}</Text>}
        {subs.length > 0 && <Button key="open-agents" label="Agents" plain onPress={() => void $.ui.open({ id: PANE, title: 'Agents', columns: 48 })} />}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const Svg = e.surface === 'desktop' || e.surface === 'mobile' ? (els as { Svg?: typeof els.Box }).Svg : undefined
    const subs = await read($, agents)
    const plan = await read($, todos)
    const t = await read($, turn)
    const custom = await read($, mascots)
    const collapsed = await read($, isCollapsed)
    const now = await $.clock.now()
    const frame = Math.floor(now / 400) % 2
    const cols = Math.max(24, e.props.bodyColumns)
    const barWidth = Math.max(10, cols - 4)

    const totalUsd = subs.reduce((s, a) => s + a.usd, 0) + (t?.usd ?? 0)
    const totalTokens = subs.reduce((s, a) => s + a.input + a.output + a.cacheRead + a.cacheWrite, 0) + (t?.tokens ?? 0)
    const elapsed = t ? (t.endedAt ?? now) - t.startedAt : 0

    // Planned: the main task list's pending items no agent has taken yet.
    const taken = (content: string) => subs.some(a => a.label.toLowerCase().includes(content.toLowerCase()) || content.toLowerCase().includes(a.label.toLowerCase()))
    const planned = plan.filter(p => p.status === 'pending' && !taken(p.content))

    const tile = (key: string, label: string, value: string) => (
      <Box key={key} flexDirection="column" flexGrow={1} borderStyle="round" borderColor="subtle" paddingX={1}>
        <Text dimColor>{label}</Text>
        <Text bold>{value}</Text>
      </Box>
    )

    const ordered = [...subs.filter(a => a.status === 'running').reverse(), ...subs.filter(a => a.status !== 'running').reverse()]

    const card = (a: SubAgent) => {
      const look = lookFor(a, custom)
      const isRunning = a.status === 'running'
      const [effortLabel, effortColor] = effortLook(a.effort)
      const done = a.todos.filter(x => x.status === 'completed').length
      const activeTodo = a.todos.find(x => x.status === 'in_progress')
      const progressText = a.todos.length > 0 ? `${done}/${a.todos.length}${activeTodo && isRunning ? ` · ${activeTodo.content}` : ''}` : isRunning ? `step ${a.steps}` : `${a.steps} steps`
      const ctxPct = Math.round((a.lastContext / (a.lastContext > 200_000 || /1m/i.test(a.model) ? 1_000_000 : 200_000)) * 100)
      const tokens = a.input + a.output + a.cacheRead + a.cacheWrite
      const [barOn, barOff] = bar(progressOf(a), barWidth - 2)
      const mark = isRunning ? <Text color="success">●</Text> : a.status === 'done' ? <Text color="success">✓</Text> : <Text color="error">✗</Text>

      const sprite = Svg ? (
        <Svg source={crabSvg(look, !isRunning)} alt={`${a.label} crab`} width={30} height={24} />
      ) : (
        <Box flexDirection="column">
          <Text color={look.hatColor}>{HAT_TEXT[look.hat] ?? HAT_TEXT.none}</Text>
          <Text color={look.color}> ▐▛█▜▌ </Text>
          <Text color={look.color}>{isRunning && frame ? '  ▝ ▘  ' : '  ▘ ▝  '}</Text>
        </Box>
      )

      if (collapsed) {
        return (
          <Box key={`agent-${a.id}`} flexDirection="row" gap={1}>
            {mark}
            <Text bold={isRunning} dimColor={!isRunning} wrap="truncate-end">
              {a.label}
            </Text>
            <Text dimColor>{progressText.split(' · ')[0]}</Text>
          </Box>
        )
      }

      return (
        <Box
          key={`agent-${a.id}`}
          flexDirection="column"
          borderStyle="round"
          borderColor={isRunning ? 'claude' : 'subtle'}
          borderDimColor={!isRunning}
          paddingX={1}
        >
          <Box flexDirection="row" gap={1}>
            {sprite}
            <Box flexDirection="column" flexGrow={1} flexShrink={1}>
              <Box flexDirection="row" justifyContent="space-between">
                <Text bold={isRunning} dimColor={!isRunning} wrap="truncate-end">
                  {a.label}
                </Text>
                {mark}
              </Box>
              <Box flexDirection="row" gap={1}>
                {effortLabel && <Text color={effortColor}>{effortLabel}</Text>}
                <Text dimColor>
                  {prettyModel(a.model)}
                  {a.effort ? ` · ${a.effort}` : ''}
                </Text>
              </Box>
            </Box>
          </Box>
          <Box flexDirection="row" justifyContent="space-between" gap={1}>
            <Text dimColor={!isRunning} wrap="truncate-end">
              {progressText}
            </Text>
            <Text dimColor>
              ctx {ctxPct}% · {fmtTokens(tokens)} ≈${a.usd.toFixed(2)} {fmtTime((a.endedAt ?? now) - a.startedAt)}
            </Text>
          </Box>
          <Box flexDirection="row">
            <Text color={isRunning ? 'success' : look.color} dimColor={!isRunning}>
              {barOn}
            </Text>
            <Text color="subtle">{barOff}</Text>
          </Box>
        </Box>
      )
    }

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
          {subs.some(a => a.status !== 'running') && (
            <Button key="clear" label="Clear finished" plain onPress={() => update($, agents, list => list.filter(a => a.status === 'running'))} />
          )}
        </Box>
        {ordered.length === 0 && planned.length === 0 && (
          <Text dimColor>No agents yet. They appear here as Claude spawns helpers. Restyle them with /crab-style.</Text>
        )}
        {ordered.map(card)}
        {planned.length > 0 && (
          <Box flexDirection="column">
            <Text dimColor>Planned · {planned.length}</Text>
            {planned.map((p, i) => (
              <Box key={`plan-${p.id}`} flexDirection="row" justifyContent="space-between">
                <Text dimColor wrap="truncate-end">
                  {plan.indexOf(p) + 1 || i + 1}. {p.content}
                </Text>
                <Text dimColor>◷</Text>
              </Box>
            ))}
          </Box>
        )}
      </Box>
    )
  })
}
