import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Blast } from '../types'

const PANE = 'blast-radius'
const pending = atom({ plugin: 'blast-radius', key: 'pending' } as const, null as Blast | null)

const MAX_LISTED = 400
const MAX_WALK = 5000

type Danger = { reason: string; kind: 'paths'; targets: string[] } | { reason: string; kind: 'git-clean'; args: string[] } | { reason: string; kind: 'git-discard' }

// Split on shell separators, then into words (quotes respected, no expansion).
function segments(command: string): string[][] {
  return command
    .split(/&&|\|\||[;|\n]/)
    .map(seg => (seg.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map(w => w.replace(/^["']|["']$/g, '')))
    .filter(ws => ws.length > 0)
}

function classify(command: string): Danger[] {
  const found: Danger[] = []
  for (const raw of segments(command)) {
    const words = raw[0] === 'sudo' ? raw.slice(1) : raw
    const cmd = (words[0] ?? '').toLowerCase()
    const flags = words.slice(1).filter(w => /^-/.test(w) || /^\/[a-zA-Z]$/.test(w))
    const args = words.slice(1).filter(w => !flags.includes(w))
    const has = (re: RegExp) => flags.some(f => re.test(f))

    if (cmd === 'rm' && (has(/^-[a-zA-Z]*[rR]/) || has(/^--recursive$/))) {
      found.push({ reason: 'rm -r/-f', kind: 'paths', targets: args })
    } else if (/^(remove-item|ri|rm|del|erase|rd|rmdir)$/.test(cmd) && has(/^-r(ecurse)?$/i)) {
      found.push({ reason: 'Remove-Item -Recurse', kind: 'paths', targets: args.filter(a => !/^-/.test(a)) })
    } else if (/^(rd|rmdir|del|erase)$/.test(cmd) && has(/^\/s$/i)) {
      found.push({ reason: `${cmd} /s`, kind: 'paths', targets: args })
    } else if (cmd === 'find' && words.includes('-delete')) {
      found.push({ reason: 'find -delete', kind: 'paths', targets: args.slice(0, 1) })
    } else if (cmd === 'git' && words[1] === 'clean' && has(/^-[a-zA-Z]*f/)) {
      found.push({ reason: 'git clean -f', kind: 'git-clean', args: words.slice(2) })
    } else if (cmd === 'git' && words[1] === 'reset' && words.includes('--hard')) {
      found.push({ reason: 'git reset --hard', kind: 'git-discard' })
    } else if (cmd === 'git' && (words[1] === 'checkout' || words[1] === 'restore') && (words.includes('.') || words.includes('--'))) {
      found.push({ reason: `git ${words[1]} (discards changes)`, kind: 'git-discard' })
    }
  }
  return found
}

const join = (base: string, p: string) =>
  /^([a-zA-Z]:[\\/]|[\\/])/.test(p) ? p : `${base.replace(/[\\/]$/, '')}/${p.replace(/^\.[\\/]/, '')}`

async function measure($: EngineInterface, dangers: Danger[], command: string): Promise<Blast> {
  const cwd = await $.session.cwd()
  const blast: Blast = { command, reason: dangers.map(d => d.reason).join(', '), files: [], fileCount: 0, dirCount: 0, bytes: 0, isTruncated: false, notes: [] }
  const add = (path: string, size: number) => {
    blast.fileCount += 1
    blast.bytes += size
    if (blast.files.length < MAX_LISTED) blast.files.push(path.replace(/\\/g, '/'))
    else blast.isTruncated = true
  }
  let walked = 0
  const walk = async (dir: string): Promise<void> => {
    blast.dirCount += 1
    const entries = await $.fs.list(dir).catch(() => [])
    for (const entry of entries) {
      if (++walked > MAX_WALK) {
        blast.isTruncated = true
        return
      }
      const full = `${dir.replace(/[\\/]$/, '')}/${entry.name}`
      if (entry.kind === 'dir' && !entry.isLink) await walk(full)
      else add(full, entry.size)
    }
  }

  for (const d of dangers) {
    if (d.kind === 'paths') {
      if (d.targets.length === 0) blast.notes.push(`${d.reason}: no explicit target`)
      for (const t of d.targets) {
        if (/[*?[\]$`~]/.test(t)) {
          blast.notes.push(`pattern not expanded: ${t}`)
          continue
        }
        const full = join(cwd, t)
        const st = await $.fs.stat(full).catch(() => undefined)
        if (!st) blast.notes.push(`does not exist: ${t}`)
        else if (st.kind === 'dir' && !st.isLink) await walk(full)
        else add(full, st.size)
        if (/^([a-zA-Z]:[\\/]?|\/|~|\.|\.\.)$/.test(t.replace(/[\\/]$/, ''))) blast.notes.push(`⚠ targets a root or the whole working directory: ${t}`)
      }
    } else if (d.kind === 'git-clean') {
      const dry = d.args.map(a => (/^-[a-zA-Z]*f/.test(a) ? a.replace(/f/g, '') : a)).filter(a => a !== '-')
      const out = await $.process.run(['git', 'clean', '-n', ...dry], { cwd, timeoutMs: 15000 }).catch(() => undefined)
      for (const line of (out?.stdout ?? '').split('\n')) {
        const m = line.match(/^Would remove (.+)$/)
        if (m) add(m[1]!, 0)
      }
      if (!out) blast.notes.push('could not run git clean -n to preview')
    } else {
      const out = await $.process.run(['git', 'status', '--porcelain'], { cwd, timeoutMs: 15000 }).catch(() => undefined)
      for (const line of (out?.stdout ?? '').split('\n')) {
        if (line.length > 3 && !line.startsWith('??')) add(`${line.slice(3)} (uncommitted changes lost)`, 0)
      }
      if (!out) blast.notes.push('could not run git status to preview')
    }
  }
  return blast
}

const fmtBytes = (n: number) => (n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n > 1e3 ? `${(n / 1e3).toFixed(1)} KB` : `${n} B`)

export const register: Register = on => {
  on('tool.call', async ($, e, next) => {
    if (e.tool !== 'Bash' && e.tool !== 'PowerShell') return next(e)
    const command = e.command
    const dangers = classify(command)
    if (dangers.length === 0) return next(e)

    const blast = await measure($, dangers, command)
    await update($, pending, () => blast)
    await $.ui.open({ id: PANE, title: 'Blast Radius' })

    const what =
      blast.fileCount > 0
        ? `${blast.fileCount}${blast.isTruncated ? '+' : ''} file(s)${blast.bytes ? `, ${fmtBytes(blast.bytes)}` : ''}`
        : 'an unknown set of files'
    let answer = 'Cancel'
    try {
      answer = await $.ui.ask(`Blast Radius: "${command.slice(0, 80)}" would affect ${what}. See the Blast Radius pane. Proceed?`, {
        header: 'Blast Radius',
        options: ['Cancel', 'Proceed'],
      })
    } catch {
      answer = 'Cancel'
    }
    await update($, pending, () => null)
    await $.ui.close({ id: PANE })

    if (answer !== 'Proceed') {
      return { deny: `Blast Radius: the user cancelled "${command.slice(0, 120)}" (${blast.reason}, ${what}). Do not retry it another way without asking.` }
    }
    return next(e)
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'Blast Radius: its safety check failed, so the command was blocked.' }))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const b = await read($, pending)
    if (!b) return <Text dimColor>No destructive command pending.</Text>
    const room = Math.max(5, (e.viewport?.rows ?? 30) - 12)
    return (
      <Box flexDirection="column">
        <Text bold color="error">
          ⚠ Destructive command intercepted ({b.reason})
        </Text>
        <Box borderStyle="round" borderColor="error" paddingX={1}>
          <Text wrap="wrap">{b.command}</Text>
        </Box>
        <Text>
          {b.fileCount}
          {b.isTruncated ? '+' : ''} file(s) in {b.dirCount} folder(s){b.bytes ? ` · ${fmtBytes(b.bytes)}` : ''} would be gone:
        </Text>
        {b.files.slice(0, room).map(f => (
          <Text color="diffRemoved" wrap="truncate-start">
            − {f}
          </Text>
        ))}
        {b.files.length > room && <Text dimColor>…and {b.fileCount - room} more</Text>}
        {b.notes.map(n => (
          <Text color="warning">{n}</Text>
        ))}
        <Text dimColor>Answer Proceed or Cancel in the dialog.</Text>
      </Box>
    )
  })
}
