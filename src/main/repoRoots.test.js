import { describe, it, expect } from 'vitest'
import { join } from 'path'
import { collectConfiguredRepoPaths } from './repoRoots.js'

describe('collectConfiguredRepoPaths', () => {
  it('maps the hybrasyl client csproj to its containing directory', () => {
    const settings = {
      targets: { hybrasyl: { clientRepoPath: join('C', 'src', 'client', 'Client.csproj') } },
      instances: []
    }
    expect(collectConfiguredRepoPaths(settings)).toEqual([join('C', 'src', 'client')])
  })

  it('includes each instance server + xml repo path', () => {
    const settings = {
      targets: { hybrasyl: { clientRepoPath: '' } },
      instances: [
        { serverRepoPath: '/srv/a', xmlRepoPath: '/xml/a' },
        { serverRepoPath: '/srv/b', xmlRepoPath: '' }
      ]
    }
    expect(collectConfiguredRepoPaths(settings)).toEqual(['/srv/a', '/xml/a', '/srv/b'])
  })

  it('gathers client + instance paths together', () => {
    const settings = {
      targets: { hybrasyl: { clientRepoPath: join('D', 'c', 'C.csproj') } },
      instances: [{ serverRepoPath: '/srv', xmlRepoPath: '' }]
    }
    expect(collectConfiguredRepoPaths(settings)).toEqual([join('D', 'c'), '/srv'])
  })

  it('returns [] for empty/missing settings — the shape that regressed', () => {
    expect(collectConfiguredRepoPaths({})).toEqual([])
    expect(collectConfiguredRepoPaths(undefined)).toEqual([])
    // A Promise (the actual bug: load() not awaited) has none of these keys, so
    // the gather must yield nothing rather than throw.
    expect(collectConfiguredRepoPaths(Promise.resolve({}))).toEqual([])
  })
})
