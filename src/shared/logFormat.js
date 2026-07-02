// Pure formatter shared by the main process (auto-save on child exit) and the
// renderer (manual save-dialog path). Turns buffered log records into a single
// text blob, tagging stderr/exit lines so the saved file stays meaningful when
// opened away from the UI. electron-vite bundles main and renderer separately,
// so a dependency-free ESM util imports cleanly into both.
//
// Each record is { stream: 'stdout' | 'stderr' | 'exit', text: string }.
export function formatLogLines(lines) {
  return lines
    .map(({ stream, text }) => {
      if (stream === 'stderr') return `[stderr] ${text}`
      if (stream === 'exit') return `[exit] ${text}`
      return text
    })
    .join('\n')
}
