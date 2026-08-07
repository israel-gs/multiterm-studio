/**
 * Layout v1 stored the tile arrangement as a mosaic tree. Both the main process
 * (when migrating a file on load) and the canvas (when handed a v1 snapshot)
 * need to flatten it, so the traversal lives here rather than in both.
 */
export function extractLeafIds(node: unknown): string[] {
  if (node === null || node === undefined) return []
  if (typeof node === 'string') return [node]
  if (typeof node === 'object') {
    const obj = node as Record<string, unknown>
    if (Array.isArray(obj.children)) {
      return obj.children.flatMap((child: unknown) => extractLeafIds(child))
    }
    if (obj.first !== undefined || obj.second !== undefined) {
      return [...extractLeafIds(obj.first), ...extractLeafIds(obj.second)]
    }
  }
  return []
}
