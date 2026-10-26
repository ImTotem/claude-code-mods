import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { MutedText, StackedTodo, TodoStack, TodoStatus } from '../types'

// The pane session-rail opens; this mod adds its card to it, and opens it
// too: a pane id is one pane whichever plugin opens it.
const RAIL = 'session-rail'
const RAIL_TITLE = '세션'
const MAX_TODOS = 300
const MAX_TEXT = 500
// One stack for every session, kept in the plugin's store.
const STORE_KEY = 'stack'
// Versions before 0.5.0 kept a stack per session under `stack:<id>`, listed
// oldest first under `sessions`. Claude Code starts a session on the version
// it has on disk and fetches an update after, so such a version can still run
// for a while once this one has saved the shared stack.
const OLD_PREFIX = 'stack:'
const OLD_INDEX = 'sessions'
// How often an open session reads the store again for other sessions' changes.
const WATCH_MS = 10_000

const STATUS_LABEL: Record<TodoStatus, string> = {
  pending: '대기',
  in_progress: '진행 중',
  completed: '완료',
}

const EMPTY: TodoStack = { todos: [], muted: [] }
const stackRef = { plugin: 'todo-stack', key: 'stack' } as const
const stack = atom(stackRef, EMPTY)
const hideDone = atom({ plugin: 'todo-stack', key: 'hideDone' } as const, false)
const isConfirmingClear = atom({ plugin: 'todo-stack', key: 'isConfirmingClear' } as const, false)
const isCollapsed = atom({ plugin: 'todo-stack', key: 'isCollapsed' } as const, false)

type ModelTodo = { content: string; status: TodoStatus }
type TaskChange = { taskId: string; subject?: string; status?: TodoStatus | 'deleted' }

function newId(): string {
  return Math.random().toString(36).slice(2, 10)
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()

  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

const isOpen = (todo: StackedTodo) => todo.status !== 'completed'
const isDropped = (todo: StackedTodo) => todo.source === 'todo' && todo.isListed === false && isOpen(todo)
// The model's todos and task ids are its session's own: another session's
// list never drops them, and its task ids never reach them.
const isModelTodoOf = (todo: StackedTodo, sessionId: string) => todo.sessionId === sessionId
// An unfinished todo of another session's, or the person's, that this
// session's model lists under the same text: the stack is one, so the model
// takes it over (and can finish it) instead of stacking it again.
const isAdoptable = (todo: StackedTodo, text: string, sessionId: string) =>
  isOpen(todo) && todo.text === text && (todo.source === 'manual' || !isModelTodoOf(todo, sessionId))

function mapTodos(value: TodoStack, fn: (todo: StackedTodo) => StackedTodo | null): TodoStack {
  return {
    ...value,
    todos: value.todos.flatMap(todo => {
      const kept = fn(todo)

      return kept === null ? [] : [kept]
    }),
  }
}

// New todos go on top of the stack; several made at once keep their order.
function push(value: TodoStack, added: readonly StackedTodo[]): TodoStack {
  return tidy({ ...value, todos: [...added, ...value.todos] })
}

// Past MAX_TODOS the lowest finished todo goes first, so an unfinished todo
// is the last thing the stack forgets.
function tidy(value: TodoStack): TodoStack {
  let todos = value.todos
  while (todos.length > MAX_TODOS) {
    const finished = todos.map(isOpen).lastIndexOf(false)
    const drop = finished === -1 ? todos.length - 1 : finished
    todos = todos.filter((_, index) => index !== drop)
  }

  return todos === value.todos ? value : { ...value, todos }
}

// TodoWrite hands over the session's whole list each time: an item it still
// holds is updated in place, a new one is pushed on top, and an unfinished
// one it no longer holds stays, marked as dropped.
function applyTodoWrite(value: TodoStack, list: readonly ModelTodo[], sessionId: string): TodoStack {
  const items = list.map(item => ({ text: oneLine(item.content, MAX_TEXT), status: item.status }))
  const texts = items.map(item => item.text)
  const muted = value.muted.filter(entry => entry.sessionId !== sessionId || texts.includes(entry.text))
  const isMuted = (text: string) => muted.some(entry => entry.sessionId === sessionId && entry.text === text)
  let next: TodoStack = { ...value, muted }
  const matched = new Set<string>()
  const added: StackedTodo[] = []

  for (const item of items) {
    if (isMuted(item.text)) continue

    const pool = next.todos.filter(
      todo =>
        todo.source === 'todo' && isModelTodoOf(todo, sessionId) && todo.text === item.text && !matched.has(todo.id),
    )
    const found = pool.find(todo => todo.isListed === true) ?? pool.find(isOpen)

    if (found !== undefined) {
      matched.add(found.id)
      next = mapTodos(next, todo =>
        todo.id !== found.id
          ? todo
          : {
              ...todo,
              isListed: true,
              modelStatus: item.status,
              status: item.status !== todo.modelStatus ? item.status : todo.status,
            },
      )
      continue
    }

    const adopted = next.todos.find(todo => !matched.has(todo.id) && isAdoptable(todo, item.text, sessionId))
    if (adopted !== undefined) {
      matched.add(adopted.id)
      next = mapTodos(next, todo => {
        if (todo.id !== adopted.id) return todo
        const { taskId: _, ...rest } = todo

        return { ...rest, source: 'todo', sessionId, isListed: true, modelStatus: item.status, status: item.status }
      })
      continue
    }

    const id = newId()
    matched.add(id)
    added.push({
      id,
      text: item.text,
      status: item.status,
      source: 'todo',
      sessionId,
      modelStatus: item.status,
      isListed: true,
    })
  }

  const marked = mapTodos(next, todo =>
    todo.source === 'todo' && isModelTodoOf(todo, sessionId) && !matched.has(todo.id) && todo.isListed !== false
      ? { ...todo, isListed: false }
      : todo,
  )

  return push(marked, added)
}

// Task ids start over with the task list (a /clear), so an older todo holding
// the same id lets go of it.
function applyTaskCreate(value: TodoStack, taskId: string, subject: string, sessionId: string): TodoStack {
  const released = mapTodos(value, todo => {
    if (todo.taskId !== taskId || !isModelTodoOf(todo, sessionId)) return todo
    const { taskId: _, ...rest } = todo

    return rest
  })
  const text = oneLine(subject, MAX_TEXT)
  const adopted = released.todos.find(todo => isAdoptable(todo, text, sessionId))
  if (adopted !== undefined) {
    return mapTodos(released, todo => {
      if (todo.id !== adopted.id) return todo
      const { isListed: _, ...rest } = todo

      return { ...rest, source: 'task', sessionId, taskId, modelStatus: 'pending' }
    })
  }

  return push(released, [
    {
      id: newId(),
      text,
      status: 'pending',
      source: 'task',
      sessionId,
      modelStatus: 'pending',
      taskId,
    },
  ])
}

function applyTaskUpdate(value: TodoStack, change: TaskChange, sessionId: string): TodoStack {
  return mapTodos(value, todo => {
    if (todo.taskId !== change.taskId || !isModelTodoOf(todo, sessionId)) return todo
    if (change.status === 'deleted') return null

    let next = todo
    if (change.subject !== undefined) next = { ...next, text: oneLine(change.subject, MAX_TEXT) }
    if (change.status !== undefined && change.status !== todo.modelStatus) {
      next = { ...next, status: change.status, modelStatus: change.status }
    }

    return next
  })
}

// What the person removes while the model's list still holds it is muted, so
// that session's next TodoWrite does not stack it again.
function mutedBy(value: TodoStack, removed: readonly StackedTodo[]): MutedText[] {
  const added = removed.flatMap(todo =>
    todo.source === 'todo' && todo.isListed === true && todo.sessionId !== undefined
      ? [{ sessionId: todo.sessionId, text: todo.text }]
      : [],
  )
  const fresh = added.filter(
    (entry, index) =>
      !value.muted.some(old => old.sessionId === entry.sessionId && old.text === entry.text) &&
      added.findIndex(other => other.sessionId === entry.sessionId && other.text === entry.text) === index,
  )

  return [...value.muted, ...fresh]
}

function toggle(value: TodoStack, id: string): TodoStack {
  return mapTodos(value, todo =>
    todo.id === id ? { ...todo, status: isOpen(todo) ? 'completed' : 'pending' } : todo,
  )
}

function remove(value: TodoStack, id: string): TodoStack {
  const removed = value.todos.filter(todo => todo.id === id)

  return { ...mapTodos(value, todo => (todo.id === id ? null : todo)), muted: mutedBy(value, removed) }
}

function clearDone(value: TodoStack): TodoStack {
  const removed = value.todos.filter(todo => !isOpen(todo))

  return { ...mapTodos(value, todo => (isOpen(todo) ? todo : null)), muted: mutedBy(value, removed) }
}

function clearAll(value: TodoStack): TodoStack {
  return { todos: [], muted: mutedBy(value, value.todos) }
}

function addManual(value: TodoStack, text: string, sessionId: string): TodoStack {
  return push(value, [{ id: newId(), text, status: 'pending', source: 'manual', sessionId }])
}

// A stack as stored or held: this version's; 0.4's, a flat stack of one
// session's; or an older one's that kept a group per request (newest group
// first, a group's todos in their order). Todos and muted texts without a
// session take `sessionId`, the session an older version kept them for.
function toStack(saved: unknown, sessionId?: string): TodoStack | undefined {
  if (typeof saved !== 'object' || saved === null) return undefined
  const { todos, groups, muted } = saved as Record<string, unknown>
  if (!Array.isArray(muted)) return undefined

  const listed = Array.isArray(todos)
    ? (todos as StackedTodo[])
    : Array.isArray(groups)
      ? (groups as { todos?: unknown }[]).flatMap(group =>
          Array.isArray(group.todos) ? (group.todos as StackedTodo[]) : [],
        )
      : undefined
  if (listed === undefined) return undefined

  return {
    todos: listed.map(todo =>
      todo.sessionId !== undefined || sessionId === undefined ? todo : { ...todo, sessionId },
    ),
    muted: (muted as unknown[]).flatMap((entry): MutedText[] => {
      if (typeof entry === 'string') return sessionId === undefined ? [] : [{ sessionId, text: entry }]
      if (typeof entry !== 'object' || entry === null) return []
      const { sessionId: owner, text } = entry as Record<string, unknown>

      return typeof owner === 'string' && typeof text === 'string' ? [{ sessionId: owner, text }] : []
    }),
  }
}

function taskIdOf(result: unknown): string | undefined {
  const task = (result as { task?: { id?: unknown } } | null | undefined)?.task
  const id = task?.id

  return typeof id === 'string' || typeof id === 'number' ? String(id) : undefined
}

function openList(todos: readonly StackedTodo[], label: (status: TodoStatus) => string): string {
  return todos
    .filter(isOpen)
    .map(todo => `- [${label(todo.status)}] ${todo.text}`)
    .join('\n')
}

// The per-session stacks older versions kept, merged onto `base`: the session
// used last on top, and above what `base` holds, since an older version still
// running wrote them after it. A todo both hold is kept as the older version
// left it. The old keys go once the merged stack is saved.
async function migrate($: EngineInterface, keys: readonly string[], base: TodoStack): Promise<TodoStack> {
  const ids = keys.map(key => key.slice(OLD_PREFIX.length))
  const index = await $.store.get(OLD_INDEX)
  const order = Array.isArray(index) ? index.filter((id): id is string => typeof id === 'string') : []
  const oldestFirst = [...ids.filter(id => !order.includes(id)), ...order.filter(id => ids.includes(id))]

  let merged = base
  for (const id of oldestFirst) {
    const old = toStack(await $.store.get(`${OLD_PREFIX}${id}`), id)
    if (old === undefined) continue
    const fresh = new Set(old.todos.map(todo => todo.id))
    merged = {
      todos: [...old.todos, ...merged.todos.filter(todo => !fresh.has(todo.id))],
      muted: [
        ...merged.muted,
        ...old.muted.filter(entry => !merged.muted.some(m => m.sessionId === entry.sessionId && m.text === entry.text)),
      ],
    }
  }
  merged = tidy(merged)

  await $.store.set(STORE_KEY, merged)
  for (const key of keys) await $.store.delete(key)
  if (index !== undefined) await $.store.delete(OLD_INDEX)

  return merged
}

// The store holds the stack; what a session holds in state is a copy of it.
async function load($: EngineInterface): Promise<TodoStack> {
  const saved = toStack(await $.store.get(STORE_KEY))
  const leftovers = (await $.store.keys()).filter(key => key.startsWith(OLD_PREFIX))
  if (saved !== undefined && leftovers.length === 0) return saved

  return migrate($, leftovers, saved ?? EMPTY)
}

async function hold($: EngineInterface, value: TodoStack) {
  const held = await $.state.get(stackRef)
  if (held.version === 0 || JSON.stringify(held.value) !== JSON.stringify(value)) {
    await $.state.set(stackRef, value)
  }
}

// Changes run one at a time, each on what the store holds then, so a change
// made in another session meanwhile is kept, not written over.
let queue: Promise<unknown> = Promise.resolve()

function serially<T>(run: () => Promise<T>): Promise<T> {
  const done = queue.then(run)
  queue = done.catch(() => undefined)

  return done
}

function refresh($: EngineInterface): Promise<void> {
  return serially(async () => hold($, await load($)))
}

function change($: EngineInterface, fn: (value: TodoStack, sessionId: string) => TodoStack): Promise<void> {
  return serially(async () => {
    const sessionId = await $.session.id()
    const value = fn(await load($), sessionId)
    await $.store.set(STORE_KEY, value)
    await hold($, value)
  })
}

// Another session's changes reach the store, not this session's state: an
// open session reads the store again now and then. Started once per load of
// this module, so a reload starts it again.
let isWatching = false

function watch($: EngineInterface) {
  if (isWatching) return
  isWatching = true
  $.clock.every(WATCH_MS, () => {
    void refresh($).catch(() => undefined)
  })
}

async function fillPrompt($: EngineInterface) {
  const value = await serially(() => load($))
  const list = openList(value.todos, status => STATUS_LABEL[status])
  if (list === '') return

  await $.prompt.fill({
    text: `아직 끝나지 않은 할 일이 있어. 이어서 진행해줘:\n${list}\n`,
    mode: 'append',
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'todo-stack',
      description: '세션 패널을 열어 할 일 스택을 보여줍니다. 텍스트를 주면 직접 할 일로 추가합니다',
      argumentHint: '[추가할 할 일]',
    })

    await refresh($).catch(() => undefined)
    watch($)

    return next(e)
  })

  on('command.run', { command: 'todo-stack' }, async ($, e) => {
    const text = oneLine(e.args, MAX_TEXT)
    if (text !== '') await change($, (value, sessionId) => addManual(value, text, sessionId))

    const opened = await $.ui.open({ id: RAIL, title: RAIL_TITLE })
    const said = text === '' ? '할 일 스택을 열었습니다.' : `할 일을 추가했습니다: ${text}`

    return { text: opened.isPlaced ? said : `${said} (패널을 열지 못했습니다: ${opened.reason})` }
  })

  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const ran = await next(e)
    if (e.tool !== 'TodoWrite' || e.agentId !== undefined || ran.deny !== undefined || ran.isError === true) {
      return ran
    }

    const list = e.todos
    await change($, (value, sessionId) => applyTodoWrite(value, list, sessionId)).catch(() => undefined)

    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const ran = await next(e)
    if (e.tool !== 'TaskCreate' || e.agentId !== undefined || ran.deny !== undefined || ran.isError === true) {
      return ran
    }

    const taskId = taskIdOf(ran.result)
    const subject = e.subject
    if (taskId !== undefined) {
      await change($, (value, sessionId) => applyTaskCreate(value, taskId, subject, sessionId)).catch(
        () => undefined,
      )
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const ran = await next(e)
    if (e.tool !== 'TaskUpdate' || e.agentId !== undefined || ran.deny !== undefined || ran.isError === true) {
      return ran
    }

    const taskChange: TaskChange = { taskId: e.taskId }
    if (e.subject !== undefined) taskChange.subject = e.subject
    if (e.status !== undefined) taskChange.status = e.status
    await change($, (value, sessionId) => applyTaskUpdate(value, taskChange, sessionId)).catch(() => undefined)

    return ran
  }).catch(($, e, next) => next(e))

  // The pane opening shows the stack as the store holds it now.
  on('ui.open', { id: RAIL }, async ($, e, next) => {
    const opened = await next(e)
    if (opened.value?.isPlaced === true) void refresh($).catch(() => undefined)

    return opened
  }).catch(($, e, next) => next(e))

  // Compaction is where the model loses track: the summarizer is told to carry
  // this session's unfinished todos over.
  on('session.compact', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)

    const sessionId = await $.session.id()
    const value = await serially(() => load($)).catch(() => EMPTY)
    const list = openList(
      value.todos.filter(todo => todo.sessionId === sessionId),
      status => status,
    )
    if (list === '') return next(e)

    const note =
      'The user keeps a stack of todo items for this session (todo-stack plugin). ' +
      'Carry every open item below into the summary, verbatim with its status, ' +
      'under a heading "Open todos", so none is forgotten after compaction:\n' +
      list
    const instructions = e.instructions === undefined ? note : `${e.instructions}\n\n${note}`

    return next({ ...e, instructions })
  }).catch(($, e, next) => next(e))

  // The card goes below whatever the other mods add, so the usage card leads.
  on('ui.render', { component: 'Pane', requestId: RAIL }, async ($, e, next) => {
    const above = await next(e)
    const table = $.ui.resolve(e)
    const { Box, Text, Button } = table
    const Input = 'Input' in table ? table.Input : undefined

    // A reload of the plugin, or an update, starts with nothing held: this
    // draw reads the stack from the store, and the state takes it up after
    // the draw (a draw sees the state as it was when it began).
    const held = await $.state.get(stackRef)
    let value = toStack(held.value) ?? EMPTY
    if (held.version === 0) {
      value = await serially(() => load($)).catch(() => EMPTY)
      $.clock.after(1, () => {
        void refresh($).catch(() => undefined)
      })
    }
    watch($)
    const isHiding = await read($, hideDone)
    const isConfirming = await read($, isConfirmingClear)
    const isFolded = await read($, isCollapsed)

    const todos = value.todos
    const open = todos.filter(isOpen).length
    const working = todos.filter(todo => todo.status === 'in_progress').length
    const dropped = todos.filter(isDropped).length
    const done = todos.length - open
    const shown = isHiding ? todos.filter(isOpen) : todos

    // Where a pointer can hover, a ✕ shows only while it is over its row (the
    // keyed Box around it).
    const canHover = e.surface === 'desktop' || e.surface === 'vscode'
    const onHover = (control: ReturnType<typeof Button>) =>
      canHover ? (
        <Box display="none" hover={{ display: 'flex' }}>
          {control}
        </Box>
      ) : (
        control
      )

    // The mark is the checkbox; the text is plain text beside it, so it wraps
    // instead of being cut to one line inside a button.
    const row = (todo: StackedTodo) => {
      const isDone = !isOpen(todo)
      const mark = isDone ? '☑' : todo.status === 'in_progress' ? '◐' : '☐'

      return (
        <Box key={`r-${todo.id}`} flexDirection="row" gap={1} alignItems="flex-start">
          <Button key={`t-${todo.id}`} plain onPress={() => change($, v => toggle(v, todo.id))}>
            <Text color={isDone ? 'success' : todo.status === 'in_progress' ? 'warning' : undefined}>{mark}</Text>
          </Button>
          <Box flexDirection="column" flexGrow={1} flexShrink={1}>
            <Text
              wrap="wrap"
              strikethrough={isDone}
              dimColor={isDone}
              weight={todo.status === 'in_progress' ? 'semibold' : undefined}
            >
              {todo.text}
            </Text>
            {isDropped(todo) && (
              <Text color="warning" size="footnote">
                모델 목록에서 빠짐
              </Text>
            )}
          </Box>
          {onHover(
            <Button key={`x-${todo.id}`} plain dimColor label="✕" onPress={() => change($, v => remove(v, todo.id))} />,
          )}
        </Box>
      )
    }

    const summary = `남은 ${open} · 진행 중 ${working} · 완료 ${done}` + (dropped > 0 ? ` · 빠짐 ${dropped}` : '')

    const header = (
      <Box flexDirection="row" justifyContent="space-between" gap={1}>
        <Button key="todo-fold" plain onPress={() => update($, isCollapsed, isOn => !isOn)}>
          <Text weight="semibold">할 일</Text>
          <Text dimColor>{isFolded ? ' ›' : ' ∨'}</Text>
        </Button>
        {isFolded ? (
          <Text dimColor tabular>{`남은 ${open}`}</Text>
        ) : (
          <Button
            key="hide"
            plain
            dimColor
            label={isHiding ? '완료 보이기' : '완료 숨기기'}
            onPress={() => update($, hideDone, isOn => !isOn)}
          />
        )}
      </Box>
    )

    const card = isFolded ? (
      <Box key="todo-card" flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
        {header}
      </Box>
    ) : (
      <Box key="todo-card" flexDirection="column" gap="md" borderStyle="round" borderDimColor paddingX={1}>
        {header}
        <Text dimColor tabular>
          {summary}
        </Text>
        {Input !== undefined && (
          <Input
            key="add"
            placeholder="할 일 직접 추가…"
            value=""
            submitLabel="추가"
            onSubmit={text => {
              const added = oneLine(text, MAX_TEXT)
              if (added !== '') void change($, (v, sessionId) => addManual(v, added, sessionId))
            }}
          />
        )}
        {shown.length === 0 ? (
          <Text dimColor wrap="wrap">
            {todos.length === 0
              ? '아직 쌓인 할 일이 없습니다. 작업을 요청하면 모델이 만든 할 일이 여기에 위로 쌓입니다.'
              : '남은 할 일이 없습니다.'}
          </Text>
        ) : (
          <Box flexDirection="column" gap="xs">
            {shown.map(row)}
          </Box>
        )}
        {isHiding && done > 0 && <Text dimColor>{`완료된 할 일 ${done}개 숨김`}</Text>}
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          {open > 0 && (
            <Button key="fill" variant="primary" label="남은 할 일 프롬프트에 넣기" onPress={() => fillPrompt($)} />
          )}
          {done > 0 && (
            <Button key="clear-done" dimColor label="완료 정리" onPress={() => change($, clearDone)} />
          )}
          {todos.length > 0 && !isConfirming && (
            <Button
              key="clear"
              dimColor
              label="모두 지우기"
              onPress={() => update($, isConfirmingClear, () => true)}
            />
          )}
          {todos.length > 0 && isConfirming && <Text color="warning">모두 지울까요?</Text>}
          {todos.length > 0 && isConfirming && (
            <Button
              key="clear-yes"
              label="지우기"
              onPress={async () => {
                await change($, clearAll)
                await update($, isConfirmingClear, () => false)
              }}
            />
          )}
          {todos.length > 0 && isConfirming && (
            <Button key="clear-no" label="취소" onPress={() => update($, isConfirmingClear, () => false)} />
          )}
        </Box>
      </Box>
    )

    return (
      <Box flexDirection="column" gap={1}>
        {above}
        {card}
      </Box>
    )
  })
}
