import { describe, it, expect } from 'vitest'
import { resolveVersionCode, supportsPatch } from './runtimePatchGate.js'

const VERSIONS = [
  { versionCode: 737, runtimePatches: [] },
  { versionCode: 740, runtimePatches: [] },
  { versionCode: 741, runtimePatches: ['groundItemHints'] }
]

describe('resolveVersionCode', () => {
  it('uses the explicit choice when one is set', () => {
    expect(resolveVersionCode(741, 737)).toBe(741)
    expect(resolveVersionCode('740', 741)).toBe(740)
  })

  it('falls back to the detected version on auto', () => {
    expect(resolveVersionCode('auto', 741)).toBe(741)
  })

  it('is null when nothing is known yet', () => {
    // No client path picked, or the exe hashed to nothing we recognise.
    expect(resolveVersionCode('auto', null)).toBe(null)
    expect(resolveVersionCode(undefined, undefined)).toBe(null)
    expect(resolveVersionCode('nonsense', null)).toBe(null)
  })
})

describe('supportsPatch', () => {
  it('is true only for a version that advertises the patch', () => {
    expect(supportsPatch(VERSIONS, 741, 'groundItemHints')).toBe(true)
    expect(supportsPatch(VERSIONS, 740, 'groundItemHints')).toBe(false)
    expect(supportsPatch(VERSIONS, 737, 'groundItemHints')).toBe(false)
  })

  it('is false for an unknown version, an unknown patch, or before the list loads', () => {
    expect(supportsPatch(VERSIONS, 999, 'groundItemHints')).toBe(false)
    expect(supportsPatch(VERSIONS, 741, 'somethingElse')).toBe(false)
    expect(supportsPatch([], 741, 'groundItemHints')).toBe(false)
    expect(supportsPatch(undefined, 741, 'groundItemHints')).toBe(false)
  })

  it('is false when no version is resolved', () => {
    // The option must not appear just because a list is present.
    expect(supportsPatch(VERSIONS, null, 'groundItemHints')).toBe(false)
  })
})
