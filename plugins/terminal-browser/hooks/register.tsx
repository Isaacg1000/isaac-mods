import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Page } from '../types'
import { titleOf, toMarkdown } from './html.ts'

const PANE = 'browser'
const page = atom({ plugin: 'terminal-browser', key: 'page' } as const, null as Page | null)
const history = atom({ plugin: 'terminal-browser', key: 'history' } as const, [] as string[])
const pageIndex = atom({ plugin: 'terminal-browser', key: 'pageIndex' } as const, 0)

const isLocalPath = (s: string) => /^([a-zA-Z]:[\\/]|\/|\.{1,2}[\\/]|~[\\/])/.test(s) || /\.(html?|md|txt)$/i.test(s)

function normalize(input: string): string {
  const s = input.trim()
  if (/^(https?|file):\/\//i.test(s)) return s
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?/i.test(s)) return `http://${s}`
  if (isLocalPath(s)) return s
  return `https://${s}`
}

async function load($: EngineInterface, target: string): Promise<Page> {
  const url = normalize(target)
  try {
    if (/^file:\/\//i.test(url) || isLocalPath(url)) {
      let path = url.replace(/^file:\/\/\/?/i, '')
      if (/^[a-zA-Z]:/.test(path) === false && !path.startsWith('/')) path = `${await $.session.cwd()}/${path}`
      const text = (await $.fs.read(decodeURIComponent(path))) as string
      const isHtml = /\.html?$/i.test(path) || /^\s*<(!doctype|html)/i.test(text)
      return {
        url: path.replace(/\\/g, '/'),
        title: isHtml ? titleOf(text) || path : path,
        markdown: isHtml ? toMarkdown(text, `file:///${path.replace(/\\/g, '/')}`) : text,
        status: 200,
        error: null,
        isLoading: false,
      }
    }
    const res = await $.http.fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Claude Code terminal-browser)', Accept: 'text/html,text/plain,*/*' } })
    const type = res.headers['content-type'] ?? res.headers['Content-Type'] ?? ''
    const isHtml = /html/i.test(type) || /^\s*<(!doctype|html)/i.test(res.text)
    const isJson = /json/i.test(type)
    return {
      url,
      title: isHtml ? titleOf(res.text) || url : url,
      markdown: isHtml ? toMarkdown(res.text, url) : isJson ? '```json\n' + res.text.slice(0, 60_000) + '\n```' : res.text.slice(0, 80_000),
      status: res.status,
      error: res.ok ? null : `HTTP ${res.status}`,
      isLoading: false,
    }
  } catch (err) {
    return { url, title: url, markdown: '', status: 0, error: String(err), isLoading: false }
  }
}

async function navigate($: EngineInterface, target: string, isBack = false) {
  const prev = await read($, page)
  await update($, page, p => ({ ...(p ?? { title: '', markdown: '', status: 0, error: null }), url: normalize(target), isLoading: true }))
  const opened = await $.ui.open({ id: PANE, title: 'Browser', columns: 100 })
  const loaded = await load($, target)
  if (!isBack && prev && prev.url !== loaded.url) await update($, history, h => [...h, prev.url].slice(-50))
  await update($, pageIndex, () => 0)
  await update($, page, () => loaded)
  if (opened.isPlaced) await $.ui.open({ id: PANE, title: loaded.title.slice(0, 40) || 'Browser' })
  return loaded
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'browse',
      description: 'Open a URL, GitHub PR or local HTML file in the browser pane',
      argumentHint: '<url | path>',
    })
    await $.tool.register({
      name: 'open_page',
      description:
        "Open a web page, GitHub pull request, localhost dev server or local HTML/Markdown file in the user's browser pane beside the chat so they can review it without leaving Claude Code. Returns the page title and a short text excerpt.",
      inputSchema: {
        type: 'object',
        properties: { url: { type: 'string', description: 'An http(s) URL, localhost:port, file:// URL or a local file path' } },
        required: ['url'],
      },
      isDeferred: false,
    })
    return next(e)
  })

  on('command.run', { command: 'browse' }, async ($, e) => {
    const target = e.args.trim()
    if (!target) {
      const p = await read($, page)
      await $.ui.open({ id: PANE, title: p?.title.slice(0, 40) || 'Browser', focus: true })
      return { text: p ? `Browser: ${p.url}` : 'Usage: /browse <url | path>' }
    }
    const loaded = await navigate($, target)
    return { text: loaded.error ? `Could not open ${loaded.url}: ${loaded.error}` : `Opened ${loaded.title} (${loaded.url}).` }
  })

  on('tool.call', { tool: 'mcp__terminal-browser__open_page' }, async ($, e) => {
    const url = String((e as { url?: unknown }).url ?? '')
    if (!url) return { isError: true as const, result: 'url is required', text: 'url is required' }
    const loaded = await navigate($, url)
    if (loaded.error) return { isError: true as const, result: loaded.error, text: `Could not open ${loaded.url}: ${loaded.error}` }
    return { result: { url: loaded.url, title: loaded.title }, text: `Opened "${loaded.title}" (${loaded.url}) in the user's browser pane.\n\n${loaded.markdown.slice(0, 1500)}` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Markdown, Input } = $.ui.resolve(e)
    const p = await read($, page)
    const back = await read($, history)
    const index = await read($, pageIndex)

    const toolbar = (
      <Box flexDirection="row" gap={1}>
        <Button key="back" label="←" hotkey="b" onPress={() => {
          void (async () => {
            const h = await read($, history)
            const last = h.at(-1)
            if (!last) return
            await update($, history, list => list.slice(0, -1))
            await navigate($, last, true)
          })()
        }} dimColor={back.length === 0} />
        <Button key="reload" label="⟳" hotkey="r" onPress={() => void (p && navigate($, p.url, true))} />
        {p && <Button key="copy" label="Copy URL" plain onPress={press => void $.ui.copy({ text: p.url, surface: press.surface })} />}
      </Box>
    )

    const urlBar = Input ? (
      <Input key="url" placeholder="Enter a URL or file path" value={p?.url ?? ''} submitLabel="Go" onSubmit={value => void navigate($, value)} />
    ) : (
      <Text dimColor wrap="truncate-middle">{p?.url ?? ''}</Text>
    )

    if (!p) {
      return (
        <Box flexDirection="column">
          {urlBar}
          <Text dimColor>Type a URL above, run /browse &lt;url&gt;, or ask Claude to open a page.</Text>
        </Box>
      )
    }

    // Page the document so long pages stay readable at any height.
    const rows = Math.max(8, (e.viewport?.rows ?? 30) - 9)
    const lines = p.markdown.split('\n')
    const chunks: string[] = []
    for (let i = 0; i < lines.length; i += rows) chunks.push(lines.slice(i, i + rows).join('\n'))
    const current = Math.min(index, Math.max(0, chunks.length - 1))

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          {toolbar}
          <Box flexGrow={1} flexShrink={1}>{urlBar}</Box>
        </Box>
        <Text bold wrap="truncate-end">
          {p.isLoading ? '⏳ loading…' : p.title}
        </Text>
        {p.error && <Text color="error">{p.error}</Text>}
        {!p.isLoading && chunks.length > 0 && (
          <Markdown key="page" text={chunks[current] ?? ''} onLinkPress={link => void navigate($, link.href)} />
        )}
        {chunks.length > 1 && (
          <Box flexDirection="row" gap={2}>
            <Button key="prev" label="◀ Prev" hotkey="k" dimColor={current === 0} onPress={() => update($, pageIndex, i => Math.max(0, i - 1))} />
            <Text dimColor>
              {current + 1}/{chunks.length}
            </Text>
            <Button key="next" label="Next ▶" hotkey="j" dimColor={current >= chunks.length - 1} onPress={() => update($, pageIndex, i => Math.min(chunks.length - 1, i + 1))} />
          </Box>
        )}
      </Box>
    )
  })
}
