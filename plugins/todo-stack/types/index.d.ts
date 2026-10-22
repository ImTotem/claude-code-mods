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

export type TodoStack = {
  // The top of the stack first: newer todos above older ones.
  todos: StackedTodo[]
  // TodoWrite texts the person removed, ignored until the model's list drops them.
  muted: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'todo-stack': {
      stack: TodoStack
      hideDone: boolean
      isConfirmingClear: boolean
      // The person folded the card to its header.
      isCollapsed: boolean
    }
  }
}
