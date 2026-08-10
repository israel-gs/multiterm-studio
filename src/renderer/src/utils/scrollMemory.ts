/**
 * Scroll positions of editors, remembered across remounts.
 *
 * Maximizing a tile re-parents its card into a portal on document.body, which
 * unmounts and remounts everything inside it — a fresh Monaco editor, scrolled
 * back to the top. The position is kept here, outside React, so the new editor
 * can pick up where the old one left off.
 *
 * Entries are dropped when their tile is closed, so this grows with tiles
 * currently open rather than with tiles ever opened.
 */
const positions = new Map<string, number>()

export function rememberScroll(key: string, top: number): void {
  positions.set(key, top)
}

export function recallScroll(key: string): number | undefined {
  return positions.get(key)
}

export function forgetScroll(key: string): void {
  positions.delete(key)
}
