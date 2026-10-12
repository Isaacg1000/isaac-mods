import { expect, mock, test } from 'claude-code/testing'

const PANE_PROPS = { title: 'Agents', isFocused: false, bodyColumns: 46, placement: 'dock', scroll: {}, view: {} } as never

test('agents panel draws cards, task progress and the planned list on both surfaces', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `a${++n}` }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.call', { tool: 'TodoWrite' }, () => ({ result: {} as never }))

  await $.agent.spawn({ prompt: 'x', description: 'Build the landing page', subagentType: 'general-purpose' })
  await $.agent.spawn({ prompt: 'y', description: 'Design the launch graphics', subagentType: 'general-purpose' })
  await $.tool.call({
    tool: 'TodoWrite',
    agentId: 'a1',
    todos: [
      { content: 'Layout', status: 'completed', activeForm: 'Laying out' },
      { content: 'Hero copy', status: 'in_progress', activeForm: 'Writing hero copy' },
    ],
  } as never)
  await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'Review the whole kit', status: 'pending', activeForm: 'Reviewing' }] } as never)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'savvy-progress', surface, component: 'Pane', requestId: 'savvy-agents', props: PANE_PROPS })
    expect(await ui.find({ type: 'Text', text: /Build the landing page/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Design the launch graphics/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1\/2 · Hero copy/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Planned · 1/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Opus 5\.5/ })).toBeDefined()
    await ui.press({ key: 'collapse' })
    expect(await ui.find({ type: 'Text', text: /Hero copy/ })).toBeUndefined()
    await ui.press({ key: 'collapse' })
    await ui.unmount()
  }
})
