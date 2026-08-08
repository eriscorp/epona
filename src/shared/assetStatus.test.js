import { describe, it, expect } from 'vitest'
import { describeAssetDir } from './assetStatus.js'

describe('describeAssetDir', () => {
  it('counts the files it found, and gets the singular right', () => {
    expect(describeAssetDir({ ok: true, datCount: 1 })).toBe('1 Dark Ages data file found')
    expect(describeAssetDir({ ok: true, datCount: 12 })).toBe('12 Dark Ages data files found')
  })

  it('says something specific for every reason inspectAssetDir can return', () => {
    // Paired with daAssets.test.js on purpose: a new reason added there without
    // a message here falls through to the generic string, which is how a
    // precise check ends up reported vaguely.
    for (const reason of ['unset', 'missing', 'not-a-directory', 'no-dat-files']) {
      const text = describeAssetDir({ ok: false, reason })
      expect(text).not.toBe('Cannot read that folder')
      expect(text.length).toBeGreaterThan(0)
    }
  })

  it('falls back rather than throwing on an unknown reason', () => {
    expect(describeAssetDir({ ok: false, reason: 'something-new' })).toBe('Cannot read that folder')
  })

  it('renders nothing before the first check comes back', () => {
    expect(describeAssetDir(null)).toBe('')
  })
})
