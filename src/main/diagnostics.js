import { clipboard, shell } from 'electron'
import os from 'os'
import { z } from 'zod'
import { appIdentity } from '../shared/appIdentity.js'
import { simplifyPlatform } from '../shared/osName.js'
import { buildDiagnosticsBlock } from '../shared/diagnostics.js'
import {
  buildIssueUrl,
  truncateBodyForUrl,
  TRUNCATION_NOTE,
  TRUNCATION_NOTE_NOT_COPIED
} from '../shared/issueUrl.js'
import { scrubText } from '../shared/scrub.js'
import { captureError, getRecentErrors, getLogsDir } from './sessionLog.js'

// Backing logic + IPC handlers for the Report Issue / diagnostics module. Pure-helper
// composition (src/shared/*) + Electron clipboard/shell. Payloads are validated with
// zod at the boundary; generous maxes just cap abuse (real payloads are far smaller).
export { buildIssueUrl }

// Conservative budget: shell.openExternal is reliable to ~2 KB; leave headroom.
const MAX_URL_LEN = 1800

// How long the report flow waits for the clipboard before it gives up on it.
export const CLIPBOARD_WAIT_MS = 3000

const rendererErrorSchema = z.object({
  source: z.string().max(40),
  message: z.string().max(10_000),
  stack: z.string().max(50_000).optional()
})
const openIssueSchema = z.object({
  title: z.string().max(500),
  body: z.string().max(200_000)
})
const copyReportSchema = z.object({
  body: z.string().max(200_000)
})

/**
 * The scrubbed diagnostics block shown (editable) in the report dialog. Errors in
 * the ring buffer are already scrubbed at capture time; a second pass here is
 * cheap, idempotent insurance over the fully assembled block.
 */
export function buildDiagnostics({ version } = {}) {
  const block = buildDiagnosticsBlock({
    productName: appIdentity.productName,
    version,
    os: simplifyPlatform(process.platform),
    errors: getRecentErrors()
  })
  let userName
  try {
    userName = os.userInfo().username
  } catch {
    userName = undefined
  }
  return scrubText(block, { homeDir: os.homedir(), userName })
}

/**
 * Open a prefilled GitHub issue on the shared public intake repo. Always copies the
 * full body to the clipboard first, so a URL-length-truncated body can be pasted.
 *
 * Only the stable per-app label is applied via the URL — GitHub applies a `labels=`
 * value only when that label already exists on the repo, so unbounded version labels
 * would silently no-op. The version already rides along in the diagnostics body.
 */
export async function openIssue({ title, body }) {
  // Wait for the copy before the browser opens: the page tells the user to paste
  // the report. A failed copy does not block the report, because the URL still
  // carries the body; the dialog and the truncation note then say so.
  const copied = await writeClipboard(body, 'openIssue')
  const labels = [appIdentity.appLabel]
  const { url, truncated } = truncateBodyForUrl(
    { owner: appIdentity.intakeOwner, repo: appIdentity.intakeRepo, title, body, labels },
    MAX_URL_LEN,
    copied ? TRUNCATION_NOTE : TRUNCATION_NOTE_NOT_COPIED
  )
  void shell.openExternal(url)
  return { ok: true, truncated, copied }
}

/** Always-works fallback: put the full report on the clipboard. */
export async function copyReport({ body }) {
  if (!(await writeClipboard(body, 'copyReport'))) throw new Error('clipboard write failed')
  return { ok: true }
}

/**
 * Electron 44's main-process clipboard returns a Promise. The wait is bounded: a
 * clipboard that another process holds must not hang the report flow. Returns
 * whether the write finished; a failure goes to the session log.
 */
async function writeClipboard(text, source) {
  let timer
  try {
    await Promise.race([
      clipboard.writeText(text),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('timed out')), CLIPBOARD_WAIT_MS)
      })
    ])
    return true
  } catch (err) {
    captureError({ source, message: `clipboard write failed: ${String(err)}` })
    return false
  } finally {
    clearTimeout(timer)
  }
}

/** Forward a scrubbed renderer error into the shared session log + ring buffer. */
export function reportRendererError(payload) {
  const p = rendererErrorSchema.parse(payload)
  captureError({ source: p.source, origin: 'renderer', message: p.message, stack: p.stack })
}

/**
 * Register the diagnostics:* IPC handlers. `getVersion` supplies the app version for
 * the diagnostics block (kept as a callback so this module needs no `app` import).
 */
export function registerDiagnosticsHandlers(ipcMain, getVersion) {
  // Renderer errors are forwarded here so main + renderer + React errors all land
  // in one scrubbed session log.
  ipcMain.handle('diagnostics:reportRendererError', (_, payload) => reportRendererError(payload))
  ipcMain.handle('diagnostics:build', () => buildDiagnostics({ version: getVersion() }))
  ipcMain.handle('diagnostics:openIssue', (_, payload) => openIssue(openIssueSchema.parse(payload)))
  ipcMain.handle('diagnostics:copyReport', (_, payload) =>
    copyReport(copyReportSchema.parse(payload))
  )
  ipcMain.handle('diagnostics:revealLogs', () => {
    const dir = getLogsDir()
    if (dir) void shell.openPath(dir)
  })
}
