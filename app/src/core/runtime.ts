/**
 * Which runtime are we on? `imports` is a GJS global that Node does not have. It decides whether
 * the process needs a GLib main loop to stay alive.
 */

export function runningOnGjs(): boolean {
  return typeof (globalThis as { imports?: unknown }).imports !== 'undefined';
}

/** Version reported by `--version` and to MCP clients. */
export const VERSION = '0.1.0';
