import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

const PANE = {
  plugin: 'todo-stack',
  component: 'Pane',
  requestId: 'todo-stack',
  props: {
    title: '할 일',
    isFocused: false,
    bodyColumns: 48,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  },
} as const

type Todo = { content: string; status: 'pending' | 'in_progress' | 'completed' }

// What the engine answers beneath the plugin: the session, the prompt, the
// tools, and what a compaction was told.
function engine(on: On, stored: Record<string, unknown> = {}) {
  mock.store(on, stored)
  const seen = { instructions: undefined as string | undefined, filled: undefined as string | undefined }
  let tasks = 0
  on('session.id', () => ({ value: 'session-1' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
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

async function todoWrite($: Engine, todos: Todo[]) {
  await $.tool.call({
    tool: 'TodoWrite',
    todos: todos.map(todo => ({ ...todo, activeForm: todo.content })),
  })
}

test('each request stacks its todos, newest on top', async ($, on) => {
  engine(on)
  await ask($, '로그인 버그 고쳐줘')
  await todoWrite($, [
    { content: '폼 검증 추가', status: 'in_progress' },
    { content: '세션 쿠키 수정', status: 'pending' },
  ])
  await ask($, '문서도 갱신해줘')
  await todoWrite($, [{ content: 'README 갱신', status: 'pending' }])

  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const headers = await ui.findAll({ type: 'Text', text: /^▸ / })
    expect(headers.map(header => header.text)).toEqual(['▸ 문서도 갱신해줘', '▸ 로그인 버그 고쳐줘'])
    expect(await ui.find({ type: 'Text', text: '남은 3 · 진행 중 1 · 완료 0' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '세션 쿠키 수정' })).toBeDefined()
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
  const [first, second] = await ui.findAll({ type: 'Button', text: /하나|둘/ })
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
  expect(await ui.find({ type: 'Text', text: '☑ ' })).toBeDefined()
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
  const headers = await ui.findAll({ type: 'Text', text: /^▸ / })
  expect(headers.map(header => header.text)).toEqual(['▸ 직접 추가한 할 일', '▸ 리팩터링'])

  await ui.press({ key: 'fill' })
  expect(seen.filled).toBe(
    '아직 끝나지 않은 할 일이 있어. 이어서 진행해줘:\n- [대기] 배포 전에 로그 확인\n- [진행 중] 함수 분리\n',
  )
})

test('a resumed session reads its stack back from the store', async ($, on) => {
  const saved = {
    groups: [
      {
        id: 'g1',
        request: '어제 하던 일',
        todos: [{ id: 't1', text: '남은 일', status: 'pending', source: 'todo', isListed: true }],
      },
    ],
    request: null,
    muted: [],
  }
  engine(on, { 'stack:session-1': saved, sessions: ['session-1'] })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: '▸ 어제 하던 일' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '남은 일' })).toBeDefined()
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
