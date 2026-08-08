// Fetching the official Dark Ages installer.
//
// The installer is a 208 MB single file on KRU's S3 bucket, linked from the
// download page on darkages.com. S3 serves ETag, Last-Modified and honours range
// requests, which is what makes resume and safe reuse possible here rather than
// aspirational.
//
// Two rules shape this module:
//
//  * A partial download must never be mistakable for a finished one. Bytes land
//    in a `.part` file and are promoted by rename only after the transfer has
//    delivered exactly the length the server advertised.
//  * A finished download should not be fetched twice. The `.part` file's sibling
//    `.meta.json` records the ETag, Last-Modified and length it was fetched
//    under, and a re-run that agrees with the server on all three reuses it.

import { promises as fs, createWriteStream } from 'fs'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'

// The download page. Linked installer URLs are read from here so a version bump
// on KRU's side does not need a release of Epona.
export const DOWNLOAD_PAGE_URL = 'https://www.darkages.com/download/client.html'

// Where the page pointed when this was written. Used when the page cannot be
// read or stops carrying a recognisable link, so the feature degrades to "the
// version we know about" rather than to nothing.
export const FALLBACK_INSTALLER_URL =
  'https://s3.amazonaws.com/kru-downloads/da/DarkAges741single.exe'

// A single-file client installer, e.g. DarkAges741single.exe. The `single` is
// what distinguishes it from the incremental patch installers on the same page,
// which are not usable as a source tree.
const INSTALLER_LINK = /https?:\/\/[^"'\s>]*DarkAges\d+single\.exe/i

// A floor for the reuse path, aimed at one specific thing: an HTML error page
// saved under the installer's name and then reused forever. Those are kilobytes.
//
// Deliberately NOT set near the real installer's 208 MB. Pinning it there would
// encode "the Dark Ages installer is at least this big" as a correctness rule,
// and a smaller future release would then be permanently un-reusable for a reason
// nobody would think to look for. Agreement with the server's content-length and
// validators is what actually establishes the file is the right one; this is only
// here to catch the degenerate case.
const MIN_PLAUSIBLE_INSTALLER_SIZE = 1024 * 1024

export class DownloadError extends Error {
  constructor(message, reason) {
    super(message)
    this.name = 'DownloadError'
    this.reason = reason
  }
}

export class DownloadCancelledError extends Error {
  constructor() {
    super('Download cancelled')
    this.name = 'DownloadCancelledError'
    this.reason = 'cancelled'
  }
}

function isAbort(error) {
  return error?.name === 'AbortError' || error?.name === 'DownloadCancelledError'
}

// Turns a fetch-layer failure into something worth showing a user. `fetch` throws
// a bare TypeError for everything from no DNS to a refused connection, so the
// cause chain is the only place the detail lives.
function networkError(error, url) {
  if (isAbort(error)) return new DownloadCancelledError()
  const code = error?.cause?.code
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return new DownloadError(
      `Could not reach ${new URL(url).host}. Check your internet connection.`,
      'offline'
    )
  }
  if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') {
    return new DownloadError(
      `The connection to ${new URL(url).host} was interrupted. Try again.`,
      'interrupted'
    )
  }
  return new DownloadError(`Could not download the installer: ${error.message}`, 'network')
}

// Reads the download page and returns the installer URL it links to.
//
// Falls back rather than throwing: a resolvable-but-stale URL is far more useful
// to a user than an error, and the page is plain 1990s HTML with no API contract
// behind it.
export async function resolveInstallerUrl({ fetchImpl = fetch, signal } = {}) {
  try {
    const response = await fetchImpl(DOWNLOAD_PAGE_URL, { signal, redirect: 'follow' })
    if (!response.ok) return { url: FALLBACK_INSTALLER_URL, resolved: false }
    const html = await response.text()
    const match = INSTALLER_LINK.exec(html)
    if (!match) return { url: FALLBACK_INSTALLER_URL, resolved: false }
    return { url: match[0], resolved: true }
  } catch (error) {
    if (isAbort(error)) throw new DownloadCancelledError()
    return { url: FALLBACK_INSTALLER_URL, resolved: false }
  }
}

function metaPathFor(destinationPath) {
  return `${destinationPath}.meta.json`
}

async function readMeta(destinationPath) {
  try {
    return JSON.parse(await fs.readFile(metaPathFor(destinationPath), 'utf8'))
  } catch {
    return null
  }
}

async function statSize(path) {
  try {
    const stat = await fs.stat(path)
    return stat.isFile() ? stat.size : null
  } catch {
    return null
  }
}

// Asks the server for length and validators without transferring the body.
async function probe(url, fetchImpl, signal) {
  let response
  try {
    response = await fetchImpl(url, { method: 'HEAD', signal, redirect: 'follow' })
  } catch (error) {
    throw networkError(error, url)
  }
  if (!response.ok) {
    throw new DownloadError(
      `The download server answered ${response.status} for the installer.`,
      'http-status'
    )
  }
  const length = Number(response.headers.get('content-length'))
  return {
    url: response.url || url,
    length: Number.isFinite(length) && length > 0 ? length : null,
    etag: response.headers.get('etag'),
    lastModified: response.headers.get('last-modified')
  }
}

// Can we skip the transfer entirely?
//
// Only when a complete file is already there AND the recorded validators still
// match what the server says. Matching on length alone is not enough: KRU could
// republish at the same size, and re-extracting a stale client would be a
// confusing failure a long way from its cause.
function canReuse(existingSize, meta, remote) {
  if (existingSize === null) return false
  if (existingSize < MIN_PLAUSIBLE_INSTALLER_SIZE) return false
  if (remote.length !== null && existingSize !== remote.length) return false
  if (!meta) return remote.length !== null && existingSize === remote.length
  if (remote.etag && meta.etag && remote.etag !== meta.etag) return false
  if (remote.lastModified && meta.lastModified && remote.lastModified !== meta.lastModified) {
    return false
  }
  return true
}

// Downloads the installer to `destinationPath`, resuming a previous attempt when
// the server still offers the same bytes.
//
// `onProgress` receives { phase, bytesDone, totalBytes, reused }. `signal` aborts
// the transfer and leaves the `.part` file in place, so the next call resumes
// from where this one stopped.
export async function downloadInstaller({
  destinationPath,
  url,
  fetchImpl = fetch,
  onProgress,
  signal
} = {}) {
  if (typeof destinationPath !== 'string' || destinationPath.length === 0) {
    throw new DownloadError('No download destination was given', 'no-destination')
  }
  if (signal?.aborted) throw new DownloadCancelledError()

  let targetUrl = url
  if (!targetUrl) {
    onProgress?.({ phase: 'resolve' })
    targetUrl = (await resolveInstallerUrl({ fetchImpl, signal })).url
  }

  const remote = await probe(targetUrl, fetchImpl, signal)
  const existingSize = await statSize(destinationPath)
  const meta = await readMeta(destinationPath)

  if (canReuse(existingSize, meta, remote)) {
    onProgress?.({
      phase: 'reuse',
      bytesDone: existingSize,
      totalBytes: existingSize,
      reused: true
    })
    return { path: destinationPath, bytes: existingSize, reused: true, url: remote.url }
  }

  const partPath = `${destinationPath}.part`
  let resumeFrom = (await statSize(partPath)) ?? 0

  // A stale part file — one fetched under different validators, or longer than
  // the file now is — cannot be resumed into a correct result.
  const partMeta = await readMeta(partPath)
  const validatorsChanged =
    partMeta &&
    ((remote.etag && partMeta.etag && remote.etag !== partMeta.etag) ||
      (remote.lastModified &&
        partMeta.lastModified &&
        remote.lastModified !== partMeta.lastModified))
  if (validatorsChanged || (remote.length !== null && resumeFrom >= remote.length)) {
    await fs.rm(partPath, { force: true })
    resumeFrom = 0
  }

  const headers = {}
  if (resumeFrom > 0) headers.Range = `bytes=${resumeFrom}-`

  let response
  try {
    response = await fetchImpl(remote.url, { headers, signal, redirect: 'follow' })
  } catch (error) {
    throw networkError(error, remote.url)
  }

  if (resumeFrom > 0 && response.status !== 206) {
    // The server ignored the range. Start over rather than append to the middle
    // of a file and produce a plausible-looking corrupt installer.
    await fs.rm(partPath, { force: true })
    resumeFrom = 0
  }
  if (!response.ok) {
    throw new DownloadError(
      `The download server answered ${response.status} for the installer.`,
      'http-status'
    )
  }
  if (!response.body) {
    throw new DownloadError('The download server sent no data.', 'empty-response')
  }

  const totalBytes = remote.length ?? resumeFrom + Number(response.headers.get('content-length'))
  await fs.mkdir(dirnameOf(destinationPath), { recursive: true })
  await fs.writeFile(
    metaPathFor(partPath),
    JSON.stringify({ etag: remote.etag, lastModified: remote.lastModified, url: remote.url })
  )

  let bytesDone = resumeFrom
  const source = Readable.fromWeb(response.body)
  source.on('data', (chunk) => {
    bytesDone += chunk.length
    onProgress?.({ phase: 'download', bytesDone, totalBytes, reused: false })
  })

  try {
    await pipeline(source, createWriteStream(partPath, { flags: resumeFrom > 0 ? 'a' : 'w' }))
  } catch (error) {
    if (isAbort(error) || signal?.aborted) throw new DownloadCancelledError()
    throw networkError(error, remote.url)
  }

  // The promotion gate. Short bytes here mean a truncated transfer that happened
  // not to raise, and promoting it would hand the extractor a file that looks
  // like an installer and is not one.
  const finalSize = await statSize(partPath)
  if (Number.isFinite(totalBytes) && totalBytes > 0 && finalSize !== totalBytes) {
    throw new DownloadError(
      `The download ended early: got ${finalSize} bytes of ${totalBytes}. Try again.`,
      'truncated'
    )
  }

  await fs.rm(destinationPath, { force: true })
  await fs.rename(partPath, destinationPath)
  await fs.rm(metaPathFor(partPath), { force: true })
  await fs.writeFile(
    metaPathFor(destinationPath),
    JSON.stringify({
      etag: remote.etag,
      lastModified: remote.lastModified,
      url: remote.url,
      bytes: finalSize
    })
  )

  return { path: destinationPath, bytes: finalSize, reused: false, url: remote.url }
}

// Kept local so this module imports no path helper for one call and stays easy to
// exercise with in-memory doubles.
function dirnameOf(filePath) {
  const at = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  return at <= 0 ? '.' : filePath.slice(0, at)
}
