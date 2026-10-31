import { createLineBuffer } from './lineBuffer.js'

// Wire a child process's stdout/stderr through line buffers into per-stream line
// callbacks, flushing both on stream 'end' and on 'exit', and formatting spawn
// 'error' events as a `[spawn error] <msg>` line. The onExit callback fires only
// after both buffers are flushed, so no trailing partial line is lost.
//
// onExit fires once, with (code, signal, error). A process that never started
// (ENOENT for a missing `dotnet` or working folder, EACCES) emits 'error' and no
// 'exit', and has no pid. That error ends the child: onExit gets (null, null,
// err) after the `[spawn error]` line, so a caller that untracks and cleans up on
// exit does the same here (HTOO-589). An 'error' from a process that did start
// (a failed kill) is only a line.
//
// Pure wiring — no Electron/IPC — so it's unit-testable; callers supply the
// channel-specific side effects (renderer sends, auto-save, cleanup, tracking).
export function pipeChildLines(child, { onStdoutLine, onStderrLine, onExit, onErrorLine }) {
  const stdout = createLineBuffer(onStdoutLine)
  const stderr = createLineBuffer(onStderrLine)
  let ended = false
  const end = (code, signal, error) => {
    if (ended) return
    ended = true
    stdout.flush()
    stderr.flush()
    onExit?.(code, signal, error)
  }
  child.stdout?.on('data', stdout.push)
  child.stderr?.on('data', stderr.push)
  child.stdout?.on('end', stdout.flush)
  child.stderr?.on('end', stderr.flush)
  child.on('exit', (code, signal) => end(code, signal))
  child.on('error', (err) => {
    onErrorLine?.(`[spawn error] ${err.message}`)
    if (child.pid === undefined) end(null, null, err)
  })
}
