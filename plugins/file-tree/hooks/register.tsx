import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { FileStatus, TrackedFile } from '../types'

const PANE = 'file-tree'
const files = atom({ plugin: 'file-tree', key: 'files' } as const, [] as TrackedFile[])
const root = atom({ plugin: 'file-tree', key: 'root' } as const, '')

const norm = (p: string) => p.replace(/\\/g, '/')

function relative(path: string, base: string): string {
  const p = norm(path)
  const b = norm(base).replace(/\/$/, '')
  return b && p.toLowerCase().startsWith(b.toLowerCase() + '/') ? p.slice(b.length + 1) : p
}

type Node = { name: string; dirs: Map<string, Node>; files: TrackedFile[] }

function buildTree(list: TrackedFile[], base: string): Node {
  const top: Node = { name: '', dirs: new Map(), files: [] }
  for (const f of list) {
    const parts = relative(f.path, base).split('/').filter(Boolean)
    let node = top
    for (const dir of parts.slice(0, -1)) {
      let child = node.dirs.get(dir)
      if (!child) node.dirs.set(dir, (child = { name: dir, dirs: new Map(), files: [] }))
      node = child
    }
    node.files.push(f)
  }
  return top
}

// Collapse single-child directory chains ("src/lib/utils/").
function flatten(node: Node, depth: number, out: Array<{ depth: number; dir?: string; file?: TrackedFile }>) {
  for (const [, child] of [...node.dirs].sort(([a], [b]) => a.localeCompare(b))) {
    let name = child.name
    let cur = child
    while (cur.files.length === 0 && cur.dirs.size === 1) {
      const [only] = [...cur.dirs.values()]
      name += '/' + only!.name
      cur = only!
    }
    out.push({ depth, dir: name })
    flatten(cur, depth + 1, out)
  }
  for (const f of [...node.files].sort((a, b) => a.path.localeCompare(b.path))) out.push({ depth, file: f })
}

const isActive = (s: FileStatus) => s === 'reading' || s === 'editing'

let ticker: { cancel: () => void } | undefined

async function touch($: EngineInterface, path: string, status: FileStatus) {
  const p = norm(path)
  await update($, files, list => {
    const found = list.find(f => f.path.toLowerCase() === p.toLowerCase())
    if (!found) return [...list, { path: p, status, wasCreated: false, touches: 1 }].slice(-300)
    return list.map(f => {
      if (f !== found) return f
      // A file once edited stays edited after a later read.
      const keep = (status === 'read' || status === 'reading') && (f.status === 'edited' || f.status === 'created')
      return { ...f, status: keep && status === 'read' ? f.status : status, touches: f.touches + 1 }
    })
  })
  if (isActive(status) && !ticker) ticker = $.clock.every(150, () => $.ui.invalidate('ui.render'))
  if (!isActive(status) && !(await read($, files)).some(f => isActive(f.status))) {
    ticker?.cancel()
    ticker = undefined
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const cwd = await $.session.cwd()
    await update($, root, () => cwd)
    await $.command.register({ name: 'files', description: 'Open the File Tree panel' })
    return next(e)
  })

  on('command.run', { command: 'files' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Files' })
    return { text: 'File Tree opened.' }
  })

  on('tool.call', async ($, e, next) => {
    let path: string | undefined
    let kind: 'read' | 'edit' | 'write' | undefined
    if (e.tool === 'Read') (path = e.file_path), (kind = 'read')
    else if (e.tool === 'Edit') (path = e.file_path), (kind = 'edit')
    else if (e.tool === 'Write') (path = e.file_path), (kind = 'write')
    else if (e.tool === 'NotebookEdit') (path = (e as { notebook_path?: string }).notebook_path), (kind = 'edit')

    if (path && kind) {
      let isNew = false
      if (kind === 'write') isNew = !(await $.fs.exists(path).catch(() => true))
      if ((await read($, files)).length === 0) void $.ui.open({ id: PANE, title: 'Files' })
      await touch($, path, kind === 'read' ? 'reading' : 'editing')
      const ran = await next(e)
      const failed = ran.deny !== undefined || ran.isError === true
      const p = norm(path)
      if (kind === 'read') await touch($, path, 'read')
      else if (failed) await touch($, path, 'read')
      else {
        await touch($, path, isNew ? 'created' : 'edited')
        if (isNew) await update($, files, list => list.map(f => (f.path === p ? { ...f, wasCreated: true } : f)))
      }
      return ran
    }

    if ((e.tool === 'Bash' || e.tool === 'PowerShell') && /\bgit\b[^\n|;&]*\bcommit\b/.test(e.command)) {
      const ran = await next(e)
      if (ran.deny === undefined && !ran.isError) {
        const base = await read($, root)
        const status = await $.process.run(['git', 'status', '--porcelain'], { cwd: base, timeoutMs: 10000 }).catch(() => undefined)
        const dirty = new Set(
          (status?.exitCode === 0 ? status.stdout : '')
            .split('\n')
            .map(l => l.slice(3).trim().replace(/^"|"$/g, '').toLowerCase())
            .filter(Boolean),
        )
        await update($, files, list =>
          list.map(f =>
            (f.status === 'edited' || f.status === 'created') && !dirty.has(relative(f.path, base).toLowerCase())
              ? { ...f, status: 'committed' as const }
              : f,
          ),
        )
      }
      return ran
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, files)
    const base = await read($, root)
    const now = await $.clock.now()
    const frame = Math.floor(now / 150)

    if (list.length === 0) return <Text dimColor>No files touched yet.</Text>

    const rows: Array<{ depth: number; dir?: string; file?: TrackedFile }> = []
    flatten(buildTree(list, base), 0, rows)
    const counts = {
      edited: list.filter(f => f.status === 'edited' || f.status === 'created' || f.status === 'editing').length,
      committed: list.filter(f => f.status === 'committed').length,
      read: list.filter(f => f.status === 'read' || f.status === 'reading').length,
    }
    const shimmer = ['#D97757', '#E89B7F', '#F5C4AE', '#E89B7F']
    const spin = ['◐', '◓', '◑', '◒']

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Text dimColor>
            {counts.edited} changed · {counts.committed} committed · {counts.read} read
          </Text>
          <Button key="clear" label="Clear" plain onPress={() => update($, files, () => [])} />
        </Box>
        {rows.map(row => {
          const pad = '  '.repeat(row.depth)
          if (row.dir) {
            return (
              <Text dimColor wrap="truncate-end">
                {pad}▾ {row.dir}/
              </Text>
            )
          }
          const f = row.file!
          const name = f.path.split('/').pop() ?? f.path
          if (isActive(f.status)) {
            const c = shimmer[frame % shimmer.length]!
            return (
              <Text color={c} bold wrap="truncate-end">
                {pad}
                {spin[frame % spin.length]} {name} {f.status === 'editing' ? '(editing)' : '(reading)'}
              </Text>
            )
          }
          const look: Record<string, [string, string, boolean]> = {
            read: ['○', 'subtle', true],
            edited: ['●', 'warning', false],
            created: ['✚', 'warning', false],
            committed: ['✓', 'success', false],
          }
          const [glyph, color, dim] = look[f.status] ?? ['○', 'subtle', true]
          return (
            <Text color={color} dimColor={dim} wrap="truncate-end">
              {pad}
              {glyph} {name}
            </Text>
          )
        })}
      </Box>
    )
  })
}
