/**
 * Every shortcut the app answers to, in one place.
 *
 * The list is the reference the Keybindings panel renders, and a test asserts
 * that each `menu` entry matches an accelerator actually registered in the
 * application menu — the documented list and the real one drifted apart once
 * already, and only a check keeps them together.
 */

export type KeybindingSource =
  /** Registered as a menu accelerator in the main process. */
  | 'menu'
  /** Handled by a keydown listener in the renderer. */
  | 'renderer'
  /** Mouse or trackpad, so `keys` reads as prose rather than an accelerator. */
  | 'gesture'
  /**
   * An Electron menu role, which brings the platform's own accelerator — no
   * `accelerator:` string of ours to compare against, so the drift check looks
   * for the role instead.
   */
  | 'role'

export interface Keybinding {
  /**
   * Electron accelerator syntax for `menu` and `renderer` entries, so the two
   * can be compared; free prose for `gesture` entries.
   */
  keys: string
  label: string
  source: KeybindingSource
  /** Where the shortcut applies, when it is not global. */
  context?: string
  /**
   * Sibling accelerators shown as one row — the four arrow directions read
   * better as "any arrow" than as four near-identical lines. They still belong
   * here so the drift check sees them.
   */
  aliases?: string[]
  /** The Electron role name, required for `role` bindings. */
  role?: string
}

export interface KeybindingGroup {
  title: string
  bindings: Keybinding[]
}

export const KEYBINDINGS: KeybindingGroup[] = [
  {
    title: 'Tiles',
    bindings: [
      { keys: 'CmdOrCtrl+T', label: 'New terminal', source: 'menu' },
      { keys: 'CmdOrCtrl+Shift+N', label: 'New note', source: 'menu' },
      { keys: 'CmdOrCtrl+Shift+D', label: 'Duplicate tile', source: 'menu' },
      { keys: 'CmdOrCtrl+W', label: 'Close tile', source: 'menu' },
      {
        keys: 'Delete',
        label: 'Close selected tiles',
        source: 'renderer',
        context: 'Canvas, with a selection',
        aliases: ['Backspace']
      },
      {
        keys: 'Up',
        label: 'Move tile — any arrow key',
        source: 'renderer',
        context: 'Focused tile border',
        aliases: ['Down', 'Left', 'Right']
      },
      {
        keys: 'Shift+Up',
        label: 'Resize tile — any arrow key',
        source: 'renderer',
        context: 'Focused tile border',
        aliases: ['Shift+Down', 'Shift+Left', 'Shift+Right']
      },
      {
        keys: 'Escape',
        label: 'Restore, then unfocus, then clear the selection',
        source: 'renderer'
      }
    ]
  },
  {
    title: 'Canvas',
    bindings: [
      { keys: 'CmdOrCtrl+Alt+0', label: 'Zoom to fit all tiles', source: 'menu' },
      { keys: 'CmdOrCtrl+Alt+F', label: 'Zoom to fit the focused tile', source: 'menu' },
      { keys: 'CmdOrCtrl+Alt+T', label: 'Tidy the selection into a grid', source: 'menu' },
      {
        keys: 'CmdOrCtrl+Alt+Left',
        label: 'Move focus between tiles — any arrow',
        source: 'menu',
        aliases: ['CmdOrCtrl+Alt+Right', 'CmdOrCtrl+Alt+Up', 'CmdOrCtrl+Alt+Down']
      },
      { keys: '0', label: 'Reset canvas zoom to 100%', source: 'renderer', context: 'Canvas' },
      { keys: 'Scroll, or Space + drag', label: 'Pan the canvas', source: 'gesture' },
      { keys: 'Pinch, or Cmd + scroll', label: 'Zoom the canvas', source: 'gesture' },
      { keys: 'Double-click the canvas', label: 'New terminal here', source: 'gesture' },
      { keys: 'Double-click a tile header', label: 'Centre that tile', source: 'gesture' },
      { keys: 'Shift + click, or drag a box', label: 'Select several tiles', source: 'gesture' }
    ]
  },
  {
    title: 'Window',
    bindings: [
      { keys: 'CmdOrCtrl+B', label: 'Toggle the sidebar', source: 'menu' },
      { keys: 'CmdOrCtrl+Alt+B', label: 'Toggle the tile index', source: 'menu' },
      { keys: 'CmdOrCtrl+Shift+F', label: 'Toggle fullscreen', source: 'renderer' },
      { keys: 'CmdOrCtrl+Shift+T', label: 'Cycle theme — dark, light, system', source: 'renderer' },
      { keys: 'CmdOrCtrl+=', label: 'Zoom the interface in', source: 'role', role: 'zoomIn' },
      { keys: 'CmdOrCtrl+-', label: 'Zoom the interface out', source: 'role', role: 'zoomOut' },
      {
        keys: 'CmdOrCtrl+0',
        label: 'Reset the interface zoom',
        source: 'role',
        role: 'resetZoom'
      },
      { keys: 'Cmd+,', label: 'Settings', source: 'menu' }
    ]
  },
  {
    title: 'Project',
    bindings: [
      { keys: 'CmdOrCtrl+Shift+A', label: 'Add a folder to the workspace', source: 'menu' },
      { keys: 'F2', label: 'Rename', source: 'renderer', context: 'File tree' },
      { keys: 'Enter', label: 'Open the selected file', source: 'renderer', context: 'File tree' }
    ]
  },
  {
    title: 'Terminal and editor',
    bindings: [
      { keys: 'CmdOrCtrl+C', label: 'Copy the selection', source: 'renderer', context: 'Terminal' },
      { keys: 'CmdOrCtrl+V', label: 'Paste', source: 'renderer', context: 'Terminal' },
      { keys: 'CmdOrCtrl+S', label: 'Save the file', source: 'renderer', context: 'Editor tile' }
    ]
  }
]

const MAC_SYMBOLS: Record<string, string> = {
  cmdorctrl: '⌘',
  cmd: '⌘',
  command: '⌘',
  ctrl: '⌃',
  control: '⌃',
  alt: '⌥',
  option: '⌥',
  shift: '⇧'
}

const OTHER_NAMES: Record<string, string> = {
  cmdorctrl: 'Ctrl',
  cmd: 'Ctrl',
  command: 'Ctrl',
  ctrl: 'Ctrl',
  control: 'Ctrl',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift'
}

const KEY_SYMBOLS: Record<string, string> = {
  left: '←',
  right: '→',
  up: '↑',
  down: '↓',
  delete: '⌫',
  backspace: '⌫',
  escape: 'Esc',
  enter: '↵',
  space: 'Space'
}

/**
 * Render an accelerator the way the platform writes it: ⇧⌘D on macOS,
 * Ctrl+Shift+D elsewhere. Modifier order is normalised so two bindings with the
 * same keys never read differently.
 */
export function formatAccelerator(keys: string, isMac: boolean): string {
  const parts = keys.split('+').map((part) => part.trim())
  const modifiers: string[] = []
  const rest: string[] = []

  for (const part of parts) {
    const lower = part.toLowerCase()
    const table = isMac ? MAC_SYMBOLS : OTHER_NAMES
    if (table[lower]) modifiers.push(table[lower])
    else rest.push(KEY_SYMBOLS[lower] ?? (part.length === 1 ? part.toUpperCase() : part))
  }

  // macOS writes modifiers in a fixed order, innermost last.
  const order = isMac ? ['⇧', '⌃', '⌥', '⌘'] : ['Ctrl', 'Alt', 'Shift']
  modifiers.sort((a, b) => order.indexOf(a) - order.indexOf(b))

  const all = [...modifiers, ...rest]
  return isMac ? all.join('') : all.join('+')
}
