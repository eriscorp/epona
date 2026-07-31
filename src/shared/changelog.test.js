import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { join, dirname } from 'path'
import { parseChangelog, parseInline } from './changelog.js'

const SAMPLE = `# Changelog

Preamble prose that is not part of any release.

<!-- a process comment -->

## [Unreleased]

## [2.7.0] - 2026-07-29

### Security

- **Epona now runs on Electron 41.10.3**, up from 41.2.0 — eight patch
  releases of Chromium security fixes.

### Changed

- **Smaller download.** Removing the duplicates cut the payload.
- A second bullet with \`inline code\` in it.

## [2.6.0] - 2026-07-23

### Added

- An installer.
`

describe('parseChangelog', () => {
  const sections = parseChangelog(SAMPLE)

  it('returns releases in file order, newest first', () => {
    expect(sections.map((s) => s.version)).toEqual(['2.7.0', '2.6.0'])
  })

  it('captures the release date', () => {
    expect(sections[0].date).toBe('2026-07-29')
  })

  it('drops the empty [Unreleased] section of a shipped build', () => {
    expect(sections.some((s) => s.version === 'Unreleased')).toBe(false)
  })

  it('keeps [Unreleased] when it actually has content', () => {
    const withWork = parseChangelog('## [Unreleased]\n\n### Added\n\n- A thing.\n')
    expect(withWork).toHaveLength(1)
    expect(withWork[0].version).toBe('Unreleased')
    expect(withWork[0].groups[0].items).toEqual(['A thing.'])
  })

  it('groups bullets under their ### heading', () => {
    expect(sections[0].groups.map((g) => g.heading)).toEqual(['Security', 'Changed'])
    expect(sections[0].groups[1].items).toHaveLength(2)
  })

  it('folds a hard-wrapped bullet back into one line', () => {
    expect(sections[0].groups[0].items[0]).toBe(
      '**Epona now runs on Electron 41.10.3**, up from 41.2.0 — eight patch releases of Chromium security fixes.'
    )
  })

  it('ignores the preamble and HTML comments above the first release', () => {
    expect(JSON.stringify(sections)).not.toContain('Preamble')
    expect(JSON.stringify(sections)).not.toContain('process comment')
  })

  it('gives an unlabelled group to bullets that precede any ###', () => {
    const flat = parseChangelog('## [1.0.0] - 2026-01-01\n\n- Straight to bullets.\n')
    expect(flat[0].groups).toEqual([{ heading: '', items: ['Straight to bullets.'] }])
  })

  it('returns an empty array for junk input', () => {
    expect(parseChangelog('')).toEqual([])
    expect(parseChangelog(undefined)).toEqual([])
    expect(parseChangelog('# Changelog\n\nNothing released yet.\n')).toEqual([])
  })

  it('parses the real CHANGELOG.md this app ships', () => {
    const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
    const real = parseChangelog(readFileSync(join(root, 'CHANGELOG.md'), 'utf-8'))
    expect(real.length).toBeGreaterThan(0)
    // Every rendered section must have a version and at least one populated group.
    for (const s of real) {
      expect(s.version).toMatch(/^(\d+\.\d+\.\d+|Unreleased)$/)
      expect(s.groups.length).toBeGreaterThan(0)
      for (const g of s.groups) expect(g.items.length).toBeGreaterThan(0)
    }
  })
})

describe('parseInline', () => {
  it('splits bold and code runs out of surrounding text', () => {
    expect(parseInline('a **bold** and `code` end')).toEqual([
      { type: 'text', value: 'a ' },
      { type: 'strong', value: 'bold' },
      { type: 'text', value: ' and ' },
      { type: 'code', value: 'code' },
      { type: 'text', value: ' end' }
    ])
  })

  it('treats ** inside a code span as literal', () => {
    expect(parseInline('`**not bold**`')).toEqual([{ type: 'code', value: '**not bold**' }])
  })

  it('leaves an unmatched marker as literal text', () => {
    expect(parseInline('5 * 3 and a stray ** here')).toEqual([
      { type: 'text', value: '5 * 3 and a stray ** here' }
    ])
  })

  it('handles plain text and empty input', () => {
    expect(parseInline('nothing special')).toEqual([{ type: 'text', value: 'nothing special' }])
    expect(parseInline('')).toEqual([])
    expect(parseInline(undefined)).toEqual([])
  })
})
