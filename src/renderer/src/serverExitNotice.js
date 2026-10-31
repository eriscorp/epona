// The notice for a server that exited when nobody asked it to (HTOO-590). Main
// marks such an exit `unexpected` on `instance:childExit`. The notice names the
// server, says how it ended, and quotes the run's last error line, so a failed
// build or a fatal config error is seen with the Log Pane closed.

// Longer lines are cut, so the notice stays a few lines high in a 480 px window.
export const NOTICE_LINE_MAX = 160

/**
 * The last line worth quoting from this run's log: the last stderr line, or the
 * last stdout line when the run wrote nothing to stderr. A dotnet build writes
 * its errors to stdout; the server writes a refused option to stderr and then
 * its usage text to stdout, so stderr comes first. The scan stops at the
 * previous run's exit line: the log keeps earlier runs, and their errors are not
 * this run's.
 *
 * @param {{ stream: string, text: string }[]} lines the instance's log
 * @returns {string|null}
 */
export function lastErrorLine(lines) {
  let stdout = null
  for (let i = lines.length - 1; i >= 0; i--) {
    const { stream, text } = lines[i]
    if (stream === 'exit') break
    if (!text?.trim()) continue
    if (stream === 'stderr') return text.trim()
    if (stream === 'stdout' && stdout === null) stdout = text.trim()
  }
  return stdout
}

/**
 * @param {{ name: string, code: number|null, signal: string|null, lines: { stream: string, text: string }[] }} exit
 * @returns {string}
 */
export function serverExitNotice({ name, code, signal, lines }) {
  const what =
    code === null && !signal
      ? `Server "${name}" did not start`
      : `Server "${name}" stopped (${signal ? `signal ${signal}` : `exit code ${code}`})`
  const line = lastErrorLine(lines)
  if (!line) return `${what}.`
  const quoted = line.length > NOTICE_LINE_MAX ? `${line.slice(0, NOTICE_LINE_MAX - 1)}…` : line
  return `${what}: ${quoted}`
}
