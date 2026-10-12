// A small HTML-to-Markdown reader: enough for docs, articles, READMEs, PRs and local builds.

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…',
  laquo: '«', raquo: '»', copy: '©', reg: '®', trade: '™', middot: '·', bull: '•', rsquo: '’', lsquo: '‘',
  rdquo: '”', ldquo: '“', times: '×', larr: '←', rarr: '→',
}

export function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole
    }
    return ENTITIES[code.toLowerCase()] ?? whole
  })
}

function absolute(href: string, base: string): string {
  try {
    return new URL(href, base).toString()
  } catch {
    return href
  }
}

export function titleOf(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return m ? decode(m[1]!.replace(/\s+/g, ' ').trim()) : ''
}

export function toMarkdown(html: string, base: string): string {
  let s = html
  // Prefer the page's main content where it marks one.
  const main = s.match(/<main[\s>][\s\S]*?<\/main>/i) ?? s.match(/<article[\s>][\s\S]*?<\/article>/i)
  if (main) s = main[0]
  else {
    const body = s.match(/<body[^>]*>([\s\S]*)<\/body>/i)
    if (body) s = body[1]!
  }

  s = s
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|svg|template|iframe|head|nav|footer|form|button|select)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<(input|meta|link)\b[^>]*>/gi, '')

  // Preformatted blocks: protect them from whitespace collapsing.
  const blocks: string[] = []
  s = s.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, inner: string) => {
    const code = decode(inner.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''))
    blocks.push('\n```\n' + code.replace(/\n+$/, '') + '\n```\n')
    return `\u0000${blocks.length - 1}\u0000`
  })

  s = s
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n: string, inner: string) => `\n\n${'#'.repeat(Number(n))} ${inner.replace(/\s+/g, ' ').trim()}\n\n`)
    .replace(/<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, inner: string) => {
      const text = inner.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
      if (!text || href.startsWith('javascript:') || href.startsWith('#')) return text
      return `[${text.replace(/[[\]]/g, '')}](${absolute(decode(href), base).replace(/\s/g, '%20').replace(/\)/g, '%29')})`
    })
    .replace(/<img\b[^>]*?alt\s*=\s*["']([^"']*)["'][^>]*>/gi, (_, alt: string) => (alt.trim() ? `[image: ${alt.trim()}]` : ''))
    .replace(/<img\b[^>]*>/gi, '')
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, _t: string, inner: string) => (inner.trim() ? `**${inner.trim()}**` : ''))
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, _t: string, inner: string) => (inner.trim() ? `*${inner.trim()}*` : ''))
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_, inner: string) => '`' + inner.replace(/<[^>]+>/g, '') + '`')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<blockquote\b[^>]*>/gi, '\n> ')
    .replace(/<(br|hr)\s*\/?>/gi, m => (/hr/i.test(m) ? '\n\n---\n\n' : '\n'))
    .replace(/<\/(td|th)>/gi, ' | ')
    .replace(/<\/(p|div|section|tr|ul|ol|table|blockquote|header|details|summary|dl|dd|dt|figure)>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')

  s = decode(s)
    .replace(/[ \t\f\v\r]+/g, ' ')
    .split('\n')
    .map(l => l.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\u0000(\d+)\u0000/g, (_, i: string) => blocks[Number(i)] ?? '')
    .trim()

  return s.length > 80_000 ? s.slice(0, 80_000) + '\n\n…(page truncated)' : s
}
