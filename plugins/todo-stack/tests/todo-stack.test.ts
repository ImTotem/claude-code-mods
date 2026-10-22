import { expect, mock, test } from 'claude-code/testing'
import type { On, RenderElement } from 'claude-code'
import type { Engine } from 'claude-code/testing'

// The pane session-rail opens; this mod adds a card to it.
const PANE = {
  plugin: 'todo-stack',
  component: 'Pane',
  requestId: 'session-rail',
  props: {
    title: '세션',
    isFocused: false,
    bodyColumns: 48,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  },
} as const

type Todo = { content: string; status: 'pending' | 'in_progress' | 'completed' }

// What the engine answers beneath the plugin: the session, the clock, the
// store, the prompt, the tools, the pane's own drawing (nothing), and what a
// compaction was told.
function engine(on: On, stored: Record<string, unknown> = {}) {
  // The plugin's store, kept here so a test can read what was saved.
  const store = new Map(Object.entries(stored))
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => {
    store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('store.delete', ($, e) => {
    store.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  const seen = {
    instructions: undefined as string | undefined,
    filled: undefined as string | undefined,
    opens: [] as string[],
    store,
    clock: mock.clock(on),
    // The session the next call comes from; another session shares the store.
    sessionId: 'session-1',
  }
  let tasks = 0
  on('session.id', () => ({ value: seen.sessionId }))
  on('ui.render', { component: 'Pane' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return h(Box, { key: 'bottom' }) as RenderElement
  })
  on('ui.open', ($, e) => {
    seen.opens.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('prompt.fill', ($, e) => {
    seen.filled = e.text
    return { isFilled: true }
  })
  on('session.compact', ($, e) => {
    seen.instructions = e.instructions
    return { messages: e.messages }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('tool.call', ($, e) => {
    if (e.tool === 'TaskCreate') {
      tasks += 1
      return { result: { task: { id: String(tasks), subject: e.subject } } }
    }
    if (e.tool === 'TaskUpdate') return { result: { success: true, taskId: e.taskId, updatedFields: [] } }
    if (e.tool === 'TodoWrite') return { result: { oldTodos: [], newTodos: e.todos } }
    return { deny: 'not in this test' }
  })

  return seen
}

async function ask($: Engine, text: string) {
  await $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
}

// The todo texts drawn, top of the stack first.
async function rowsOf(ui: { findAll(query: { type: 'Text'; text: RegExp }): Promise<{ text?: string }[]> }, ...names: string[]) {
  const found = await ui.findAll({ type: 'Text', text: new RegExp(`^(${names.join('|')})$`) })

  return found.map(text => text.text)
}

type Drawn = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

// Whether the Button keyed `key` sits in a Box drawn hidden until hovered.
function isHoverOnly(node: unknown, key: string, isHidden = false): boolean | undefined {
  if (typeof node !== 'object' || node === null) return undefined
  const { type, props = {}, children = [] } = node as Drawn
  const hidden = isHidden || (type === 'Box' && props.display === 'none')
  if (type === 'Button' && props.key === key) return hidden
  for (const child of children) {
    const found = isHoverOnly(child, key, hidden)
    if (found !== undefined) return found
  }
  return undefined
}

async function todoWrite($: Engine, todos: Todo[]) {
  await $.tool.call({
    tool: 'TodoWrite',
    todos: todos.map(todo => ({ ...todo, activeForm: todo.content })),
  })
}

test('new todos go on top of the stack, a list made at once keeping its order', async ($, on) => {
  engine(on)
  await ask($, '로그인 버그 고쳐줘')
  await todoWrite($, [
    { content: '폼 검증 추가', status: 'in_progress' },
    { content: '세션 쿠키 수정', status: 'pending' },
  ])
  await ask($, '문서도 갱신해줘')
  await todoWrite($, [
    { content: '폼 검증 추가', status: 'completed' },
    { content: '세션 쿠키 수정', status: 'in_progress' },
    { content: 'README 갱신', status: 'pending' },
  ])
  await $.tool.call({ tool: 'TaskCreate', subject: '릴리스 노트', description: '...' })
  await $.command.run({
    command: 'todo-stack',
    args: '배포 확인',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })

  const names = ['배포 확인', '릴리스 노트', 'README 갱신', '폼 검증 추가', '세션 쿠키 수정']
  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await rowsOf(ui, ...names)).toEqual(names)
    expect(await ui.find({ type: 'Text', text: '남은 4 · 진행 중 1 · 완료 1' })).toBeDefined()
    // No request is drawn: the card holds the todos alone.
    expect(await ui.find({ type: 'Text', text: /고쳐줘|갱신해줘/ })).toBeUndefined()
    const texts = await ui.findAll({ type: 'Text', text: /^(배포 확인|README 갱신)$/ })
    expect(texts.map(text => text.props.wrap)).toEqual(['wrap', 'wrap'])
    await ui.unmount()
  }
})

test('a todo the model drops from its list stays, marked as dropped', async ($, on) => {
  engine(on)
  await ask($, '작업 A')
  await todoWrite($, [
    { content: '첫째', status: 'completed' },
    { content: '둘째', status: 'pending' },
  ])
  await ask($, '작업 B')
  // The model starts a fresh list for the new request, forgetting 둘째.
  await todoWrite($, [{ content: '셋째', status: 'in_progress' }])

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: '둘째' })).toBeDefined()
  expect(await ui.findAll({ type: 'Text', text: '모델 목록에서 빠짐' })).toHaveLength(1)
  expect(await ui.find({ type: 'Text', text: '남은 2 · 진행 중 1 · 완료 1 · 빠짐 1' })).toBeDefined()

  // Listed again, it is the same todo and no longer dropped.
  await todoWrite($, [
    { content: '셋째', status: 'completed' },
    { content: '둘째', status: 'in_progress' },
  ])
  expect(await ui.findAll({ type: 'Text', text: '모델 목록에서 빠짐' })).toHaveLength(0)
  expect(await ui.findAll({ type: 'Text', text: '둘째' })).toHaveLength(1)
})

test("the person's check and removal hold against the model's next list", async ($, on) => {
  engine(on)
  await ask($, '정리해줘')
  await todoWrite($, [
    { content: '하나', status: 'pending' },
    { content: '둘', status: 'pending' },
  ])

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const checks = (await ui.findAll({ type: 'Button' })).filter(button => String(button.key).startsWith('t-'))
  expect(checks).toHaveLength(2)
  const [first, second] = checks
  await ui.press({ key: String(first?.key) })
  await ui.press({ key: String(second?.key).replace(/^t-/, 'x-') })
  expect(await ui.find({ type: 'Text', text: '남은 0 · 진행 중 0 · 완료 1' })).toBeDefined()

  // The model still holds both as pending: the check stays, 둘 stays removed.
  await todoWrite($, [
    { content: '하나', status: 'pending' },
    { content: '둘', status: 'pending' },
  ])
  expect(await ui.find({ type: 'Text', text: '남은 0 · 진행 중 0 · 완료 1' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '둘' })).toBeUndefined()
})

test('Task tools stack and update by task id', async ($, on) => {
  engine(on)
  await ask($, '테스트 추가해줘')
  await $.tool.call({ tool: 'TaskCreate', subject: '유닛 테스트', description: '...' })
  await $.tool.call({ tool: 'TaskCreate', subject: '통합 테스트', description: '...' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '2', status: 'deleted' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: '남은 0 · 진행 중 0 · 완료 1' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '☑' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '유닛 테스트' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '통합 테스트' })).toBeUndefined()
})

test('a compaction is told to keep the open todos, and the button fills the prompt', async ($, on) => {
  const seen = engine(on)
  await ask($, '리팩터링')
  await todoWrite($, [
    { content: '함수 분리', status: 'in_progress' },
    { content: '이름 정리', status: 'completed' },
  ])
  await $.command.run({
    command: 'todo-stack',
    args: '배포 전에 로그 확인',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 200 },
  })

  await $.session.compact({ trigger: 'auto', messages: [{ role: 'user', text: '리팩터링', toolUses: [] }] })
  expect(seen.instructions).toContain('- [in_progress] 함수 분리')
  expect(seen.instructions).toContain('- [pending] 배포 전에 로그 확인')
  expect(seen.instructions).not.toContain('이름 정리')

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await rowsOf(ui, '배포 전에 로그 확인', '함수 분리', '이름 정리')).toEqual([
    '배포 전에 로그 확인',
    '함수 분리',
    '이름 정리',
  ])

  await ui.press({ key: 'fill' })
  expect(seen.filled).toBe(
    '아직 끝나지 않은 할 일이 있어. 이어서 진행해줘:\n- [대기] 배포 전에 로그 확인\n- [진행 중] 함수 분리\n',
  )
})

test('every session shares one stack, read from the store', async ($, on) => {
  const saved = {
    todos: [
      { id: 't2', text: '위에 있는 일', status: 'pending', source: 'manual', sessionId: 'session-0' },
      { id: 't1', text: '남은 일', status: 'pending', source: 'todo', sessionId: 'session-0', isListed: true },
    ],
    muted: [],
  }
  const seen = engine(on, { stack: saved })
  seen.sessionId = 'session-new'
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await rowsOf(ui, '위에 있는 일', '남은 일')).toEqual(['위에 있는 일', '남은 일'])
})

test('after a reload of the plugin the card reads the stack back from the store', async ($, on) => {
  const saved = {
    todos: [{ id: 't1', text: '새로고침 전에 쌓인 일', status: 'pending', source: 'manual', sessionId: 'session-1' }],
    muted: [],
  }
  const seen = engine(on, { stack: saved })

  // No session.start: the plugin was reloaded into a running session.
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await seen.clock.settle()
  expect(await rowsOf(ui, '새로고침 전에 쌓인 일')).toEqual(['새로고침 전에 쌓인 일'])

  // A change made now adds to that stack, not to an empty one.
  await todoWrite($, [{ content: '새 일', status: 'pending' }])
  expect(await rowsOf(ui, '새 일', '새로고침 전에 쌓인 일')).toEqual(['새 일', '새로고침 전에 쌓인 일'])
  const stored = seen.store.get('stack') as { todos: { text: string }[] }
  expect(stored.todos.map(todo => todo.text)).toEqual(['새 일', '새로고침 전에 쌓인 일'])
})

test("another session's changes are kept and shown, and its list leaves this session's todos alone", async ($, on) => {
  const seen = engine(on)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await todoWrite($, [{ content: '이 세션의 일', status: 'in_progress' }])
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  // Another session, running beside this one, writes the store.
  const stored = seen.store.get('stack') as { todos: unknown[]; muted: unknown[] }
  seen.store.set('stack', {
    ...stored,
    todos: [{ id: 'o1', text: '다른 세션의 일', status: 'pending', source: 'todo', sessionId: 'session-2', isListed: true }, ...stored.todos],
  })
  await seen.clock.advance(10_000)
  expect(await rowsOf(ui, '다른 세션의 일', '이 세션의 일')).toEqual(['다른 세션의 일', '이 세션의 일'])

  // This session's next list neither drops nor duplicates the other's todo.
  await todoWrite($, [
    { content: '이 세션의 일', status: 'completed' },
    { content: '다음 일', status: 'pending' },
  ])
  expect(await rowsOf(ui, '다음 일', '다른 세션의 일', '이 세션의 일')).toEqual(['다음 일', '다른 세션의 일', '이 세션의 일'])
  expect(await ui.findAll({ type: 'Text', text: '모델 목록에서 빠짐' })).toHaveLength(0)

  // The other session's list, in turn, leaves this session's todos as they are.
  seen.sessionId = 'session-2'
  await todoWrite($, [{ content: '다른 세션의 일', status: 'completed' }])
  expect(await ui.findAll({ type: 'Text', text: '모델 목록에서 빠짐' })).toHaveLength(0)
  expect(await ui.find({ type: 'Text', text: '남은 1 · 진행 중 0 · 완료 2' })).toBeDefined()

  // A compaction carries over its own session's todos only.
  seen.sessionId = 'session-1'
  await $.session.compact({ trigger: 'auto', messages: [{ role: 'user', text: '계속', toolUses: [] }] })
  expect(seen.instructions).toContain('- [pending] 다음 일')
  expect(seen.instructions).not.toContain('다른 세션의 일')
})

test('the per-session stacks of older versions are merged into one, the last used on top', async ($, on) => {
  const grouped = {
    groups: [
      { id: 'g2', request: '오늘 요청', todos: [{ id: 't3', text: '새 일', status: 'pending', source: 'todo', isListed: true }] },
      {
        id: 'g1',
        request: '어제 하던 일',
        todos: [
          { id: 't1', text: '첫 일', status: 'completed', source: 'todo', isListed: true },
          { id: 't2', text: '둘째 일', status: 'pending', source: 'todo', isListed: true },
        ],
      },
    ],
    request: { text: '오늘 요청', groupId: 'g2' },
    muted: ['지운 일'],
  }
  const flat = {
    todos: [{ id: 't0', text: '예전 세션의 일', status: 'pending', source: 'manual' }],
    muted: [],
  }
  const seen = engine(on, {
    'stack:session-0': flat,
    'stack:session-1': grouped,
    sessions: ['session-0', 'session-1'],
  })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const names = ['새 일', '첫 일', '둘째 일', '예전 세션의 일']
  expect(await rowsOf(ui, ...names)).toEqual(names)
  expect(await ui.find({ type: 'Text', text: /오늘 요청|어제 하던 일/ })).toBeUndefined()

  expect([...seen.store.keys()]).toEqual(['stack'])
  const stored = seen.store.get('stack') as { todos: { text: string; sessionId: string }[]; muted: unknown[] }
  expect(stored.todos.map(todo => [todo.text, todo.sessionId])).toEqual([
    ['새 일', 'session-1'],
    ['첫 일', 'session-1'],
    ['둘째 일', 'session-1'],
    ['예전 세션의 일', 'session-0'],
  ])
  expect(stored.muted).toEqual([{ sessionId: 'session-1', text: '지운 일' }])

  // The session they came from still owns its model's todos.
  await todoWrite($, [{ content: '둘째 일', status: 'completed' }])
  expect(await ui.find({ type: 'Text', text: '남은 2 · 진행 중 0 · 완료 2' })).toBeDefined()
})

test('a row shows its ✕ under the pointer where there is one, and always elsewhere', async ($, on) => {
  engine(on)
  await ask($, '지울 수 있는 일')
  await todoWrite($, [{ content: '하나', status: 'pending' }])

  for (const [surface, isHidden] of [['desktop', true], ['vscode', true], ['terminal', false], ['mobile', false]] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const [check] = (await ui.findAll({ type: 'Button' })).filter(button => String(button.key).startsWith('t-'))
    const tree = await ui.drawn()
    expect(isHoverOnly(tree, String(check?.key).replace(/^t-/, 'x-'))).toBe(isHidden)
    await ui.unmount()
  }
})

test('clearing everything asks first', async ($, on) => {
  engine(on)
  await ask($, '지우기')
  await todoWrite($, [{ content: '사라질 일', status: 'pending' }])

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'clear' })
  expect(await ui.find({ type: 'Text', text: '사라질 일' })).toBeDefined()
  await ui.press({ key: 'clear-yes' })
  expect(await ui.find({ type: 'Text', text: '사라질 일' })).toBeUndefined()

  // Still on the model's list, it is not stacked again.
  await todoWrite($, [{ content: '사라질 일', status: 'pending' }])
  expect(await ui.find({ type: 'Text', text: '사라질 일' })).toBeUndefined()
})

test('the command opens the session pane, adding a todo when given one', async ($, on) => {
  const seen = engine(on)
  const run = (args: string) =>
    $.command.run({
      command: 'todo-stack',
      args,
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 80 },
    })

  expect(await run('')).toMatchObject({ text: '할 일 스택을 열었습니다.' })
  expect(await run('우유 사기')).toMatchObject({ text: '할 일을 추가했습니다: 우유 사기' })
  expect(seen.opens).toEqual(['session-rail', 'session-rail'])

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: '우유 사기' })).toBeDefined()
})

test('folding the card leaves its header and the open count', async ($, on) => {
  engine(on)
  await ask($, '접기')
  await todoWrite($, [{ content: '보일 일', status: 'pending' }])

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'todo-fold' })
  expect(await ui.find({ type: 'Text', text: '남은 1' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '보일 일' })).toBeUndefined()

  await ui.press({ key: 'todo-fold' })
  expect(await ui.find({ type: 'Text', text: '보일 일' })).toBeDefined()
})

test("the card follows the other mods' cards in the pane", {
  plugins: [
    {
      name: 'other-card',
      register(on) {
        on('ui.render', { component: 'Pane', requestId: 'session-rail' }, async ($, e, next) => {
          const { Box, Text } = $.ui.resolve(e)
          const below = await next(e)
          return h(Box, { flexDirection: 'column' }, h(Text, {}, 'other card'), below) as RenderElement
        })
      },
    },
  ],
}, async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const texts = (await ui.findAll({ type: 'Text', text: /^할 일$|other card/ })).map(text => text.text)
  expect(texts).toEqual(['other card', '할 일'])
})
