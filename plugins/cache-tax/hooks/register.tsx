import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CacheSettings } from '../types'

const settings = atom(
  { plugin: 'cache-tax', key: 'settings' } as const,
  { ttlMinutes: 60, keepWarm: false, maxPings: 8 } as CacheSettings,
)

const PING = '[keep-warm ping] Reply with only the word: ok'
// Below this many context tokens a cold start is cheap; don't interrupt.
const MIN_TOKENS = 20_000
const CONFIRM_WINDOW_MS = 3 * 60_000

// USD per million input tokens, API list prices. An estimate only.
const INPUT_PRICE: Array<[RegExp, number]> = [
  [/haiku/i, 1],
  [/sonnet/i, 3],
  [/opus|fable/i, 5],
]
const priceOf = (model: string) => INPUT_PRICE.find(([re]) => re.test(model))?.[1] ?? 3

const fmtTok = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : `${Math.round(n / 1000)}k`)

let lastActivity = 0
let lastContext = 0
let isWorking = false
let pings = 0
let pending: { text: string; at: number } | undefined

async function save($: EngineInterface) {
  await $.store.set('settings', await read($, settings))
}

async function refreshStatus($: EngineInterface) {
  if (lastActivity === 0) return $.ui.status(undefined)
  const s = await read($, settings)
  const left = s.ttlMinutes * 60_000 - ((await $.clock.now()) - lastActivity)
  const warm = s.keepWarm ? ' · keepwarm' : ''
  $.ui.status(left > 0 ? `cache warm · ${Math.ceil(left / 60_000)}m left${warm}` : `cache cold${warm}`)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const saved = (await $.store.get('settings')) as Partial<CacheSettings> | undefined
    if (saved) await update($, settings, s => ({ ...s, ...saved }))
    await $.command.register({
      name: 'keepwarm',
      description: 'Cache Tax: ping the session just before the prompt cache goes cold (on/off)',
      argumentHint: 'on | off',
    })
    await $.command.register({
      name: 'cachetax',
      description: 'Cache Tax: show cache state, or set the TTL: /cachetax ttl <minutes>',
      argumentHint: 'ttl <minutes> | pings <n>',
    })
    $.clock.every(60_000, () => {
      void (async () => {
        await refreshStatus($)
        const s = await read($, settings)
        if (!s.keepWarm || isWorking || lastActivity === 0 || pings >= s.maxPings) return
        const idle = (await $.clock.now()) - lastActivity
        const ttl = s.ttlMinutes * 60_000
        // Fire inside the last four minutes before expiry.
        if (idle > ttl - 4 * 60_000 && idle < ttl) {
          pings += 1
          await $.prompt.submit({ text: PING })
        }
      })()
    })
    return next(e)
  })

  on('command.run', { command: 'keepwarm' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const current = await read($, settings)
    const keepWarm = arg === 'off' ? false : arg === 'on' ? true : !current.keepWarm
    await update($, settings, s => ({ ...s, keepWarm }))
    await save($)
    pings = 0
    await refreshStatus($)
    return {
      text: keepWarm
        ? `Keep-warm on: up to ${current.maxPings} tiny pings, each just before the ${current.ttlMinutes}-minute cache expires.`
        : 'Keep-warm off.',
    }
  })

  on('command.run', { command: 'cachetax' }, async ($, e) => {
    const [key, value] = e.args.trim().split(/\s+/)
    const n = Number(value)
    if (key === 'ttl' && n > 0) await update($, settings, s => ({ ...s, ttlMinutes: n }))
    else if (key === 'pings' && n >= 0) await update($, settings, s => ({ ...s, maxPings: n }))
    await save($)
    const s = await read($, settings)
    const idle = lastActivity ? Math.round(((await $.clock.now()) - lastActivity) / 60_000) : 0
    return {
      text: `TTL ${s.ttlMinutes}m · keep-warm ${s.keepWarm ? 'on' : 'off'} (max ${s.maxPings} pings) · idle ${idle}m · context ≈${fmtTok(lastContext)} tokens`,
    }
  })

  on('turn.start', async ($, e, next) => {
    isWorking = true
    if (e.text !== PING) pings = 0
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    if (!e.agentId && result.usage) {
      const u = result.usage
      lastContext = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens + u.output_tokens
      lastActivity = await $.clock.now()
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      isWorking = false
      lastActivity = await $.clock.now()
      await refreshStatus($)
    }
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const kind = e.origin.kind
    if (e.text === PING || (kind !== 'composer' && kind !== 'sdk' && kind !== 'bridge') || lastActivity === 0) return next(e)
    const s = await read($, settings)
    const now = await $.clock.now()
    const idle = now - lastActivity
    if (idle < s.ttlMinutes * 60_000) return next(e)

    const usage = await $.session.usage().catch(() => undefined)
    const tokens = usage?.context.tokens ?? lastContext
    if (tokens < MIN_TOKENS) return next(e)

    if (pending && pending.text === e.text && now - pending.at < CONFIRM_WINDOW_MS) {
      pending = undefined
      return next(e)
    }

    const price = priceOf(await $.session.model())
    const writeRate = s.ttlMinutes >= 60 ? 2 : 1.25
    const cold = (tokens * price * writeRate) / 1e6
    const warm = (tokens * price * 0.1) / 1e6
    const minutes = Math.round(idle / 60_000)
    pending = { text: e.text, at: now }
    const text = e.text
    // Put the prompt back in the composer so Enter sends it.
    $.clock.after(30, () => void $.prompt.fill({ text, mode: 'replace' }))
    return {
      drop:
        `Cache Tax: the prompt cache went cold ${minutes}m ago. Sending re-reads ~${fmtTok(tokens)} tokens ` +
        `(≈$${cold.toFixed(2)} API-equivalent vs ≈$${warm.toFixed(2)} warm, and more of your usage limit). ` +
        `Press Enter again within 3 minutes to send anyway, or /compact first to shrink it. Tip: /keepwarm.`,
    }
  }).catch(($, e, next) => next(e))
}
