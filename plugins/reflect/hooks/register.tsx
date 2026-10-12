import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Suggestion } from '../types'

const suggestion = atom({ plugin: 'reflect', key: 'suggestion' } as const, null as Suggestion | null)

const HEADER = '## Learned rules (Reflect)'

// Phrases that usually mean the person is correcting Claude.
const FEEDBACK = [
  /^\s*(no|nope|nah|wrong|stop|don'?t|do not|never|always|ugh|actually)\b/i,
  /\b(doesn'?t|does not|didn'?t) (look|work|feel) (good|right)\b/i,
  /\bi (wish|would rather|'d rather|prefer|told you|said)\b/i,
  /\b(instead of|rather than|not like that|that'?s not what|you should(n'?t)? have|please don'?t|stop (doing|using|adding))\b/i,
  /\b(from now on|next time|in (the )?future|every time|going forward)\b/i,
]

const SYSTEM = `You turn a user's correction of an AI coding assistant into one durable rule for its instructions file.
Write a single imperative sentence under 25 words, general enough to apply next time, with no preamble or quotes.
If the message is a one-off instruction rather than a lasting preference, reply with exactly SKIP.`

async function homeDir($: EngineInterface) {
  return (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '~'
}

async function appendRule($: EngineInterface, path: string, rule: string) {
  const exists = await $.fs.exists(path)
  const text = exists ? ((await $.fs.read(path)) as string) : ''
  const line = `- ${rule.replace(/^[-*]\s*/, '').trim()}`
  if (text.includes(line)) return
  const lines = text.split(/\r?\n/)
  const at = lines.findIndex(l => l.trim() === HEADER)
  if (at === -1) {
    const sep = text.length === 0 ? '' : text.endsWith('\n') ? '\n' : '\n\n'
    await $.fs.write(path, `${text}${sep}${HEADER}\n\n${line}\n`)
    return
  }
  let end = at + 1
  while (end < lines.length && (lines[end]!.trim() === '' || lines[end]!.trimStart().startsWith('- '))) end++
  while (end > at + 1 && lines[end - 1]!.trim() === '') end--
  lines.splice(end, 0, line)
  await $.fs.write(path, lines.join('\n'))
}

// The person's edit of the suggested rule; kept out of state so typing doesn't redraw the field.
let draft: string | undefined

async function save($: EngineInterface, where: 'project' | 'user') {
  const held = await read($, suggestion)
  const s = held && draft?.trim() ? { ...held, rule: draft.trim() } : held
  if (!s || !s.rule.trim()) return
  const path =
    where === 'project' ? `${(await $.session.cwd()).replace(/[\\/]$/, '')}/CLAUDE.md` : `${await homeDir($)}/.claude/CLAUDE.md`
  try {
    await appendRule($, path, s.rule)
    draft = undefined
    await update($, suggestion, v => (v ? { ...v, rule: s.rule, savedTo: path } : v))
    $.ui.toast(`Rule saved to ${path}`)
    $.clock.after(4000, () => void update($, suggestion, v => (v?.savedTo ? null : v)))
  } catch (err) {
    $.ui.toast(`Reflect could not write ${path}: ${String(err)}`)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'reflect', description: 'Reflect: save a rule to CLAUDE.md: /reflect <rule>', argumentHint: '<rule>' })
    return next(e)
  })

  on('command.run', { command: 'reflect' }, async ($, e) => {
    const rule = e.args.trim()
    if (!rule) return { text: 'Usage: /reflect <rule>. Reflect also offers this automatically when you correct Claude.' }
    await update($, suggestion, () => ({ feedback: rule, rule, savedTo: null }))
    return { text: 'Choose where to save it in the banner above the prompt.' }
  })

  on('prompt.submit', async ($, e, next) => {
    const result = await next(e)
    const kind = e.origin.kind
    const text = e.text.trim()
    if ((kind !== 'composer' && kind !== 'sdk' && kind !== 'bridge') || text.startsWith('/') || text.length > 1500) return result
    if (!FEEDBACK.some(re => re.test(text))) return result

    $.clock.after(0, () => {
      void (async () => {
        const messages = await $.session.messages().catch(() => [])
        const lastReply = [...messages].reverse().find(m => m.role === 'assistant')?.text ?? ''
        const reply = await $.model.complete({
          model: 'haiku',
          system: SYSTEM,
          prompt: `Assistant's previous reply (for context):\n${lastReply.slice(-3000)}\n\nUser's message:\n${text}`,
          maxTokens: 120,
          timeoutMs: 30000,
        })
        if (!reply.isAnswered) return
        const rule = reply.text.trim().split('\n')[0]!.replace(/^["'`-]\s*|["'`]$/g, '')
        if (!rule || /^SKIP\b/i.test(rule)) return
        draft = undefined
        await update($, suggestion, () => ({ feedback: text, rule, savedTo: null }))
      })()
    })
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, suggestion)
    if (!s || e.props.hasSurvey) return next(e)
    const { Box, Text, Button, Input } = $.ui.resolve(e)
    if (s.savedTo) {
      return (
        <Box>
          <Text color="success">🪞 Saved to {s.savedTo}</Text>
        </Box>
      )
    }
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="suggestion" paddingX={1}>
        <Text bold color="suggestion">
          🪞 Save this as a permanent rule?
        </Text>
        {Input ? (
          <Input
            key="rule"
            value={s.rule}
            submitLabel="Save to project"
            onInput={value => {
              draft = value
            }}
            onSubmit={value => {
              draft = value
              void save($, 'project')
            }}
          />
        ) : (
          <Text italic>{s.rule}</Text>
        )}
        <Box flexDirection="row" gap={2}>
          <Button key="project" label="Project CLAUDE.md" variant="primary" hotkey="p" onPress={() => save($, 'project')} />
          <Button key="user" label="User CLAUDE.md" hotkey="u" onPress={() => save($, 'user')} />
          <Button key="dismiss" label="Dismiss" role="dismiss" hotkey="d" onPress={() => {
              draft = undefined
              void update($, suggestion, () => null)
            }} />
        </Box>
      </Box>
    )
  })
}
