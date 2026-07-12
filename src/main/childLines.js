import { createLineBuffer } from './lineBuffer.js'

// Wire a child process's stdout/stderr through line buffers into per-stream line
// callbacks, flushing both on stream 'end' and on 'exit', and formatting spawn
// 'error' events as a `[spawn error] <msg>` line. The onExit callback fires only
// after both buffers are flushed, so no trailing partial line is lost.
//
// Pure wiring — no Electron/IPC — so it's unit-testable; callers supply the
// channel-specific side effects (renderer sends, auto-save, cleanup, tracking).
export function pipeChildLines(child, { onStdoutLine, onStderrLine, onExit, onErrorLine }) {
  const stdout = createLineBuffer(onStdoutLine)
  const stderr = createLineBuffer(onStderrLine)
  child.stdout?.on('data', stdout.push)
  child.stderr?.on('data', stderr.push)
  child.stdout?.on('end', stdout.flush)
  child.stderr?.on('end', stderr.flush)
  child.on('exit', (code, signal) => {
    stdout.flush()
    stderr.flush()
    onExit?.(code, signal)
  })
  child.on('error', (err) => onErrorLine?.(`[spawn error] ${err.message}`))
}
