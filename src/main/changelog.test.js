import { describe, it, expect, vi, beforeEach } from 'vitest'

// The backing read for Settings > About > What's New.
//
// This file's own comment used to say no unit test could import it, because
// `__dirname` exists only in the electron-vite CJS bundle. That is not true under
// vitest — vite defines `__dirname` per module — and the path it builds,
// `<module dir>/../../CHANGELOG.md`, lands on the repository's real CHANGELOG.md
// from `src/main`, exactly as it lands on the packaged one from `out/main`. So the
// two-levels-up convention is checkable here rather than only in e2e.
//
// Each test re-imports the module because it memoises after the first read, and a
// cache shared across cases would make the later ones assert nothing.

beforeEach(() => {
  vi.resetModules()
  vi.doUnmock('fs/promises')
})

describe('readChangelog', () => {
  it('finds and parses the CHANGELOG.md two levels above the bundle', async () => {
    // The real file, resolved by the real convention. In a packaged build this is
    // app.asar/out/main -> app.asar/CHANGELOG.md; here it is src/main -> the repo
    // root. A change to that relative path breaks What's New in a packaged build
    // only, which is the sort of thing worth catching before a release.
    const { readChangelog } = await import('./changelog.js')
    const sections = await readChangelog()

    expect(Array.isArray(sections)).toBe(true)
    expect(sections.length).toBeGreaterThan(0)
    expect(sections[0]).toHaveProperty('version')
  })

  it('reads the file once and serves the rest from cache', async () => {
    // The dialog is cheap to reopen and the file cannot change for the life of a
    // build, so a second read would be pure waste.
    let reads = 0
    vi.doMock('fs/promises', () => ({
      readFile: async () => {
        reads++
        return '# Changelog\n\n## [1.0.0] - 2026-01-01\n\n### Added\n\n- A thing\n'
      }
    }))
    const { readChangelog } = await import('./changelog.js')

    const first = await readChangelog()
    const second = await readChangelog()

    expect(reads).toBe(1)
    // The same array, not an equal one — proof it is the cache and not a re-parse.
    expect(second).toBe(first)
  })

  it('parses the version and notes out of the file it reads', async () => {
    vi.doMock('fs/promises', () => ({
      readFile: async () =>
        '# Changelog\n\n## [2.7.2] - 2026-08-01\n\n### Added\n\n- Something visible\n'
    }))
    const { readChangelog } = await import('./changelog.js')
    const [section] = await readChangelog()

    expect(section.version).toBe('2.7.2')
    expect(JSON.stringify(section)).toContain('Something visible')
  })

  it('returns an empty list when the file is missing', async () => {
    // A build that somehow shipped without CHANGELOG.md — it is on the
    // electron-builder `files` allowlist, so a subtraction there is exactly how
    // that happens — must not break the About card. The dialog renders its own
    // "unavailable" state from an empty list.
    vi.doMock('fs/promises', () => ({
      readFile: async () => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      }
    }))
    const { readChangelog } = await import('./changelog.js')
    await expect(readChangelog()).resolves.toEqual([])
  })

  it('returns an empty list rather than throwing on unparseable content', async () => {
    vi.doMock('fs/promises', () => ({ readFile: async () => '' }))
    const { readChangelog } = await import('./changelog.js')
    await expect(readChangelog()).resolves.toEqual([])
  })

  it('caches the empty result too, so a missing file is not re-read forever', async () => {
    let reads = 0
    vi.doMock('fs/promises', () => ({
      readFile: async () => {
        reads++
        throw new Error('ENOENT')
      }
    }))
    const { readChangelog } = await import('./changelog.js')
    await readChangelog()
    await readChangelog()
    // Empty is falsy-ish as an array but `cached` holds [], and [] is truthy — so
    // the second call short-circuits. Pinned because a `cached.length` guard here
    // would silently re-read on every dialog open for a broken build.
    expect(reads).toBe(1)
  })
})

describe('registerChangelogHandlers', () => {
  it('registers the one channel the renderer invokes', async () => {
    const { registerChangelogHandlers } = await import('./changelog.js')
    const handlers = new Map()
    registerChangelogHandlers({ handle: (channel, handler) => handlers.set(channel, handler) })
    expect([...handlers.keys()]).toEqual(['changelog:read'])
  })

  it('answers that channel with the parsed sections', async () => {
    vi.doMock('fs/promises', () => ({
      readFile: async () => '# Changelog\n\n## [3.0.0] - 2026-02-02\n\n### Fixed\n\n- A bug\n'
    }))
    const { registerChangelogHandlers } = await import('./changelog.js')
    const handlers = new Map()
    registerChangelogHandlers({ handle: (channel, handler) => handlers.set(channel, handler) })

    const sections = await handlers.get('changelog:read')()
    expect(sections[0].version).toBe('3.0.0')
  })
})
