// Getting a usable Dark Ages client tree onto macOS and Linux.
//
// The whole point of this directory: on Windows a user runs the official
// installer and Epona reads the folder it made. Everywhere else the installer
// cannot run, so Epona reads it instead — the payload is raw DEFLATE with CRC32s,
// and nothing about unpacking it needs Windows. No Wine, no VM, and no external
// extractor: `zlib` is the only decompressor involved, so there is no dependency
// to bundle, notarize or tell the user to install. See docs/da-installer.md.
//
// Two ways in, because the download is 208 MB and plenty of people already have
// the file:
//
//   installFromInstaller() — a copy the user picked themselves
//   downloadAndInstall()   — fetch it, then the same path as above
//
// Both end at the same place: a validated tree at a directory the caller chose,
// which for Epona becomes `clientPath`.
//
// Headless on purpose. Nothing here imports electron, so Elatha can take the same
// four modules without inheriting Epona's UI. HTOO-97's reasoning applies to when
// that becomes a published package: on Elatha actually consuming it, not before.

import { join } from 'path'
import { readWiseManifest, NotAWiseInstallerError } from './wiseArchive.js'
import { extractClientFiles, ExtractionCancelledError } from './wiseExtract.js'
import { downloadInstaller, DownloadCancelledError } from './installerDownload.js'
import { verifyClientTree } from '../daAssets.js'
import { NotAPortableExecutableError } from './peOverlay.js'

export { DOWNLOAD_PAGE_URL, FALLBACK_INSTALLER_URL } from './installerDownload.js'
export { readWiseManifest } from './wiseArchive.js'

// The filename the downloader caches under. Fixed rather than derived from the
// URL so a re-run finds the previous attempt and can resume or reuse it.
export const CACHED_INSTALLER_NAME = 'DarkAges-installer.exe'

export class InstallError extends Error {
  constructor(message, reason) {
    super(message)
    this.name = 'InstallError'
    this.reason = reason
  }
}

// Unpacks an installer the caller already has on disk.
//
// `onProgress` is forwarded from the extractor and additionally called with
// { phase: 'read' } and { phase: 'verify' }, so a UI can say what is happening
// during the two steps that are not per-file.
export async function installFromInstaller({
  installerPath,
  destinationDir,
  onProgress,
  signal
} = {}) {
  if (typeof installerPath !== 'string' || installerPath.length === 0) {
    throw new InstallError('No installer was chosen', 'no-installer')
  }
  if (typeof destinationDir !== 'string' || destinationDir.length === 0) {
    throw new InstallError('No destination folder was chosen', 'no-destination')
  }

  onProgress?.({ phase: 'read' })
  let manifest
  try {
    manifest = await readWiseManifest(installerPath)
  } catch (error) {
    // The two "this is not the right file" cases are worth distinguishing from a
    // genuine fault, because the fix is different: pick a different file, versus
    // report a bug.
    if (error instanceof NotAWiseInstallerError || error instanceof NotAPortableExecutableError) {
      throw new InstallError(
        `That file is not a Dark Ages installer. ${error.message}`,
        'not-an-installer'
      )
    }
    if (error?.code === 'ENOENT') {
      throw new InstallError('That installer file no longer exists', 'installer-missing')
    }
    throw error
  }

  if (manifest.clientFiles.length === 0) {
    throw new InstallError('That installer contains no Dark Ages client files', 'no-client-files')
  }

  const extraction = await extractClientFiles(installerPath, manifest, destinationDir, {
    onProgress,
    signal
  })

  // Validate what we wrote before telling the caller it is usable. We know what
  // should be there, so a short tree is a real failure and not a judgement call.
  onProgress?.({ phase: 'verify' })
  const verification = await verifyClientTree(destinationDir)
  if (!verification.ok) {
    throw new InstallError(
      verification.reason === 'incomplete-client'
        ? `The unpacked folder is missing ${verification.missing.join(', ')}`
        : `The unpacked folder did not validate (${verification.reason})`,
      'verification-failed'
    )
  }

  return {
    destinationDir,
    installerPath,
    filesWritten: extraction.filesWritten,
    bytesWritten: extraction.bytesWritten,
    skipped: manifest.skipped,
    verification
  }
}

// Downloads the official installer into `cacheDir`, then unpacks it.
//
// The download is resumable and reuses an already-complete copy, so calling this
// twice does not transfer 208 MB twice.
export async function downloadAndInstall({
  cacheDir,
  destinationDir,
  url,
  fetchImpl,
  onProgress,
  signal
} = {}) {
  if (typeof cacheDir !== 'string' || cacheDir.length === 0) {
    throw new InstallError('No download folder was given', 'no-cache-dir')
  }

  const installerPath = join(cacheDir, CACHED_INSTALLER_NAME)
  const download = await downloadInstaller({
    destinationPath: installerPath,
    url,
    fetchImpl,
    onProgress,
    signal
  })

  const result = await installFromInstaller({
    installerPath: download.path,
    destinationDir,
    onProgress,
    signal
  })
  return { ...result, download }
}

// Was this thrown because the user cancelled, rather than because something
// broke? Callers use it to stay quiet instead of showing an error.
export function isCancellation(error) {
  return error instanceof DownloadCancelledError || error instanceof ExtractionCancelledError
}
