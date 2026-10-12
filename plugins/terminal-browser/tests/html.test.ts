import { expect, test } from 'claude-code/testing'

import { titleOf, toMarkdown } from '../hooks/html.ts'

test('converts a page to readable markdown with absolute links', async () => {
  const html = `<html><head><title>Docs &amp; Guides</title><script>evil()</script></head>
    <body><nav>menu</nav><main><h1>Hello</h1><p>See <a href="/a/b">the guide</a>.</p>
    <ul><li>one</li><li>two</li></ul><pre><code>x &lt; 1</code></pre></main></body></html>`
  expect(titleOf(html)).toBe('Docs & Guides')
  const md = toMarkdown(html, 'https://example.com/docs/')
  expect(md).toContain('# Hello')
  expect(md).toContain('[the guide](https://example.com/a/b)')
  expect(md).toContain('- one\n- two')
  expect(md).toContain('x < 1')
  expect(md).not.toContain('evil')
  expect(md).not.toContain('menu')
})
