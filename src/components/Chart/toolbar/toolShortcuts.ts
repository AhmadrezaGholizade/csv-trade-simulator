import type { DrawTool } from '../chartTypes'

const DRAW_TOOL_KEYBOARD_SHORTCUTS: Array<{
  code: string
  shift: boolean
  tool: DrawTool
}> = [
  { code: 'KeyT', shift: false, tool: 'trendline' },
  { code: 'KeyH', shift: false, tool: 'horizontal' },
  { code: 'KeyJ', shift: false, tool: 'horizontalray' },
  { code: 'KeyV', shift: false, tool: 'vertical' },
  { code: 'KeyC', shift: false, tool: 'crossline' },
  { code: 'KeyF', shift: false, tool: 'fibonacci' },
  { code: 'KeyR', shift: true, tool: 'rectangle' },
]

export function getDrawToolShortcut(event: KeyboardEvent): DrawTool {
  if (!event.altKey || event.ctrlKey || event.metaKey) return null

  return DRAW_TOOL_KEYBOARD_SHORTCUTS.find(shortcut =>
    shortcut.code === event.code && shortcut.shift === event.shiftKey
  )?.tool ?? null
}

export function isEditableShortcutTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null
  if (!element) return false
  return Boolean(element.closest('input, textarea, select, [contenteditable="true"]'))
}