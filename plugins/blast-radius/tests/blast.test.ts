import { expect, test } from 'claude-code/testing'

const answering = (label: string) => (on: any) => {
  on('session.cwd', () => ({ value: '/proj' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('tool.call', { tool: 'AskUserQuestion' }, (_$: unknown, e: any) => ({
    result: { questions: e.questions, answers: Object.fromEntries(e.questions.map((q: any) => [q.question, label])) },
  }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: 'ran' }, text: 'ran' }))
}

test('a harmless command passes straight through', async ($, on) => {
  answering('Cancel')(on)
  const r = await $.tool.call({ tool: 'Bash', command: 'ls -la' })
  expect(r.text).toBe('ran')
})

test('rm -rf is blocked when the user cancels', async ($, on) => {
  answering('Cancel')(on)
  const r = await $.tool.call({ tool: 'Bash', command: 'rm -rf build/*' })
  expect(r.text ?? r.deny ?? '').toContain('Blast Radius')
})

test('rm -rf runs when the user proceeds', async ($, on) => {
  answering('Proceed')(on)
  const r = await $.tool.call({ tool: 'Bash', command: 'rm -rf build/*' })
  expect(r.text).toBe('ran')
})
