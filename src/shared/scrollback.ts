/**
 * Scrollback buffer bounds, shared by the main process, the sidecar and the
 * settings UI.
 *
 * These used to be declared separately in four files; a change to one of them
 * silently disagreed with the others (the UI could offer a value the sidecar
 * would clamp away).
 */

/** Default scrollback retained per session: 8 MB. */
export const SCROLLBACK_DEFAULT_BYTES = 8 * 1024 * 1024

/** Smallest configurable scrollback: 16 KB. */
export const SCROLLBACK_MIN_BYTES = 16 * 1024

/** Largest configurable scrollback: 64 MB. */
export const SCROLLBACK_MAX_BYTES = 64 * 1024 * 1024

/** Clamps a requested size into the supported range. */
export function clampScrollbackBytes(bytes: number): number {
  return Math.min(SCROLLBACK_MAX_BYTES, Math.max(SCROLLBACK_MIN_BYTES, bytes))
}
