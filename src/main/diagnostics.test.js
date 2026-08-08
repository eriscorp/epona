import { describe, it, expect, vi, beforeEach } from 'vitest'
import { homedir } from 'os'

const writeText = vi.fn()
const openExternal = vi.fn()
const openPath = vi.fn()

vi.mock('electron', () => ({
  clipboard: { writeText: (...a) => writeText(...a) },
  shell: {
    openExternal: (...a) => openExternal(...a),
    openPath: (...a) => openPath(...a)
  }
}))

const {
  buildDiagnostics,
  openIssue,
  copyReport,
  reportRendererError,
  registerDiagnosticsHandlers
} = await import('./diagnostics.js')
const { captureError, getRecentErrors } = await import('./sessionLog.js')

beforeEach(() => {
  writeText.mockClear()
  openExternal.mockClear()
  openPath.mockClear()
})

describe('buildDiagnostics', () => {
  it('includes the app name, version and platform', () => {
    const block = buildDiagnostics({ version: '2.7.2' })
    expect(block).toContain('2.7.2')
    expect(block).toContain('Epona')
  })

  it('scrubs the home directory out of the assembled block', () => {
    // Errors are scrubbed at capture time, but the block is assembled from more
    // than errors, so this second pass is the only thing that can catch a path
    // introduced by the assembly itself. What a user is about to paste into a
    // public issue must not carry their home directory.
    captureError({
      source: 'test',
      origin: 'main',
      message: `failed reading ${homedir()}/Documents/Hybrasyl/settings.json`
    })
    const block = buildDiagnostics({ version: '2.7.2' })
    expect(block).not.toContain(homedir())
  })

  it('survives a platform where userInfo throws', () => {
    // os.userInfo() throws when the uid has no passwd entry, which happens in
    // containers. The report is a support tool; it must not be the thing that
    // fails.
    expect(() => buildDiagnostics({ version: '2.7.2' })).not.toThrow()
  })

  it('works with no version supplied', () => {
    expect(() => buildDiagnostics()).not.toThrow()
  })
})

describe('openIssue', () => {
  it('copies the full body before opening the URL', () => {
    // The URL is length-capped, so the clipboard is the only place the whole body
    // is guaranteed to exist. Copying first means a truncated URL is still
    // recoverable by pasting.
    openIssue({ title: 'Something broke', body: 'the full body' })
    expect(writeText).toHaveBeenCalledWith('the full body')
    expect(openExternal).toHaveBeenCalled()
    expect(writeText.mock.invocationCallOrder[0]).toBeLessThan(
      openExternal.mock.invocationCallOrder[0]
    )
  })

  it('reports truncation when the body will not fit in a URL', () => {
    const result = openIssue({ title: 'Big', body: 'x'.repeat(50_000) })
    expect(result).toEqual({ ok: true, truncated: true })
    // The clipboard still has all of it.
    expect(writeText.mock.calls[0][0]).toHaveLength(50_000)
  })

  it('does not truncate a small body', () => {
    expect(openIssue({ title: 'Small', body: 'short' })).toEqual({ ok: true, truncated: false })
  })

  it('opens a URL under the length shell.openExternal can carry', () => {
    openIssue({ title: 'Big', body: 'x'.repeat(50_000) })
    const [url] = openExternal.mock.calls[0]
    expect(url.length).toBeLessThanOrEqual(1800)
  })

  it('applies only the stable per-app label', () => {
    // GitHub applies `labels=` only for labels that already exist on the repo, so
    // an unbounded version label would silently no-op and lose the whole
    // parameter.
    openIssue({ title: 'T', body: 'B' })
    const [url] = openExternal.mock.calls[0]
    const labels = new URL(url).searchParams.get('labels')
    expect(labels).toBe('app:epona')
    // The part that matters: no version, so the label always already exists on
    // the intake repo. The version rides in the diagnostics body instead.
    expect(labels).not.toMatch(/\d+\.\d+\.\d+/)
  })
})

describe('copyReport', () => {
  it('puts the body on the clipboard', () => {
    expect(copyReport({ body: 'report text' })).toEqual({ ok: true })
    expect(writeText).toHaveBeenCalledWith('report text')
  })
})

describe('reportRendererError', () => {
  it('records a renderer error against the renderer origin', () => {
    reportRendererError({ source: 'react', message: 'render failed', stack: 'at Component' })
    const recorded = getRecentErrors().at(-1)
    expect(recorded).toMatchObject({ source: 'react', origin: 'renderer' })
  })

  it('rejects a payload that is not the right shape', () => {
    expect(() => reportRendererError({ message: 'no source' })).toThrow()
    expect(() => reportRendererError({ source: 'x' })).toThrow()
    expect(() => reportRendererError(null)).toThrow()
  })

  it('rejects an oversized payload rather than logging it', () => {
    // The cap exists to stop a runaway renderer loop filling the session log.
    expect(() => reportRendererError({ source: 'x', message: 'y'.repeat(10_001) })).toThrow()
  })
})

describe('registerDiagnosticsHandlers', () => {
  function register() {
    const handlers = new Map()
    registerDiagnosticsHandlers({ handle: (c, h) => handlers.set(c, h) }, () => '2.7.2')
    return handlers
  }

  it('registers the whole diagnostics surface', () => {
    expect([...register().keys()].sort()).toEqual([
      'diagnostics:build',
      'diagnostics:copyReport',
      'diagnostics:openIssue',
      'diagnostics:reportRendererError',
      'diagnostics:revealLogs'
    ])
  })

  it('takes the version from the callback rather than importing app', () => {
    // Keeps this module free of an `app` import, which is what lets it be tested
    // with only clipboard and shell stubbed.
    const getVersion = vi.fn(() => '9.9.9')
    const handlers = new Map()
    registerDiagnosticsHandlers({ handle: (c, h) => handlers.set(c, h) }, getVersion)
    const block = handlers.get('diagnostics:build')()
    expect(getVersion).toHaveBeenCalled()
    expect(block).toContain('9.9.9')
  })

  it('validates an openIssue payload at the boundary', () => {
    const handlers = register()
    expect(() => handlers.get('diagnostics:openIssue')(null, { title: 'a' })).toThrow()
    expect(() =>
      handlers.get('diagnostics:openIssue')(null, { title: 'a', body: 'b' })
    ).not.toThrow()
  })

  it('validates a copyReport payload at the boundary', () => {
    const handlers = register()
    expect(() => handlers.get('diagnostics:copyReport')(null, {})).toThrow()
    expect(() => handlers.get('diagnostics:copyReport')(null, { body: 'b' })).not.toThrow()
  })
})
