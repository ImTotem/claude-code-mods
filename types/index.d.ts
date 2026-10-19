export type TodoStatus = 'pending' | 'in_progress' | 'completed'

export type StackedTodo = {
  id: string
  text: string
  status: TodoStatus
  // Where it came from: the model's TodoWrite list, its Task tools, or the person.
  source: 'todo' | 'task' | 'manual'
  // The status the model last reported, so a press of the person's is kept
  // until the model itself reports a different one.
  modelStatus?: TodoStatus
  taskId?: string
  // TodoWrite items only: whether the model's latest list still holds it.
  isListed?: boolean
}

export type TodoGroup = {
  id: string
  request: string
  todos: StackedTodo[]
}

export type TodoRequest = { text: string; groupId?: string }

export type TodoStack = {
  // Newest request first.
  groups: TodoGroup[]
  // The request the next model todo belongs to.
  request: TodoRequest | null
  // TodoWrite texts the person removed, ignored until the model's list drops them.
  muted: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'todo-stack': {
      stack: TodoStack
      hideDone: boolean
      isConfirmingClear: boolean
      // The person closed the pane by hand; it stays closed until /todo-stack.
      isDismissed: boolean
      // The pane could not be placed and the person was told once.
      isWarned: boolean
    }
  }
}
