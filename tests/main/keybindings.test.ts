/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { KEYBINDINGS, formatAccelerator } from '../../src/shared/keybindings'

/**
 * The documented shortcut list and the real menu drifted apart once already —
 * the README advertised a ⌘K that was never wired to anything. These tests read
 * the menu definition as text and hold the two together, which is cheaper than
 * booting Electron to enumerate a live menu.
 */

const menuSource = readFileSync(join(__dirname, '../../src/main/index.ts'), 'utf-8')

function menuAccelerators(): string[] {
  return [...menuSource.matchAll(/accelerator:\s*'([^']+)'/g)].map((m) => m[1])
}

const documented = KEYBINDINGS.flatMap((group) => group.bindings)
const documentedMenuKeys = documented
  .filter((b) => b.source === 'menu')
  .flatMap((b) => [b.keys, ...(b.aliases ?? [])])

describe('keybindings — menu accelerators', () => {
  it('documents every accelerator the menu registers', () => {
    const missing = menuAccelerators().filter((accel) => !documentedMenuKeys.includes(accel))

    expect(missing).toEqual([])
  })

  it('does not document a menu accelerator that no longer exists', () => {
    const registered = menuAccelerators()
    const stale = documentedMenuKeys.filter((keys) => !registered.includes(keys))

    expect(stale).toEqual([])
  })
})

describe('keybindings — menu roles', () => {
  it('names a role that the menu actually declares', () => {
    const roles = documented.filter((b) => b.source === 'role')
    expect(roles.length).toBeGreaterThan(0)

    for (const binding of roles) {
      expect(binding.role, `${binding.label} needs a role name`).toBeTruthy()
      expect(menuSource).toContain(`role: '${binding.role}'`)
    }
  })
})

describe('keybindings — the list itself', () => {
  it('has no duplicate rows within a group', () => {
    for (const group of KEYBINDINGS) {
      const rows = group.bindings.map((b) => `${b.keys}|${b.label}`)
      expect(new Set(rows).size).toBe(rows.length)
    }
  })

  it('gives every binding a label', () => {
    expect(documented.every((b) => b.label.trim().length > 0)).toBe(true)
  })

  it('marks zoom as a role rather than a renderer shortcut', () => {
    // Matching key names by hand missed the minus a non-US layout produces, so
    // Chromium owns these accelerators now.
    const zoom = documented.filter((b) => b.label.toLowerCase().includes('the interface'))
    expect(zoom).toHaveLength(3)
    expect(zoom.every((b) => b.source === 'role')).toBe(true)
  })

  it('keeps gesture entries out of accelerator formatting', () => {
    // A gesture's `keys` is prose; running it through the formatter would
    // mangle it into nonsense.
    const gestures = documented.filter((b) => b.source === 'gesture')
    expect(gestures.length).toBeGreaterThan(0)
    expect(gestures.every((b) => /[a-z]\s/.test(b.keys))).toBe(true)
  })
})

describe('formatAccelerator', () => {
  it('writes macOS modifiers as symbols with no separators', () => {
    expect(formatAccelerator('CmdOrCtrl+Shift+D', true)).toBe('⇧⌘D')
  })

  it('writes other platforms with names and plus signs', () => {
    expect(formatAccelerator('CmdOrCtrl+Shift+D', false)).toBe('Ctrl+Shift+D')
  })

  it('orders modifiers the way macOS does regardless of input order', () => {
    expect(formatAccelerator('CmdOrCtrl+Alt+0', true)).toBe(
      formatAccelerator('Alt+CmdOrCtrl+0', true)
    )
    expect(formatAccelerator('CmdOrCtrl+Alt+0', true)).toBe('⌥⌘0')
  })

  it('turns arrows and editing keys into their symbols', () => {
    expect(formatAccelerator('CmdOrCtrl+Alt+Left', true)).toBe('⌥⌘←')
    expect(formatAccelerator('Delete', true)).toBe('⌫')
    expect(formatAccelerator('Escape', true)).toBe('Esc')
  })

  it('leaves a bare punctuation key alone', () => {
    expect(formatAccelerator('Cmd+,', true)).toBe('⌘,')
  })

  it('keeps multi-character key names readable', () => {
    expect(formatAccelerator('F2', true)).toBe('F2')
  })
})
