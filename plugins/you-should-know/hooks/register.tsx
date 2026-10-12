import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Flags } from '../types'

const flags = atom({ plugin: 'you-should-know', key: 'flags' } as const, null as Flags | null)
const isChecking = atom({ plugin: 'you-should-know', key: 'isChecking' } as const, false)
const focus = atom({ plugin: 'you-should-know', key: 'focus' } as const, '')
const isEnabled = atom({ plugin: 'you-should-know', key: 'isEnabled' } as const, true)

// Replies shorter than this are easy to read in full; skip the side agent.
const MIN_CHARS = 600

const SYSTEM = `You are a second reader watching an AI assistant's reply to its user. The user often skims long replies.
Flag ONLY things the user would regret missing, such as:
- money or usage costs, paid API calls, pricing
- irreversible, destructive or risky actions taken or proposed
- security or privacy concerns, secrets, credentials
- decisions or actions the user must take themselves
- failures, skipped steps, unverified claims, caveats buried in the text
Reply with at most 3 lines, each starting with "- " and under 22 words, most important first.
If nothing qualifies, reply with exactly NONE.`

export const register: Register = on => {
  let lastPrompt = ''

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'ysk',
      description: 'You Should Know: /ysk on | off | focus <what to watch for> | show',
      argumentHint: 'on | off | focus <text> | show',
    })
    const saved = (await $.store.get('settings')) as { focus?: string; isEnabled?: boolean } | undefined
    if (saved?.focus) await update($, focus, () => saved.focus ?? '')
    if (saved?.isEnabled === false) await update($, isEnabled, () => false)
    return next(e)
  })

  on('command.run', { command: 'ysk' }, async ($, e) => {
    const [verb = '', ...rest] = e.args.trim().split(/\s+/)
    if (verb === 'on' || verb === 'off') {
      await update($, isEnabled, () => verb === 'on')
    } else if (verb === 'focus') {
      await update($, focus, () => rest.join(' '))
    } else if (verb === 'show') {
      const f = await read($, flags)
      return { text: f ? f.items.join('\n') : 'Nothing flagged yet.' }
    } else {
      const f = await read($, focus)
      const enabled = await read($, isEnabled)
      return { text: `You Should Know is ${enabled ? 'on' : 'off'}. Extra focus: ${f || '(none)'}.\nUsage: /ysk on | off | focus <text> | show` }
    }
    await $.store.set('settings', { focus: await read($, focus), isEnabled: await read($, isEnabled) })
    return { text: verb === 'focus' ? `Now also watching for: ${rest.join(' ') || '(defaults only)'}` : `You Should Know ${verb}.` }
  })

  on('turn.start', async ($, e, next) => {
    lastPrompt = e.text
    await update($, flags, () => null)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId || e.isAborted || e.answer.length < MIN_CHARS || !(await read($, isEnabled))) return result

    const answer = e.answer
    const turnId = e.turnId
    const prompt = lastPrompt
    // Run after this dispatch so the turn is never held up by the side agent.
    $.clock.after(0, () => {
      void (async () => {
        await update($, isChecking, () => true)
        try {
          const extra = await read($, focus)
          const reply = await $.model.complete({
            model: 'haiku',
            system: extra ? `${SYSTEM}\nThe user especially cares about: ${extra}` : SYSTEM,
            prompt: `The user asked:\n${prompt.slice(0, 2000)}\n\nThe assistant replied:\n${answer.slice(0, 24000)}`,
            maxTokens: 300,
            timeoutMs: 45000,
          })
          if (!reply.isAnswered) return
          const items = reply.text
            .split('\n')
            .map(l => l.trim())
            .filter(l => l.startsWith('- '))
            .map(l => l.slice(2))
            .slice(0, 3)
          if (items.length === 0 || /^NONE\b/.test(reply.text.trim())) return
          await update($, flags, () => ({ turnId, items }))
          $.ui.toast(`You should know: ${items[0]}`, { timeoutMs: 6000 })
        } finally {
          await update($, isChecking, () => false)
        }
      })()
    })
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const f = await read($, flags)
    const checking = await read($, isChecking)
    if (e.props.hasSurvey || e.props.isWorking || (!f && !checking)) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    if (!f) {
      return (
        <Box>
          <Text dimColor>💡 skimming the reply for anything you should know…</Text>
        </Box>
      )
    }
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="warning" paddingX={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold color="warning">
            💡 You should know
          </Text>
          <Button key="dismiss" label="Dismiss" role="dismiss" plain onPress={() => update($, flags, () => null)} />
        </Box>
        {f.items.map(item => (
          <Text wrap="wrap">• {item}</Text>
        ))}
      </Box>
    )
  })
}
