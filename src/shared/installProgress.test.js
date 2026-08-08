import { describe, it, expect } from 'vitest'
import {
  formatBytes,
  installPercent,
  describeInstallProgress,
  describeInstallResult
} from './installProgress.js'

describe('formatBytes', () => {
  it('uses binary units, since these come from file lengths', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1024)).toBe('1.0 KiB')
    expect(formatBytes(1536)).toBe('1.5 KiB')
    expect(formatBytes(13560544)).toBe('12.9 MiB')
  })

  it('drops the decimal once the number is big enough not to need it', () => {
    expect(formatBytes(208513633)).toBe('199 MiB')
    expect(formatBytes(610802176)).toBe('583 MiB')
  })

  it('returns nothing for a value it cannot describe', () => {
    expect(formatBytes(undefined)).toBe('')
    expect(formatBytes(-1)).toBe('')
    expect(formatBytes(NaN)).toBe('')
  })
})

describe('installPercent', () => {
  it('is a whole percentage of the advertised total', () => {
    expect(installPercent({ bytesDone: 50, totalBytes: 200 })).toBe(25)
    expect(installPercent({ bytesDone: 200, totalBytes: 200 })).toBe(100)
  })

  it('is null when there is no denominator, so the bar goes indeterminate', () => {
    // A determinate bar pinned at 0% reads as stalled, which is exactly the wrong
    // thing to show while the installer is being read.
    expect(installPercent({ phase: 'read' })).toBeNull()
    expect(installPercent({ bytesDone: 5, totalBytes: 0 })).toBeNull()
    expect(installPercent(null)).toBeNull()
  })

  it('never reports outside 0-100 even if the counts disagree', () => {
    expect(installPercent({ bytesDone: 300, totalBytes: 200 })).toBe(100)
    expect(installPercent({ bytesDone: -5, totalBytes: 200 })).toBe(0)
  })
})

describe('describeInstallProgress', () => {
  it('names each phase of the install', () => {
    expect(describeInstallProgress({ phase: 'resolve' })).toMatch(/finding/i)
    expect(describeInstallProgress({ phase: 'read' })).toMatch(/reading/i)
    expect(describeInstallProgress({ phase: 'verify' })).toMatch(/checking/i)
  })

  it('shows how much of the download has arrived', () => {
    expect(
      describeInstallProgress({ phase: 'download', bytesDone: 1048576, totalBytes: 2097152 })
    ).toBe('Downloading 1.0 MiB of 2.0 MiB')
  })

  it('still reports a download whose total the server did not give', () => {
    expect(describeInstallProgress({ phase: 'download', bytesDone: 1024 })).toBe(
      'Downloading 1.0 KiB'
    )
  })

  it('says when it is reusing an existing download', () => {
    // Otherwise a second attempt looks like it skipped the download by mistake.
    expect(describeInstallProgress({ phase: 'reuse' })).toMatch(/already downloaded/i)
  })

  it('counts files while unpacking', () => {
    expect(
      describeInstallProgress({ phase: 'extract', filesDone: 3, filesTotal: 101, bytesDone: 1024 })
    ).toBe('Unpacking 3 of 101 files — 1.0 KiB')
  })

  it('renders nothing before the first event', () => {
    expect(describeInstallProgress(null)).toBe('')
  })
})

describe('describeInstallResult', () => {
  it('reports a completed install with what it wrote', () => {
    expect(describeInstallResult({ ok: true, filesWritten: 101, bytesWritten: 610802176 })).toEqual(
      {
        severity: 'success',
        text: 'Installed 101 files (583 MiB)'
      }
    )
  })

  it('warns when the tree is usable but something could not be verified', () => {
    // A usable-but-short tree must not report as a clean success. Saying nothing
    // is the failure this flow exists to prevent.
    const result = describeInstallResult({
      ok: true,
      filesWritten: 100,
      bytesWritten: 1024,
      skipped: [{ destFile: '%MAINDIR%\\x.dat', reason: 'crc-unconfirmed' }]
    })
    expect(result.severity).toBe('warning')
    expect(result.text).toMatch(/1 could not be verified/)
  })

  it('treats a cancellation as information, not as an error', () => {
    expect(describeInstallResult({ ok: false, reason: 'cancelled' })).toEqual({
      severity: 'info',
      text: 'Install cancelled'
    })
  })

  it('passes a failure message through so the cause is visible', () => {
    expect(
      describeInstallResult({ ok: false, reason: 'not-an-installer', message: 'That file is not…' })
    ).toEqual({ severity: 'error', text: 'That file is not…' })
  })

  it('has a fallback for a failure with no message', () => {
    expect(describeInstallResult({ ok: false }).text).toBe('The install failed')
  })

  it('renders nothing before an install has run', () => {
    expect(describeInstallResult(null)).toBeNull()
  })
})
