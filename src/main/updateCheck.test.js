import { describe, it, expect, vi, afterEach } from 'vitest'
import { checkForUpdates, __testing } from './updateCheck.js'

const { parseVersion, isNewer } = __testing

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function stubFetch(impl) {
  const fn = vi.fn(impl)
  vi.stubGlobal('fetch', fn)
  return fn
}

function release(body) {
  return { status: 200, ok: true, json: async () => body }
}

describe('parseVersion', () => {
  it('strips a v prefix and pads to three components', () => {
    expect(parseVersion('v2.7')).toEqual([2, 7, 0])
    expect(parseVersion('2.7.2')).toEqual([2, 7, 2])
  })

  it('drops a pre-release suffix', () => {
    // Only the suffix goes; the numeric part in front of it still counts.
    expect(parseVersion('3.0.0-rc.1')).toEqual([3, 0, 0])
  })

  it('returns null rather than a partial parse for junk', () => {
    // A partial parse is the dangerous outcome: [NaN] would compare as 0 and
    // could report a downgrade as an update.
    expect(parseVersion('latest')).toBeNull()
    expect(parseVersion('2.x.1')).toBeNull()
    expect(parseVersion('')).toBeNull()
    expect(parseVersion(null)).toBeNull()
  })
})

describe('isNewer', () => {
  it('compares component by component, not lexically', () => {
    // The case a string compare gets wrong: "2.10.0" < "2.9.0" as text.
    expect(isNewer('2.10.0', '2.9.0')).toBe(true)
    expect(isNewer('2.9.0', '2.10.0')).toBe(false)
  })

  it('is false for the same version', () => {
    expect(isNewer('2.7.2', '2.7.2')).toBe(false)
    expect(isNewer('v2.7.2', '2.7.2')).toBe(false)
  })

  it('is false for an older remote', () => {
    expect(isNewer('2.7.1', '2.7.2')).toBe(false)
  })

  it('is false — never true — when either side will not parse', () => {
    // Unparseable input must fail closed. Nagging every launch about an update
    // that does not exist is worse than missing one.
    expect(isNewer('nightly', '2.7.2')).toBe(false)
    expect(isNewer('2.8.0', 'unknown')).toBe(false)
  })
})

describe('checkForUpdates', () => {
  it('reports an available update with the release metadata', async () => {
    stubFetch(async () =>
      release({
        tag_name: 'v2.8.0',
        html_url: 'https://github.com/eriscorp/epona/releases/tag/v2.8.0',
        name: 'Epona 2.8.0',
        body: 'notes'
      })
    )
    await expect(checkForUpdates('2.7.2')).resolves.toEqual({
      ok: true,
      updateAvailable: true,
      currentVersion: '2.7.2',
      latestVersion: 'v2.8.0',
      releaseUrl: 'https://github.com/eriscorp/epona/releases/tag/v2.8.0',
      releaseName: 'Epona 2.8.0',
      releaseNotes: 'notes'
    })
  })

  it('sends the headers the GitHub API expects', async () => {
    const fetchMock = stubFetch(async () => release({ tag_name: 'v2.7.2' }))
    await checkForUpdates('2.7.2')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.github.com/repos/eriscorp/epona/releases/latest')
    // GitHub rejects an API request with no User-Agent outright.
    expect(init.headers['User-Agent']).toBe('epona-update-check')
    expect(init.headers.Accept).toBe('application/vnd.github+json')
  })

  it('treats 404 as "no releases yet", not as a failure', async () => {
    stubFetch(async () => ({ status: 404, ok: false, json: async () => ({}) }))
    await expect(checkForUpdates('2.7.2')).resolves.toEqual({
      ok: true,
      updateAvailable: false,
      currentVersion: '2.7.2',
      latestVersion: null,
      reason: 'no-releases'
    })
  })

  it('ignores a draft or prerelease latest', async () => {
    stubFetch(async () => release({ tag_name: 'v3.0.0', prerelease: true }))
    await expect(checkForUpdates('2.7.2')).resolves.toMatchObject({
      ok: true,
      updateAvailable: false,
      reason: 'prerelease-only'
    })
  })

  it('returns ok:false on a rate-limit or other error status', async () => {
    stubFetch(async () => ({ status: 403, ok: false, json: async () => ({}) }))
    await expect(checkForUpdates('2.7.2')).resolves.toEqual({
      ok: false,
      error: 'GitHub responded with 403'
    })
  })

  it('never throws when the network is unreachable', async () => {
    // The whole point of the module: a launch on an offline machine must not
    // surface an error, and must not reject into the handler.
    stubFetch(async () => {
      throw new Error('getaddrinfo ENOTFOUND api.github.com')
    })
    await expect(checkForUpdates('2.7.2')).resolves.toEqual({
      ok: false,
      error: 'getaddrinfo ENOTFOUND api.github.com'
    })
  })

  it('reports an abort as a timeout', async () => {
    stubFetch(async () => {
      const err = new Error('aborted')
      err.name = 'AbortError'
      throw err
    })
    await expect(checkForUpdates('2.7.2')).resolves.toEqual({ ok: false, error: 'timeout' })
  })
})
