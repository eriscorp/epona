import { describe, it, expect } from 'vitest'
import { listVersions, getVersion, detectVersion } from './clientVersions.js'

describe('listVersions', () => {
  it('returns the four supported Dark Ages versions', () => {
    const versions = listVersions()
    expect(versions).toHaveLength(4)
    expect(versions.map((v) => v.versionCode).sort()).toEqual([737, 739, 740, 741])
  })

  it('exposes only name/versionCode/hash (no patch addresses)', () => {
    for (const v of listVersions()) {
      expect(Object.keys(v).sort()).toEqual(['hash', 'name', 'versionCode'])
    }
  })

  it('returns md5 hashes as 32-char hex strings', () => {
    for (const v of listVersions()) {
      expect(v.hash).toMatch(/^[0-9a-f]{32}$/)
    }
  })
})

describe('getVersion', () => {
  it('returns the full entry including BigInt patch addresses for a known versionCode', () => {
    const v = getVersion(737)
    expect(v).not.toBeNull()
    expect(v.name).toBe('US Dark Ages 7.37')
    expect(v.hash).toBe('36f4689b09a4a91c74555b3c3603b196')
    expect(typeof v.hostnamePatchAddress).toBe('bigint')
    expect(typeof v.portPatchAddress).toBe('bigint')
    expect(typeof v.skipIntroPatchAddress).toBe('bigint')
  })

  it('returns null for an unknown versionCode', () => {
    expect(getVersion(999)).toBeNull()
    expect(getVersion(0)).toBeNull()
  })

  it('distinguishes 7.41 with its different patch offsets', () => {
    const v741 = getVersion(741)
    const v740 = getVersion(740)
    expect(v741.hostnamePatchAddress).not.toBe(v740.hostnamePatchAddress)
    expect(v741.skipHostnamePatchAddress).not.toBeNull()
    expect(v740.skipHostnamePatchAddress).toBeNull()
  })
})

describe('detectVersion', () => {
  it('returns { found: false } when the file does not exist', async () => {
    const result = await detectVersion('nonexistent-path-that-should-never-exist.exe')
    expect(result).toEqual({ found: false })
  })
})
