export type TodoStatus = 'pending' | 'in_progress' | 'completed'

export type StackedTodo = {
  id: string
  text: string
  status: TodoStatus
  // Where it came from: the model's TodoWrite list, its Task tools, or the person.
  source: 'todo' | 'task' | 'manual'
  // The session it was made in. The stack is shared by every session, but a
  // model's list and task ids are its own session's.
  sessionId?: string
  // The status the model last reported, so a press of the person's is kept
  // until the model itself reports a different one.
  modelStatus?: TodoStatus
  taskId?: string
  // TodoWrite items only: whether the model's latest list still holds it.
  isListed?: boolean
}

// A TodoWrite text the person removed, ignored until that session's list drops it.
export type MutedText = { sessionId: string; text: string }

// One stack for every session, kept in the plugin's store.
export type TodoStack = {
  // The top of the stack first: newer todos above older ones.
  todos: StackedTodo[]
  muted: MutedText[]
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
