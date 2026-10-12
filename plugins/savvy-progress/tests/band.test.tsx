import { expect, mock, test } from 'claude-code/testing'

const BAND_PROPS = { hasSurvey: false, isWorking: true, maxRows: 6, bodyColumns: 100, scroll: {}, view: {} } as never
const PANE_PROPS = { title: 'Agents', isFocused: false, bodyColumns: 46, placement: 'dock', scroll: {}, view: {} } as never

test('band shows title, task pill, percent and agent count; panel splits running and finished', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  let n = 0
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `a${++n}` }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('model.complete', () => ({ value: { isAnswered: true, text: 'Launch kit', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }))
  on('tool.call', { tool: 'TodoWrite' }, () => ({ result: {} as never }))

  await $.turn.start({ text: 'Build the launch kit for our new cold brew', turnId: 't1' })
  await $.tool.call({
    tool: 'TodoWrite',
    todos: [
      { content: 'Research competitor launches', status: 'completed', activeForm: 'r' },
      { content: 'Design the launch graphics', status: 'completed', activeForm: 'd' },
      { content: 'Build the landing page', status: 'completed', activeForm: 'b' },
      { content: 'Review the whole kit', status: 'in_progress', activeForm: 'v' },
    ],
  } as never)
  await $.agent.spawn({ prompt: 'x', description: 'Build the landing page', subagentType: 'general-purpose' })
  await $.agent.spawn({ prompt: 'y', description: 'Review the whole kit', subagentType: 'general-purpose' })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', agentId: 'a1', reason: 'answer' } as never)

  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ plugin: 'savvy-progress', surface, component: 'AbovePrompt', props: BAND_PROPS })
    expect(await band.find({ type: 'Text', text: /75%/ })).toBeDefined()
    expect(await band.find({ key: 'open-agents' })).toBeDefined()
    await band.unmount()

    const pane = await $.ui.mount({ plugin: 'savvy-progress', surface, component: 'Pane', requestId: 'savvy-agents', props: PANE_PROPS })
    expect(await pane.find({ type: 'Text', text: /Running · 1/ })).toBeDefined()
    expect(await pane.find({ key: 'toggle-finished' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /Build the landing page/ })).toBeDefined()
    await pane.press({ key: 'toggle-finished' })
    expect(await pane.find({ type: 'Text', text: /Build the landing page/ })).toBeUndefined()
    await pane.press({ key: 'toggle-finished' })
    await pane.unmount()
  }
})

test('with no task list or agents the band sweeps, names the activity and shows elapsed time', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('tool.call', { tool: 'Read' }, () => ({ result: {} as never }))
  await $.turn.start({ text: 'fix the typo', turnId: 't2' })
  await $.tool.call({ tool: 'Read', file_path: 'a.md' } as never)
  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ plugin: 'savvy-progress', surface, component: 'AbovePrompt', props: BAND_PROPS })
    expect(await band.find({ type: 'Text', text: /0%/ })).toBeUndefined()
    expect(await band.find({ type: 'Text', text: /0:0\d/ })).toBeDefined()
    await band.unmount()
  }
  void clock
})
