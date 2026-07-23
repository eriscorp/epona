import { describe, it, expect } from 'vitest'
import { listVersions, getVersion, detectVersion, supportsRuntimePatch } from './clientVersions.js'

describe('listVersions', () => {
  it('returns the four supported Dark Ages versions', () => {
    const versions = listVersions()
    expect(versions).toHaveLength(4)
    expect(versions.map((v) => v.versionCode).sort()).toEqual([737, 739, 740, 741])
  })

  it('exposes only identity + capabilities, never patch addresses', () => {
    for (const v of listVersions()) {
      // runtimePatches is a capability list ("this build supports the ground-item
      // hook"), not an address — the renderer needs it to decide whether to offer
      // the option. Actual patch addresses must never cross the IPC boundary.
      expect(Object.keys(v).sort()).toEqual(['hash', 'name', 'runtimePatches', 'versionCode'])
      expect(Object.keys(v).some((k) => /address/i.test(k))).toBe(false)
      expect(Array.isArray(v.runtimePatches)).toBe(true)
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

describe('supportsRuntimePatch', () => {
  it('offers the ground-item hook only on 7.41', () => {
    // The hook sites, helper functions and vtable it relocates against were
    // mapped for that build alone; the other three have different layouts, so
    // installing there would corrupt the client.
    expect(supportsRuntimePatch(741, 'groundItemHints')).toBe(true)
    for (const code of [737, 739, 740]) {
      expect(supportsRuntimePatch(code, 'groundItemHints')).toBe(false)
    }
  })

  it('is false for an unknown version or an unknown patch', () => {
    expect(supportsRuntimePatch(999, 'groundItemHints')).toBe(false)
    expect(supportsRuntimePatch(741, 'notARealPatch')).toBe(false)
    expect(supportsRuntimePatch(undefined, 'groundItemHints')).toBe(false)
  })
})

describe('getVersion accepts either form the settings can hold', () => {
  it('takes a numeric code (what the Settings <Select> stores)', () => {
    expect(getVersion(741)?.versionCode).toBe(741)
  })

  it('takes a numeric string (what older settings.json files hold)', () => {
    expect(getVersion('741')?.versionCode).toBe(741)
  })

  it('is null for "auto" and for anything unrecognised', () => {
    // Callers resolve 'auto' by hashing the exe before they get here.
    expect(getVersion('auto')).toBe(null)
    expect(getVersion(999)).toBe(null)
    expect(getVersion(null)).toBe(null)
    expect(getVersion(undefined)).toBe(null)
  })
})
