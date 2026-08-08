// Wording and arithmetic for the Dark Ages install progress readout.
//
// In src/shared for the usual reason: the renderer displays it, the main process
// produces the raw events, and neither should own the sentences. Pure functions,
// so the wording is testable without a DOM or a 208 MB download.

// Byte sizes a person can read. Binary units, because the sizes being reported
// come from file lengths rather than from a marketing figure.
export function formatBytes(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  const units = ['KiB', 'MiB', 'GiB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

// A 0-100 percentage, or null when the phase has no meaningful total.
//
// Null matters: the download's total is known from content-length, but the
// resolve and verify phases have no denominator, and a progress bar that sits at
// 0% reads as stalled. The caller renders an indeterminate bar for null.
export function installPercent(progress) {
  if (!progress) return null
  const { bytesDone, totalBytes } = progress
  if (typeof bytesDone !== 'number' || typeof totalBytes !== 'number' || totalBytes <= 0) {
    return null
  }
  return Math.max(0, Math.min(100, Math.round((bytesDone / totalBytes) * 100)))
}

// One line describing where the install has got to.
export function describeInstallProgress(progress) {
  if (!progress) return ''
  switch (progress.phase) {
    case 'resolve':
      return 'Finding the current installer…'
    case 'download': {
      const done = formatBytes(progress.bytesDone)
      const total = formatBytes(progress.totalBytes)
      return total ? `Downloading ${done} of ${total}` : `Downloading ${done}`
    }
    case 'reuse':
      // Worth saying rather than skipping silently: without it, a second attempt
      // looks like it ignored the download step by mistake.
      return 'Using the installer already downloaded'
    case 'read':
      return 'Reading the installer…'
    case 'extract': {
      const { filesDone, filesTotal } = progress
      const counted =
        typeof filesDone === 'number' && typeof filesTotal === 'number'
          ? `${filesDone} of ${filesTotal} files`
          : 'files'
      return `Unpacking ${counted} — ${formatBytes(progress.bytesDone)}`
    }
    case 'verify':
      return 'Checking the unpacked files…'
    default:
      return 'Working…'
  }
}

// The message shown when an install ends. `result` is what the IPC handlers
// return: { ok: true, ... } or { ok: false, reason, message }.
export function describeInstallResult(result) {
  if (!result) return null
  if (result.ok) {
    const files = result.filesWritten
    const size = formatBytes(result.bytesWritten)
    const base =
      typeof files === 'number'
        ? `Installed ${files} files${size ? ` (${size})` : ''}`
        : 'Dark Ages installed'
    // A usable tree that was still short of something has to say so. Silence here
    // would be the one failure mode this whole flow is built to avoid.
    const short = Array.isArray(result.skipped) && result.skipped.length > 0
    return {
      severity: short ? 'warning' : 'success',
      text: short ? `${base}, but ${result.skipped.length} could not be verified` : base
    }
  }
  if (result.reason === 'cancelled') return { severity: 'info', text: 'Install cancelled' }
  return { severity: 'error', text: result.message || 'The install failed' }
}
