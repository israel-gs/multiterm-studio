// The OSC 7 escape sequence notifies the terminal of the current working directory.
// Format: \e]7;file://<host><absolute-path>\a
const OSC7_EMIT = `printf '\\e]7;file://%s%s\\a' "$(hostname)" "$PWD"`

// The function name uses the _MTS_ namespace to avoid collisions.
const HOOK_FN = '__mts_osc7'

function buildOsc7Function(): string {
  return `${HOOK_FN}() { ${OSC7_EMIT}; }`
}

/**
 * Returns a one-line shell snippet to inject into the PTY after spawn,
 * or null if the shell handles OSC 7 natively (fish) or is unrecognised.
 *
 * The snippet ends with `clear` so the injected setup does not pollute the
 * user's visible scroll history.
 */
export function osc7ShellHook(shell: string): string | null {
  const base = shell.split('/').pop() ?? shell

  if (base === 'zsh') {
    const fn = buildOsc7Function()
    return `${fn}; precmd_functions+=(${HOOK_FN}); clear`
  }

  if (base === 'bash' || base === 'sh') {
    const fn = buildOsc7Function()
    // Preserve any existing PROMPT_COMMAND while prepending our hook.
    return `${fn}; ` + `PROMPT_COMMAND="${HOOK_FN}; \${PROMPT_COMMAND:-}"; ` + `clear`
  }

  // fish emits OSC 7 natively — no injection needed.
  return null
}
