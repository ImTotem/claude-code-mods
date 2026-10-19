declare module 'claude-code' {
  interface PluginState {
    'session-rail': {
      // A surface draws the pane now; while it does not, the band offers to open it.
      isOpen: boolean
      // The person closed the pane by hand; a prompt does not reopen it.
      isDismissed: boolean
      // The pane could not be placed and the person was told once.
      isWarned: boolean
    }
  }
}
